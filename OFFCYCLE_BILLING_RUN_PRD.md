# Off-Cycle Billing Run (Quick Bill) — PRD
**Project:** Stanton Management Payroll & Invoicing System
**Version:** 1.0
**Status:** Draft
**Relationship:** Sibling to `TIMESHEET_ADJUSTMENT_PRD.md`. Does **not** supersede it. Reuses the
portfolio-spread allocation math (§3 there) and the existing invoice tables (`PAYROLL_PRD.md` §5).

---

## Problem Restatement

A worker's hours get missed — they didn't make it into Workyard, weren't caught in the weekly
adjustment pass, and the worker was made whole some other way (Excel, a manual ADP entry). The
**pay** side gets handled. What falls through is the **billing** side: the property or portfolio
that the work was for never gets charged for those hours, because charging today requires running
(or re-opening) a full weekly payroll cycle.

> *Concrete case (2026-06-19):* Xavier was short some hours; the pay was reconciled by hand in
> Excel. To bill the customer for those hours, there is no quick path — you'd have to fold them
> into a weekly run. So the charge just gets dropped, or recreated by hand in a spreadsheet.

**What's needed:** a one-off action — "bill 5 hours of Xavier's labor to *this* property (or *this*
portfolio), now" — that produces a proper invoice (labor + management fee, correct billing LLC,
auditable line items) **without** running the weekly cycle and **without** touching employee pay.

This is a **billing instrument, not a pay instrument.** It is the in-app replacement for the Excel
workaround, scoped to the part that's actually missing: the charge.

---

## Scope Decisions (locked 2026-06-19)

| # | Decision | Source |
|---|---|---|
| B.1 | **Billing / invoice only.** The off-cycle run produces an invoice charge to a property or portfolio. It does **not** pay the employee, does **not** create a payable time entry, and does **not** touch ADP. Pay is handled separately (the existing weekly run, or manually). | This session |
| B.2 | **Standalone, off-cycle.** The run generates an immediate one-off invoice for just these hours, outside the weekly batch. It does not require an open `payroll_week`, and it does not re-open a locked one. | This session |
| B.3 | **Reuses existing billing math and invoice surfaces.** Labor = hours × rate; management fee per `PAYROLL_PRD.md §5` / `DECISIONS_LOG §5`; portfolio spread is unit-weighted per `DECISIONS_LOG §5`. No new pricing model. | `DECISIONS_LOG §5`; `usePayrollWeekInvoices.ts` |

These resolve directly to the two questions that previously stalled this: *does the quick run pay
or bill?* → **bill only**; *standalone or fold into the week?* → **standalone**.

---

## The Flow (happy path, target < 30s)

1. **Open Quick Bill.** From the invoicing area, "New Off-Cycle Bill."
2. **Pick the employee.** Used to resolve the labor rate and to label/audit the charge. *No pay is
   computed or owed — the employee is the basis for the bill, not a payee here.*
3. **Enter hours** (e.g. `5.0`). Fractional supported.
4. **Confirm the rate.** Prefilled from the employee's current effective-dated rate
   (`PAYROLL_PRD.md §`, rate history model). Editable; an override requires a reason.
5. **Pick the destination** — one of:
   - **Direct property** — a single property gets the whole charge.
   - **Portfolio spread** — choose a portfolio, optionally toggle properties off (vacant, etc.);
     the charge spreads **unit-weighted** across the selected set (same engine as the adjustment
     **Spread** operation).
6. **Reason / origin** (required): why this is being billed off-cycle, and — optional but
   encouraged — which week the hours belong to (the "missed" week) and a free-text note that pay
   was already handled (e.g. "paid via Excel 6/19"). This is the audit link.
7. **Preview.** The run shows, before anything is written: labor amount, management-fee line,
   per-property breakdown (for spreads), billing LLC(s), and grand total.
8. **Create draft → Approve → Send.** Produces a standalone invoice in `draft`, then through the
   existing `draft → approved → sent` flow (`DECISIONS_LOG §5`). Park sub-LLCs invoice individually,
   same as the weekly path.

---

## Allocation Modes

### Direct property
Single property carries the full charge.
- **Labor line:** `hours × rate` against that property.
- **Mgmt-fee line:** management-fee % (resolved for that property's portfolio, effective-dated)
  applied to the labor.
- **Billing LLC:** resolved from the property → portfolio → billing LLC (`billing_llc` /
  `portfolio_owner_llc`, same resolution `usePayrollWeekInvoices.ts` uses).

### Portfolio spread (unit-weighted)
Charge is distributed across the selected properties **by unit count**, per the house rule:
`cost ÷ total selected units × each property's units` (`DECISIONS_LOG §5`). This is the same
allocation the adjustment **Spread** uses — do **not** reimplement; share it.
- One labor line per property, weighted by units.
- Mgmt fee applied per-portfolio on the portfolio's share.
- If the selected properties span multiple billing LLCs (e.g. Park sub-LLCs), the run produces
  **one invoice per LLC**, exactly like the weekly generator groups by `owner_llc`.

> Even split vs. unit-weighted: the weekly invoicing path is unit-weighted, so this run is
> **unit-weighted** to stay consistent with how every other portfolio cost is billed. (The
> adjustment-spread *time entry* split is even-by-property for pay; that's a pay concern and out of
> scope here — see Open Questions if a flat/even billing split is ever wanted.)

---

## What It Explicitly Does **Not** Do

- **No employee pay.** No `payroll_time_entries` row that feeds calculations/ADP; no gross, no
  tax/WC, no phone or reimbursement spread. The labor basis lives only on the off-cycle run + the
  invoice line items.
- **No weekly cycle.** Does not create, open, advance, or re-open a `payroll_week`. Does not unlock
  an approved week (consistent with the carry-forward principle — never unlock history).
- **No Workyard write-back** (`DECISIONS_LOG §0.6` — the API is read-only anyway).

---

## Billing Math

```
labor_amount   = round2(hours × rate)
mgmt_fee_amount= round2(labor_amount × mgmt_fee_pct)     // pct = effective-dated, per portfolio
total_amount   = labor_amount + mgmt_fee_amount
```
- `round2 = Math.round(n*100)/100`, the one money-rounding rule (`DECISIONS_LOG §1`).
- For spreads, compute each property's labor share from its unit weight first, then fee per LLC,
  then sum — so per-line and invoice totals reconcile.
- Rate source = employee effective-dated rate; override allowed with reason (captured on the run).

---

## Off-Cycle Invoice Model

The existing `payroll_invoices.payroll_week_id` is **`NOT NULL`** and FKs to `payroll_weeks`. A true
standalone bill has no week. Rather than mint a fake "week," introduce an explicit off-cycle run and
relax the week link:

- New parent table **`payroll_offcycle_runs`** holds the run: employee, hours, rate (+ override
  reason), destination kind (direct/spread), portfolio, origin-week reference, reason, requested_by,
  external-pay note, timestamps.
- `payroll_invoices` gains an **`invoice_type`** discriminator (`'weekly' | 'off_cycle'`) and an
  **`offcycle_run_id`**; `payroll_week_id` becomes **nullable** (required only when
  `invoice_type='weekly'`, enforced by CHECK).
- Line items are unchanged (`payroll_invoice_line_items`): `cost_type ∈ labor | mgmt_fee` (spread
  type unused here — these are explicit labor charges, not reimbursement spreads).
- The invoice carries a clear human label so it's unmistakable on a statement, e.g.
  *"Off-Cycle Bill — Xavier R. — 5.0h — S0001 90 Park St — back-bill wk of 6/8."*

### Data model additions

```sql
-- Run parent ------------------------------------------------------------
CREATE TABLE payroll_offcycle_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES payroll_employees(id),
  hours            NUMERIC(6,2) NOT NULL CHECK (hours > 0),
  rate             NUMERIC(10,2) NOT NULL,          -- snapshot of rate used
  rate_overridden  BOOLEAN DEFAULT false,
  rate_reason      TEXT,                            -- required iff rate_overridden
  dest_kind        TEXT NOT NULL CHECK (dest_kind IN ('direct','portfolio_spread')),
  property_id      UUID REFERENCES properties(id),  -- set for direct
  portfolio_id     UUID REFERENCES portfolios(id),  -- set for spread
  origin_week_id   UUID REFERENCES payroll_weeks(id), -- the "missed" week, nullable
  external_pay_note TEXT,                           -- e.g. "paid via Excel 6/19"
  reason           TEXT NOT NULL,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Relax + tag invoices --------------------------------------------------
ALTER TABLE payroll_invoices
  ADD COLUMN invoice_type   TEXT NOT NULL DEFAULT 'weekly'
    CHECK (invoice_type IN ('weekly','off_cycle')),
  ADD COLUMN offcycle_run_id UUID REFERENCES payroll_offcycle_runs(id),
  ALTER COLUMN payroll_week_id DROP NOT NULL,
  ADD CONSTRAINT invoice_week_or_offcycle CHECK (
    (invoice_type = 'weekly'    AND payroll_week_id IS NOT NULL) OR
    (invoice_type = 'off_cycle' AND offcycle_run_id IS NOT NULL)
  );

-- Optional: which properties were selected in a spread (audit of toggles)
CREATE TABLE payroll_offcycle_run_properties (
  offcycle_run_id UUID REFERENCES payroll_offcycle_runs(id),
  property_id     UUID REFERENCES properties(id),
  units           INTEGER NOT NULL,                -- unit weight at run time
  PRIMARY KEY (offcycle_run_id, property_id)
);
```

> Every read path that lists invoices (`usePayrollInvoices`, `usePayrollStatement`,
> `useBillingLedger`, `usePayrollHistory`) currently filters/joins by `payroll_week_id`. Those need
> to tolerate `NULL` week and surface `invoice_type='off_cycle'` — likely a small "Off-Cycle" group
> in the billing ledger rather than under a week.

---

## Reconciliation / Double-Bill Guard

The risk: the same hours later arrive from Workyard and get billed *again* in a weekly run.

- At run time, **warn** if an active time entry already exists for that employee + property +
  (origin) week — the manager confirms it's genuinely un-billed.
- Persist enough on the run (employee, origin week, property/portfolio, hours) to detect overlap
  later. The weekly invoice generator should **flag** (not silently merge) when a property's billed
  labor for a week overlaps an off-cycle run tagged to that same origin week.
- This is a flag-and-review guard, not hard enforcement — consistent with `DECISIONS_LOG §0.8`
  (manual additions are normal; only surface conflicts, don't block).

---

## Approval, Locking & Audit

- Off-cycle invoices use the **same status flow**: `draft → approved → sent`
  (`DECISIONS_LOG §5`; `usePayrollStatement` already flips to `sent`).
- Approval is **independent** of the weekly approval chain — an off-cycle bill is self-contained and
  does not gate or get gated by `timesheet → payroll → invoice → statement`.
- Once `sent`, the invoice locks read-only like any other (`DECISIONS_LOG §6`).
- Full attribution: the run records `created_by` / actor + reason; the invoice carries
  `approved_by` / `approved_at`. (Honors the actor-attribution direction in `audit/prps/04`.)
- RLS on `payroll_offcycle_runs` and the new columns must match the portfolio/role scoping the rest
  of the payroll tables are moving to (`audit/prps/01`) — not blanket `USING(true)`.

---

## UI Flow

A single inline panel (no multi-page wizard), matching the adjustment interface's speed principle:

```
New Off-Cycle Bill
  Employee  [ Xavier R.            ▾ ]      Rate  [ $/hr  prefilled ]  ( override → reason )
  Hours     [ 5.0 ]                          Origin week (optional) [ wk of 6/8 ▾ ]
  Destination  ( ) Direct property  [ S0001 — 90 Park St ▾ ]
               ( ) Portfolio spread [ Southend ▾ ]   ☑ S0002 … ☐ S0009 (vacant)
  Reason    [ ........................................ ]  (required)
  Note      [ paid via Excel 6/19 ]                       (optional)

  ── Preview ───────────────────────────────────────────────
  Labor            5.0h × $XX.XX            $  XXX.XX
  Mgmt fee (10%)                            $   XX.XX
  Billing LLC      <resolved>
  (spread: per-property unit-weighted breakdown table)
  Total                                     $  XXX.XX
  [ Create draft invoice ]
```

- Preview is **side-effect-free**; "Create draft" is the only write (mirrors the
  plan()/commit() discipline in `DECISIONS_LOG §7` / HANDOFF).
- After create: the invoice appears in the billing ledger under an **Off-Cycle** group, ready to
  Approve and Send like any invoice.

---

## Out of Scope

- **Employee pay / ADP** of the missed hours — handled separately (B.1). This run never pays.
- **Re-opening or editing a locked weekly run** (B.2).
- **Reimbursement / phone / tool spreads** — this run bills explicit labor only.
- **Workyard write-back** (`DECISIONS_LOG §0.6`).
- **Bulk / multi-employee off-cycle billing** — one employee per run for v1.

---

## Open Questions

| Question | Why it matters | How to settle |
|---|---|---|
| Bill at the employee's **cost rate** (+10% mgmt fee), or is there ever a distinct customer **bill rate**? | The whole system bills hours×cost today; if a separate bill rate exists this run needs it too. | Confirm with Alex; default = cost rate, consistent with weekly. |
| Should a portfolio off-cycle bill ever split **evenly** (not unit-weighted)? | Adjustment *spread* splits evenly for pay; billing is unit-weighted. A flat option may be wanted for some dispatch types. | Business call; default unit-weighted (matches all other billing). |
| Do off-cycle invoices need their **own number series / statement section**, or just a label + the Off-Cycle group? | Customer-facing clarity and reconciliation. | Decide with whoever sends statements. |
| Hard-block vs. warn on the **double-bill** overlap guard? | Stronger guard prevents double charges but adds friction. | Default warn-and-confirm per `§0.8`; revisit if double-bills occur. |
