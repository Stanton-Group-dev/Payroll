# Payroll System — Handoff

_Last updated: 2026-06-20_

The single doc to read first when taking over. Status/roadmap lives in `PLAN.md`; decisions in `DECISIONS_LOG.md`; Workyard in `WORKYARD_GUIDE.md`; remaining manual ops in `MANUAL_TASKS_HANDOFF.md`. This file is the orientation + setup + "what to do next."

---

## TL;DR — where the project is

- **Phase 1 (Excel replacement) is built end-to-end, and the system overdelivered** — all 15 originally-planned features exist, plus ~23 more (NL command bar, RLS hardening, unallocated-SMS, dumpster report, analytics, mileage, remote-worker portal, etc.). Verified against code 2026-06-20; see `PLAN.md`.
- **The #1 thing to do is merge the hardening branch** (see next section). Until that lands, `main` runs the *older* payroll engine and lacks DB week-locking.
- The app builds, boots, connects to the live seeded DB, and login works. Ready for QA.

---

## ⚠️ #1 priority: the two worktrees are diverged — merge them

There are **two working copies** of this repo, on two branches, and they have **split-brain changes** that must be reconciled:

| Worktree | Branch | Has |
|---|---|---|
| `C:/01-repos/Payroll` | `fix/payroll-office-spread-weekly-ot` (merged to `main` via PRs) | the **OD-2** cost-code→building importer fix, bilingual cost codes, Westend onboarding, PRP-01/03/05, the older payroll engine |
| `C:/01-repos/Payroll-hardening` | `hardening/payroll-waves-0-2` (8 commits, **NOT merged**) | the **correct payroll engine** (PRP-02: OT/tax-base/fee/prefund fixes, largest-remainder rounding, config-driven rates, golden test), the **DB week-lock trigger** (PRP-04), the **rate-settings** migration |

**Neither branch has everything.** `main` has OD-2; hardening has the engine fix — and both edited `workyard-api.ts`, `config.ts`, `DECISIONS_LOG.md`. **First task: merge `hardening/payroll-waves-0-2` into `main`, resolve those conflicts carefully, and run the golden test.** This makes `main` the correct, locked, config-driven engine. Everything else in "Top open work" is secondary to this.

---

## How to run locally

```bash
npm install            # also wires the gitleaks pre-commit hook via "prepare"
# secrets come from Infisical (preferred) or a local .env.local
infisical run --env=prod -- npm run dev     # http://localhost:3000 → /payroll/login
# or: create .env.local (below) and: npm run dev
```

Quality gates:
```bash
npm run typecheck      # tsc --noEmit   (pre-existing pdf.ts puppeteer stub errors are expected unless deps installed)
npm run lint
npm test               # vitest (golden engine test lives on the hardening branch)
npm run build
```

**Secrets (Infisical, project `b974f539-54dc-4687-9afd-941d95d434c9`):** the app reads Supabase, Workyard, Twilio, Anthropic, Monitask keys from Infisical at runtime — they are **not** in files. CLI auth is `infisical login` (Stanton self-hosted instance). There is no `.infisical.json` checked in; run with `--projectId=… --env=prod --recursive` or `infisical init` once.

**Minimal `.env.local`** (gitignored) if not using Infisical:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://wkwmxxlfheywwbgdbzxe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<active sb_publishable_ key>
WORKYARD_MOCK=1            # deterministic dummy timecards, no Workyard creds needed
ANTHROPIC_API_KEY=<key>   # only needed for the NL command bar
```

---

## Environments & data

- **App:** Next.js on **Vercel** (`.vercel/` linked). Deploys on merge to `main`.
- **DB:** Supabase **"Stanton Main DB"** `wkwmxxlfheywwbgdbzxe` — **shared** across Stanton apps. RLS hardened via PRP-01 (anon DML revoked, blanket policies dropped, role-gated writes). Seeded: portfolios, ~72 properties, hourly employees, cost codes, payroll weeks.
- **Workyard:** org `25316`. **Read `WORKYARD_GUIDE.md`** for the data model + the measured API capability matrix (what the API can/can't do) before any Workyard work.
- **Test login:** `claude-test@payroll.test` = `superadmin`, active. Password vaulted in Infisical `/test-users` → `MAIN_TEST_PASSWORD` (registry: `stanton-control/context/test-users.md`).

---

## The canonical docs (don't re-derive these)

| Doc | Use it for |
|---|---|
| `PLAN.md` | Roadmap + **verified** per-feature build status (planned-vs-built) + top open work |
| `DECISIONS_LOG.md` | Every settled decision + the live Workyard/payroll constraints (§0.1–0.16). Check before re-asking. |
| `WORKYARD_GUIDE.md` | Workyard platform: data model, features, **API capability matrix**, onboarding |
| `MANUAL_TASKS_HANDOFF.md` | Remaining manual Workyard UI tasks (26 Westend cost codes, 3 junk-code deletes) |
| `audit/prps/01–05` | The hardening specs (RLS, single engine, API authz, locking, reliability) |
| `*_PRD.md` | Per-feature specs (unallocated-SMS, in-app-approval, expense, dumpster, etc.) |
| `scripts/wy-*.mjs` | Workyard tooling (pull/list/onboard/rename); run via the Infisical command above |

---

## Top open work (from PLAN.md, prioritized)

1. **Merge the hardening branch** (G1, above). **P0.**
2. **Backfill `CREATE TABLE` migrations** for live-but-unmigrated tables (employee rates/splits, mgmt-fee config, ADP recon, expenses, weekly costs, thresholds) so schema is reproducible from source. **P1.**
3. **Add role-gated RLS write policies** where blanket ones were dropped (invoices, line items; audit the rest). **P1.**
4. **Sequential approval-stage enforcement** (`payroll_advance_status`) — stages can currently be set without prerequisite checks. **P1.**
5. Persist the portfolio-wizard LLC groupings. **P2.**
6. Unallocated-SMS: daily cron + revised "fix it in Workyard" copy. **P2.**
7. Westend: the 26 cost codes (API-scriptable via `POST /orgs/{org_id}/cost_codes`) + 3 junk deletes (`MANUAL_TASKS_HANDOFF.md`). **P2 (ops).**
8. Workyard-miles import into the existing mileage pipeline. **P3.**

---

## Architecture note — the audited operation layer (still current)

Every payroll mutation goes through a named **Operation**: Zod-validated input → side-effect-free `plan()` (preview with changes/warnings/**blockers**) → audited `commit()` writing an append-only `payroll_audit_log` row (actor, op, input, result, original NL prompt). `src/lib/payroll/operations/`. The execute routes **re-plan server-side** and never trust the client preview. The NL command bar (`/payroll/console`, `CommandBar`) and the admin UIs both converge on this path. Deterministic resolvers (fuzzy entity match, NL dates) live in `src/lib/payroll/resolve/` — no LLM in the actual match.

---

## Known gotchas

- **Shared prod DB** — changes affect other Stanton apps; prefer additive/reversible migrations.
- **Schema-not-in-source** (G2 above) — several live tables have no migration in the repo; don't assume the repo's migrations fully describe the DB.
- **Workyard API is limited** — no create-cost-code, no project-update, no time-card-write endpoints. See `WORKYARD_GUIDE.md` before planning automation.
- **`pdf.ts` typecheck errors** (puppeteer/chromium) are expected unless those optional deps are installed; not a regression.
