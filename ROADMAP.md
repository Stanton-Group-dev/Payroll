# Payroll & Invoicing — Roadmap
**Project:** Stanton Management Payroll & Invoicing System
_Created 2026-06-25. Forward-looking direction. Status of what's **already built** lives in `PLAN.md`; settled decisions in `DECISIONS_LOG.md` — this file does not restate them, it points past them to what's next._

---

## How to read this file

- **`PLAN.md`** = "what is built vs. planned, verified." Backward/present-looking.
- **`ROADMAP.md`** (this) = "where we're going and in what order." Forward-looking themes and horizons.
- **`DECISIONS_LOG.md`** = "why it is the way it is." Check before re-opening anything here.
- Each roadmap item links to its PRD where one exists; an item with no PRD is a stub until one is written.

When an item ships, move it out of here and let `PLAN.md` carry its build status. Keep this list short and honest — a roadmap that lists everything tracks nothing.

---

## The north star

Turn the weekly-payroll tool into an **institutional-quality, auditable, multi-employer labor & billing system driven by a natural-language command bar** ([[payroll-agentic-goal]]). Every number traceable to its source; every business rule a config, not a hardcode; every overhead dollar explainable to the LLC that pays it.

---

## Now — active / next up

| Item | What | Source |
|---|---|---|
| **Expense private-bucket flip** | Apply `…_05_expense_receipts_private`, verify path-based + legacy receipts still download via the signed-URL route. The one outstanding deploy step. | `CLAUDE.md`, DECISIONS_LOG |
| **Unallocated-hours SMS — switch on** | Daily cron + reworded self-service copy; engine exists, it's deployed but dormant. Top non-engineering priority. | `UNALLOCATED_HOURS_NOTIFICATION_PRD.md`, DECISIONS §0.18 |
| **Persist Workyard cost code on import** | Add `cost_code` to `payroll_time_entries`, write it at import. **Unblocks both the capex P&L and the dumpster analysis** — highest-leverage small piece. | `LABOR_ALLOCATION_CAPEX_PRD.md` Part 1 dep, `DUMPSTER_ANALYSIS_PRD.md` |
| **Workyard cost-code cleanup** | 68 → ~13 bilingual codes; Project = bill-to property, Cost Code = activity. Stabilizes every activity/capital-class report downstream. | [[workyard-cost-code-model]], `WORKYARD_GUIDE.md` |

---

## Next — committed direction (PRDs written)

### Activity-based labor allocation, audit & capex P&L → `LABOR_ALLOCATION_CAPEX_PRD.md`
The Dean ask, in four parts:
1. **Follow-the-crew allocation** — supervisory/overhead pay follows where the maintenance & construction crews actually worked that week, not unit count. Opt-in basis, default unchanged.
2. **Allocation audit** — snapshot + "explain" UI showing exactly how each overhead dollar landed on each property.
3. **Capital classification** — cost code → capex / R&M / turnover / opex; a P&L-shaped labor report where **capex payroll sits below the line**. Supervisory pay inherits the crew's capital mix for free.
4. **Multi-employer** — see its own theme below; this PRD ships employer-aware schema so that phase is additive.

### Employee time-spend analytics ("how is Will Thomas spending his time?")
A per-employee activity report: hours by Workyard cost code / activity / capital class, over a week and trended over time — "Will Thomas spent 60% on turnovers, 25% R&M, 15% construction this month." Direct output of the **persisted cost code** + the **capital-class map** above (same data, employee axis instead of property axis). Lightweight to build once those land; high value for understanding where the crew's time actually goes. **No PRD yet — stub.** Companion to the dumpster ([[dumpster-sizing-analysis]]) and tenant-coordination ([[tenant-document-coordination-report]]) cost reports, which are the same "labor by cost code, sliced differently" pattern.

### In-app time approval → `IN_APP_TIME_APPROVAL_PRD.md`
Make our app the system of record for approved time (pull `submitted`, approve in-app, drift-detect re-pulls). Kills "approved in Workyard ≠ what I was paid." Proposed.

### Employee pay record / stub (DECISIONS §0.9)
Give employees a visible clocked → adjustments → paid trail. The "you shorted me" upset is an invisibility problem; the audit data exists but is manager-only. **No PRD yet — stub.**

---

## Later — vision / bigger structural bets

### Multi-employer (employer as a first-class dimension)
Run payroll for **different employers** off the one engine: an `employer` entity threaded through roster, weeks, config, cost-code class map; per-employer rate config and RLS scoping; `calculatePayroll` stays single, employer becomes a scope filter. A phase of its own — schema breadth + RLS + every query's scope. New employer-aware tables (allocation, capital-class) carry `employer_id` from the start so this is fill-in, not re-migration. See `LABOR_ALLOCATION_CAPEX_PRD.md` Part 4.

### Natural-language command bar / agentic layer ([[payroll-agentic-goal]])
Drive the system by NL command over a shared brain — "why is Dean on Westend's bill this week?", "reduce Carlos by 4 hours on 31 Park with reason X", "compare this week to last." The allocation-audit explain strings and week-compare `notable[]` are deliberate stepping stones toward this. Anchors dates to the viewed week ([[payroll-week-alignment]]).

### Remote payroll & Monitask ([[remote-payroll-monitask]])
Separate remote run (`pay_group`), Monitask OAuth, token-based worker portal, lateral analyst role. Intersects multi-employer (a remote run is arguably a different employer shape).

### Off-cycle "quick bill" run → `OFFCYCLE_BILLING_RUN_PRD.md`
A bill outside the weekly cadence. Needs a model change — not built.

### Cost-report family (same engine, different slice)
- **Dumpster sizing & off-site labor** → `DUMPSTER_ANALYSIS_PRD.md` (deferred; early version shipped).
- **Tenant document coordination** ("Office" code → chasing paperwork) → `TENANT_DOCUMENT_COORDINATION_PRD.md` ([[tenant-document-coordination-report]]).
- **Employee time-spend** (Will Thomas) — listed under Next.

These are one capability — *labor hours by cost code, attributed and sliced* — wearing three hats. Build the persisted-cost-code + capital-class spine once; each report is then a query and a page.

---

## Cross-cutting engineering debt (from `PLAN.md` G1–G4)

Not features, but they gate trust in everything above. Track in `PLAN.md`; surfaced here so roadmap planning accounts for them:
- **G2** — several live tables have no `CREATE TABLE` migration in source (rates/splits, mgmt-fee, recon, expenses, weekly-property-costs). Reproducibility/DR debt.
- **G3** — RLS write-policy holes on a few tables (`payroll_invoices`, `_line_items`). Security.
- **G4** — sequential approval-stage enforcement (deferred), portfolio-wizard LLC-groupings persistence, Workyard-miles import.

_(G1 — the hardening-branch merge — is **done** as of 2026-06-23; see `CLAUDE.md`.)_

---

## Principles that constrain the roadmap (don't relitigate)

- **Config, not spec-gates.** Never block a build on a tunable business rule; default from config and ship. (DECISIONS, windsurfrules.)
- **One engine.** ADP, reconciliation, invoices, statement, and any new allocation route through `calculatePayroll` — never a parallel derivation. ([[overtime-rule]].)
- **Full-prefund billing is invariant.** Reporting overlays (capex/opex) never change what the LLC owes. ([[statement-bills-full-prefund]].)
- **Additive, reversible, shared-DB-safe migrations; `payroll_*`; RLS-on by default.** (`DATABASE_ARCHITECTURE.md`, `CLAUDE.md`.)
- **Solo dev → straight to `main`, no PRs.** ([[no-prs-direct-to-main]].)
