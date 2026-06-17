# 05_PRP_Reliability_Substrate

**Status:** Draft — awaiting human release to build queue
**Owner:** StantonManagement
**Created:** 2026-06-13
**Estimated effort:** 2–3 engineer-days [Speculation: baseline assumes one person; CI setup ~2 h, vitest + typecheck wiring ~2 h, schema baseline ~3 h, error-handling sweep ~6–8 h across 7 files]
**Sequencing note:** This PRP is ordered FIRST among buildable uplift work even though PRP-01 carries the highest severity. It installs the test/CI/typecheck harness and the schema-in-version-control infrastructure that makes every other PRP verifiable and prevents the same invisible-drift failure mode (G4) from recurring during the uplift itself. Build this before building anything else.
**Depends on:** None (this is the foundation layer)
**Reads with:** `audit/PAYROLL_RESPINE_AUDIT_2026-06-13.md` (findings ST3, ST4, G3, G4, C-9 through C-13, C-MED fire-and-forget class, C-LOW silent-error class); `STANTON-spec-standard.md` §3–5

---

## 1. Problem Statement

Four distinct reliability failures exist today, each independently harmful and collectively making the codebase unverifiable during uplift:

1. **No test runner, no `test` script, no `typecheck` script** (ST4/G3). `package.json` has only `dev`, `build`, `start`, `lint`. A 14.9 K-LOC money system with zero tests means every refactor — including this entire uplift — is unverifiable. Regressions surface in production, not in review.

2. **No CI pipeline** (ST4/G3). No `.github/workflows/` directory exists. PRs merge with no automated gate. Lint, typecheck, and tests (once added) are not enforced; they depend entirely on discipline.

3. **Schema and RLS policies exist only in the live shared database** (ST3/G4). One migration file covers 29 live `payroll_` tables. Every schema or policy change has gone to production with no diff, no review, and no history. This is the meta-gap: it is exactly why the always-true `*_auth` RLS override (S1/S2, PRP-01) reached production unseen. Without a reviewable schema baseline, PRP-01 through PRP-04 cannot be applied as verified migrations.

4. **A systematic fire-and-forget error class** (C-9 through C-13, C-MED, C-LOW). Across seven files, Supabase write calls (`.insert()`, `.update()`, `.upsert()`) are executed but their returned `{ error }` is never checked. The client silently believes the write succeeded, often displaying a success toast, while no data was written. This causes false import confirmations, silent double-imports, duplicated hours, missing reconciliation rows, lost audit entries, and undetected approval-state mutations. The full file:line manifest is in §3 below.

---

## 2. Evidence Baseline

Every claim below is drawn from the live audit (verified against the live codebase and live DB on 2026-06-13). Status column: **Verified** = confirmed by file:line read or live-DB introspection; `[Unverified]` = becomes a Phase-1 gate.

### 2a. No tests / no scripts

| Claim | Evidence | Status |
|---|---|---|
| `package.json` has no `test` script | `package.json` scripts block: `dev`, `build`, `start`, `lint` only. No `vitest`, `jest`, `playwright`, `cypress` in devDependencies. | Verified |
| `package.json` has no `typecheck` script | Same file; no `tsc --noEmit` invocation anywhere. | Verified |
| No test files exist | Audit A3 recon: "no tests of any kind." | Verified |
| No `.github/workflows/` directory | Audit A3: "no `.github/workflows` (no CI)." | Verified |

### 2b. Schema baseline gap

| Claim | Evidence | Status |
|---|---|---|
| 29 `payroll_`-prefixed tables exist in the live DB | Audit intro: "Payroll owns 29 `payroll_`-prefixed tables." Live DB `wkwmxxlfheywwbgdbzxe`. | Verified |
| Only 1 migration file exists in the repo | Audit A3: "1 migration file vs 29 tables." | Verified |
| The blanket `*_auth` always-true RLS policies (S1/S2) reached production with no reviewable diff | Audit ST3: "Schema + RLS policies exist only in the live DB; no reviewable history. This is *why* S1/S2 persisted unseen." | Verified |

### 2c. Fire-and-forget error manifest

The following writes are confirmed unchecked at the cited locations. Each is a data-integrity risk: the caller believes the write succeeded; the DB may have written nothing.

| ID | File | Line(s) | Call | Failure mode | Status |
|---|---|---|---|---|---|
| **FF-01** | `src/app/(payroll)/import/page.tsx` | 226–241 | `.insert()` on timecard rows | Returns `{error}` which is ignored; constraint failures counted as imported; operator believes payroll loaded when no row was written (C-9). | Verified |
| **FF-02** | `src/lib/payroll/csv-parser.ts` | 51 | Synthetic `row-N` fallback for missing `timecard_id` | No dedup key → re-uploading a CSV silently doubles every hour line (C-10). Note: this is a missing guard rather than an unchecked write; fix is a `throw` / validation error before the write is attempted. | Verified |
| **FF-03** | `src/hooks/payroll/useADPReconciliation.ts` | 99–128 | `.insert()` / `.upsert()` on recon rows | Error is not checked; a `!` non-null assertion on `ins!.id` crashes with a null-deref on insert failure instead of surfacing a meaningful error (C-13). | Verified |
| **FF-04** | `src/hooks/payroll/useTimesheetAdjustments.ts` | 258–260 | `.update()` to deactivate spread source entry | Called fire-and-forget; on DB failure the source entry stays active alongside all spread legs → duplicated hours (C-12). | Verified |
| **FF-05** | `src/hooks/payroll/useExpenseApprovals.ts` | ~303–391 | `.update()` calls in approve / reject / correct / route handlers | All four mutators fire-and-forget; approval state can silently fail to persist while the UI shows success. | Verified |
| **FF-06** | `src/hooks/payroll/useDeptSplitOverrides.ts` | 54–82 | `.delete()` old rows + `.insert()` new rows | Both calls fire-and-forget; old rows may not delete → duplicate splits on subsequent saves. | Verified |
| **FF-07** | Multiple hooks (split/remove/reassign/carry-forward) | Various | Correction audit-row `.insert()` calls | Audit log inserts fire-and-forget → correction history silently missing (C-LOW). | Verified |
| **FF-08** | Multiple query hooks | Various | Error from `.select()` calls swallowed | Query errors returned as empty lists with no surfacing; caller sees an empty table rather than a loading/error state (C-LOW). | Verified |

---

## 3. Users and Roles

**In scope for v1 of this PRP:**
- **Build agent / developer** running `npm test` and `npm run typecheck` locally and in CI.
- **Reviewer** inspecting PR CI status before merging.
- **Future build agent** applying PRP-01 through PRP-04 migrations with confidence they will be reviewed against a baseline.

**Out of scope for v1:**
- End users (payroll operators, managers). This PRP adds no user-facing behavior.
- E2E / browser tests (Playwright, Cypress) — out of scope; the target is a fast unit/integration test harness.
- Coverage thresholds or reporting — add after the suite exists.

---

## 4. Core Features

### F-1: Test runner and scripts

Install `vitest` as the test runner. Add two new `package.json` scripts:
- `"typecheck": "tsc --noEmit"` — runs TypeScript compiler in check-only mode; exits non-zero on any type error.
- `"test": "vitest run"` — runs all `*.test.ts` / `*.spec.ts` files; exits non-zero on any failure.

No changes to existing `dev`, `build`, `start`, or `lint` scripts.

### F-2: CI workflow — typecheck + lint + test gate

Create `.github/workflows/ci.yml`. It must:
- Trigger on `pull_request` (all branches) and `push` to `main`.
- Run in sequence: `npm run typecheck`, `npm run lint`, `npm run test`.
- Block merge if any step exits non-zero (branch protection rule — noted as a GitHub repo setting to enable, not a file-level concern).
- Use Node.js LTS (20.x). Cache `node_modules` via `actions/cache`.

### F-3: Baseline golden-week test for the payroll engine

**Coordinate with PRP-02 (payroll math single engine):** PRP-02 will consolidate the three divergent gross-pay implementations into one canonical service. PRP-05 installs the test harness that makes PRP-02 verifiable. The golden-week test lives here (the harness) and references the `calculatePayroll` function from `src/lib/payroll/calculations.ts`. It does not duplicate or replace the engine correctness work in PRP-02.

Write `src/lib/payroll/__tests__/calculations.test.ts` with a baseline golden-week fixture:
- One regular employee (40 regular hours, known hourly rate, no OT) → assert gross pay, management fee, property spread total.
- One employee with OT hours marked — assert result is deterministic (current behavior, not the corrected 1.5× behavior; PRP-02 will update the assertion when it fixes the engine).
- Zero-hours employee → assert no divide-by-zero, result is zero.
- `round2` utility → assert two-decimal rounding.

The fixture is intentionally minimal: its purpose is to catch accidental breakage during the uplift, not to validate business rules (that is PRP-02's mandate).

### F-4: Schema baseline migration

Capture the current live schema and RLS policies for all 29 `payroll_` tables into a single baseline migration file:

`supabase/migrations/<timestamp>_payroll_schema_baseline.sql`

This migration must:
- Reproduce every `payroll_`-prefixed table with its columns, constraints, indexes, and foreign keys as they exist in the live DB on the day the baseline is captured.
- Include the `CREATE POLICY` statements for all `payroll_` tables as they exist today — including the always-true `*_auth` policies that PRP-01 will subsequently fix.
- Include the `payroll_get_role`, `payroll_is_admin`, `payroll_is_manager_or_above` function definitions.
- Be idempotent with `IF NOT EXISTS` / `OR REPLACE` where supported; add a header comment: `-- BASELINE SNAPSHOT: captured <date>. Do not apply to a DB that already has these tables. PRP-01 will patch RLS policies in the next migration.`
- Not make any correctness or policy changes — this is a snapshot, not a fix. Policy fixes belong to PRP-01.

**Why this matters:** Once this file exists, every subsequent PRP that touches schema or policies can be written as a diff against this baseline, reviewed as a normal PR diff, and applied with `supabase db push` rather than manual SQL execution against the live DB.

### F-5: Systematic error-handling sweep

For every item in the FF-01 through FF-08 manifest (§3), apply the following pattern:

```typescript
// Before (fire-and-forget):
await supabase.from('payroll_time_entries').insert(rows)

// After (checked):
const { error } = await supabase.from('payroll_time_entries').insert(rows)
if (error) throw new Error(`Failed to insert time entries: ${error.message}`)
```

Specific rules by call type:
- **`.insert()` / `.upsert()`**: destructure `{ error }`, throw on non-null error. Return type must be typed (`data` used downstream must be typed, not `any`).
- **`.update()` / `.delete()`**: destructure `{ error }`, throw on non-null error.
- **`.select()` queries**: destructure `{ data, error }`, throw (or return an error state) on non-null error; do not return an empty array as a substitute for an error.
- **FF-02 specifically** (csv-parser synthetic key): add a validation guard before the write — if `timecard_id` is missing or matches the synthetic `row-N` pattern, throw a parse error rather than inserting a non-deduplicable row.
- **FF-03 null-deref** (`ins!.id`): remove the `!` assertion; check the insert error first; access `.id` only after confirming `error` is null and `data` is non-null.

Each hook that currently swallows errors must surface them to the caller via its existing error-return pattern (most hooks already have an `error` state in their `useState`; use it). No silent toasts on write failure.

---

## 5. Data Model

This PRP introduces no schema changes to the live DB. The schema baseline migration (F-4) is a read-only snapshot, not a structural change. PRP-01 will be the first migration to actually modify RLS policies.

New files only:
- `vitest.config.ts` — vitest configuration (Next.js + path aliases).
- `src/lib/payroll/__tests__/calculations.test.ts` — golden-week test fixture.
- `.github/workflows/ci.yml` — CI pipeline definition.
- `supabase/migrations/<timestamp>_payroll_schema_baseline.sql` — live-schema snapshot.

---

## 6. Integration Points

| System | Touch point | Direction | Notes |
|---|---|---|---|
| `package.json` | Add `test` and `typecheck` scripts; add `vitest` to `devDependencies` | Modify | No existing scripts changed |
| TypeScript (`tsconfig.json`) | `tsc --noEmit` must succeed with existing config | Read-only | Any existing type errors exposed by `typecheck` must be fixed as part of Phase 2 |
| ESLint (`eslint.config.mjs`) | `npm run lint` already defined; CI re-uses it | Read-only | |
| GitHub Actions | `.github/workflows/ci.yml` | New file | Branch-protection rule (require status checks to pass) is a GitHub repo setting — noted, not automated |
| Supabase CLI | `supabase db dump` or equivalent to capture baseline schema | Read-only against live DB | Captured once; committed as a migration; never re-run automatically |
| `src/lib/payroll/calculations.ts` | Test imports `calculatePayroll`, `round2` | Read-only | No changes to the source file in this PRP |
| Seven hook/page files in FF manifest | Destructure and check `{error}` on every write | Modify | See Affected Files §7 |

---

## 7. Affected Files

### New files

| File | Purpose |
|---|---|
| `vitest.config.ts` | Vitest configuration: Next.js resolver, path aliases, test environment (`node`) |
| `src/lib/payroll/__tests__/calculations.test.ts` | Golden-week baseline fixture (F-3) |
| `.github/workflows/ci.yml` | CI pipeline: typecheck → lint → test on PR and push to main (F-2) |
| `supabase/migrations/<timestamp>_payroll_schema_baseline.sql` | Snapshot of all 29 `payroll_` tables + RLS policies + role functions (F-4) |

### Modified files

| File | Change | Finding addressed |
|---|---|---|
| `package.json` | Add `"test": "vitest run"` and `"typecheck": "tsc --noEmit"` scripts; add `vitest`, `@vitest/coverage-v8` (optional) to `devDependencies` | ST4/G3 |
| `src/app/(payroll)/import/page.tsx` | Lines 226–241: destructure `{error}` from `.insert()`, throw on failure; remove false-success path | FF-01 / C-9 |
| `src/lib/payroll/csv-parser.ts` | Line 51: add guard — if `timecard_id` is missing/synthetic, throw a parse validation error before insert | FF-02 / C-10 |
| `src/hooks/payroll/useADPReconciliation.ts` | Lines 99–128: destructure `{data, error}` from insert/upsert; remove `ins!.id` null assertion; check error first; surface to hook error state | FF-03 / C-13 |
| `src/hooks/payroll/useTimesheetAdjustments.ts` | Lines 258–260: await and check `{error}` on source-deactivation `.update()`; on error, roll back or surface rather than continuing | FF-04 / C-12 |
| `src/hooks/payroll/useExpenseApprovals.ts` | Lines ~303–391: destructure `{error}` from all four mutators (approve / reject / correct / route); throw or surface to hook error state on failure | FF-05 |
| `src/hooks/payroll/useDeptSplitOverrides.ts` | Lines 54–82: await and check `{error}` on both `.delete()` and `.insert()` calls; abort insert if delete fails | FF-06 |
| Correction-audit-row inserts (multiple hooks: split/remove/reassign/carry-forward) | Identify all `payroll_audit_log` insert calls; destructure `{error}`; surface or log — do not silently swallow | FF-07 |
| Query hooks with swallowed `.select()` errors | Identify all patterns returning `[]` on error instead of propagating `error`; return error state instead | FF-08 |

### Deleted files

None.

---

## 8. Implementation Phases

Phases are ordered so that each is independently shippable, independently reversible, and builds on a verified prior state. Phase 1 is always recon; tooling comes before the sweep.

---

### Phase 1 — Confirm evidence, install test tooling

**Goal:** vitest running; `npm test` and `npm run typecheck` exit 0 on a clean tree.

**Steps:**

1.1 Run `npx tsc --noEmit` in the repo root. Record every type error. Any error that is not related to the fire-and-forget sweep must be fixed before proceeding.
**Check:** `npm run typecheck` exits 0. [Unverified pre-condition: the existing codebase may have type errors beyond the `!` assertions in FF-03; each must be triaged.]

1.2 Install vitest: `npm install --save-dev vitest @vitejs/plugin-react`.
**Check:** `node_modules/vitest` exists; `package.json` devDependencies includes `vitest`.

1.3 Create `vitest.config.ts` with Next.js path-alias resolution and `environment: 'node'`.
**Check:** `npx vitest run` with no test files exits 0 (no test files found is not an error).

1.4 Add scripts to `package.json`:
```json
"typecheck": "tsc --noEmit",
"test": "vitest run"
```
**Check:** `npm run typecheck` and `npm test` both exit 0 on the current tree (no test files yet → test exits 0 by default).

**Rollback:** Remove vitest from devDependencies; remove the two scripts from `package.json`. No DB or CI change yet.

---

### Phase 2 — Golden-week baseline test

**Goal:** One test file exists and passes; `npm test` exits 0 with at least one passing test.

**Steps:**

2.1 Write `src/lib/payroll/__tests__/calculations.test.ts` with the four fixtures described in F-3 (regular week, OT week, zero hours, `round2`). All assertions reflect current behavior, not corrected behavior.
**Check:** `npm test` exits 0; output shows `4 passed`.

2.2 If any fixture reveals a crash (e.g., divide-by-zero on zero-hours employee), fix the defensive guard in `calculations.ts` and add that fix to this PR. Do not change business logic — that belongs to PRP-02.
**Check:** `npm test` exits 0 after the guard fix.

**Rollback:** Delete `src/lib/payroll/__tests__/calculations.test.ts`. The harness from Phase 1 remains.

---

### Phase 3 — CI workflow

**Goal:** Every PR triggers typecheck + lint + test; all three must pass for the CI check to go green.

**Steps:**

3.1 Create `.github/workflows/ci.yml` with the content described in F-2 (Node 20.x, cache, three-step sequence).
**Check:** Open a PR (or push a branch); GitHub Actions UI shows the `ci` workflow running and passing all three steps.

3.2 (Manual, repo settings) Enable the "Require status checks to pass before merging" branch protection rule on `main`, selecting the `ci` workflow check.
**Check:** Attempting to merge a PR with a failing CI check is blocked by GitHub.

**Rollback:** Delete `.github/workflows/ci.yml`. The branch protection rule must be manually removed via repo settings.

---

### Phase 4 — Schema baseline migration

**Goal:** All 29 `payroll_` tables, their RLS policies, and the three role functions are captured in a committed migration file.

**Steps:**

4.1 Use the Supabase CLI to dump the live schema for payroll-prefixed objects:
```
supabase db dump --db-url <connection-string> --schema public > /tmp/payroll_dump.sql
```
Manually extract only the `payroll_`-prefixed tables, their indexes, foreign keys, sequences, the three role functions, and all `CREATE POLICY` statements for `payroll_` tables. Remove everything else.
**Check:** The output SQL, when run against a fresh schema, produces exactly 29 tables (`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'payroll_%'` = 29) and all policies (`SELECT count(*) FROM pg_policies WHERE tablename LIKE 'payroll_%'` matches live count).

4.2 Save as `supabase/migrations/<timestamp>_payroll_schema_baseline.sql`. Add the header comment noting this is a snapshot, not a fix, and that PRP-01 follows.
**Check:** File committed; `supabase/migrations/` now contains at least 2 migration files.

4.3 [Unverified gate]: Confirm that `supabase db push` applied to a fresh branch DB produces the same advisor findings as the live DB (RLS policies present, including the always-true ones). This confirms the baseline is complete enough for PRP-01 to target it.

**Rollback:** Delete the migration file. The live DB is unchanged (this phase never modifies the live DB). `git revert` the commit.

---

### Phase 5 — Fire-and-forget error-handling sweep

**Goal:** Every write call in the FF-01 through FF-08 manifest is checked; `grep` finds no unchecked write in the listed files.

**Steps:**

5.1 Apply FF-01: `src/app/(payroll)/import/page.tsx` lines 226–241. Destructure `{error}`, surface as a toast error, do not increment the success counter on failure.
**Check:** `grep -n "\.insert(" src/app/\(payroll\)/import/page.tsx` shows no result whose surrounding context lacks `{ error }` destructuring and a check.

5.2 Apply FF-02: `src/lib/payroll/csv-parser.ts` line 51. Add pre-insert validation: if `timecard_id` is undefined or matches `/^row-\d+$/`, throw `new Error('Missing timecard_id at row N — re-upload rejected to prevent duplicate import')`.
**Check:** Unit test (add to Phase 2 fixture): calling `parseWorkyardCSV` with a row missing `timecard_id` throws rather than returning a row with a synthetic key.

5.3 Apply FF-03: `src/hooks/payroll/useADPReconciliation.ts` lines 99–128. Destructure `{data, error}`. Remove `ins!.id`. After checking `error`, access `data[0].id` with a null guard.
**Check:** `npm run typecheck` exits 0 (the `!` assertion was a type-system suppression; removing it will surface any remaining unsafe access).

5.4 Apply FF-04: `src/hooks/payroll/useTimesheetAdjustments.ts` lines 258–260. Await and destructure `{error}` on source deactivation; if error, throw before proceeding with spread-leg inserts (atomicity: do not insert legs if source deactivation fails).
**Check:** `grep -n "deactivate\|source.*update\|\.update(" src/hooks/payroll/useTimesheetAdjustments.ts | head -20` shows the checked pattern.

5.5 Apply FF-05: `src/hooks/payroll/useExpenseApprovals.ts` lines ~303–391. All four mutators (approve/reject/correct/route) receive `{error}` destructuring; on non-null error, set hook error state and do not proceed to success branch.
**Check:** `grep -n "\.update\|\.insert" src/hooks/payroll/useExpenseApprovals.ts` — every hit has a corresponding `error` check within 3 lines.

5.6 Apply FF-06: `src/hooks/payroll/useDeptSplitOverrides.ts` lines 54–82. Check `{error}` on `.delete()`; only proceed to `.insert()` if delete succeeded.
**Check:** `grep -n "\.delete\|\.insert" src/hooks/payroll/useDeptSplitOverrides.ts` — each hit has a surrounding error check.

5.7 Apply FF-07: Scan all hooks for `payroll_audit_log` insert calls; add `{error}` checks and surface/log on failure. [Unverified: exact file:line for all correction-audit-row inserts in split/remove/reassign/carry-forward paths — Phase 5.7 begins with a `grep -rn "payroll_audit_log" src/hooks/` to enumerate them all before patching.]

5.8 Apply FF-08: Scan all query hooks for the pattern `return []` (or equivalent) inside a `.select()` error branch; replace with proper error propagation. [Unverified: exact file:line — Phase 5.8 begins with `grep -rn "return \[\]\|setData\(\[\]\)" src/hooks/payroll/` to enumerate before patching.]

5.9 Run `npm run typecheck` and `npm test` after each sub-step. All must pass before the next sub-step begins.

**Check (sweep complete):**
```
grep -rn "await supabase\.from.*\.\(insert\|update\|upsert\|delete\)" \
  src/app/\(payroll\)/import/page.tsx \
  src/lib/payroll/csv-parser.ts \
  src/hooks/payroll/useADPReconciliation.ts \
  src/hooks/payroll/useTimesheetAdjustments.ts \
  src/hooks/payroll/useExpenseApprovals.ts \
  src/hooks/payroll/useDeptSplitOverrides.ts
```
Every match must have a corresponding `{ error }` destructure and a null-check on `error` within the same block. A checker can verify this mechanically.

**Rollback:** `git revert` the Phase 5 commit(s). The error-handling sweep is purely additive to error checking; reverting returns to the prior fire-and-forget behavior with no schema or migration impact.

---

## 9. Open Decisions

| # | Question | Defensible default | Who decides |
|---|---|---|---|
| OD-1 | Should `vitest run` use `--reporter=verbose` by default, or the compact default? | Compact (default) in CI; `--reporter=verbose` locally via `npm run test:verbose`. Add the extra script only if needed. | Developer preference — agent uses compact. |
| OD-2 | Should the CI workflow also run `npm run build`? | No — build is slow and `typecheck` catches the same type-level errors faster. Add `build` to CI only after the test suite provides meaningful coverage. | Alex |
| OD-3 | For FF-07/FF-08 [Unverified] items: if `grep` reveals more unchecked writes than listed here, should the sweep be expanded to cover them in Phase 5 or deferred to a follow-on PRP? | Expand Phase 5 — the cost of a partial sweep is greater than the cost of a slightly longer phase. Any new item found is added to the Phase 5 manifest before build begins. | Build agent judgment, flagged to reviewer. |
| OD-4 | Should the schema baseline migration be applied to a Supabase preview branch first, or committed as a documentation-only migration (never applied to the live DB)? | Documentation-only: add a `-- DO NOT APPLY: snapshot only` header. The baseline's purpose is reviewable history, not re-application. PRP-01 is the first migration actually applied. | Alex |
| OD-5 | Should `vitest` be configured with jsdom (for React hooks) or node environment? | `node` for `calculations.ts` tests (no DOM needed). React hook tests (if added later) will need `jsdom` — add it per-file via `// @vitest-environment jsdom` rather than globally. | Consistent with this PRP's scope (calculation unit tests only). |

---

## 10. Out of Scope

- **E2E tests** (Playwright, Cypress, browser automation). Out of scope for this PRP; add after the unit/integration harness is established.
- **Coverage thresholds or reporting.** Add after meaningful test coverage exists.
- **Correctness fixes to `calculations.ts`** (OT at 1.5×, effective-dated rates, fee base). Those are PRP-02. The golden-week test in this PRP asserts current behavior only.
- **RLS policy changes or security fixes.** Those are PRP-01. The schema baseline migration in this PRP is a snapshot; it explicitly preserves the broken policies so PRP-01 can patch them as a reviewable diff.
- **Service-layer extraction** (hooks → service modules). That is PRP's 02/04 mandate. The error-handling sweep in this PRP fixes the fire-and-forget calls in-place without restructuring the hooks.
- **Audit-trail enforcement** (DB-trigger-written `payroll_events`). PRP-04.
- **Any new user-facing feature.** This PRP is infrastructure only.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pre-existing TypeScript errors block Phase 1 | Medium [Speculation] | Medium — delays the start of the sweep | Run `tsc --noEmit` as the first step; triage and fix errors in the same PR before adding any new code. The FF-03 `!` removal will surface at least one; there may be others. |
| Schema dump is incomplete (missing functions, partial policy dump) | Medium [Inference: `supabase db dump` may require flags to include policies; manual extraction is error-prone] | High — PRP-01 migration written against an incomplete baseline will diverge from live DB | Phase 4 gate: verify the baseline by counting tables and policies against the live DB before committing. |
| The fire-and-forget sweep changes behavior in unexpected ways | Low | Medium — a throw where a silent failure existed may break a UI flow that tolerated the failure | Each sub-step (5.1–5.8) is applied and tested individually before the next. `npm test` gates each. |
| FF-07/FF-08 grep reveals substantially more unchecked writes than the manifest lists | Medium | Medium — scope expansion | OD-3 default: expand Phase 5 rather than defer. Flag to reviewer with count before proceeding. |
| `vitest` conflicts with Next.js path aliases or the `@` import alias | Low [Speculation] | Low — vitest config handles it | `vitest.config.ts` resolves `@/*` to `./src/*` matching `tsconfig.json`; tested in Phase 1 before any test is written. |

---

## 12. Definition of Done

A checker model must be able to confirm every item below from the repo and CI output alone, without running the application or accessing the live DB.

**Tooling and CI:**
- [ ] `npm run typecheck` exits 0 in the CI log for the merged PR.
- [ ] `npm run lint` exits 0 in the CI log.
- [ ] `npm test` exits 0 in the CI log with at least 1 passing test reported.
- [ ] A file `.github/workflows/ci.yml` exists at the repo root and contains a `pull_request` trigger, a `typecheck` step, a `lint` step, and a `test` step.
- [ ] `package.json` contains both a `"test"` script and a `"typecheck"` script.

**Schema baseline:**
- [ ] `supabase/migrations/` contains at least 2 files (the original + the baseline snapshot).
- [ ] The baseline migration file name matches `*_payroll_schema_baseline.sql`.
- [ ] The baseline migration file contains `CREATE TABLE payroll_` for at least 29 distinct table names (checker: `grep -c "CREATE TABLE payroll_" <file>` ≥ 29).
- [ ] The baseline migration file contains `CREATE POLICY` statements (checker: `grep -c "CREATE POLICY" <file>` > 0).

**Test fixture:**
- [ ] `src/lib/payroll/__tests__/calculations.test.ts` exists.
- [ ] `npm test` output shows at least 4 passing tests in that file.

**Error-handling sweep:**
- [ ] The following grep exits with 0 matches (no unchecked write remains in the manifest files):
  ```
  grep -rn "await supabase\.from(" \
    src/app/\(payroll\)/import/page.tsx \
    src/hooks/payroll/useADPReconciliation.ts \
    src/hooks/payroll/useTimesheetAdjustments.ts \
    src/hooks/payroll/useExpenseApprovals.ts \
    src/hooks/payroll/useDeptSplitOverrides.ts \
  | grep -v "{ error }"
  ```
  (Every `.from(` call in these files must appear on a line that also contains `{ error }` or be a pure `.select()` read with error checked in context.)
- [ ] `src/lib/payroll/csv-parser.ts` line 51 area contains a guard that throws on missing/synthetic `timecard_id` (checker: `grep -n "row-" src/lib/payroll/csv-parser.ts` shows the guard, not a silent fallback).
- [ ] `src/hooks/payroll/useADPReconciliation.ts` contains no `!` non-null assertions on insert/upsert result data (checker: `grep -n "ins!" src/hooks/payroll/useADPReconciliation.ts` returns 0 matches).

---

## 13. Rollback

Rollback is per-phase and non-destructive. No phase in this PRP modifies the live DB data.

| Phase | Rollback action | Time to reverse |
|---|---|---|
| Phase 1 (tooling) | `npm uninstall vitest @vitejs/plugin-react`; remove `test` and `typecheck` from `package.json`; delete `vitest.config.ts`; `git revert` the commit. | < 5 min |
| Phase 2 (test fixture) | Delete `src/lib/payroll/__tests__/calculations.test.ts`; `git revert`. Phase 1 tooling remains. | < 2 min |
| Phase 3 (CI workflow) | Delete `.github/workflows/ci.yml`; `git revert`. Manually remove branch protection rule from GitHub repo settings if it was enabled. | < 5 min |
| Phase 4 (schema baseline) | Delete `supabase/migrations/<timestamp>_payroll_schema_baseline.sql`; `git revert`. The live DB is unaffected — this phase never touched it. | < 2 min |
| Phase 5 (error-handling sweep) | `git revert` the Phase 5 commit(s). Each sub-step was a separate commit; revert only the failing sub-step if a single file causes a regression. The sweep is purely additive error checking; revert restores fire-and-forget behavior. | < 5 min per sub-step |

---

## 14. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-13 | PRP-05 sequenced before PRP-01 (highest severity) | The reliability substrate is the precondition for verifying every other PRP. Without tests and CI, PRP-01's RLS migration cannot be confirmed to not break the app; without the schema baseline, PRP-01's migration has no reviewable ancestor. Sequenced first by leverage, not by severity. |
| 2026-06-13 | Schema baseline migration is snapshot-only (no live-DB apply) | The purpose is reviewable history and a diff-base for PRP-01. Applying the snapshot to a DB that already has the tables would fail or require destructive `DROP` statements. Header comment makes this explicit. |
| 2026-06-13 | Golden-week test asserts current (broken) behavior for OT and rates | Asserting the correct (future) behavior would make the test fail immediately and block the harness from being useful during the rest of the uplift. PRP-02 owns the correctness fixes; when PRP-02 lands, it updates the assertions. |
| 2026-06-13 | Error-handling sweep is in-place (hooks unchanged structurally) | Extracting hooks to a service layer is PRP-02/04 scope. Interleaving structural refactor with the error-handling sweep would multiply blast radius and make Phase 5 rollback non-atomic. Fix the safety gap now; restructure later. |

---

## §5 — Self-Score (nine-element, per STANTON-spec-standard §5)

| # | Element | Score | Note |
|---|---|---|---|
| 1 | Problem statement | Y | Four numbered, concrete defects with live-system evidence. |
| 2 | Users and roles | Y | Build agent / developer / reviewer in scope; end users explicitly out of scope. |
| 3 | Numbered features | Y | F-1 through F-5, each a discrete, named deliverable. |
| 4 | Data model | Y | No schema changes; new files enumerated; baseline migration scoped to snapshot-only with explicit no-apply header. |
| 5 | Integration points | Y | Every touched system listed with direction and hook. |
| 6 | Ordered phases | Y | Five phases, each independently shippable, each with explicit rollback, each with a named verification check. |
| 7 | Open decisions with defaults | Y | Five decisions, each with a defensible default and an owner. |
| 8 | Out of scope | Y | Eight explicit exclusions covering the most likely agent-wander destinations. |
| 9 | Definition of done | Y | Dual (system-state + checker-verifiable), every item confirmable from repo/CI output without running the app or accessing the live DB. |
