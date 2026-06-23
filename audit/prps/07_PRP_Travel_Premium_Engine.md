# 07_PRP_Travel_Premium_Engine

**Status:** Draft — awaiting domain sign-off (taxability + per-job semantics) before release to build
**Owner:** StantonManagement
**Created:** 2026-06-23
**Estimated effort:** 2–3 days [Speculation — depends on the taxability and `flat_per_job` decisions and the golden-test fixture]
**Depends on:** `02_PRP_Payroll_Math_Single_Engine` (the hardening single-engine consolidation) — so the premium computed in `calculatePayroll` also reaches the ADP export and reconciliation. On `main`/`fix/…`, the export and reconciliation still re-derive gross in local loops, so a premium added only inside `calculatePayroll` would not appear there until that merge lands.
**Reads with:** `DECISIONS_LOG.md` §0.3, §0.9; `06_PRP_New_Project_Wizard` (the wizard writes the premium rows this PRP teaches the engine to honor)

---

## 1. Problem Statement

**Travel premiums are configured but the pay engine never reads them — so setting one pays no
employee and bills no property.** The `payroll_travel_premiums` table and its admin page exist and
work, but `calculatePayroll` and `cost-code-breakdown.ts` contain no reference to them.

1. **Inert config (E-1/E-2).** Verified by grep: the table's identifiers
   (`travel_premium` / `TravelPremium`) appear only in the type definitions, the
   `usePayrollTravelPremiums` hook, and the admin page. The only "premium" in `calculations.ts` is
   the unrelated overtime premium. No money moves.

2. **Silent expectation gap.** An admin who sets a premium reasonably believes it will be paid and
   billed. It is not. This is a correctness + trust problem: the figure is entered, stored, and
   ignored.

3. **Two destinations unwired.** A travel premium is owed **to the employee** (pay) and billable
   **to the property** (invoice) — like mileage. Neither path exists today.

This PRP wires the premium into the single pay engine: resolve the effective premium per property,
add it to the employee's pay, and charge it to the property's bill, with a pinned golden-week test.

---

## 2. Evidence Baseline

| ID | Claim | Location | Evidence | Status |
|----|-------|----------|----------|--------|
| E-1 | `calculatePayroll` never reads travel premiums | `src/lib/payroll/calculations.ts` | Grep for `travel`/`premium`: only OT-premium matches (`:120-129, 191, 221, 309, 335`); no table reference | Verified — self (grep) |
| E-2 | Travel-premium identifiers exist only in types, hook, admin page | `src/lib/supabase/types.ts:459`, `src/hooks/payroll/usePayrollTravelPremiums.ts`, `src/app/payroll/admin/travel-premiums/page.tsx` | Grep `travel_premium\|TravelPremium\|travelPremium` → exactly those three files | Verified — self (grep) |
| E-3 | Table shape | `src/lib/supabase/types.ts:459` | `property_id`, `premium_type` (`per_day`\|`flat_per_job`), `amount`, `effective_date`, `created_by`, timestamps | Verified — subagent read |
| E-4 | Effective-date resolution is "most recent ≤ reference date" elsewhere | `PayrollEmployeeRate`, `PayrollMileageRate` patterns | Same shape as rates/mileage-rate | Verified — subagent read |
| E-5 | "Property-configured, auto-applied; not employee-submitted" | `DECISIONS_LOG §0.3`, `EXPENSE_REIMBURSEMENT_PRD.md` | Travel bonuses configured on property, applied automatically; no receipt | Verified — decision log |
| E-6 | Premium write is admin add/delete (no update) | `travel-premiums/page.tsx` | Insert + delete only; effective-dating gives history | Verified — subagent read |

---

## 3. Users and Roles

**In scope:** payroll operator/admin (sees the premium on the pay record and the invoice); any
agent/server action that calls `calculatePayroll`.
**Out of scope:** employees (do not submit travel premiums — §0.3); remote pay group (separate
week state).

---

## 4. Core Features

**CF-1 — Resolve effective premium per property.** For each property an employee logged time at in
the week, select the `payroll_travel_premiums` row with the greatest `effective_date ≤ weekStart`
(E-4). No row → no premium (no regression).

**CF-2 — `per_day` math.** Add `amount` per **distinct calendar day** the employee logged time at
that property (derived from `payroll_time_entries` dates already in the engine).

**CF-3 — `flat_per_job` math.** Add `amount` once per employee per property per week. *(Unit
semantics — per week vs per dispatch/day — is OD-2; default per-week.)*

**CF-4 — Pay the employee.** The premium increases the employee's `gross_pay`. **Taxability is
OD-1:** default **taxable** (it is a bonus, not a reimbursement — unlike mileage/phone). If
taxable, it is included in the tax/WC base; if non-taxable, it is excluded (mirrors the
reimbursement handling in the engine). Surface it as a distinct `travel_premium` field on
`EmployeePaySummary`, not folded into wages.

**CF-5 — Bill the property.** The premium is added to that property's cost as a distinct line
(`travel_premium`) so it flows to the invoice/statement — paid by the LLC that owns the property,
consistent with mileage billing.

**CF-6 — Surface on the audit trail.** The premium appears as a named, auto-applied line on the
employee pay record (§0.9) and as a named line on the property invoice — never silently merged.

**CF-7 — Prefund + golden test.** Include the premium in `required_prefund` consistent with how
other employee-owed pay is prefunded (confirm against the §0.x prefund rule — OD-3). Add a
golden-week fixture case so the engine stays pinned.

---

## 5. Data Model

**No schema change** — `payroll_travel_premiums` already exists (E-3).

**Type changes (TypeScript):**
- `EmployeePaySummary` — add `travel_premium: number` (per-employee total for the week).
- Property-cost result — add `travel_premium: number` line per property.
- `calculatePayroll` signature — append `travelPremiums: PayrollTravelPremium[]` (and the existing
  `properties` + `entries` already carry the day/property data needed).

---

## 6. Integration Points

| System | Hook | Direction | Change |
|--------|------|-----------|--------|
| Engine | `calculatePayroll` (`calculations.ts`) | core | Resolve + apply premium (CF-1…CF-5) |
| Effective-date helper | rate/mileage resolver pattern | reuse | Same "most recent ≤ week" lookup |
| ADP export / reconciliation | via single engine (PRP-02) | downstream | Premium reaches both once they route through the engine |
| Invoice / statement | property-cost output | downstream | New `travel_premium` line renders on the bill |
| Premium fetch | new `select` in the engine's callers | new read | Fetch `payroll_travel_premiums` alongside the week's inputs |

---

## 7. Affected Files

| File | Change | Type |
|------|--------|------|
| `src/lib/payroll/calculations.ts` | Resolve + apply premium; add `travelPremiums` param; new summary/property fields | Modified |
| Engine callers (week review, ADP export, reconciliation) | Fetch `payroll_travel_premiums`; pass to `calculatePayroll` | Modified |
| Invoice/statement render | Show the `travel_premium` line | Modified |
| `src/lib/payroll/calculations.golden.test.ts` | Add premium fixture case | Modified (or New on `main`) |

---

## 8. Implementation Phases

### Phase 1 — Confirm semantics (no code)
Resolve OD-1 (taxability), OD-2 (`flat_per_job` unit), OD-3 (prefund inclusion).
**Verification:** all three resolved in this doc with defaults defended.

### Phase 2 — Engine resolution + per_day
2a. Append `travelPremiums` param. 2b. CF-1 resolver. 2c. CF-2 per-day accumulation onto the
employee total and the property total.
**Verification:** unit test — a worker with 3 distinct days at a `per_day`-$X property yields `3X`
on both pay and that property's cost.

### Phase 3 — flat_per_job + taxability + billing line
3a. CF-3 flat math (per OD-2). 3b. CF-4 taxability handling (per OD-1). 3c. CF-5 property line.
**Verification:** unit test — `flat_per_job` adds `amount` once; tax base reflects OD-1; property
cost carries the line.

### Phase 4 — Surface + prefund + golden
4a. CF-6 pay-record + invoice lines. 4b. CF-7 prefund (per OD-3) + golden fixture.
**Verification:** golden test green; a real week's invoice shows the named line; pay record shows it.

---

## 9. Open Decisions

| ID | Question | Default (pending sign-off) | Label |
|----|----------|----------------------------|-------|
| OD-1 | Is a travel premium taxable wages or a non-taxable reimbursement? | **Taxable** (bonus, not a reimbursement) — include in tax/WC base | Open |
| OD-2 | `flat_per_job` = once per week, per dispatch, or per work order? | Once per employee per property per **week** | Open |
| OD-3 | Does `required_prefund` include the premium? | Yes — it is employee-owed pay collected at prefund | Open |
| OD-4 | Effective-date tie-break when two rows share a date | Latest `created_at` wins | Open |

---

## 10. Out of Scope
- The onboarding wizard and Workyard provisioning — **PRP-06**.
- Editing premiums (the admin page is add/delete; an update path is a separate UI item).
- Remote pay group premiums.
- Retroactively repricing already-`statement_sent` (locked) weeks — corrections go as carry-forward.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Premium added in the engine but absent from ADP/recon (they re-derive gross pre-PRP-02) | Medium | Sequence after the single-engine merge; DoD checks all three surfaces agree |
| Taxability decided wrong (OD-1) | Medium | Conservative default taxable; separate `travel_premium` field makes the base easy to flip |
| `per_day` double-counts multi-entry days | Low-Med | Count **distinct** dates per property, not entries |
| Repricing a historical/locked week | Low | Effective-date keyed to `weekStart`; locked weeks immutable by trigger |

---

## 12. Definition of Done

**Operator-observable:**
1. A week with a `per_day` premium increases the employee's pay and the property's bill by
   `amount × distinct days`, shown as a named line on both the pay record and the invoice.
2. A `flat_per_job` premium adds `amount` once (per OD-2).
3. A property with no premium row is unaffected (no regression).

**System/test-observable:**
4. `calculations.golden.test.ts` includes a premium case and passes.
5. `npx tsc --noEmit`, lint, and the full test run pass.
6. The same premium total appears on the week-review screen, the ADP-relevant gross, and the
   reconciliation system gross (once routed through the single engine).

---

## 13. Rollback

| Phase | Change | Rollback |
|-------|--------|----------|
| 2–3 | engine math + param | `git revert`; no DB change; callers pass old signature until updated |
| 4 | surfacing + prefund + golden | `git revert`; premium lines disappear; no data written |

No migrations; full rollback is a `git revert` per phase. (The premium **data** persists in the
table either way — reverting only stops the engine reading it.)

---

## 14. Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-23 | Default travel premium to **taxable** | It is a bonus for travel, not a cost reimbursement; conservative for compliance; a separate field makes it cheap to flip if §0.3 intends otherwise |
| 2026-06-23 | Count **distinct days** for `per_day`, not entries | A worker with two entries on one day earns one day's premium |
| 2026-06-23 | Sequence after the single-engine merge (PRP-02) | So the premium reaches ADP export + reconciliation, not just the on-screen figure |

---

## 15. Spec Self-Score (nine-element Y/P/N)

| # | Element | Score | Note |
|---|---------|-------|------|
| 1 | Problem statement | Y | Inertness evidenced by grep; two-destination gap named |
| 2 | Users and roles | Y | Operator/agent in; employees/remote out |
| 3 | Numbered features | Y | CF-1…CF-7 |
| 4 | Data model | Y | No schema change; typed field additions specified |
| 5 | Integration points | Y | Engine + callers + invoice + prefund |
| 6 | Ordered phases | Y | Four phases, each with verification |
| 7 | Open decisions w/ defaults | Y | Four, each with a defended default |
| 8 | Out of scope | Y | Wizard, edit-UI, remote, locked-week repricing |
| 9 | Definition of done | Y | Operator- + test-observable; cross-surface agreement check |
