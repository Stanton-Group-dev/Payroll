# Payroll Re-Spine Audit — 2026-06-13

**Method:** `stanton-respine` (recon-first brownfield uplift), orchestrated with `/code-review` and `/security-review` folded in as two of the audit lenses.
**Target:** `C:\01-repos\Payroll` — Next.js 15 + Supabase weekly payroll & property-billing system, Phase 1 (Excel replacement). ~14.9K LOC, 73 TS/TSX files.
**Audited against:** `C:\01-repos\stanton-control\standards\STANTON-engineering-standards.md` and `STANTON-spec-standard.md` (located; `AGENT_READY_ARCHITECTURE.md` and `STANTON-workflow.md` not found — agent-ready rubric carried from the `stanton-respine` references).
**Live DB:** `wkwmxxlfheywwbgdbzxe` ("Stanton Main DB") — a **shared, multi-department** Postgres. Payroll owns 29 `payroll_`-prefixed tables here. Schema/policy claims below are verified by live introspection (`pg_policies`, `information_schema.role_table_grants`, `pg_get_functiondef`, Supabase security advisors), not from migration files.

> **One-line verdict:** The build is further along than PLAN.md says (the cost engine is its best-built piece, not "planned"), but it rests on a **broken authorization substrate** (an unauthenticated write path + defeated RBAC on a shared DB), a **three-way-divergent payroll math engine** (the number on screen, the number sent to ADP, and the number reconciled against ADP can all disagree), and **no reliability substrate at all** (zero tests, zero CI, schema/policies live only in the DB with no migration or review). The auditable, approval-gated promise is not demonstrable today because locking is a soft UI flag over open tables.

---

## How to read this document

- **Part A — Recon map** (what actually exists, verified).
- **Part B — Gap register** (two axes: feature gaps vs platform-substrate gaps; each triaged structural/surgical with "why it bites late").
- **Part C — Findings by lens** (Security / Correctness / Structural), each with severity, evidence, and verification status.
- **Part D — Schema hooks** (trunk-and-branch: cheap now, painful later).
- **Part E — Uplift PRP index** (carved units in `audit/prps/`; land in this review folder for a human to release — nothing auto-built).
- **Part F — Open structural decisions** for the human, and the handoff test.

Severity legend: **CRITICAL** (exploitable now / wrong money now) · **HIGH** · **MEDIUM** · **LOW/INFO**. Verification: **Verified** (read against live system) · `[Unverified]` (becomes a Phase-1 gate) · `[Needs domain confirmation]` (a business-rule call, not a code fact).

---

## Part A — Recon map (verified)

### A1. Actions vs. screens (the agent-ready axis)
Only three units are real, importable services with typed I/O — agent-callable today:
- `src/lib/payroll/calculations.ts` (`calculatePayroll`, `getMgmtFeeRate`, `resolveRateAsOf`, `round2`)
- `src/lib/payroll/workyard-api.ts` (`fetchWorkyardTimecards`, S-code matching)
- `src/lib/payroll/csv-parser.ts` (`parseWorkyardCSV`)

**Everything else is trapped behind a screen.** All mutations — timesheet reassign/add/spread/remove/carry-forward, invoice generation, statement approval, the four-stage approval chain, expense submission/approval/gas-allocation, ADP export, ADP reconciliation — live inside `'use client'` React hooks (`src/hooks/payroll/*`) or page components, mixing `useState`, Supabase I/O, and business logic in one closure. **Zero `.rpc()` calls exist in the codebase.** None of these can be invoked by an API route, a server action, a cron job, or an agent without a refactor.

### A2. Seams (verified)
| Seam | Direction | Real/Stub | Failure terminus |
|---|---|---|---|
| Workyard API (employees, timecards) | inbound-read | Real (paginated; one 400-retry) | Throws → 502; **no auth on the proxy route** (see S4) |
| Workyard CSV | inbound-read | Real | per-row error array; some silent truncation (see C-MED) |
| Supabase DB read/write | both | Real | **many writes fire-and-forget** — `.error` unchecked (see C-CRIT/HIGH) |
| Supabase Auth | both | Real (`signInWithPassword`, middleware `getUser`) | redirect to login |
| Supabase Storage (receipts) | outbound-write | Real, **bucket public** | orphaned files on partial failure (see C-CRIT-4) |
| ADP export | outbound | **Client-side CSV only** — never touches ADP | unhandled JS exceptions |
| ADP import (reconciliation) | inbound file + DB write | Real (xlsx parsed client-side) | parse error string; **DB writes unchecked** |

### A3. Control surface (verified absent)
No `tasks/`, no `lessons.md`, no `decisions.md`, no `PROJECT_NORTH_STAR.md`, **no `PRPs/`/`specs/` (no carved units)**, **no `.github/workflows` (no CI)**, **no tests of any kind**, no `test`/`typecheck` script in `package.json` (only `dev`/`build`/`start`/`lint`). Legacy PRDs (`PAYROLL_PRD.md`, `TIMESHEET_ADJUSTMENT_PRD.md`, …) linger at root alongside the consolidated `PLAN.md`.

---

## Part B — Gap register

Two axes. **Feature gaps** are mostly already in PLAN.md — noted and deferred. **Platform-substrate gaps** — the cross-cutting things every feature silently assumes — are where this audit earns its keep.

### B1. Feature gaps (known; defer to PLAN.md)
| Gap | Reality in code | Triage |
|---|---|---|
| Cost Allocation Engine ("planned") | **Already built** — `calculations.ts` is the best-built unit. PLAN status is stale. | Surgical (fix PLAN) |
| Invoice / Statement generators ("planned") | Exist, hook-embedded (`usePayrollWeekInvoices`, `usePayrollStatement`). | Surgical |
| History store ("planned") | Surface exists (`history/page.tsx`, `usePayrollHistory.ts`); immutability not DB-enforced. | Structural (see ST3) |
| Intelligence layer, mileage, SMS | Genuinely deferred. | Defer (correct) |

### B2. Platform-substrate gaps (the bite-late class — hunt these)
| # | Gap | Why it bites late | Triage |
|---|---|---|---|
| **G1** | **Authorization substrate is broken** — unauthenticated write path + RBAC defeated by blanket policies on a shared DB. | Looks done: granular role policies are right there in the list. The hole is invisible until someone reads the *combined* policy set against the live grants. | **Structural** |
| **G2** | **No single source of truth for payroll math** — 3 divergent gross-pay implementations. | The screen agrees with ADP only by luck; the divergence surfaces the first week with OT, an advance, or a soft-deleted adjustment. | **Structural** |
| **G3** | **No reliability substrate** — zero tests, zero CI, no typecheck gate. | A money system with no tests means every refactor (including this uplift) is unverifiable. Discovered "at the end" of every regression. | **Structural** |
| **G4** | **Schema & policies live only in the DB, with no migration or review** — 1 migration file vs 29 live tables. | This is the *meta-gap*: it's *how* G1 stayed invisible. A policy change (the always-true override, the fail-open default) hit production with no diff anyone could review. | **Structural** |
| **G5** | **Logic trapped behind screens** — no service layer, zero `.rpc()`. | The "agent-ready" / automation value (run-payroll, generate-invoices unattended) is unreachable; every operation needs a human clicking. | **Structural** |
| **G6** | **Locking/immutability is a soft UI flag** over open tables. | The headline "auditable, approval-gated" value prop is undeliverable; a locked week is writable by any authenticated user or the anon key. | **Structural** |
| **G7** | **Audit trail is app-written and forgeable** (`payroll_audit_log` open to authenticated insert/select). | The audit trail — the entire reason to leave Excel — can be fabricated or read by anyone. | **Structural** |
| **G8** | **Unowned API-route seam** — `/api/workyard/*` unauthenticated, proxying a secret token. | A deployed public URL leaks employee PII + timecards and burns the Workyard token. | **Structural** |
| **G9** | **Actuator gap** — requirements (RLS portfolio filtering, approval gates, immutable locking) exist only as PLAN.md prose / "Known Debt" bullets, **no carved PRP**. | Per the carve pipeline, *a requirement with no PRP is never built.* The carve reads a PRD, not a debt bullet. | **Structural** |

---

## Part C — Findings by lens

### C1. Security (live-DB verified; both Criticals adversarially upheld)

| ID | Sev | Finding | Evidence (Verified) |
|---|---|---|---|
| **S1** | **CRITICAL** | **Unauthenticated write to payroll data.** `anon` role holds full DML grants on all `payroll_` tables; `payroll_get_role()` = `COALESCE((SELECT role FROM profiles WHERE id=auth.uid()),'manager')` → for anon, `auth.uid()` is NULL → resolves to `'manager'`; `{public}`-role write policies gated only by `payroll_is_manager_or_above()` therefore pass. A request bearing the **public anon key (hardcoded in `src/lib/supabase/config.ts:2`)** can INSERT/UPDATE `payroll_time_entries`, `payroll_employees`, `payroll_employee_rates`, `payroll_invoices`, `payroll_property_thresholds`, `payroll_adp_recon_rows`. | `role_table_grants` (anon = SELECT/INSERT/UPDATE/DELETE/TRUNCATE); `pg_get_functiondef(payroll_get_role)`; `pg_policies` `{public}` write policies. Adversarial verify: **UPHELD**. |
| **S2** | **CRITICAL** | **RBAC is defeated for every authenticated user.** 22 tables carry a blanket `*_auth` / `authenticated_access` policy: `cmd=ALL, role=authenticated, USING true, WITH CHECK true`, coexisting with the granular role policies. Postgres ORs permissive policies → `true OR payroll_is_manager_or_above()` = always true. **Any authenticated user on the shared Stanton Main DB has full CRUD on all payroll data**, including `payroll_audit_log`. The role checks are dead code. | `pg_policies` (the `*_auth` rows). Adversarial verify: **UPHELD**, severity CRITICAL due to shared-DB blast radius. |
| **S3** | **HIGH** | **Forgeable audit trail.** `payroll_audit_log` policies: authenticated INSERT `WITH CHECK true` + SELECT `USING true`; no actor binding. Any authenticated user can inject false audit rows and read all audit history. (No UPDATE/DELETE policy → not editable, the one saving grace.) | `pg_policies`. |
| **S4** | **HIGH** | **Two unauthenticated API routes proxy a secret token.** Middleware matcher is `['/payroll/:path*']` only — it does **not** cover `/api/**`. `/api/workyard/employees` and `/api/workyard/timecards` perform no auth check and forward `WORKYARD_API_KEY` to any caller → employee PII + timecard exfiltration + token abuse from the public internet if deployed. | `src/middleware.ts` matcher; `src/app/api/workyard/*/route.ts`. |
| **S5** | **HIGH** | **Public storage bucket for PII.** `expense-receipts` made public (`supabase/migrations/20260308_make_expense_bucket_public.sql`); receipts + signatures stored at predictable `receipts/{userId}/{ts}-{uuid}.{ext}` paths → unauthenticated retrieval. Advisor: `public_bucket_allows_listing`. | migration + `useExpenseSubmissions.ts` path pattern. |
| **S6** | **MEDIUM** | **SECURITY DEFINER role functions with mutable `search_path`** (`payroll_get_role/is_admin/is_manager_or_above`, `proconfig=null`) — search-path-hijack hardening gap; also anon-EXECUTE-granted. | `pg_proc.proconfig`; advisor `function_search_path_mutable`. |
| **S7** | **MEDIUM** | **Fail-open role default in the app layer too** — `useAuth.ts:44-56` defaults a profile-less user to `role:'manager', is_active:true`, mirroring the DB function. Compounds S1/S2. | `src/hooks/payroll/useAuth.ts:44-56`. |
| **S8** | **LOW** | **Hardcoded publishable key + URL committed** (`config.ts:1-2`). Public-class (not a secret leak) but cannot be rotated without a code change. | `src/lib/supabase/config.ts`. |
| **S9** | **INFO** | **No server-side authorization anywhere** — all role gates (`isAdmin`/`isManager`) are client-only React state; no service-role key; RLS is the sole DB-authz layer (and it's broken). | `useAuth.ts`; no `SUPABASE_SERVICE_ROLE_KEY` in repo. |

> Shared-DB-wide advisor context (out of payroll scope, but the org should see it): 212 `rls_policy_always_true`, 146 `rls_enabled_no_policy`, 134 `function_search_path_mutable`, **7 ERROR `security_definer_view`**, leaked-password protection disabled, end-of-life Postgres 15.8. Recommend an org-level advisor sweep separately.

### C2. Correctness — the money path (code-verified)

**Structural theme (G2): gross pay is implemented three times and they have diverged.** `calculations.ts:calculatePayroll` (the canonical engine), the ADP-export page's `useEffect`, and `useADPReconciliation.load()` each re-derive gross pay differently. The on-screen number, the number exported to ADP, and the number reconciled against ADP are not guaranteed equal.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **C-1** | **CRITICAL** | **No overtime premium anywhere.** OT wages = `ot_hours * rate` at 1× in all three implementations (`calculations.ts:129`, adp-export `page.tsx`, `useADPReconciliation.ts`). `ot_allowed` flag is dead code. Systematic FLSA underpayment. | `calculations.ts:129` Verified. `[Needs domain confirmation]` that 1.5× is intended. |
| **C-2** | **CRITICAL** | **Effective-dated rates ignored.** `resolveRateAsOf` is exported but never called; all three impls use the live `emp.hourly_rate` → a raise retroactively reprices every historical week. | `calculations.ts:16,124,191`. Verified. |
| **C-3** | **CRITICAL** | **Reconciliation sign error.** `useADPReconciliation.load()` adds *every* adjustment amount (incl. advances) to system gross instead of subtracting advances → every week with an advance shows a false variance equal to the advance. | `useADPReconciliation.ts:~79`. Verified. |
| **C-4** | **CRITICAL** | **Storage orphans + zero-item submissions on partial failure.** `useExpenseSubmissions.submitBatch` uploads signature + receipts, then inserts rows; any later-step failure throws without removing already-uploaded files or the header row → orphaned PII blobs and a 0-item submission shown as received. | `useExpenseSubmissions.ts:197-265`. Verified. |
| **C-5** | **HIGH** | **Mgmt-fee rate uses `new Date()` (today), not the week** → historical weeks reprice at the current fee rate. | `calculations.ts:74`. Verified. |
| **C-6** | **HIGH** | **Salaried labor excluded from property cost** (Method A only spreads hourly labor) → LLCs underbilled for salaried staff. | `calculations.ts:185-194`. Verified. `[Needs domain confirmation]` on allocation method. |
| **C-7** | **HIGH** | **Two management-fee bases + prefund excludes fee.** Per-employee fee = global rate × gross; per-property fee = portfolio rate × (labor+spread); `total_mgmt_fee` sums the employee one; `required_prefund` omits fee entirely. | `calculations.ts:164,212,231,232`. Verified. `[Needs domain confirmation]`. |
| **C-8** | **HIGH** | **First-name-only employee matching** on import assigns hours to the wrong person when first names collide; no flag set. | `import/page.tsx:53`. Verified. |
| **C-9** | **HIGH** | **Import reports false success.** `handleImport` ignores Supabase `.insert().error` (which doesn't throw) → constraint failures counted as "imported"; operator believes payroll loaded when no row was written. | `import/page.tsx:226-241`. Verified. |
| **C-10** | **HIGH** | **Silent double-import.** Missing `timecard_id` falls back to synthetic `row-N` → no dedup key → re-uploading a CSV doubles every hour line. | `csv-parser.ts:51`. Verified. |
| **C-11** | **HIGH** | **Multi-allocation split loses/gains hours** — each leg rounded independently with no residue correction; card total ≠ Workyard canonical total. | `workyard-api.ts:318-335`. Verified. |
| **C-12** | **HIGH** | **Spread source not deactivated on error** — `useTimesheetAdjustments.spread` deactivates the source entry fire-and-forget; on failure the source + all spread legs are active → duplicated hours. | `useTimesheetAdjustments.ts:258-260`. Verified. |
| **C-13** | **HIGH** | **ADP reconciliation writes fire-and-forget + null-deref crash** on insert-branch failure (`ins!.id`). | `useADPReconciliation.ts:99-128`. Verified. |
| **C-MED** | **MEDIUM** | Tax/WC base includes phone + expense reimbursements and nets advances (`calc:161-163`, `C9`); `is_active` filter mismatch between ADP export and recon → permanent false variances (`C8`); spread rounding residue (`C1`); div-by-zero silently drops all spread when `total_units=0` (`C3`); European comma-decimal truncates fractional hours (`F-02`); geofence-only allocations dropped (`F-05`); 400-retry double-counts if it fires on page >1 (`F-06`); dept-split old-row delete fire-and-forget → duplicate splits (`F-18/19`); expense approve/reject/correct/route writes all fire-and-forget (`F-10..13`). | All file:line-cited, Verified. |
| **C-LOW** | **LOW** | Negative hours unguarded; float accumulation in totals; `ot_allowed` dead; `Intl` hour=24 DST edge; zero-hour rows pass; correction-audit-row inserts fire-and-forget (audit loss on split/remove/reassign); query errors swallowed as empty lists; optimistic `markResolved`. | Verified. |

### C3. Structural / agent-ready (respine lens)

- **ST1 (Structural, G5):** Logic trapped behind screens; no service layer; zero `.rpc()`. Four-Word Test "could an agent call it tomorrow?" → **No** for every capability except the three `lib/` services. Agent-ready litmus fails on named-action-separate-from-UI, machine-describable-I/O, composable for all mutations.
- **ST2 (Structural, G6):** Approval/locking is a UI `isLocked` boolean (`timesheets/page.tsx:55`); no DB trigger/predicate enforces immutability; with S1/S2 a "locked" week is writable. The auditable/approval-gated value prop is **not demonstrable**.
- **ST3 (Structural, G4):** Schema + RLS policies exist only in the live DB; 1 migration file vs 29 tables → no reviewable history. This is *why* S1/S2 persisted unseen.
- **ST4 (Structural, G3):** No tests, no CI, no typecheck. The uplift itself is unverifiable until this exists — so it is sequenced first among the buildable fixes.
- **ST5 (Structural, G7):** No enforced domain-event/actor spine; `payroll_audit_log` is app-written and forgeable (S3).
- **ST6 (Structural):** Two RBAC mechanisms coexist — `payroll_is_*()` functions vs inline `EXISTS (SELECT FROM profiles …)` on the `payroll_onboarding_*` tables — evidence of ad-hoc, unreviewed policy authoring (compounds G4).
- **ST7 (Actuator gap, G9):** No carved PRPs; PLAN.md prose + "Known Debt" bullets are not actuators. The fixes in Part E exist to *become* the actuators.
- **ST8 (Value-prop / stale plan):** PLAN statuses are stale (Cost Allocation "planned" but built); the genuinely-missing trunk piece is **enforced** approval/locking + integrity, not another feature.

---

## Part D — Schema hooks (trunk-and-branch: cheap now, painful retrofit later)

Leave these columns/objects in now, even unused, rather than migrate after data lands:
1. **Actor + event spine.** Add `actor_id uuid`, `actor_role text` to mutation-bearing tables and stand up one append-only `payroll_events` table (event_type, entity, entity_id, actor, payload jsonb, occurred_at) written by DB triggers — so the audit trail is DB-enforced, not app-forgeable (closes S3/ST5). Defer per-domain event *aggregates*; name them, don't build.
2. **DB-enforced locking.** Promote `payroll_weeks.status` to a constrained enum and add a trigger (or RLS predicate) that rejects writes to child rows of a locked week. This moves immutability from the UI into the trunk (closes ST2/G6). Carry-forward stays the only post-lock path.
3. **Portfolio scoping for RLS.** Reserve the `portfolio_id` join path needed for portfolio-level RLS filtering (the deferred multi-portfolio branch named in PLAN's Known Debt) so the eventual tightening is a policy change, not a data migration.

---

## Part E — Uplift PRP index (carved units, in `audit/prps/`)

Carved narrow — only the trunk the named fixes need. Each lands here for a human to release; **nothing is auto-built**. Ordered by leverage:

| PRP | Title | Covers | Why first |
|---|---|---|---|
| `01_PRP_RLS_Authz_Remediation.md` | RLS & authorization remediation | S1, S2, S3, S6, S7, G1 | Stops active unauthenticated + cross-tenant write. **Do before anything that writes data.** |
| `02_PRP_Payroll_Math_Single_Engine.md` | One payroll engine; OT, effective rates, fee base | C-1,2,5,6,7,11 + collapse the 3 gross-pay impls (G2) | Wrong money is being computed now; consolidation also kills C-3/C-13 by construction. |
| `03_PRP_API_AuthZ_And_Secrets.md` | Protect API routes; lock the bucket; move the key | S4, S5, S8, S9, G8 | Public PII/token exposure on deploy. |
| `04_PRP_Approval_Locking_Enforcement.md` | DB-enforced weekly lock + actor/event spine | ST2, ST5, S3, hooks D1/D2, G6/G7 | Delivers the auditable/approval-gated value prop. |
| `05_PRP_Reliability_Substrate.md` | Tests + CI + typecheck + schema-in-migrations + error-handling sweep | ST3, ST4, G3, G4, C-9..13 fire-and-forget class | Makes the uplift verifiable and stops future invisible drift. |

> The ingestion correctness items (C-8 first-name match, C-10 double-import, the silent-error inventory) fold into PRP-02 (engine/ingest) and PRP-05 (error-handling sweep); the full file:line list lives in this audit's Part C and is transcribed into each PRP's Evidence Baseline.

---

## Part F — Open structural decisions (human call) + handoff test

**Structural decisions to surface (do not let the build silently guess):**
1. **OT policy (C-1):** Is 1.5× intended, and gated on `ot_allowed`? (Default for PRP-02: 1.5× on hours flagged OT, only when `ot_allowed=true`.)
2. **Salaried→property allocation (C-6):** weekly_rate ÷ standard week, spread by recorded hours? (Default: `weekly_rate/40`, allocate by property hours.)
3. **Tax base (C-MED/B5):** exclude phone + expense reimbursements; do not net advances before tax? (Default: yes.)
4. **Management fee authority (C-7):** property-level portfolio rate is authoritative; `total_mgmt_fee` aggregates property fees; does `required_prefund` include fees? (Default: property-authoritative; prefund excludes fee unless collected upfront — confirm.)
5. **Shared-DB tenancy (S2):** is "any authenticated Stanton user = full payroll access" ever acceptable, or must payroll be scoped to a payroll-role set now? (Default: scope now; PRP-01 assumes it.)

**Respine handoff test (the 8 questions):**
1. Every finding cites live-system verification or carries a label — **yes** (Part C).
2. Platform-substrate gaps hunted, not just features — **yes** (Part B2 / G1-G9).
3. Each finding triaged structural vs surgical — **yes** (Part B).
4. Schema hooks are trunk-and-branch, deferred-named — **yes** (Part D).
5. Each PRP has a checker-verifiable Definition of Done — **see `audit/prps/` (per-PRP).**
6. This loop's lessons written where the next loop reads them — **yes** (`tasks/lessons.md`).
7. Audited against an external requirements baseline, treating silence as suspect — **yes** (auth/RLS/tests/CI/migrations were absent from the docs and are the headline findings).
8. Each requirement traced to an actuator (a carved PRP) — **yes** (Part E); the deliverable for each foundation gap is a PRP, not a bullet.

---
*Generated by an orchestrated `stanton-respine` pass. Evidence base: live introspection of `wkwmxxlfheywwbgdbzxe`, plus file:line reads across `src/`. No code was modified; no DB write or exploit was performed.*
