# Payroll & Invoicing System
Replaces Stanton Management's spreadsheet-driven weekly payroll and property billing with an auditable, approval-gated system that preserves history, surfaces management fees as explicit line items, and scales across portfolios without manual rebuilds.

> **Status reconciled 2026-06-20** against the actual code in both worktrees (`C:/01-repos/Payroll` = main line, `C:/01-repos/Payroll-hardening` = unmerged hardening branch). Statuses below are evidence-verified, not aspirational.

---

## Build status — planned vs built (the headline)

**All 15 originally-planned features are built.** Nothing in the plan is unstarted. On top of them, ~23 additional capabilities shipped that were never in this plan (see "Shipped beyond the plan"). The system **exceeds** the original Phase-1 scope and has reached well into Phase 2.

| Planned feature | Real status |
|---|---|
| Workyard Time Card Ingestion | ✅ done |
| Timesheet Adjustment Workbench | ✅ done |
| Employee / Rate / Dept-Split Management | ✅ done · debt |
| Cost Allocation Engine | ✅ built — **best version unmerged** (see G1) |
| Approval Gates + Immutable Weekly Locking | 🟠 partial — locking built (unmerged); sequential-stage enforcement not built |
| Invoice Generator | ✅ done · debt |
| Statement Generator | ✅ done |
| ADP Export + Inbound Reconciliation | ✅ done · debt |
| Expense & Reimbursement Submission | ✅ built (core) · debt |
| Management Fee Configuration | ✅ done · debt |
| History Store + Excel Export | ✅ done |
| Cost-Per-Unit Intelligence Layer | ✅ done (already built, was marked Phase-2-parked) |
| Workyard Reliability Tracking | ✅ done |
| Portfolio Expansion Onboarding | 🟠 partial — wizard built; LLC-groupings step not persisted |
| Mileage + SMS Confirmation Paths | 🟠 partial — manager mileage review built; Workyard-miles *import* not built; SMS engine built, no cron |

**"· debt" = the feature works, but a cross-cutting plumbing gap applies** (almost always G1 or G2 below). It is built, not missing.

### The four cross-cutting gaps (these explain almost every non-"done")
- **G1 — the hardening branch is not merged.** The *correct* cost-allocation engine (PRP-02: OT/tax-base/fee-authority/prefund fixes, largest-remainder rounding, config-driven rates), the DB week-lock trigger (PRP-04), and the rate-settings migration live **only** on `hardening/payroll-waves-0-2`. Worse, the branches **diverged**: `main` has the OD-2 cost-code→building fix; hardening has the math fix; *neither has both*. **A careful merge is the #1 task.**
- **G2 — schema not in source-controlled migrations.** Many live tables (employee rates/splits, mgmt-fee config, ADP recon, expenses, weekly-property-costs, thresholds) were created directly on the DB before the migration window and have **no `CREATE TABLE` migration in the repo**. Features work; the schema isn't reproducible from source. Real onboarding/DR debt.
- **G3 — RLS write-policy holes.** A few tables (e.g. `payroll_invoices`, `payroll_invoice_line_items`) had their blanket policies dropped without role-gated replacements. Security gap to close.
- **G4 — a handful of genuine feature gaps:** sequential approval-stage enforcement (deferred), portfolio-wizard LLC-groupings persistence, Workyard-miles import, unallocated-SMS cron + revised copy.

---

## Features (verified)

### Workyard Time Card Ingestion — ✅ done
API pull + CSV fallback + S-code matching + flagged-entry routing, all wired (`workyard-api.ts`, `csv-parser.ts`, `import/page.tsx`, `api/workyard/timecards`). OD-2 cost-code→building recovery shipped on main. **Gap (G1):** the largest-remainder rounding fix is on hardening only; branches diverged → merge needed. Priority P1.

### Timesheet Adjustment Workbench — ✅ done
Week-grid-first UI, inline drawer (Quick Assign / Split / Spread / Pending / Edit-Remove), Manual-Add + Carry-Forward panels, Adjustment Log, EmployeeSwitcher; full CRUD in `useTimesheetAdjustments.ts` with correction records on every path. **Gap (G1):** server-side `assertWeekWritable` lock guard is hardening-only (main has UI-level lock only). P1.

### Employee / Rate / Department Split Management — ✅ done · debt
Roster + effective-dated rates + comp flags + salaried dept-split defaults/overrides + per-field audit trail, all built. **Gap (G2):** no CREATE-TABLE migrations for rates/splits tables in source. P2.

### Cost Allocation Engine — ✅ built (best version unmerged)
Direct labor + unit-weighted spread + management fee + prefund, in `calculations.ts`/`billing.ts`. **Gap (G1, top risk):** the corrected single-engine (tax base, property-authoritative fee, prefund-includes-fee, golden test, config rates) is on **hardening only**; `main` runs the older engine. Merge to make main correct. P1.

### Approval Gates + Immutable Weekly Locking — 🟠 partial
Per-stage approvals + post-approval read-only + DB lock trigger on 6 pay-input tables are built (trigger is **hardening-only**, G1). **Real gap (G4):** no enforced *sequential* stage ordering (`payroll_advance_status`) — stages can be set without verifying prerequisites; explicitly deferred. P1.

### Invoice Generator — ✅ done · debt
Per-LLC invoices with explicit mgmt-fee line items + per-activity breakdown (`[weekId]/invoices`, `useInvoiceBuild.ts`). **Gap (G3):** missing RLS write policies on `payroll_invoices` / `_line_items`. P1 (security).

### Statement Generator — ✅ done
Consolidated per-LLC statement + variance error-check with reimbursements carve-out + release gate (`[weekId]/statement`, `usePayrollStatement.ts`). No gaps found.

### ADP Export + Inbound Reconciliation — ✅ done · debt
Outbound gross-pay export + inbound variance reconciliation (`adp-reconciliation`, `reconcile.ts`); on hardening the recon path routes through the single engine (G1). **Gap (G2):** recon tables lack CREATE-TABLE migrations. P2.

### Expense & Reimbursement Submission — ✅ built (core) · debt
Submission + approval (`expenses/`, `ApprovalTab`) live. **Gaps:** the two-path mobile self-submit/proxy flow per the PRD is only partly realized; expense tables lack migrations (G2). P2.

### Management Fee Configuration — ✅ done · debt
Per-portfolio effective-dated fee in `payroll_management_fee_config` + admin UI. **Gap (G2):** no CREATE-TABLE migration in source. P1.

### History Store + Excel Export — ✅ done
Approved-week history + export (`history/`). Immutability backed by the lock trigger (G1, hardening). No functional gaps.

### Cost-Per-Unit Intelligence Layer — ✅ done (ahead of plan)
Full analytics dashboard (cost-per-unit, rolling avg, WoW delta, threshold vs actual, trend chart) at `/payroll/analytics` + Admin→Thresholds. This was marked Phase-2-parked but is **built**. **Gap (G2):** weekly-costs/thresholds tables lack migrations; threshold values still need management input. P3.

### Workyard Reliability Tracking — ✅ done
`useWorkyardReliability.ts` + collapsible panel on the employees page. No gaps.

### Portfolio Expansion Onboarding — 🟠 partial
In-app stepped wizard (Admin→Portfolios) + external-projects CRUD + admin property creation built. **Real gap (G4):** the wizard's LLC-Groupings step is UI-only — it doesn't persist `owner_llc` (must be set per-property manually). P3.

### Mileage + SMS Confirmation Paths — 🟠 partial
Manager-side **mileage review** (approve/deny/edit, effective-dated rate, pay+billing allocation) is **built** (`mileage/`, migration `20260616_02`). **Real gaps (G4):** (a) Workyard-miles *import* isn't built — miles are manual-entry only; (b) the unallocated-hours **SMS engine is built** (`unallocatedHolds.ts`, `twilio-api.ts`) but has no daily cron and the copy needs revision per `UNALLOCATED_HOURS_NOTIFICATION_PRD.md`. P3 (mileage import) / P2 (SMS cron).

---

## Shipped beyond the original plan (~23, audit-verified)

Capabilities built that were never in the feature list above:

- **Unallocated-hours holds + Twilio SMS** (`unallocatedHolds.ts`, `twilio-api.ts`, `api/payroll/holds`, migrations `20260617_03/04`) — done; needs cron + revised copy.
- **OD-2 cost-code→building importer fix** — done (main, 2026-06-19).
- **Bilingual cost-code normalization** + `activityOf()` EN/ES resolver — done (53 codes renamed).
- **Westend bulk-onboarding tooling** (`scripts/wy-onboard-buildings.mjs`) — 26 projects API-created; cost codes manual (see `MANUAL_TASKS_HANDOFF.md`).
- **Remote-worker self-service portal** (`/portal?token=`) + **remote payroll run with Monitask cross-check** — done (Monitask live path pending vendor grant; mock works).
- **Natural-language command bar / agent** (`/payroll/console`, `CommandBar`) over the audited operation layer — done.
- **RLS / authz hardening** (PRP-01/03 + superadmin fix) — done, applied live.
- **Settings tab for rate constants** (tax/WC/phone/OT → `payroll_global_config`) — done (migration on hardening, G1).
- **DB week-lock trigger** (PRP-04) — done (hardening, G1).
- **Dumpster overflow report** · **Tenant-coordination invoice label** · **User/role admin** · **Rate-coverage dashboard** · **External-projects mgmt** · **Travel-premiums config** · **Invoicing inclusion flags** · **Employee roster + audit trail** · **Audited plan/commit operation layer** · **Workyard vs DB drift detection** — all done.

This is the body of evidence for the equity/progress story: the plan was delivered and substantially overdelivered.

---

## Top open work (prioritized — what a new owner does next)

1. **Merge `hardening/payroll-waves-0-2` into main, resolving the OD-2 ↔ math-engine divergence (G1).** This is the single highest-value action: it makes `main` the *correct* engine + locking + settings, and unifies the two diverged `workyard-api.ts`. Careful merge + run the golden test. **P0.**
2. **Backfill CREATE-TABLE migrations for the live-but-unmigrated tables (G2)** so the schema is reproducible from source. **P1.**
3. **Add role-gated RLS write policies** where blanket policies were dropped (invoices, line items; audit others) (G3). **P1.**
4. **Sequential approval-stage enforcement** (`payroll_advance_status`) (G4). **P1.**
5. Persist portfolio-wizard LLC groupings (G4). **P2.**
6. Unallocated-SMS: daily cron + revised "fix it in Workyard" copy (`UNALLOCATED_HOURS_NOTIFICATION_PRD.md`). **P2.**
7. Westend: finish the 26 manual cost codes + 3 junk-code deletes (`MANUAL_TASKS_HANDOFF.md`). **P2 (ops).**
8. Workyard-miles import into the existing mileage pipeline. **P3.**

---

## Next milestone
**Phase 1 (Excel replacement) is effectively complete** — every module to run a full weekly payroll + billing cycle exists. The gating items to *trust it end-to-end on `main`* are **#1–#4 above** (merge hardening, backfill migrations, close RLS + sequential-approval gaps). Phase 2 (intelligence) is already largely built.

---

## Implementation phases (status)
- **Phase 1 — Core Weekly Operations (Excel replacement):** ✅ built end-to-end; hardening merge + the G1–G4 closeouts make it production-trustworthy on main.
- **Phase 2 — Intelligence Layer:** ✅ largely built (analytics dashboard, history queries, trends live; budget-threshold values still pending management input).
- **Phase 3 — Expansion & Scalability:** 🟡 in progress (portfolio wizard + external projects built; LLC-groupings persistence + divergent invoice structures remain).

---

## Reference (consolidated, still current)

### Core operating modules
Workyard ingestion · timesheet adjustment · employee/rate/dept-split mgmt · adjustment manager (phone/tool/advance/deduction) · cost allocation engine · invoice generation · statement generation · ADP export+recon · history store · intelligence layer.

### Timesheet adjustment UX
Week-grid-first (properties × days+total); prominent unallocated row + header counts; inline drawer (Quick Assign/Split/Spread/Pending/Edit-Remove); separate Manual-Add + Carry-Forward; collapsible adjustment log; <30s resolution target.

### Expense & reimbursement flow
Two paths (employee mobile self-submit + in-office proxy); no-receipt-no-submission; payment-method routing (reimbursement vs bookkeeping); batch + signature; configurable weekly cutoff messaging; approver routing + Kathleen bookkeeping visibility; gas auto-allocation by visit pattern; mileage future.

### Data & architecture rules
`payroll_`-prefixed tables; read canonical snake_case layer (not AF_ staging); no hard deletes (status/deactivate); money `NUMERIC(10,2)`; constrained lowercase statuses; **RLS on all payroll tables**; department-owned tables with canonical FKs.

### Data model
Employees/rates/splits, weeks, time entries, corrections, adjustments, fee config, invoices+line items, weekly property costs, reconciliation, approvals, spread events, travel premiums, expense submissions/items/approvals, mileage, holds/notifications. Extension points: `source` semantics (`workyard`/corrected/manual/`sms_employee`/`mileage_workyard`); pending-resolution fields; carry-forward refs.

### UI component standard
Reusable advanced data table: drag-reorder/resize/visibility, sort/filter, density + local prefs, sticky headers, selected/loading/empty states, a11y + keyboard, optional bulk actions + CSV export. Default primitive for high-throughput manager review.

### Operational standards
Logic in domain hooks/services not views; explicit loading/error/empty states; auditability of all overrides/approvals/corrections; additive + effective-dated config over hardcoded constants; approval transitions persist actor+timestamp+notes; locked prior weeks → carry-forward in current week.
