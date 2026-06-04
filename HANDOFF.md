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
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<active publishable key>   # from Supabase project / Bitwarden
WORKYARD_MOCK=1                                                 # dummy import data, no creds needed
```

- The **active publishable key** (browser-safe `sb_publishable_...`) is on the Supabase
  project "Stanton Main DB" and should be stored in Bitwarden. Do not paste it into any
  committed file.
- `WORKYARD_MOCK=1` makes the Workyard API-pull return deterministic dummy time cards.

---

## Test credentials & data

- **Test login:** `claude-test@payroll.test` (password shared out-of-band, not in repo).
  Created directly in the live DB. Its profile currently has `role = null`, which the app
  treats as **manager** (see `useAuth.ts`). It is **not** yet a true `admin` — see Pending.
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

1. **Promote the test user to admin (optional).** A one-line UPDATE on the production
   `profiles` row (`role='admin', is_active=true` for `claude-test@payroll.test`). It was
   intentionally not auto-applied (production-profile privilege grant). Until then the
   account behaves as a manager, which is enough for most testing.
2. **Fix the key in the deployed env.** Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the
   active key in Vercel (may already be set). **Recommended:** remove the hardcoded fallback
   in `src/lib/supabase/config.ts` so a revoked key can never silently break login again.
3. **Seed/enter employee rates** before testing a full payroll calculation (0 rows now).
4. **Push `main`** to origin when the above is reviewed.

## Known debt (pre-existing, not addressed here)
- RLS: ~38 payroll policies are `USING (true)` (any authenticated user sees all rows) —
  must be tightened to portfolio-level before multi-portfolio rollout. Tracked in `PLAN.md`.
- Many Phase-1 features remain **unbuilt by design** (cost allocation engine, approval gates,
  invoice/statement generation, ADP reconciliation). See `PLAN.md` for status per feature.
