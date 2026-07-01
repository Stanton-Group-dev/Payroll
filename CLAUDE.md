# Payroll — agent entrypoint

You are an agent (Claude Code, Hermes, or similar) or an engineer opening **Stanton
Management's Payroll repo** cold. This app replaces the weekly payroll Excel sheet: it pulls
field‑crew time from Workyard, allocates labor to buildings, computes pay, locks approved
weeks, exports to ADP, and bills each LLC per‑week.

**Read this file first.** Its job is to point you at the right source of truth. The big
historical caveat — that the database had "run ahead" of an unmerged hardening branch living in
a second worktree — is **resolved as of 2026‑06‑23**: that work is merged to `main`, deployed,
and the second worktree is gone. The DB and the app code now agree. Still: never assume "it's in
main" or "it's not built" from memory — verify against the map below and the live DB.

---

## ⚠️ First: which branch am I in, and what's actually live?

Run `git rev-parse --abbrev-ref HEAD` before trusting any "this is live" statement.

There is now a **single worktree** (`C:\01-repos\Payroll`). Branch state after the 2026‑06‑23
consolidation:
- **`main`** — the source of truth; auto‑deploys to Vercel. Everything below is on it.
- **`feat/new-project-wizard`** — the only other branch: an active workspace. Its *committed*
  work is already on `main`; it lingers only for in‑progress uncommitted edits. Retire it once
  that work lands, then it's `main` only.

**The old three‑way "DB vs main vs hardening" split is gone.** Current live state (verified
against `wkwmxxlfheywwbgdbzxe`, 2026‑06‑23) — DB **and** the deployed app on `main` agree:

| Capability | Status (DB + app on `main`, deployed) |
|---|---|
| RLS / authz hardening | ✅ Live — anon DML revoked, blanket `payroll_employees_auth` dropped, fail‑closed role helpers; `useAuth` fail‑closed |
| Approval‑week **lock trigger** + in‑app guard | ✅ Live — DB trigger on all 6 pay‑input tables **and** `assertWeekWritable` friendly guard in‑app |
| Rate config columns + config‑driven engine | ✅ Live — 5 columns on `payroll_global_config`; engine reads them; admin page edits them |
| `prefund_includes_mgmt_fee` flag | ✅ Live (default `true`); engine honors it |
| Single‑engine routing (ADP + reconciliation) | ✅ Live — both route through `calculatePayroll` (no inline re‑derivation) |
| Golden‑week regression test | ✅ Present — `src/lib/payroll/calculations.golden.test.ts` |
| Expense **sign‑on‑read** route | ✅ Live — `GET /api/expense-receipt` |
| Timesheet **reduce‑hours** (partial cut + reason) | ✅ Live — `operation='reduce'` (merged via PR #12) |
| Expense **bucket privacy** | ⏳ **Bucket is still PUBLIC.** The sign‑on‑read route is deployed; the private‑bucket flip migration (`…_05_expense_receipts_private`) exists but is **not applied**. |

**The one pending deploy step — the expense private‑bucket flip.** The sign‑on‑read route is now
live, so it's finally safe to flip: apply `…_05_expense_receipts_private`, then verify a path‑based
receipt **and** a legacy (`http…`) receipt both still download through the signed‑URL route. Never
flip before the route is live (it is now) — that order breaks receipt display.

**Former #1 task — done.** "Merge `hardening/payroll-waves-0-2` → `main`" (old PLAN.md G1) is
**complete**; the branch and its worktree are deleted. For the current top priority, read
`PLAN.md` / `HANDOFF.md` (treat them as possibly lagging — trust `DECISIONS_LOG.md` and the live
DB where they diverge).

**Recently shipped (2026‑06‑23 consolidation):** money‑engine hardening waves 0‑2 (PRP‑02/03/04),
employee onboarding, unallocated‑hours daily SMS (deployed but **dormant** — switch off), the
new‑project onboarding wizard, and timesheet reduce‑hours.

---

## What this repo is
A Next.js 15 / Supabase app authenticating against **Stanton Main DB** (`wkwmxxlfheywwbgdbzxe`)
via `signInWithPassword`, deployed on Vercel (project `payroll`, auto‑deploys on push to `main`).
It **shares the production DB with other Stanton apps** — prefer additive, reversible migrations;
new tables are `payroll_*`; read canonical tables only, never `AF_` staging; never write
AppFolio‑authoritative columns. A respine audit lives in `audit/` with PRPs 01–05.

## How to start any task
Read in this order; trust later docs over earlier ones where they diverge.

1. **`HANDOFF.md`** — orientation map: state, current priority, setup, environment/DB/Workyard
   pointers, and the index to every other doc.
2. **`PLAN.md`** — planned‑vs‑built status and the cross‑cutting gaps **G1–G4** (may lag the live
   state — cross‑check the table above and the DB).
3. **`DECISIONS_LOG.md`** (§0 first) — every settled decision. Check here **before** re‑asking
   "why is it this way / should we…", and before touching payroll math, cost‑code, or Workyard logic.
4. **`windsurfrules`** + **`.windsurfrules`** — the engineering standard and the agent‑behavior rules
   (plan‑mode discipline; **always use the Supabase MCP** for DB ops). Both files exist; both apply.
5. **`DATABASE_ARCHITECTURE.md`** — shared‑DB / `AF_`‑staging / canonical‑table / `payroll_` ownership.

**Local run:** `infisical run --env=prod -- npm run dev` (Infisical project per `HANDOFF.md`;
`infisical login` once; no `.infisical.json` is committed — `infisical init` if missing). Test
login + password come from Infisical `/test-users`, not the repo. Set `WORKYARD_MOCK=1` to exercise
the import flow with deterministic dummy timecards (no Workyard creds); real pulls need
`WORKYARD_API_KEY` + `WORKYARD_ORG_ID` (org 25316). Install `gitleaks`
(`winget install Gitleaks.Gitleaks`) + `npm install` so the `.githooks/pre-commit` secret scan is
wired — without gitleaks the hook silently passes everything.

**Verify before & after any change:** `npm run typecheck && npm run lint && npm test`. CI
(`.github/workflows/ci.yml`) runs the same three on every PR and push to `main` and blocks a red merge.

## Doc map
| Doc | Read when | Status |
|---|---|---|
| `HANDOFF.md` | First, on any task — the map to everything | Authoritative (handoff) |
| `PLAN.md` | Built‑vs‑missing status, gaps G1–G4, what to work on | **Authoritative status** (may lag live) |
| `DECISIONS_LOG.md` | Before re‑asking anything settled; before math/cost‑code/Workyard | **Authoritative** |
| `windsurfrules` | Before writing ANY code — engineering standard (8 sections) | Authoritative |
| `.windsurfrules` | Session start — plan‑mode discipline + Supabase MCP usage | Authoritative |
| `DATABASE_ARCHITECTURE.md` | Before any migration/query — DB rules, not a table catalog | Authoritative |
| `WORKYARD_GUIDE.md` | Before any Workyard work — model + resolution chain (org 25316) | Authoritative |
| `WORKYARD_API_REFERENCE.md` | When writing Workyard API calls — endpoints, 60 req/min | Authoritative |
| `DESIGN_SYSTEM.md` | Before touching UI — the tokens behind windsurfrules §3 | Authoritative |
| `ADVANCED_DATA_TABLE_SPECIFICATION.md` | Before building any data‑heavy table — reuse this primitive | Spec |
| `TIMESHEET_ADJUSTMENT_PRD.md` + `_UI_SPEC.md` | Adjustment workbench / manual‑hours work | Spec (supersedes PRD Module 2) |
| `EXPENSE_REIMBURSEMENT_PRD.md` | Expense submission/approval work | PRD (core built, mobile flow partial) |
| `IN_APP_TIME_APPROVAL_PRD.md` | Approval‑gate / Workyard re‑pull drift | PRD — proposed, **not built** |
| `UNALLOCATED_HOURS_NOTIFICATION_PRD.md` | Unallocated‑SMS cron / copy | PRD — **merged & deployed, dormant** (switch off) |
| `OFFCYCLE_BILLING_RUN_PRD.md` | Off‑cycle "quick bill" run | PRD — **not built** (needs model change) |
| `PAYROLL_PRD.md` | Original intent / canonical math definitions | **Historical baseline** — PLAN/DECISIONS override |
| `MANUAL_TASKS_HANDOFF.md` / `WESTEND_ONBOARDING_CHECKLIST.md` | Workyard data‑entry / Westend rollout ops | Handoff |
| `README.md` | 30‑sec product/stack overview only | Status line **stale** — defer to PLAN |
| `WESTEND_WORKYARD_SETUP.md`, `WORKYARD_REPLACEMENT_FEASIBILITY.md` | Background/strategy only | Historical |
| `DUMPSTER_ANALYSIS_PRD.md` | Dumpster/off‑site‑labor analytics only | PRD — deferred (early version shipped) |
| `TENANT_DOCUMENT_COORDINATION_PRD.md` | Confirm it's **out of scope** — do NOT build under payroll | PRD — ruled out (§0.19) |

## Capabilities & invariants — how to use what's built
Each rule names a verified symbol/file. Everything below is **merged to `main` and deployed** —
it describes the live app, not a future merge.

### Pay math — one engine, RAW hours to ADP
- **The engine is `calculatePayroll`** (`src/lib/payroll/calculations.ts:133`). W2‑hourly OT at
  **1.5×** over a weekly **40‑hr** threshold (recomputes reg/OT from the worked total, ignoring the
  imported split) for OT‑eligible workers only; salaried = 0× (exempt, paid by `weekly_rate`);
  contractor / construction‑dept / `!ot_allowed` = 1.0× straight time. `otMultiplier`
  (`calculations.ts:125`) is the **single** OT classifier — never double‑apply 1.5×.
  `gross = regular_wages + ot_wages + phone + mileage + other_adjustments − advances`; the tax/WC
  base excludes reimbursements. `required_prefund = gross + payroll_tax + workers_comp`, **plus the
  mgmt fee iff `prefund_includes_mgmt_fee` is true** (live config flag, default true).
- **The LLC statement bills the FULL prefund (2026‑06‑25, `DECISIONS_LOG.md` §0.20 — reverses the old
  "prefund is reference‑only" §1).** Each property's `total_cost` now folds in its share of employer
  **payroll tax + workers' comp**, allocated by each employee's wage placement (`propTaxCost` /
  `propWcCost` in `calculations.ts`: direct labor → their properties; salaried/overhead/suppressed →
  unit‑weighted spread). The **mgmt‑fee base stays wages** (`labor + spread`), mirroring the prefund,
  so `Σ property total_cost = required_prefund + advances` (advances bill at full freight and are
  recovered from the employee, not by under‑billing the LLC). Tax/WC are **folded into the property
  total — no separate customer line.** Companion rule: labor on a **suppressed** placeholder property
  is no longer written off — it joins the overhead spread (a non‑asset's labor lands on the real
  billable assets). Stored on `payroll_weekly_property_costs.tax_cost`/`wc_cost`.
- **Do not fork the calc.** ADP export and reconciliation **route through the engine** (PRP‑02,
  `d033933`) — they no longer re‑derive gross in local loops. When you touch pay math, push it into
  the engine; never add a parallel derivation.
- **ADP export carries RAW hours at the straight rate** (`adp-export/page.tsx`: `gross +=
  (regular_hours + ot_hours) * rate`, **no ×1.5**; `net = gross − advances`). **ADP applies the 1.5×
  premium itself — never inflate OT in the export.** It is correct but uncommented; do not "fix" it
  to match the engine.
- **Golden‑week test** (`src/lib/payroll/calculations.golden.test.ts`) pins the engine's canonical
  week. **Keep it green** — it's the regression net for any pay‑math change.

### Business constants — config, never spec‑gates
- **Standing Stanton rule: config, not spec‑gates.** Never block a build on a tunable business rule
  and never hardcode one where it can be configured — default it from config and ship, then expose a
  setting. (Manufacturing such gates is why systems stall.)
- **Live truth:** `payroll_global_config` carries `payroll_tax_rate`, `workers_comp_rate`,
  `phone_reimbursement_amount`, `ot_threshold_hours`, `prefund_includes_mgmt_fee`. The engine reads
  them (`usePayrollWeekReview.ts`, `usePayrollAdjustments.ts` with a fallback to the constant) and the
  admin page (`app/payroll/admin/mgmt-fee/page.tsx` via `useAdminGlobalConfig`) edits them.
- `src/lib/payroll/config.ts` still holds the **fallback defaults** (`PAYROLL_TAX_RATE` 0.08,
  `WORKERS_COMP_RATE` 0.03, `PHONE_REIMBURSEMENT_AMOUNT` 8, `DEFAULT_MILEAGE_RATE` 0.73; 1.5×/40 are
  inline literals). **When you add or change a rate, wire it through `payroll_global_config` + a
  settings control — never add a new hardcode.**

### Approved‑week lock — reject‑on‑locked is the feature
- Once `payroll_weeks.status ∈ ('payroll_approved','invoiced','statement_sent')`, the 6 pay‑input
  tables (`payroll_time_entries`, `payroll_adjustments`, `payroll_dept_split_overrides`,
  `payroll_spread_events`, `payroll_weekly_property_costs`, `payroll_mileage_reimbursements`) are
  immutable. Enforced at the DB by trigger `trg_lock_after_approval` → `payroll_reject_if_week_locked()`
  (bypasses RLS, hits all roles incl. service_role) **and** in‑app by `assertWeekWritable(supabase,
  weekId)` (`src/lib/payroll/weekLock.ts`, `LOCKED_WEEK_STATUSES`), which throws a friendly error
  **before** the DB rejects. Both are live.
- **Writes to a locked week reject by design — that is the feature.** Corrections go in as a
  **carry‑forward in the current open week**. When you add any week‑scoped pay‑table write, call
  `await assertWeekWritable(supabase, weekId)` first so the user gets the friendly error, not the raw
  trigger violation.

### RLS / authz (live)
- `anon` INSERT/UPDATE/DELETE/TRUNCATE revoked on every `public.payroll_*` table; the blanket
  `payroll_employees_auth` (true/true) and other always‑true policies dropped; Group‑A pay‑table
  writes gated on `payroll_is_manager_or_above()`; role helpers fail **closed**
  (`payroll_get_role()` → NULL with no fail‑open default; `payroll_is_admin()` /
  `payroll_is_manager_or_above()` coalesce NULL → false). Applied via `harden_payroll_role_and_revoke_anon_dml`,
  `tighten_payroll_rls_drop_blanket_auth`, `complete_payroll_rls`. App twin: `useAuth`
  (`src/hooks/payroll/useAuth.ts`) is fail‑closed.
- **If a legitimate user hits a 403 / blank data:** fail‑closed `useAuth` + RLS deny any session
  whose `auth.uid()` has **no `public.profiles` row or a null role**. The fix is to **provision the
  profiles row/role**, never to loosen the policy or restore a fail‑open default.

### Expense receipts — sign‑on‑read live, private‑bucket flip still pending
- `GET /api/expense-receipt?path=…` auth‑gates (401 if no user), passes through legacy `http…` URLs,
  else issues a ~60s `createSignedUrl` on the `expense-receipts` bucket. **This route is live.**
- ⚠️ **The bucket is still PUBLIC** (`20260308_make_expense_bucket_public` applied; the flip
  `…_05_expense_receipts_private` is **not** applied — verified 2026‑06‑23). Apply the flip, then
  verify a path‑based receipt **and** a legacy (`http…`) receipt both still download via the route.
  This is the one outstanding deploy step.

### Timesheet adjustments — reduce as well as remove
- The adjustment workbench (`/payroll/timesheets`, `useTimesheetAdjustments.ts`) supports reassign,
  split, spread, manual add, full **remove**, and partial **reduce** (cut some worked hours off an
  assigned entry, keep the rest, with a required reason). All corrections log to
  `payroll_timesheet_corrections` with an `operation` of
  `reassign | split | add | remove | reduce` (the `reduce` value is live in the CHECK constraint).
  Reduce sets `regular = remainder` / `ot = 0` and lets the engine recompute OT from the weekly total
  — the same convention split/spread use. Don't write a fourth hours convention.

## Deployment sequencing
- **Shared prod DB.** Additive, reversible migrations only; `payroll_*` for new tables; canonical
  reads only; no AppFolio‑authoritative writes; no hard deletes (`is_current = false`); money is
  `NUMERIC(10,2)`. Use the **Supabase MCP** for DB ops (`.windsurfrules`) — don't hand out SQL to
  paste or ask for a service‑role key. (Applying a migration to the shared prod DB is a deliberate,
  authorize‑first step — don't fold it into an unrelated "commit and push".)
- **Expense private‑bucket flip** (`…_05`): the sign‑on‑read route is already deployed, so apply the
  flip, then verify a path‑based receipt **and** a legacy (`http…`) receipt both still display.
- App code is only live once pushed to `main` and deployed to Vercel — a feature branch is not live.

## Watch in production (steady‑state checks)
- **Week lock:** a write to a `statement_sent` week is rejected at the DB **and** `assertWeekWritable`
  throws the friendly error in‑app; a current‑week carry‑forward still succeeds.
- **Rates:** editing a rate in the admin page changes the deployed engine's math (the config columns
  are read, not the constants).
- **ADP export:** spot‑check an OT/threshold week — RAW hours, straight rate, `net = gross − advances`;
  confirm it stays in step with `calculatePayroll`.
- **Expense flip:** after `…_05`, open a path‑based receipt and a legacy (`http…`) receipt — both must
  still display via the signed‑URL route.

## Safety rules (Stanton doctrine)
- **No secret values in this repo, ever.** Machine/app secrets come from **Infisical** at runtime
  (`infisical run -- <cmd>`); human logins live in **Keeper**. Find a real key/JWT/token → incident:
  stop, flag, rotate. (Old Bitwarden boilerplate was purged 06‑17; any remaining `bws`/Bitwarden is
  stale — fix it.)
- **RLS by default on new public tables — without asking.** Every new `public.payroll_*` table must
  `ENABLE ROW LEVEL SECURITY` and carry the family policy set (service_role full + scoped dev role +
  `authenticated` read + manager/admin write). Ship no bare‑RLS tables.
- **Least privilege:** contractors get dev‑only keys; CI/agents use scoped accounts, never god‑mode.
- **Plan‑mode discipline** (`.windsurfrules`): present the plan and **wait for explicit confirmation**
  before implementing — don't infer "go" from the request.

## Test login (shared — verify without a real person's password)

This app authenticates against **Stanton Main DB** (Supabase Auth, project `wkwmxxlfheywwbgdbzxe`). To log in and verify a change in-browser, use the shared Stanton test user — do **not** invent one, hardcode credentials, or ask. There is deliberately **no test login in the code** (no secrets in the repo); this is it.

- **Login:** `claude-test@payroll.test` (role `superadmin`, active)
- **Password:** never in this repo. Fetch from Infisical at runtime: `infisical secrets get MAIN_TEST_PASSWORD --path /test-users --env prod --projectId b974f539-54dc-4687-9afd-941d95d434c9 --plain`
- **Full registry + rotation:** `stanton-control/context/test-users.md`.
