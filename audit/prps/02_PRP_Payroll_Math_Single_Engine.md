# 02_PRP_Payroll_Math_Single_Engine

**Status:** Draft — awaiting domain-confirmation sign-offs before release to build  
**Owner:** StantonManagement  
**Created:** 2026-06-13  
**Estimated effort:** 3–5 days [Speculation — depends on OT/salaried domain confirmations and test fixture build]  
**Depends on:** `01_PRP_RLS_Authz_Remediation` — do not start this PRP while write paths on payroll tables are unauthenticated (PRP-01 must land first so no data-layer mutations happen over broken authz)  
**Reads with:** `PAYROLL_RESPINE_AUDIT_2026-06-13.md` (Part C correctness findings, Part F open decisions), `STANTON-spec-standard.md` §3/§4/§5

---

## 1. Problem Statement

Gross pay is computed three times in three places, and the three results have already diverged on every week that contains overtime, an advance, or a salaried employee. The on-screen figure, the ADP export, and the reconciliation system total are not guaranteed to be equal.

1. **No overtime premium (C-1).** `calculations.ts:129` computes OT wages as `ot_hours * rate` (1×). The 0.5× premium is absent in all three implementations. `ot_allowed` is stored in the schema but is dead code. Systematic FLSA underpayment.

2. **Effective-dated rates ignored (C-2).** `resolveRateAsOf` is exported but never called anywhere. All three implementations read the live `emp.hourly_rate` or `emp.weekly_rate`. A rate change retroactively reprices every historical week that shares the same active employee record.

3. **Mgmt-fee rate uses today, not the week start (C-5).** `getMgmtFeeRate` filters configs with `new Date()` (`calculations.ts:74`). Historical weeks are repriced whenever a fee config row changes.

4. **Salaried labor excluded from property cost (C-6).** Method A (`calculations.ts:185-194`) iterates `entries` and multiplies hourly hours by `hourly_rate`. Salaried employees have no `hourly_rate` entries contributing to this loop, so no property cost is charged for their work. LLCs are systematically underbilled.

5. **Two conflicting management-fee bases; prefund excludes fee (C-7).** Per-employee management fee (`calculations.ts:164`) uses the global `getMgmtFeeRate(null, …) × gross`. Per-property fee (`calculations.ts:212`) uses the portfolio-specific rate × `(labor + spread)`. `total_mgmt_fee` (`l.231`) sums the per-employee amounts. `required_prefund` (`l.232`) excludes management fee entirely. The two fee computations are inconsistent and neither aligns with the property-level billing output.

6. **Reconciliation sign error on advances (C-3).** `useADPReconciliation.ts:79`: every adjustment amount — including advances — is *added* to `empGross`. Advances should reduce gross. Every week with an advance produces a false variance of `2 × advance_amount` against ADP.

7. **Reconciliation fire-and-forget + null-deref crash (C-13).** `useADPReconciliation.saveUpload` insert branch (`l.110-118`): Supabase `.insert().select().single()` error is not checked; `ins!.id` will throw a null-deref when the insert fails. DB writes are fire-and-forget throughout `saveUpload` and `saveManual`.

8. **Multi-allocation split does not conserve hours (C-11).** `workyard-api.ts:318-335` rounds each allocation leg independently with no largest-remainder correction; the sum of rounded legs does not equal the Workyard canonical total.

9. **Tax base over-broad (C-MED).** `calculations.ts:161` includes `phone_reimbursement` and `other_adjustments` in `gross_pay`, which is also the tax/WC base. Reimbursements are not taxable wages; advances should not reduce the tax base.

**Construction note on C-3 and C-13:** once the ADP-export page and `useADPReconciliation` are refactored to call `calculatePayroll` rather than re-deriving gross, C-3 (sign error) and C-13 (fire-and-forget + null-deref in the recon gross path) are eliminated by the removal of the duplicated logic. They are listed here for completeness but do not require independent fixes.

---

## 2. Evidence Baseline

| ID | Claim | Location | Evidence | Status |
|----|-------|----------|----------|--------|
| C-1 | OT computed at 1×, no premium | `calculations.ts:129` | `empData[entry.employee_id].ot_wages += (entry.ot_hours ?? 0) * rate` — no `* 1.5`; same pattern in adp-export `page.tsx:68` and `useADPReconciliation.ts:74` | Verified |
| C-1b | `ot_allowed` is dead code | `calculations.ts` (entire file) | Column exists on `PayrollEmployee` type; never read in any computation | Verified |
| C-2 | `resolveRateAsOf` never called | `calculations.ts:16-26` | Exported but not imported in any other file in `src/` | Verified |
| C-2b | All impls use live `emp.hourly_rate` | `calculations.ts:124`, `page.tsx:67`, `useADPReconciliation.ts:74` | Direct property reads, no rate-history lookup | Verified |
| C-3 | Advance sign error in recon hook | `useADPReconciliation.ts:79` | `empGross[adj.employee_id] += Number(adj.amount)` — advances are negative amounts but the loop does not filter or negate them separately | Verified |
| C-5 | Fee-rate filter uses `new Date()` | `calculations.ts:74` | `c => new Date(c.effective_date) <= new Date()` — `weekStart` not in scope | Verified |
| C-6 | Salaried labor absent from property cost | `calculations.ts:185-194` | Loop over `entries`; salaried employees have entries but `emp.hourly_rate` is typically `null` for salaried type; `weekly_rate` never referenced in this loop | Verified |
| C-7a | Per-employee fee uses global rate | `calculations.ts:164` | `getMgmtFeeRate(null, mgmtFeeConfigs)` — `null` forces global fallback regardless of property | Verified |
| C-7b | Per-property fee uses portfolio rate | `calculations.ts:212` | `getMgmtFeeRate(prop.portfolio_id, mgmtFeeConfigs)` — correct call | Verified |
| C-7c | `total_mgmt_fee` aggregates employee fees | `calculations.ts:231` | `employee_summaries.reduce((s, e) => s + e.management_fee, 0)` — sums per-employee; not the sum of property fees | Verified |
| C-7d | `required_prefund` excludes fee | `calculations.ts:232` | `gross_pay + payroll_tax + workers_comp` only | Verified |
| C-11 | Multi-allocation split rounds independently | `workyard-api.ts:318-335` | Each allocation leg rounded with `Math.round`; no residue/largest-remainder correction | Verified |
| C-13a | `ins!.id` null-deref path | `useADPReconciliation.ts:117` | `const { data: ins } = …insert…select().single()` — `.error` unchecked before `ins!.id` | Verified |
| C-13b | `saveUpload`/`saveManual` writes fire-and-forget | `useADPReconciliation.ts:100-128` | No `await`-checked error on `.update()`, `.delete()`, `.insert()` calls | Verified |
| C-MED | Tax base includes phone + reimbursements | `calculations.ts:161` | `gross_pay = regular_wages + ot_wages + phone_reimbursement + other_adjustments - advances` — phone is in the sum and thus in the tax base | Verified |
| ADP-dup | ADP-export page re-derives gross | `page.tsx:50-88` | Entire local `summary` accumulation loop; does not import or call `calculatePayroll` | Verified |
| RECON-dup | Recon hook re-derives gross | `useADPReconciliation.ts:62-88` | Entire local `empGross` accumulation loop; does not import or call `calculatePayroll` | Verified |

---

## 3. Users and Roles

**In scope for v1:**
- Payroll operator (runs weekly payroll, exports to ADP, reviews reconciliation)
- Payroll admin (configures management fee rates, employee rates)
- Any automated agent or server action that invokes `calculatePayroll`

**Out of scope for v1:**
- Multi-company / multi-portfolio tenancy isolation (a PRP-01 and future portfolio-RLS concern)
- UI redesign of the ADP-export page or reconciliation page beyond the data-source swap
- Approval/locking enforcement (PRP-04)
- Test infrastructure and CI scaffolding (PRP-05; the golden-week fixture in this PRP's DoD is a precursor, not a replacement)

---

## 4. Core Features

The single named action after this PRP lands:

```typescript
calculatePayroll(
  employees:      PayrollEmployee[],
  entries:        PayrollTimeEntry[],
  adjustments:    PayrollAdjustment[],
  mgmtFeeConfigs: PayrollManagementFeeConfig[],
  properties:     Property[],
  allRates:       PayrollEmployeeRate[],   // NEW — was absent; enables resolveRateAsOf
  weekStart:      string                   // NEW — ISO date "YYYY-MM-DD"; used by resolveRateAsOf + getMgmtFeeRate
) → PayrollCalculationResult
```

`PayrollCalculationResult` retains its current shape. The two new parameters (`allRates`, `weekStart`) make the function deterministic for any historical week.

### Feature list

**CF-1 — Effective-dated hourly rates (fixes C-2)**  
For each hourly time entry, resolve the effective rate using `resolveRateAsOf(employee_id, weekStart, allRates, emp.hourly_rate)`. The existing `resolveRateAsOf` implementation is correct; it only needs to be called. If `allRates` is empty or no record matches, fall back to `emp.hourly_rate` (existing behavior, no regression).

**CF-2 — Overtime premium at 1.5× gated on `ot_allowed` (fixes C-1)**  
OT wages = `ot_hours × resolvedRate × (emp.ot_allowed ? 1.5 : 1.0)`.  
`ot_allowed` defaults to `false` on the `PayrollEmployee` type, so any employee without the flag set continues to receive 1× until the operator sets it. [Needs domain confirmation — see Open Decision OD-1]

**CF-3 — Salaried employee property-cost allocation (fixes C-6)**  
For salaried employees (`emp.type === 'salaried'`), derive an effective hourly cost rate of `weekly_rate / 40`. Allocate that cost to properties using the same time-entry `property_id` proportionality as hourly employees. If no entries exist for the week, no cost is allocated (the salaried wage still flows to the employee summary). [Needs domain confirmation — see Open Decision OD-2]

**CF-4 — Corrected tax and WC base (fixes C-MED)**  
The tax/WC base is `regular_wages + ot_wages` only. `phone_reimbursement`, `other_adjustments`, and advances are excluded from the tax base. Gross pay (the sum reported to ADP) remains `regular_wages + ot_wages + phone_reimbursement + other_adjustments − advances` to match current ADP expectations. The two values (`taxable_wages` and `gross_pay`) are tracked separately in `EmployeePaySummary`. [Needs domain confirmation — see Open Decision OD-3]

**CF-5 — Property-authoritative management fee, consistent total (fixes C-7)**  
`getMgmtFeeRate` receives `weekStart` (not `new Date()`). The per-employee `management_fee` field on `EmployeePaySummary` is removed or zeroed; it was a by-product of the now-replaced employee-level fee calculation. `total_mgmt_fee` in `PayrollCalculationResult` becomes the sum of `property_costs[*].mgmt_fee` (the portfolio-rate × (labor+spread) path, which already exists at `calculations.ts:212` and is correct). [Needs domain confirmation — see Open Decision OD-4]

**CF-6 — Prefund fee inclusion (fixes C-7d)**  
`required_prefund` formula to confirm: `gross_pay + payroll_tax + workers_comp [+ total_mgmt_fee?]`. [Needs domain confirmation — see Open Decision OD-5]

**CF-7 — ADP-export page calls `calculatePayroll` (collapses ADP-dup)**  
`src/app/payroll/[weekId]/adp-export/page.tsx` fetches the two new data sets (`payroll_employee_rates`, week `week_start`) in its existing `Promise.all`, passes them to `calculatePayroll`, and maps `employee_summaries` to `ADPRow`. The local `summary` accumulation loop is deleted.

**CF-8 — `useADPReconciliation` calls `calculatePayroll` (collapses RECON-dup, fixes C-3, fixes C-13)**  
`useADPReconciliation.load()` fetches `payroll_employee_rates` and passes all inputs to `calculatePayroll`. The local `empGross` loop is deleted. `systemEmployees` is mapped from `employee_summaries`. All Supabase writes in `saveUpload` and `saveManual` check `.error` and surface it via `setError`; `ins!.id` is guarded.

**CF-9 — Multi-allocation largest-remainder (fixes C-11)**  
In `workyard-api.ts`, after rounding each allocation leg, compute the total rounding residue (`canonical_total − sum(rounded_legs)`) and add it as a +1-cent correction to the leg with the largest fractional part (standard largest-remainder). The corrected legs' sum must equal the canonical total (enforced by an assertion in the test fixture).

---

## 5. Data Model

No new tables. No schema migration.

### Type changes (TypeScript only)

**`EmployeePaySummary` — add `taxable_wages`, clarify `management_fee`**

```typescript
export interface EmployeePaySummary {
  // ... existing fields unchanged ...
  taxable_wages: number        // NEW: regular_wages + ot_wages only (tax/WC base)
  // management_fee: number    // CHANGE: will be 0 for all employees (fee is now property-level only)
                               // Field retained for backward compat; callers should use
                               // PayrollCalculationResult.total_mgmt_fee
}
```

**`calculatePayroll` signature** — two new required parameters appended:

```typescript
export function calculatePayroll(
  employees:      PayrollEmployee[],
  entries:        PayrollTimeEntry[],
  adjustments:    PayrollAdjustment[],
  mgmtFeeConfigs: PayrollManagementFeeConfig[],
  properties:     Property[],
  allRates:       PayrollEmployeeRate[],  // NEW
  weekStart:      string                  // NEW
): PayrollCalculationResult
```

**`getMgmtFeeRate` signature** — `weekStart` replaces the implicit `new Date()`:

```typescript
export function getMgmtFeeRate(
  portfolioId: string | null,
  configs:     PayrollManagementFeeConfig[],
  weekStart:   string   // NEW: ISO date; replaces new Date() inside the function
): number
```

### `PayrollEmployeeRate` (existing table, no change)

Already has `employee_id`, `effective_date`, `rate`. No column additions needed.

---

## 6. Integration Points

| System | Hook | Direction | Change |
|--------|------|-----------|--------|
| `calculations.ts` | `calculatePayroll` | called by page + hook | Add `allRates`, `weekStart` params; fix math |
| `calculations.ts` | `getMgmtFeeRate` | called by `calculatePayroll` | Add `weekStart` param; remove `new Date()` |
| `calculations.ts` | `resolveRateAsOf` | called by `calculatePayroll` | No change to impl; just call it |
| `adp-export/page.tsx` | `useEffect` load | replaces local loop | Fetch `payroll_employee_rates` + `week_start`; call `calculatePayroll`; delete local accumulation |
| `useADPReconciliation.ts` | `load` callback | replaces local loop | Same fetch additions; call `calculatePayroll`; delete local `empGross` loop; guard all DB writes |
| `workyard-api.ts` | allocation split (lines 318-335) | internal | Largest-remainder rounding correction |
| `payroll_employee_rates` table | Supabase read | new read in two callers | No schema change; add `select('*').eq('payroll_week_id', …)` — actually keyed on `employee_id`, no week filter |
| `payroll_weeks` | already fetched | read | `week_start` string passed down; no new fetch |

---

## 7. Affected Files

| File | Change | Type |
|------|--------|------|
| `src/lib/payroll/calculations.ts` | Signature change + all 6 math fixes (CF-1 through CF-6) | Modified |
| `src/app/payroll/[weekId]/adp-export/page.tsx` | Remove local accumulation loop; fetch `payroll_employee_rates`; call `calculatePayroll`; map result to `ADPRow` | Modified |
| `src/hooks/payroll/useADPReconciliation.ts` | Remove local `empGross` loop; fetch `payroll_employee_rates`; call `calculatePayroll`; guard all DB writes; map `employee_summaries` | Modified |
| `src/lib/payroll/workyard-api.ts` | Lines 318-335: largest-remainder rounding correction | Modified |
| Any page/hook that calls `calculatePayroll` directly [Inference — grep needed in Phase 1] | Add `allRates` + `weekStart` arguments | Modified |
| `src/lib/payroll/calculations.test.ts` | New — golden-week fixture (see Definition of Done) | New |

---

## 8. Implementation Phases

Each phase is independently shippable and reversible. Phase 1 gates the build on verified facts.

---

### Phase 1 — Confirm callers and resolve `[Unverified]` items

**Steps:**

1a. Grep for all calls to `calculatePayroll` across `src/`:  
    `grep -rn "calculatePayroll" src/`  
    Expected: the two confirmed callers (adp-export page, useADPReconciliation) plus any others. Document all callers — each must be updated in Phase 3.

1b. Grep for all calls to `getMgmtFeeRate` across `src/`:  
    `grep -rn "getMgmtFeeRate" src/`  
    Expected: called only inside `calculatePayroll`. If called from elsewhere, add those callers to the affected-files list.

1c. Grep for `resolveRateAsOf` import/call sites:  
    `grep -rn "resolveRateAsOf" src/`  
    Expected: exported in `calculations.ts`, imported nowhere — confirms C-2.

1d. Confirm `payroll_employee_rates` table exists and is populated:  
    Supabase `list_tables` or `execute_sql`:  
    `SELECT COUNT(*) FROM payroll_employee_rates;`  
    If zero rows: `allRates = []` triggers the `resolveRateAsOf` fallback (no regression), but effective-dating has no data. Note in the decisions log.

1e. Confirm `PayrollEmployee.ot_allowed` column exists in the live DB:  
    `SELECT column_name FROM information_schema.columns WHERE table_name='payroll_employees' AND column_name='ot_allowed';`  
    If absent: OD-1 default must be `ot_multiplier = 1.0` for all employees and the column addition becomes a schema-hook task for PRP-05. [Unverified — becomes a go/no-go gate]

**Verification:** all greps return and results are documented; `payroll_employee_rates` existence confirmed; `ot_allowed` presence confirmed or absence noted.

---

### Phase 2 — Fix `calculations.ts` (the single engine)

**Steps** (all within `calculations.ts`; no callers touched yet):

2a. Change `getMgmtFeeRate` signature to accept `weekStart: string`; replace `new Date()` filter with `new Date(c.effective_date) <= new Date(weekStart + 'T00:00:00')`.

2b. Change `calculatePayroll` signature: add `allRates: PayrollEmployeeRate[]` and `weekStart: string` as the 6th and 7th parameters.

2c. In the time-entry loop (`l.120-130`): replace `emp.hourly_rate ?? 0` with `resolveRateAsOf(entry.employee_id, weekStart, allRates, emp.hourly_rate ?? 0)`.

2d. In the time-entry loop: change OT wages to `(entry.ot_hours ?? 0) * resolvedRate * (emp.ot_allowed ? 1.5 : 1.0)`.

2e. Add salaried-to-property allocation (CF-3) in the Method A block after the hourly loop: for each salaried employee, compute `effectiveCostRate = emp.weekly_rate / 40`, iterate their entries, and accumulate `propLaborCost[entry.property_id]` by `(entry.regular_hours ?? 0) * effectiveCostRate`.

2f. Add `taxable_wages` field: computed as `regular_wages + ot_wages` before the adjustment loop. Add it to `EmployeePaySummary`. Change `payroll_tax` and `workers_comp` to use `taxable_wages` as the base, not `gross_pay`.

2g. Change `total_mgmt_fee` aggregation: `property_costs.reduce((s, p) => s + p.mgmt_fee, 0)` (sum of property fees). Zero out `employee_summaries[*].management_fee` (keep the field, set to 0 — no callers break). Update `getMgmtFeeRate` call inside `calculatePayroll` employee loop to pass `weekStart`.

2h. `required_prefund`: to be updated once OD-5 is confirmed. In the interim, retain the existing formula to avoid unintentional cash-flow impact.

**Verification:**  
- `grep "new Date()" src/lib/payroll/calculations.ts` returns zero results.  
- `grep "resolveRateAsOf" src/lib/payroll/calculations.ts` shows a call inside the entry loop.  
- TypeScript compilation passes (`npx tsc --noEmit`).  
- The golden-week test fixture (Phase 5) is written against Phase 2 before callers are changed.

---

### Phase 3 — Update callers: ADP-export page

**Steps** (within `adp-export/page.tsx`):

3a. Add `payroll_employee_rates` to the `Promise.all` fetch (keyed by `payroll_week_id` or all active rates — see Phase 1 result).  
    `supabase.from('payroll_employee_rates').select('*')`

3b. Extract `week_start` from `weekRes.data.week_start`.

3c. Import `calculatePayroll` from `@/lib/payroll/calculations`. Call it:  
    `const result = calculatePayroll(employees, entries, adjustments, [], properties, allRates, weekStart)`  
    (mgmtFeeConfigs can be `[]` on the export page — the ADP export does not show management fees; or fetch them if the gross_pay is affected by CF-5. [Inference — check whether adp-export page needs fee configs])

3d. Map `result.employee_summaries` to `ADPRow`. Delete the local `summary` accumulation block (lines 50-88 of current `page.tsx`).

**Verification:**  
- `grep "summary\[" src/app/payroll/\[weekId\]/adp-export/page.tsx` returns zero results.  
- Load the ADP export page in dev for a week with a salaried employee — the gross matches the main payroll screen.  
- Load for a week with an advance — gross is net-of-advance consistently across screen + export.

---

### Phase 4 — Update callers: `useADPReconciliation`

**Steps** (within `useADPReconciliation.ts`):

4a. Add `payroll_employee_rates` to the `Promise.all` fetch in `load`.

4b. Import `calculatePayroll`; call it with all inputs including `allRates` and `weekRes.data.week_start`.

4c. Map `result.employee_summaries` to `SystemEmployeeRow`. Delete the local `empGross` and `empMap` accumulation blocks (lines 62-88 of current hook).

4d. Guard all DB writes: wrap every `.update()`, `.delete()`, `.insert()` with error checks; surface via `setError`. Protect `ins!.id` with:  
    ```typescript
    if (!ins || insError) { setError(insError?.message ?? 'Failed to create reconciliation'); return }
    reconId = ins.id
    ```

**Verification:**  
- `grep "empGross" src/hooks/payroll/useADPReconciliation.ts` returns zero results.  
- Load the reconciliation page for a week with an advance; `system_gross` matches the ADP export gross (zero variance from the deduplication, all else equal).  
- Simulate an insert failure (e.g., offline Supabase) — `error` state is set and displayed; no crash.

---

### Phase 5 — Golden-week test fixture

**Steps:**

5a. Create `src/lib/payroll/calculations.test.ts`.

5b. Build one fixture week containing all four discriminating cases:
- One hourly employee with OT hours and `ot_allowed = true` → expect OT wages at 1.5×.
- One adjustment of type `advance` → expect it to reduce `gross_pay` but not `taxable_wages` (tax base unchanged).
- One salaried employee with `weekly_rate` and time entries across two properties → expect property labor cost to include their allocated cost.
- One mid-week rate change (two `PayrollEmployeeRate` rows — one before `weekStart`, one after) → expect the earlier rate to be used.

5c. Assert: `calculatePayroll(…).employee_summaries[OT employee].ot_wages` equals `ot_hours × rate × 1.5`.

5d. Assert: `calculatePayroll(…).employee_summaries[advance employee].taxable_wages` excludes the advance amount.

5e. Assert: salaried employee's time entries produce non-zero `propLaborCost` entries for their properties.

5f. Assert: rate-change employee uses the pre-`weekStart` rate, not the post-`weekStart` rate.

5g. For the spread allocation (CF-9 / C-11): build a case where 1.0 hour is split across 3 properties with unequal unit weights. Assert `sum(legs) === canonical_total` to the penny.

5h. Assert that `calculatePayroll` result's `total_gross_pay` matches `adp-export`-equivalent mapping and `useADPReconciliation`-equivalent mapping (they now share the same engine — this is a type-level guarantee, but an integration smoke test covers the shared call path).

**Verification:**  
- `npx vitest run src/lib/payroll/calculations.test.ts` (or Jest equivalent) exits 0.  
- All five fixture cases pass and are printed to stdout.

---

### Phase 6 — Fix workyard-api.ts multi-allocation split (C-11)

**Steps** (within `workyard-api.ts:318-335`):

6a. After computing all raw (unrounded) allocation legs, round each to 2 decimal places.

6b. Compute `residue = canonical_total − sum(rounded_legs)`, rounded to cents.

6c. If `residue !== 0`, find the leg with the largest positive fractional part and add `residue` to it.

6d. Add an assertion (or a `console.error` guard in production): `Math.abs(sum(corrected_legs) − canonical_total) < 0.005`.

**Verification:**  
- Run the golden-week fixture test from Phase 5 (step 5g) — passes.  
- Manual test: import a timecard with a 3-way split; verify the leg totals equal the Workyard card total.

---

## 9. Open Decisions

| ID | Question | Defensible Default | Label |
|----|----------|--------------------|-------|
| OD-1 | Is OT premium 1.5× intended, and should it be gated on `ot_allowed` (i.e., only employees with the flag set earn time-and-a-half)? | Yes, 1.5× gated on `ot_allowed = true`; employees without the flag continue at 1× until the operator sets it | [Needs domain confirmation] |
| OD-2 | For salaried employees, is the property allocation rate `weekly_rate / 40` allocated proportionally by recorded hours? | Yes — `weekly_rate / 40` as the effective hourly cost; allocate by `entry.regular_hours / total_salaried_hours_that_week * weekly_rate` | [Needs domain confirmation] |
| OD-3 | Does the tax and WC base exclude phone reimbursements and `other_adjustments`, and are advances excluded from the tax base rather than reducing it? | Yes — taxable base = `regular_wages + ot_wages` only; advances do not affect taxable wages | [Needs domain confirmation] |
| OD-4 | Is the property-level portfolio fee authoritative for billing purposes, with `total_mgmt_fee` being the sum of property fees (not the per-employee global-rate fee)? | Yes — property-level fee is authoritative; per-employee `management_fee` field is deprecated to 0 | [Needs domain confirmation] |
| OD-5 | Does `required_prefund` include management fee (i.e., is the fee collected at prefund time)? | Exclude fee from prefund (current behavior) unless the org confirms upfront fee collection | [Needs domain confirmation] |
| OD-6 | If `ot_allowed` column is absent from the live `payroll_employees` table (Phase 1 gate): should the build proceed with `ot_multiplier = 1.0` for all employees and a schema-hook column addition deferred to PRP-05? | Yes — proceed with 1.0 for all; column addition is a PRP-05 schema-hook | [Unverified — Phase 1 gate] |

---

## 10. Out of Scope

- Multi-portfolio / multi-company tenancy. RLS portfolio scoping is a PRP-01 and deferred-branch concern.
- Approval and locking enforcement. PRP-04.
- Test infrastructure, CI, and typecheck gate. PRP-05 (the golden-week fixture in this PRP is a precursor, not a replacement).
- UI redesign of the ADP export or reconciliation pages (layout, UX).
- Invoice and statement generator refactoring.
- Ingestion correctness items: first-name-only matching (C-8), silent double-import (C-10), European comma-decimal (C-MED). These are in PRP-05's error-handling sweep.
- Storage orphan fix (C-4). Separate concern.
- All Part C security findings. PRP-01 and PRP-03.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Signature change to `calculatePayroll` breaks an undiscovered caller | Medium | Phase 1 grep confirms all callers before Phase 2 modifies the signature; TypeScript `--noEmit` catches missed updates |
| Domain confirmation on OD-1 (OT gating) not obtained before build | Medium | Default is conservative (1× until flag set) — no employee is overpaid; the operator can set `ot_allowed` per employee at any time |
| `payroll_employee_rates` has zero rows (Phase 1 gate) | Medium | `resolveRateAsOf` falls back to `emp.hourly_rate` — identical to current behavior; no regression; document in decisions log |
| `ot_allowed` column absent from live DB (Phase 1 gate) | Low-Medium | OD-6 default: 1× for all; column addition is a cheap schema hook; note in decisions log |
| Golden-week fixture reveals an undiscovered discrepancy between old and new engine for non-OT/non-advance weeks | Low | Run old and new implementations in parallel for one real historical week before deleting old code (Phase 3 can soft-delete rather than hard-delete the accumulation loops until Phase 5 fixture passes) |
| ADP export page passes empty `mgmtFeeConfigs` (inference risk from Phase 3) | Low | `getMgmtFeeRate` returns the hard-coded fallback `0.10` on empty array — same as today; gross pay is unaffected; document in Phase 3 |
| Largest-remainder fix changes a previously-exported allocation split for a live week | Low | The fix only affects future ingestion runs; historical `payroll_time_entries` rows already written are not reprocessed |

---

## 12. Definition of Done

**Operator-observable:**
1. The payroll main screen (week view), the ADP export CSV, and the reconciliation `system_gross` column show **the same gross-pay figure for every employee** for any given week — including weeks with OT, advances, or salaried employees.
2. A week with a known OT employee shows OT wages at 1.5× (if `ot_allowed = true`) on every screen.
3. An employee whose rate changed mid-history shows the historically-correct rate when an earlier week is loaded (not the current rate).
4. Salaried employees' cost appears in the property cost breakdown.

**System/test-observable:**
5. `npx vitest run src/lib/payroll/calculations.test.ts` exits 0 with the following fixture cases all passing:
   - OT employee: `ot_wages === ot_hours × rate × 1.5`
   - Advance employee: `taxable_wages` is unchanged by the advance; `gross_pay` is net-of-advance
   - Salaried employee: property labor cost is non-zero for their entry properties
   - Rate-change employee: calculation uses the pre-`weekStart` rate
   - Multi-allocation split: `sum(legs) === canonical_total` to the penny (largest-remainder)
6. `grep -rn "empGross\|summary\[e\.id\]" src/` returns zero results (local accumulation loops deleted).
7. `grep "new Date()" src/lib/payroll/calculations.ts` returns zero results.
8. `npx tsc --noEmit` exits 0.
9. `grep "ins!\.id" src/hooks/payroll/useADPReconciliation.ts` returns zero results (null-deref guarded).

---

## 13. Rollback

| Phase | What was changed | Rollback action |
|-------|-----------------|-----------------|
| Phase 1 | Read-only investigation | N/A — no code changed |
| Phase 2 | `calculations.ts` signature + math | `git revert` the Phase 2 commit; no DB change; callers still pass the old signature until Phase 3 |
| Phase 3 | `adp-export/page.tsx` | `git revert` the Phase 3 commit; page reverts to local loop (old math); independent of Phase 4 |
| Phase 4 | `useADPReconciliation.ts` | `git revert` the Phase 4 commit; hook reverts to local loop (old math); independent of Phase 3 |
| Phase 5 | Test fixture | Delete `calculations.test.ts`; no runtime impact |
| Phase 6 | `workyard-api.ts` allocation split | `git revert` the Phase 6 commit; future ingestion runs revert to independent-rounding behavior; historical entries are unaffected |

No database migrations are part of this PRP. Full rollback is a single `git revert` per phase commit.

---

## 14. Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-13 | Scope limited to math correctness and engine consolidation; auth, CI, and schema-in-migrations deferred | The money path is actively wrong (FLSA OT, repriced historical weeks). This PRP must land after PRP-01 (authz) and before PRP-05 (tests/CI) because the golden-week fixture here is the seed for the broader reliability substrate. |
| 2026-06-13 | `EmployeePaySummary.management_fee` retained at 0 rather than removed | Removing a field from a public interface is a breaking change for any future callers; zeroing it is non-breaking and signals the deprecation without a hard removal. |
| 2026-06-13 | `required_prefund` formula change deferred pending OD-5 confirmation | Changing the prefund amount has immediate cash-flow impact; must be a deliberate operator decision, not an inference from the audit. |
| 2026-06-13 | Phase ordering puts the test fixture (Phase 5) after the engine fix (Phase 2) and before the accumulation-loop deletions become permanent | The fixture acts as the acceptance gate: if Phase 2 is wrong, the fixture reveals it before Phase 3/4 delete the old code. |

---

## 15. Spec Self-Score (§5 nine-element Y/P/N)

| # | Element | Score | Note |
|---|---------|-------|------|
| 1 | Problem statement | Y | Nine numbered defects, each with file:line evidence |
| 2 | Users and roles | Y | Operator, admin, agent listed; out-of-scope users named |
| 3 | Numbered features | Y | CF-1 through CF-9, each a named typed action or precise behavior |
| 4 | Data model | Y | Type changes specified; no schema migrations needed; existing table confirmed |
| 5 | Integration points | Y | All six touched systems named with exact hooks and change direction |
| 6 | Ordered phases | Y | Six phases, each with steps and a verification check; each independently reversible |
| 7 | Open decisions with defaults | Y | Five domain decisions + one unverified gate, all with defensible defaults |
| 8 | Out of scope | Y | Eleven items explicitly named |
| 9 | Definition of done | Y | Dual (operator-observable + system/test-observable); nine numbered checks a checker can confirm |
