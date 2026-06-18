# Payroll System — Session Handoff

_Last updated: 2026-06-04_

This captures the state of the repo after a stabilization session focused on **getting
the app runnable and testable**. It is meant to let the next person (or session) pick up
without re-discovering everything.

---

## TL;DR — current state

- **The app builds, boots, connects to a healthy seeded DB, and login works.** It is
  ready for manual/QA testing of the existing ("partial") features.
- **Biggest fix:** login was broken for *everyone* — the Supabase publishable key
  hardcoded in `src/lib/supabase/config.ts` is stale/revoked. The correct active key is
  now in a local (gitignored) `.env.local`. See "Required local setup" below.
- **A test login + a dummy-data import path now exist** so the API-pull import flow can be
  exercised end-to-end with no Workyard credentials.
- Several real bugs fixed (React hooks crash, broken lint). See "What changed".

---

## How to run locally

```bash
npm install            # also wires the gitleaks pre-commit hook via "prepare"
# create .env.local (see below)
npm run dev            # http://localhost:3000  → app at /payroll/login
```

Quality gates (all currently green):
```bash
npx tsc --noEmit       # types
npm run lint           # eslint (next/core-web-vitals)
npm run build          # production build, 24 routes
```

### Required local setup: `.env.local` (gitignored — NOT committed)

The Supabase fallback baked into `config.ts` is **revoked**, so without this file logins
fail with `"Unregistered API key"`. Create `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://wkwmxxlfheywwbgdbzxe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<active publishable key>   # from Supabase project / Infisical
WORKYARD_MOCK=1                                                 # dummy import data, no creds needed
```

- The **active publishable key** (browser-safe `sb_publishable_...`) is on the Supabase
  project "Stanton Main DB" and should be stored in Infisical. Do not paste it into any
  committed file.
- `WORKYARD_MOCK=1` makes the Workyard API-pull return deterministic dummy time cards.

---

## Test credentials & data

- **Test login:** `claude-test@payroll.test` — now a true **`superadmin`** (`is_active = true`),
  so it unlocks the CommandBar and all admin surfaces. **Password is vaulted in Infisical
  `/test-users` → `MAIN_TEST_PASSWORD`** (never in-repo). Throwaway test identity, lives in the
  live DB. Canonical registry of test users across all Stanton auth realms (incl. how to
  retrieve/rotate): `stanton-control/context/test-users.md`.
- **Database:** Supabase project `wkwmxxlfheywwbgdbzxe` ("Stanton Main DB"), healthy,
  RLS enabled with real policies. Seeded: 9 portfolios, 72 properties, 11 hourly
  employees, 48 cost codes, 1 draft payroll week (week_start 2026-03-08).
- **Time data:** `payroll_time_entries` and `payroll_employee_rates` are **empty**. Import
  a mock week to populate entries; rates must be entered via the Employees & Rates page
  (or seeded) before a full payroll calculation will produce gross pay.

### Testing the import flow
1. Log in → **Workyard Import**.
2. Select the draft week (Mar 8, 2026), **Pull from API** (mock returns ~62 rows).
3. Most rows auto-match; a few are intentionally flagged (overhead, unknown property `S9999`,
   PTO, split-property) to exercise the **Correction Queue**.
4. Import → review on the week dashboard / timesheets.

---

## What changed this session (commits on `main`, NOT yet pushed)

`main` is **ahead of `origin/main`** by these commits (push when ready):

1. `chore: add gitleaks secret-scanning guardrail and Bitwarden env reference`
   - `.githooks/pre-commit` (gitleaks staged scan), `prepare` script auto-wires hooksPath,
     `.env.example` placeholder reference, `.gitignore` hardening.
   - **gitleaks must be installed** to actually scan: `winget install Gitleaks.Gitleaks`.
2. `fix: rules-of-hooks crash in InlineDrawer + restore working lint`
   - `InlineDrawer.tsx` called 13 `useState` hooks after an early return → "rendered more
     hooks than previous render" crash when the selected timesheet cell changed. Guard moved
     below all hooks; initializers made null-safe.
   - Added `.eslintrc.json`; `npm run lint` previously had no config and hung on a prompt.
3. `feat: add WORKYARD_MOCK dummy data path for API-pull import testing`
   - `src/lib/payroll/workyard-mock.ts` + wiring in `workyard-api.ts` and the timecards route.

Local-only (gitignored, not committed): `.env.local`.

---

## Pending / next steps

1. ~~**Promote the test user to admin.**~~ **DONE (2026-06-16):** `claude-test@payroll.test`
   is now `role='superadmin', is_active=true` on the Main DB `profiles` row. See
   `stanton-control/context/test-users.md`.
2. **Fix the key in the deployed env.** Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the
   active key in Vercel (may already be set). **Recommended:** remove the hardcoded fallback
   in `src/lib/supabase/config.ts` so a revoked key can never silently break login again.
3. **Seed/enter employee rates** before testing a full payroll calculation (0 rows now).
4. **Push `main`** to origin when the above is reviewed.

## Agentic command layer + audited operations (added 2026-06-04)

A new backbone was added so payroll mutations are validated, previewable, and
audited — and so a natural-language command bar can drive them safely.

**Architecture (one validated path for every write):**
- `payroll_audit_log` table (live DB) — append-only, RLS, no UPDATE/DELETE policies
  (mirrors the `user_access_log` convention). Records actor, operation, input,
  result, and the original NL prompt.
- `src/lib/payroll/operations/` — the Operation layer. Each op has a Zod schema,
  a side-effect-free `plan()` (returns a preview: changes / warnings / **blockers**),
  and an audited `commit()`. `core.ts` exposes `previewOperation` / `executeOperation`.
  Implemented (15 ops): `time_entry.add` (property / portfolio-spread / unallocated),
  `time_entry.adjust`, `time_entry.remove`; `employee.add/update/deactivate/reactivate`
  (`operations/employees.ts` — rate changes append to `payroll_employee_rates`,
  soft-deactivate only); `external_project.add/update/deactivate/reactivate`
  (`operations/externalProjects.ts` — non-portfolio client work like "Zimmerman",
  billed to a named client). All soft-delete, no hard deletes. Registry in
  `operations/index.ts`.
- `src/lib/payroll/resolve/` — deterministic resolvers: fuzzy entity match
  (`entities.ts` + `text.ts`) and natural-language dates (`dates.ts`, Sunday-start
  weeks, plus `resolveWeekForDate` / week-lock check). **No LLM in the actual match.**
- `src/lib/payroll/agent/` — Claude tool-use loop (`run.ts`, model
  `claude-sonnet-4-6`, override via `PAYROLL_AGENT_MODEL`). The model resolves
  names→ids via tools then calls `propose_operation`; the server returns a
  **preview only**. Nothing is written until the user confirms.
- Routes: `POST /api/payroll/agent` (chat → preview) and
  `POST /api/payroll/agent/execute` (confirm → validate+commit+audit, source=agent).
  Plus general UI-sourced `POST /api/payroll/operations/preview` and
  `POST /api/payroll/operations/execute` (source=ui) — the same audited path for
  any UI surface to converge onto. All execute paths **re-plan server-side** and
  never trust a client preview.
- UI: `components/payroll/CommandBar.tsx` + `hooks/payroll/usePayrollAgent.ts`,
  wired into the timesheets page (refreshes via the hook's `refetch`).

**Example that works end-to-end:** "add 10 hours to stan for wednesday of last week
across the park portfolio" → resolves Stan Baldyga + Park Portfolio (`af-portfolio-11`,
6 properties, unit-weighted spread) + 2026-05-27, shows a preview, then on confirm
writes a spread event + per-property entries + an audit row. (Note: 2026-05-27 has
no payroll week yet, so the preview will show a blocker until that week exists —
the only seeded week is Mar 8–14.)

**Required to use the NL bar:** set `ANTHROPIC_API_KEY` in `.env.local` (see
`.env.example`). Without it the bar returns a graceful 503; everything else is unaffected.

**Deps added:** `zod`, `@anthropic-ai/sdk`. **Gates (all green):** `tsc --noEmit`,
`npm run lint` (only the pre-existing `expenses/page.tsx` `<img>` warning),
`npm run build` (**30 routes**, including the 4 agent/operations API routes).
Schema logic unit-tested via `scripts/verify-employee-ops.mts` (24/24 — employee
type↔rate pairing, external-project required fields, "at least one field" on
updates, uuid validation) and resolvers via `scripts/verify-resolvers.mts`. Live
schema re-confirmed for every table the ops touch (employee/rate/external-project
columns, the `payroll_time_entries→payroll_weeks` FK the open-entry check embeds,
append-only audit policies). All 4 routes recompile and auth-gate (401) on the
running dev server.

**⚠ DEMO BLOCKER — `ANTHROPIC_API_KEY` is NOT set in `.env.local`.** The NL command
bar returns a graceful 503 until it is present; nothing to demo until the key is
added (then restart `npm run dev`). This is the single thing gating Dean's test of
the command bar. Everything else (operations, audit, build) is ready.

**Not yet done (next steps for this track):**
- **Set `ANTHROPIC_API_KEY`** (see `.env.example`) and restart dev — required for the bar.
- Converge the existing admin UIs onto `/api/payroll/operations/*` (the route exists
  and is smoke-tested). Deliberately NOT done pre-demo to avoid touching working pages:
  the `employees` page allows rate-less adds + has dept-splits/manual rate-dating not
  yet modeled by `employee.*`, and the `external-projects` edit form toggles `is_active`
  (which is `deactivate`/`reactivate`, not `update`). Each page needs per-field handling
  + a click-test under auth before rewiring.
- Add `cost_code.*` / job-level ops if "jobs" should be distinct from external projects
  (currently a job = an external project billed to a client; no separate jobs table exists).
- These changes are uncommitted on `main` (working tree) — review then commit/push.

## Known debt (pre-existing, not addressed here)
- RLS: ~38 payroll policies are `USING (true)` (any authenticated user sees all rows) —
  must be tightened to portfolio-level before multi-portfolio rollout. Tracked in `PLAN.md`.
- Many Phase-1 features remain **unbuilt by design** (cost allocation engine, approval gates,
  invoice/statement generation, ADP reconciliation). See `PLAN.md` for status per feature.
