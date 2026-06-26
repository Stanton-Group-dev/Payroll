# Activity-Based Labor Allocation, Audit & Capex Classification — PRD
**Project:** Stanton Management Payroll & Invoicing System
**Version:** 1.0
**Status:** Draft — proposed, **not built**. Write-up only; do not implement off this doc without sign-off.
**Motivating ask (Alex, 2026-06-25):** *"Allocate Dean's payroll based on where the maintenance and the construction teams have worked that week. We need to audit how we got there. Eventually cost codes from Workyard tell us which work is capex / R&M / turnover — the point being that capex payroll hits below the line on the P&L. And we'll need this tool to work for different employers."*

---

## Problem Statement

Today every salaried / overhead worker's pay is spread across the portfolio by **unit count** — see Method B in `src/lib/payroll/calculations.ts:393`. A 167-unit LLC bears more of Dean's paycheck than a 6-unit building, *regardless of whether anyone actually worked there that week*. For a true overhead role (bookkeeping, corporate) that's defensible. For a **field supervisor like Dean**, it's wrong: Dean's week is spent wherever the **maintenance and construction crews** are deployed. If those crews spent the week gut-renovating one building, Dean's supervisory cost belongs to *that* building — not smeared by door count across 200 units he never set foot in.

Three gaps follow from that one mismatch:

1. **Allocation** — supervisory labor doesn't follow the crews it supervises. The bill (and the cost-per-unit intelligence built on it) is distorted.
2. **Auditability** — even where allocation is "right," we can't *show our work*. There is no per-week, per-employee breakdown of *why* a property got $X of Dean. When an LLC owner asks "why am I paying for your supervisor," we have no answer on screen.
3. **Capital vs. expense** — all crew labor lands on the P&L as one undifferentiated operating expense. But a chunk of it is **capital improvement** (capex) that should be **capitalized and reported below the line**, not expensed. R&M and turnover stay above the line. Workyard already knows which is which — via the **cost code** — but we throw that signal away at import and never classify the dollars.

**This module makes supervisory labor follow the crews it supervises, snapshots an auditable trail of how every overhead dollar was allocated, and classifies all labor by capital class (capex / R&M / turnover / opex) so capex payroll can be reported below the line.**

---

## North Star

> Open week 2026-W26. Dean's $2,400 is split: **31 Park 28% ($672)**, **Westend 19% ($456)**, … — *because that's where Maintenance + Construction logged their hours this week*, shown line by line. Of the total field labor that hit 31 Park, **$3,100 is capex (below the line)** and **$1,400 is R&M (above the line)** — and Dean's $672 inherits that same capex/R&M mix, because his time followed the crews that did the capital work. Answerable per week, per property, on demand — and reproducible months later because it was snapshotted, not recomputed.

---

## Dependencies & shared prerequisites

This build leans on one piece of plumbing that is **also** the blocker for the dumpster analysis — do it once, both features unlock:

1. **Persist the Workyard cost code on import.** `payroll_time_entries` currently **drops** the cost code (the insert writes `flag_reason`, never the activity). Add an additive `cost_code` column (and `cost_code_name`) and write it at import. This is the single hard prerequisite shared with `DUMPSTER_ANALYSIS_PRD.md` and [[workyard-cost-code-model]] / [[workyard-import-identity-index]]. **Without the persisted cost code there is no capital-class signal to classify.** Until then, the capex layer runs in "best-effort" mode off the live Workyard pull only (like `cost-code-breakdown.ts` does today), which means it can't classify *finalized historical* weeks.

2. **A stable department signal on the roster.** `PayrollEmployee.department` exists (`types.ts:74`, e.g. `"02 - Maintenance"`). The "follow-the-crew" allocation reads it to decide whose hours weight Dean's spread, so the department names the crews work under must be consistent. Verify before relying on it.

3. **Cost-code cleanup landing** ([[workyard-cost-code-model]]) makes the capital-class map stable. The map can ship against today's messy codes (it reuses `activityOf` in `cost-code-breakdown.ts:16`), but it gets trustworthy once the 68→13 cleanup is done.

---

## Part 1 — Follow-the-crew allocation (the Dean case)

### The model

Introduce a per-employee **allocation basis** for everyone currently in the spread pool (salaried + overhead-spread hourly). Two values:

- **`unit_weighted`** — today's behavior (`total_units / billableUnits`). Stays the **default** for true overhead (corporate, bookkeeping). **No change for anyone unless opted in.**
- **`crew_follow`** *(new)* — spread by **where a configured set of crews worked this week**. For Dean: weight each property by the labor logged there by the **Maintenance** and **Construction** departments, then allocate Dean's weekly pay across properties by those weights.

Concretely, inside `calculatePayroll`, for a `crew_follow` employee `E` configured to follow departments `D`:

1. Build `crewLaborByProp[E]` = Σ direct labor (hours **or** dollars — see open question) logged this week by employees whose `department ∈ D`, per property. This reuses the per-property labor aggregation the engine already computes (Method A, `calculations.ts:360`).
2. Normalize to weights summing to 1.
3. Allocate `E`'s weekly pay across properties by those weights instead of by units.
4. **Fallback:** if `D` logged **zero** billable hours that week (crew all on PTO, idle week), fall back to `unit_weighted` so `E`'s pay is never paid-but-unbilled. Record which basis was actually used (see audit).

### Why this is the right shape

- It's **additive and reversible** — a new opt-in basis, default unchanged. The golden-week test (`calculations.golden.test.ts`) stays green because nobody is `crew_follow` until configured.
- It **routes through the one engine** (windsurfrules / [[overtime-rule]] doctrine: never fork the calc). The supervisory spread becomes another weighting of the same labor pool, not a parallel derivation.
- It composes with everything downstream for free — invoices, statement, ADP, cost-per-unit, week-compare all read `property_costs`, so they inherit the better allocation with no per-surface change.
- It's **config, not a spec-gate** (Stanton standing rule): which departments a supervisor follows, and whether they're `crew_follow` at all, is data — defaulted and editable, never hardcoded.

### Configuration

Per-employee allocation config (new columns on the roster or a small `payroll_employee_allocation` table, effective-dated like rates/splits):
- `allocation_basis` — `unit_weighted` (default) | `crew_follow`
- `follows_departments` — text[] of department names (only when `crew_follow`)
- effective-dated so a mid-quarter change is point-in-time, consistent with rates/splits.

Dean gets `crew_follow` + `["Maintenance","Construction"]`. Everyone else is untouched.

> **Generalizes past Dean.** Any supervisor/lead whose time tracks a crew (a construction PM, a landscaping lead) uses the same basis with a different department set. Dean is the first instance, not a special case — do **not** hardcode "Dean."

---

## Part 2 — Allocation audit (show the work)

The complaint behind this whole ask is **invisibility** (the same root cause as DECISIONS_LOG §0.9's "missing hours" upset). Allocation that can't be explained is allocation that gets disputed.

**Snapshot the allocation, don't just recompute it.** At the moment a week's costs are computed/finalized, persist the resolved spread for each spread-pool employee:

- New table `payroll_overhead_allocation_audit` (RLS-on, `payroll_*`, family policy set):
  `week_id, employee_id, property_id, basis_used (unit_weighted|crew_follow|fallback_unit_weighted), weight, amount, crew_departments (when crew_follow)`.
- Written at calc/finalize time so it's **frozen** — a `statement_sent` week's allocation is reproducible months later even if rosters, units, or config drift. (Mirrors how `payroll_weekly_property_costs` already snapshots costs, and respects the week-lock invariant — this table is read-only once its week locks.)

**Surface it** as an "Explain allocation" drill-down:
- Per employee: "Dean — $2,400 this week, basis = crew_follow [Maintenance, Construction]" → table of properties with weight %, the crew hours that produced the weight, and the dollar landed.
- Per property: "Of your overhead line, $672 is Dean (supervision of the maintenance/construction work on *your* building this week), $310 is bookkeeping (spread by units)…"
- Reuse the existing `spread_by_dept` display affordance on `PropertyCostSummary` (`calculations.ts:92`) — this extends it from "which department" to "which person, which basis, why."

This is also the natural home for an **agent-readable** explanation (`notable[]`-style strings) so the command-bar / NL layer ([[payroll-agentic-goal]]) can answer "why is Dean on Westend's bill this week?" in plain English.

---

## Part 3 — Capital classification & below-the-line P&L

### The model

Every Workyard cost code maps to a **capital class**:

| Capital class | Examples (cost code → `activityOf`) | P&L treatment |
|---|---|---|
| **capex** | Construction & Repairs / `obra`, capital improvements | **Below the line** (capitalized) |
| **r_and_m** | Maintenance / `mantenimiento` / work orders, appliance repair, pest, snow | Above the line (operating) |
| **turnover** | Turnover / `vacante` (unit make-ready) | Above the line (own bucket — owners watch this) |
| **opex / overhead** | Office, material pickup, vehicles, unallocated | Above the line |

- New employer-scoped config table `payroll_cost_code_class` (`cost_code, activity, capital_class, employer_id`), **seeded from the existing `activityOf` mapping** (`cost-code-breakdown.ts:16`) so day-one behavior is sensible, then editable in an admin page. Config, not a spec-gate.
- The split is **hours-weighted off persisted cost codes**, the same mechanism `splitLaborByActivity` (`cost-code-breakdown.ts:62`) already uses for invoice activity sub-lines — we're adding a *classification* axis on top of the activity axis, not a new computation of cost.

### The elegant payoff: supervisory labor inherits the crew's capital mix

Because Part 1 makes Dean's pay **follow the crews**, his dollars can inherit the **same capex/R&M/turnover mix** as the labor he supervised. A week where the crews did 70% capital work makes 70% of Dean's supervisory cost *capex too* — which is the economically correct answer and falls out for free once allocation and classification share the same crew-labor weights. Call this out explicitly; it's the reason to build Parts 1 and 3 together.

### Output

A **P&L-shaped labor report** (per week, roll-up to month/quarter, per property and per LLC):
- **Above the line:** R&M + Turnover + Overhead labor (operating expense).
- **Below the line:** Capex labor (capitalized).
- Drill to the cost codes and the entries behind each bucket.
- Exportable (the finance/bookkeeping consumer is the same one served by the statement/ADP exports). Whether this feeds AppFolio GL coding or is a standalone export is an open question — see below.

> ⚠️ This is **management/owner reporting**, not a change to *what we bill*. The LLC still owes the full prefund (`statement-bills-full-prefund` / DECISIONS_LOG §0.20) — capex vs. opex is how the owner *books* the cost on their P&L, not a discount. Keep the billing total invariant; add the classification as a reporting overlay.

---

## Part 4 — Multi-employer (make "employer" a first-class dimension)

"Set this tool to work for different employers" is the largest structural piece — scoped here as **direction**, not v1 scope. Today there is one implicit employer: Stanton's crew billing Stanton's LLCs, with one `payroll_global_config`, one roster, one cost-code vocabulary.

Direction:
- An `employer` entity; `employer_id` threaded through roster, weeks, config, and the new class/allocation tables.
- **Per-employer** rate config (`payroll_global_config` becomes employer-scoped — tax rate, WC rate, OT threshold, mgmt-fee policy), cost-code class map, and roster.
- The engine stays single (`calculatePayroll`); employer becomes a scoping filter, not a fork.
- RLS scoped so an employer's users see only their own data.

This is a **phase of its own** (touches schema breadth + RLS + every query's scope) and belongs on the roadmap, not bolted onto the Dean fix. The Dean allocation and capex layer should be built **employer-aware in their schema** (carry `employer_id` from the start, defaulted to the current implicit employer) so multi-employer is a fill-in later, not a migration of everything.

---

## Build order (suggested)

1. **Persist cost code on import** (shared prereq; unblocks capex *and* dumpster). Smallest, highest-leverage, do regardless.
2. **Follow-the-crew allocation** + per-employee allocation config (default `unit_weighted`, opt Dean in). Golden test stays green.
3. **Allocation audit snapshot + explain UI.**
4. **Capital-class config + P&L labor report** (supervisory inheritance falls out of 2+4).
5. **Multi-employer** scoping — its own phase; schema carries `employer_id` from step 2 onward so this is additive.

---

## Out of Scope (v1)

- Changing **what the LLC is billed** — capex/opex is a reporting overlay; the full-prefund billing total is invariant ([[statement-bills-full-prefund]]).
- Direct **AppFolio GL posting** of the capex/opex split (export first; integration later — open question).
- Rewriting **finalized historical** weeks: the capex report reads persisted cost codes going forward; pre-persistence weeks are best-effort off the live Workyard pull and clearly flagged as such.
- A general per-employee allocation-rule builder — v1 ships `unit_weighted` and `crew_follow` only; more bases are added when a real role needs one.

## Open Questions

- **Weight by crew HOURS or crew DOLLARS?** Hours = "where attention went" (a high-rate worker doesn't pull more supervision); dollars = "where the money went" and matches every other spread in the engine. Lean **hours** for supervisory attention, but confirm with Alex — it changes the numbers.
- **Is Dean salaried or overhead-spread hourly?** Determines which pool he's in. The mechanism covers both; verify his roster classification before configuring.
- **Capex threshold:** is *all* `obra`/Construction capex, or only above a $/scope threshold (small repairs are R&M even if coded construction)? Owners' accountants may have a capitalization policy — needs a finance answer.
- **Turnover:** above the line as opex, or its own reported line owners can watch? (Proposed: own line, above the line.)
- **Where does the capex P&L go** — a `/payroll` report page, a periodic export, or fed into AppFolio GL coding?
- **Multi-employer billing:** do other employers even bill LLCs the Stanton way, or just run pay? Shapes how much of the billing stack is employer-scoped vs. Stanton-only.

## Related artifacts

- `src/lib/payroll/calculations.ts` — Method A (direct labor, `:360`) and Method B (unit-weighted spread, `:393`); `spread_by_dept` (`:92`). The allocation change lives here.
- `src/lib/payroll/cost-code-breakdown.ts` — `activityOf` (`:16`) seeds the capital-class map; `splitLaborByActivity` (`:62`) is the hours-weighting precedent.
- `DUMPSTER_ANALYSIS_PRD.md` — shares the "persist cost code on import" prerequisite.
- `WORKYARD_GUIDE.md`, `WORKYARD_API_REFERENCE.md` — cost-code source & pull.
- Memory: [[workyard-cost-code-model]], [[workyard-import-identity-index]], [[statement-bills-full-prefund]], [[payroll-agentic-goal]], [[overtime-rule]].
- `ROADMAP.md` — where the multi-employer phase and the employee time-spend analytics (Will Thomas view) are tracked.
