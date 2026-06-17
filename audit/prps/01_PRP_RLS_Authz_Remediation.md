# 01_PRP_RLS_Authz_Remediation

| Field | Value |
|---|---|
| **Status** | DRAFT — awaiting human release |
| **Owner** | StantonManagement |
| **Created** | 2026-06-13 |
| **Estimated effort** | 4–6 hours (migration authoring + manual live-DB execution + verification) |
| **Depends on** | None — this is the prerequisite for every other PRP |
| **Reads with** | `audit/PAYROLL_RESPINE_AUDIT_2026-06-13.md` (Evidence source); `STANTON-spec-standard.md` §3 |
| **Priority** | HIGHEST — ship before any change that writes payroll data |

---

## 1. Problem Statement

The Supabase project `wkwmxxlfheywwbgdbzxe` ("Stanton Main DB") currently provides an unauthenticated write path and defeated RBAC on all 22 covered payroll tables. This means:

1. **Unauthenticated full DML (S1).** The `anon` role holds INSERT/UPDATE/DELETE/TRUNCATE on every `payroll_`-prefixed table. The DB role-resolver function `payroll_get_role()` returns `'manager'` for `auth.uid() = NULL`, which causes the `{public}`-scoped write policies (gated on `payroll_is_manager_or_above()`) to pass for requests carrying only the public anon key. Any script or curl command bearing the hardcoded publishable key in `src/lib/supabase/config.ts` can write payroll data without a user session.

2. **RBAC defeated by blanket always-true policies (S2).** 22 tables carry a policy named `*_auth` or `authenticated_access` with `cmd=ALL, role=authenticated, USING true, WITH CHECK true`. Because Postgres ORs permissive policies, `true OR <granular_check>` = always true. The granular role policies are dead code. Any authenticated Stanton user on the shared DB has full CRUD on all payroll data including `payroll_audit_log`.

3. **Forgeable, universally readable audit log (S3).** `payroll_audit_log` allows authenticated INSERT with `WITH CHECK true` (no actor binding) and SELECT with `USING true` (no scoping). Any authenticated user can inject false audit rows and read the full audit history.

4. **SECURITY DEFINER role functions have mutable `search_path` (S6).** `payroll_get_role`, `payroll_is_admin`, `payroll_is_manager_or_above` are `SECURITY DEFINER` with `proconfig = null` (no `SET search_path`). Anon holds EXECUTE on all three, compounding S1.

5. **App-layer fail-open mirrors the DB bug (S7).** `src/hooks/payroll/useAuth.ts` lines 49–55 assign `role: 'manager', is_active: true` to any authenticated user whose `profiles` row is missing. This mirrors `payroll_get_role()`'s fail-open and would survive even a correct DB fix unless patched together.

---

## 2. Evidence Baseline

| ID | Finding | Evidence | Status |
|---|---|---|---|
| S1-a | `anon` has INSERT/UPDATE/DELETE/TRUNCATE on `payroll_*` tables | `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='anon' AND table_name LIKE 'payroll\_%'` returned rows for all payroll tables | **Verified** (live `pg_policies` + `role_table_grants` introspection, 2026-06-13) |
| S1-b | `payroll_get_role()` body: `COALESCE((SELECT role FROM profiles WHERE id=auth.uid()),'manager')` — returns `'manager'` when `auth.uid()` is NULL | `pg_get_functiondef('payroll_get_role'::regproc)` | **Verified** |
| S1-c | Public anon key hardcoded at `src/lib/supabase/config.ts:2` (`FALLBACK_SUPABASE_PUBLISHABLE_KEY`) | File read | **Verified** |
| S2-a | 22 `payroll_*` tables carry a policy named `*_auth` or `authenticated_access` with `cmd=ALL, roles={authenticated}, qual='true', with_check='true'` | `SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'payroll\_%' AND qual='true'` | **Verified** |
| S2-b | Granular role policies co-exist on the same tables — Postgres ORs them, making the granular checks unreachable | Postgres documentation + live policy set | **Verified** |
| S3-a | `payroll_audit_log` INSERT policy: `WITH CHECK true` (no actor binding) | `pg_policies` for `payroll_audit_log` | **Verified** |
| S3-b | `payroll_audit_log` SELECT policy: `USING true` (no scoping) | `pg_policies` for `payroll_audit_log` | **Verified** |
| S6-a | `payroll_get_role`, `payroll_is_admin`, `payroll_is_manager_or_above` are `SECURITY DEFINER` with `proconfig = null` | `SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname LIKE 'payroll\_%'` | **Verified** |
| S6-b | `anon` has EXECUTE on all three role functions | `information_schema.role_routine_grants WHERE grantee='anon'` | **Verified** |
| S7-a | `useAuth.ts:49–55` fallback assigns `role:'manager', is_active:true` for authenticated users without a `profiles` row | `src/hooks/payroll/useAuth.ts` file read, lines 48–55 | **Verified** |
| S7-b | `useAuth.ts:45` also coerces a null/missing `data.role` to `'manager'` via `?? 'manager'` | `src/hooks/payroll/useAuth.ts:45` | **Verified** |
| UNV-1 | Exact list of 22 affected table names carrying the blanket policy | Must enumerate via `SELECT DISTINCT tablename FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'payroll\_%' AND qual='true' AND 'authenticated'=ANY(roles)` at build time | **[Unverified] — Phase 1 gate** |
| UNV-2 | Whether any application code path relies on the blanket policies (i.e., issues requests that would fail under the tightened policies for legitimate use cases) | Code audit of all Supabase client calls from `src/hooks/payroll/*` and `src/app/**` | **[Unverified] — Phase 1 gate** |
| UNV-3 | Whether a `payroll_role` column or separate role table already exists in `profiles`, or whether payroll access is currently controlled only by the existing `role` column | `SELECT column_name FROM information_schema.columns WHERE table_name='profiles'` | **[Unverified] — Phase 1 gate** |
| UNV-4 | Whether any row in `payroll_audit_log` has `actor_id` or `actor_role` columns already | `\d payroll_audit_log` at build time | **[Unverified] — Phase 1 gate** |

---

## 3. Users and Roles

**In scope for this PRP:**

| Actor | Description |
|---|---|
| `payroll_admin` | Authenticated Stanton user with `role='admin'` in `profiles`; full CRUD on payroll data |
| `payroll_manager` | Authenticated Stanton user with `role='manager'` in `profiles`; CRUD on time entries, employees, invoices; no direct audit-log write |
| `payroll_bookkeeper` | Authenticated Stanton user with `role='bookkeeper'` in `profiles`; read-only on most payroll data; can insert reconciliation rows |
| `authenticated` (non-payroll) | Any other authenticated Stanton user on the shared DB; must have **zero** access to `payroll_*` tables after this PRP |
| `anon` | Unauthenticated / public-key caller; must have **zero** DML on any `payroll_*` table and zero EXECUTE on payroll role functions |

**Out of scope for v1:** service-role access patterns (no `SUPABASE_SERVICE_ROLE_KEY` exists in the repo); portfolio-level scoping within the payroll role set (deferred to PRP-04 per Part D §3 of the audit); external API routes auth (PRP-03).

---

## 4. Core Features

Each is a named, verifiable end-state — not a screen.

**CF-1: Drop all blanket always-true policies.**
Remove every policy on `payroll_*` tables where `qual = 'true'` and `roles @> '{authenticated}'`. After execution `SELECT … FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'payroll\_%' AND qual='true' AND 'authenticated'=ANY(roles)` returns zero rows.

**CF-2: Fix `payroll_get_role()` to deny (return NULL) for absent profiles, and pin `search_path`.**
Replace the `COALESCE(…,'manager')` fallback with a bare lookup — missing profile returns `NULL`. Add `SET search_path = public, pg_temp` to the function definition (addresses S6). Verify: `SELECT payroll_get_role()` executed as a session where `auth.uid()` returns NULL (or no matching profile row) returns `NULL`, not `'manager'`.

**CF-3: Pin `search_path` on `payroll_is_admin()` and `payroll_is_manager_or_above()`.**
Same hardening as CF-2. Both functions receive `SET search_path = public, pg_temp`. Verify: `SELECT proconfig FROM pg_proc WHERE proname IN ('payroll_is_admin','payroll_is_manager_or_above','payroll_get_role')` returns `{search_path=public,pg_temp}` for each row.

**CF-4: Revoke anon DML and EXECUTE.**
`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon` (scoped to the payroll tables individually if other tables legitimately need anon DML). `REVOKE EXECUTE ON FUNCTION payroll_get_role(), payroll_is_admin(), payroll_is_manager_or_above() FROM anon`. Verify: `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE grantee='anon' AND table_name LIKE 'payroll\_%' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')` returns zero rows.

**CF-5: Gate payroll table access on a payroll role in `profiles`.**
Replace the granular role policies (which currently exist but are dead code due to S2) with correct policies that first check whether `auth.uid()` has `role IN ('admin','manager','bookkeeper')` in `profiles`. Unauthenticated users and non-payroll Stanton users see nothing. [Open Decision OD-1 governs the exact role set.] Verify: an authenticated user whose `profiles.role` is not in the payroll role set receives a `42501` or empty result on any `payroll_*` table query.

**CF-6: Bind `payroll_audit_log` inserts to the session actor; restrict SELECT.**
Replace the open INSERT policy with `WITH CHECK (actor_id = auth.uid())` (requires `actor_id uuid NOT NULL` column — see Data Model). Replace the open SELECT policy with `USING (actor_id = auth.uid() OR payroll_is_admin())`. Verify: an authenticated non-admin cannot INSERT a row with a spoofed `actor_id`; cannot SELECT rows they did not author.

**CF-7: Remove the app-layer fail-open in `useAuth.ts`.**
Change lines 45 and 49–55 of `src/hooks/payroll/useAuth.ts` so that a missing or incomplete profile resolves to `role: null` (or a typed `undefined`) and `is_active: false`, matching least privilege. Components that currently rely on the `manager` default will need to handle a null role gracefully (render a "contact admin" state, not a manager-level UI). Verify: a user with a valid session but no `profiles` row receives `profile.role === null` and sees no payroll data.

---

## 5. Data Model

### 5a. Required schema change — `payroll_audit_log`

CF-6 requires `actor_id` to be non-null and bound to `auth.uid()`. Current state is `[Unverified]` (UNV-4) — verify the column exists and its nullable/constraint state before writing the migration.

```sql
-- Only if actor_id does not already exist:
ALTER TABLE public.payroll_audit_log
  ADD COLUMN IF NOT EXISTS actor_id uuid NOT NULL DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS actor_role text;

-- If actor_id already exists but is nullable:
ALTER TABLE public.payroll_audit_log
  ALTER COLUMN actor_id SET NOT NULL,
  ALTER COLUMN actor_id SET DEFAULT auth.uid();
```

The `DEFAULT auth.uid()` is a session-context default — app-layer inserts that omit `actor_id` automatically bind to the current session user. Existing rows with NULL `actor_id` must be handled before adding NOT NULL (see Phase 2 rollback notes).

### 5b. No new tables

The `payroll_events` DB-trigger event spine (Part D §1 of the audit) is explicitly deferred to PRP-04. Do not create `payroll_events` here.

### 5c. `profiles` table dependency

The tightened policies query `profiles.role`. The column already exists [Inference — standard Supabase auth setup; confirmed by `payroll_get_role()` body referencing it]. Verify at build time (UNV-3): `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='profiles' AND column_name='role'`. If a separate `payroll_role` column is needed (OD-1), the migration adds it.

---

## 6. Integration Points

| System | Hook | Direction | Notes |
|---|---|---|---|
| Supabase `pg_policies` (live DB) | `DROP POLICY … ON …` / `CREATE POLICY … ON …` | DB migration | Irreversible unless rollback script is kept (Phase Rollback section preserves exact DROP statements) |
| Supabase `pg_proc` | `CREATE OR REPLACE FUNCTION` | DB migration | Function body change; prior body must be saved before replacement |
| `information_schema.role_table_grants` | `REVOKE … FROM anon` | DB migration | Affects all connections using the anon key |
| `src/hooks/payroll/useAuth.ts` | Direct edit, lines 45 and 49–55 | App code | TypeScript; requires null-role handling in all consuming components |
| Consuming components of `useAuth` | Read-only impact assessment | App code | `[Unverified]` — enumerate via Phase 1 grep |

---

## 7. Affected Files

### Migrations (new files — to be created in `supabase/migrations/`)

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/YYYYMMDD_drop_blanket_auth_policies.sql` | New | CF-1: DROP the 22 always-true policies |
| `supabase/migrations/YYYYMMDD_fix_role_functions.sql` | New | CF-2, CF-3: replace function bodies, pin search_path |
| `supabase/migrations/YYYYMMDD_revoke_anon_payroll.sql` | New | CF-4: REVOKE anon DML + EXECUTE |
| `supabase/migrations/YYYYMMDD_tighten_payroll_rls.sql` | New | CF-5: replace granular policies with correct role-gated versions |
| `supabase/migrations/YYYYMMDD_bind_audit_log_actor.sql` | New | CF-6: actor_id column + policy replacement on payroll_audit_log |

### App code (modified)

| File | Lines | Action |
|---|---|---|
| `src/hooks/payroll/useAuth.ts` | 45, 49–55 | CF-7: remove manager/true fail-open defaults; return null role for missing profile |

### Potentially affected (Phase 1 audit required)

| File glob | Reason |
|---|---|
| `src/hooks/payroll/use*.ts` | Any hook that reads `profile.role` and renders manager-level UI on a null/undefined role |
| `src/app/payroll/**/page.tsx` | Page-level role checks may need a null-role guard |
| `src/components/payroll/**/*.tsx` | [Speculation] — component-level role branches |

---

## 8. Implementation Phases

### Phase 0 — Recon (no DB change, no code change)

Confirm the `[Unverified]` gates before touching anything.

**Step 0.1** — Enumerate the exact 22 policy names to drop:
```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'payroll\_%'
  AND qual = 'true'
  AND 'authenticated' = ANY(roles)
ORDER BY tablename;
```
Expected: rows for 22 tables. Capture output — the policy names feed the DROP statements in Phase 1.

**Step 0.2** — Confirm `profiles.role` column and its allowed values:
```sql
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name IN ('role','payroll_role');
```
If neither exists, pause and resolve OD-1 before proceeding.

**Step 0.3** — Check `payroll_audit_log` schema:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'payroll_audit_log'
ORDER BY ordinal_position;
```
Determines whether CF-6 migration needs ADD COLUMN vs ALTER COLUMN.

**Step 0.4** — Grep for components consuming `useAuth` and their role branch logic:
```
grep -r "useAuth\|profile\.role\|isAdmin\|isManager" src/ --include="*.ts" --include="*.tsx" -l
```
Review each file for manager-default assumptions that CF-7 will break.

**Step 0.5** — Save current function bodies to a rollback artefact:
```sql
SELECT proname, pg_get_functiondef(oid)
FROM pg_proc
WHERE proname IN ('payroll_get_role','payroll_is_admin','payroll_is_manager_or_above');
```
Paste output into `audit/rollback_snapshots/phase1_function_bodies.sql` before Phase 1 begins.

**Verification:** All five steps produce legible output with no errors. Zero unresolved blockers. Proceed to Phase 1.

---

### Phase 1 — Drop blanket policies + revoke anon (DB only; no code change)

**Risk level:** High — this immediately closes the unauthenticated write path. The app will continue to work for properly-authenticated users because the granular role policies survive. Test with a logged-in session before marking complete.

**Step 1.1** — Drop all blanket always-true policies (use exact names from Step 0.1 output):
```sql
-- Template; repeat for each row from Step 0.1
DROP POLICY IF EXISTS "<policyname>" ON public.<tablename>;
```
Confirm count: the DROP statements must match the row count from Step 0.1 exactly.

**Step 1.2** — Revoke anon DML on payroll tables:
```sql
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'payroll\_%'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', tbl
    );
  END LOOP;
END;
$$;
```

**Step 1.3** — Revoke anon EXECUTE on role functions:
```sql
REVOKE EXECUTE ON FUNCTION
  public.payroll_get_role(),
  public.payroll_is_admin(),
  public.payroll_is_manager_or_above()
FROM anon;
```

**Verification (Phase 1 Done):**
```sql
-- Must return 0 rows:
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'payroll\_%'
  AND qual = 'true'
  AND 'authenticated' = ANY(roles);

-- Must return 0 rows:
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
  AND table_name LIKE 'payroll\_%'
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');

-- Must return 0 rows:
SELECT grantee, routine_name
FROM information_schema.role_routine_grants
WHERE grantee = 'anon'
  AND routine_name IN ('payroll_get_role','payroll_is_admin','payroll_is_manager_or_above');
```

**Phase 1 Rollback:**
```sql
-- Restore blanket policies (one per table, using saved names from Step 0.1):
CREATE POLICY "<saved_policyname>" ON public.<tablename>
  AS PERMISSIVE FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Restore anon DML grants:
DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'payroll\_%'
  LOOP
    EXECUTE format(
      'GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.%I TO anon', tbl
    );
  END LOOP;
END;
$$;

-- Restore anon EXECUTE:
GRANT EXECUTE ON FUNCTION
  public.payroll_get_role(),
  public.payroll_is_admin(),
  public.payroll_is_manager_or_above()
TO anon;
```

---

### Phase 2 — Fix role functions + pin search_path (DB only)

**Step 2.1** — Replace `payroll_get_role()`:
```sql
CREATE OR REPLACE FUNCTION public.payroll_get_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;
```
The `COALESCE(…,'manager')` default is removed. Returns `NULL` when no profile row exists.

**Step 2.2** — Pin `search_path` on `payroll_is_admin()` and `payroll_is_manager_or_above()`:
```sql
CREATE OR REPLACE FUNCTION public.payroll_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT payroll_get_role() = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.payroll_is_manager_or_above()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT payroll_get_role() IN ('admin', 'manager')
$$;
```
Exact bodies are `[Unverified]` pending Step 0.5 output — substitute the correct body while adding only the `SET search_path` clause and removing the fail-open default from `payroll_get_role`.

**Verification (Phase 2 Done):**
```sql
-- All three must return '{search_path=public,pg_temp}':
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('payroll_get_role','payroll_is_admin','payroll_is_manager_or_above');

-- payroll_get_role() must return NULL (not 'manager') for an absent profile:
-- Run in a context where auth.uid() returns a UUID with no matching profiles row.
-- Expected: NULL
SELECT public.payroll_get_role();
```

**Phase 2 Rollback:**
Restore from `audit/rollback_snapshots/phase1_function_bodies.sql` (saved in Phase 0, Step 0.5).

---

### Phase 3 — Tighten payroll RLS to require payroll role (DB only)

This phase replaces the now-dead granular role policies with correct versions. The policy set for each table must:
- Deny all access if `payroll_get_role()` returns NULL (covers non-payroll Stanton users and unauthenticated callers).
- Scope operations by role (admin = all; manager = CRUD on operational tables; bookkeeper = SELECT + reconciliation inserts).

The exact per-table policies depend on OD-1 and the table list from Phase 0.

**Step 3.1** — For each `payroll_*` table, replace policies following this template:
```sql
-- DROP the existing granular policies first (names from pg_policies; they are dead code but
-- must be explicitly replaced):
DROP POLICY IF EXISTS "<existing_granular_policy>" ON public.<tablename>;

-- Admin: full access
CREATE POLICY "payroll_admin_all" ON public.<tablename>
  AS PERMISSIVE FOR ALL TO authenticated
  USING (payroll_is_admin())
  WITH CHECK (payroll_is_admin());

-- Manager: CRUD (tune per table — see OD-2)
CREATE POLICY "payroll_manager_crud" ON public.<tablename>
  AS PERMISSIVE FOR ALL TO authenticated
  USING (payroll_is_manager_or_above())
  WITH CHECK (payroll_is_manager_or_above());

-- Bookkeeper: SELECT only (tune per table)
CREATE POLICY "payroll_bookkeeper_read" ON public.<tablename>
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (payroll_get_role() = 'bookkeeper');
```

**Step 3.2** — For `payroll_audit_log` specifically (actor-bound, per CF-6):
```sql
DROP POLICY IF EXISTS "<existing_insert_policy>" ON public.payroll_audit_log;
DROP POLICY IF EXISTS "<existing_select_policy>" ON public.payroll_audit_log;

CREATE POLICY "audit_log_insert_self" ON public.payroll_audit_log
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND payroll_get_role() IS NOT NULL);

CREATE POLICY "audit_log_select_own_or_admin" ON public.payroll_audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR payroll_is_admin());
```

**Verification (Phase 3 Done):**
```sql
-- Non-payroll authenticated user: must return 0 rows on any payroll table.
-- (Run as a Stanton user whose profiles.role is NOT in {'admin','manager','bookkeeper'})
SELECT count(*) FROM public.payroll_time_entries;
-- Expected: 0 rows (RLS blocks), not a permissions error — RLS returns empty, not 403.

-- Authenticated user cannot insert a spoofed audit row:
-- (Run as manager-role user, set actor_id to a different user's UUID)
INSERT INTO public.payroll_audit_log (actor_id, ...) VALUES ('<other_user_uuid>', ...);
-- Expected: ERROR — violates WITH CHECK constraint.

-- Admin can read all audit rows; non-admin sees only their own:
-- (Verify by comparing row counts for an admin vs a manager session)
```

**Phase 3 Rollback:**
```sql
-- Restore the previously-dropped granular policies from the saved policy snapshot.
-- The blanket policies are NOT restored (Phase 1 rollback handles that if needed).
-- Capture the full pg_policies snapshot for payroll_ tables before Phase 3 begins:
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'payroll\_%'
ORDER BY tablename, policyname;
-- Save to: audit/rollback_snapshots/phase3_pre_policy_snapshot.sql
```

---

### Phase 4 — `payroll_audit_log` actor-id column migration (DB only; prerequisite for Phase 3 Step 3.2)

This phase must run before Phase 3 Step 3.2 if `actor_id` does not already exist (determined in Phase 0, Step 0.3).

**Step 4.1** — Add `actor_id` column if absent:
```sql
ALTER TABLE public.payroll_audit_log
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS actor_role text;

-- Backfill existing rows to a sentinel rather than leaving NULL
-- (prevents NOT NULL constraint failure on migration):
UPDATE public.payroll_audit_log
SET actor_id = '00000000-0000-0000-0000-000000000000'
WHERE actor_id IS NULL;

ALTER TABLE public.payroll_audit_log
  ALTER COLUMN actor_id SET NOT NULL,
  ALTER COLUMN actor_id SET DEFAULT auth.uid();
```

**Step 4.2** — Add FK to `auth.users` [Inference — standard pattern; confirm auth schema is accessible]:
```sql
ALTER TABLE public.payroll_audit_log
  ADD CONSTRAINT payroll_audit_log_actor_fk
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
```
Skip the FK if existing rows were backfilled to the sentinel UUID (sentinel won't be in `auth.users`). In that case, leave as an unbound UUID column and add the FK only after data cleanup.

**Verification (Phase 4 Done):**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'payroll_audit_log'
  AND column_name IN ('actor_id', 'actor_role');
-- Both rows must appear; actor_id must show is_nullable = 'NO'.
```

**Phase 4 Rollback:**
```sql
ALTER TABLE public.payroll_audit_log
  DROP COLUMN IF EXISTS actor_id,
  DROP COLUMN IF EXISTS actor_role;
```

---

### Phase 5 — App-layer fail-open removal (code change only; independent of DB phases)

**Step 5.1** — Edit `src/hooks/payroll/useAuth.ts`:

Change the `loadProfile` function so both the data-present and data-absent branches return least-privilege values:

- Line 45: `role: (data.role as UserRole) ?? 'manager'` → `role: (data.role as UserRole | null) ?? null`
- Lines 49–55 (no-profile branch): `role: 'manager', is_active: true` → `role: null, is_active: false`

Update the `AuthProfile` type: `role: UserRole | null`.

**Step 5.2** — Audit all consuming components (from Phase 0 Step 0.4 list) for hard assumptions on `profile.role` being non-null. Add null guards: show a "Contact your administrator to be added to payroll" message when `profile.role === null`. Do not silently default to read-only manager view.

**Verification (Phase 5 Done):**
```bash
# No remaining 'manager' string default in useAuth.ts:
grep -n "role.*manager\|manager.*role\|'manager'" src/hooks/payroll/useAuth.ts
# Expected: zero matches on the fail-open default lines.

# TypeScript compiles without error:
npx tsc --noEmit
# Expected: exit 0.
```

**Phase 5 Rollback:**
Revert `src/hooks/payroll/useAuth.ts` to the prior commit. Git revert is sufficient — this phase has no DB component.

---

## 9. Open Decisions

| ID | Decision | Default (used if not overridden) | Owner |
|---|---|---|---|
| OD-1 | Is payroll access gated by the existing `profiles.role` column (`admin`/`manager`/`bookkeeper`), or does it need a separate `profiles.payroll_access boolean` or `profiles.payroll_role text` column to avoid coupling payroll access to the org-wide role set? | Use existing `profiles.role IN ('admin','manager','bookkeeper')` as the payroll access gate. No new column. Rationale: the current role set already maps to payroll responsibilities; a separate column is a PRP-04 concern when portfolio-level scoping arrives. | Alex |
| OD-2 | Should `bookkeeper` role have INSERT on operational tables (e.g., `payroll_adp_recon_rows`, `payroll_invoices`) or SELECT-only? | Bookkeeper gets SELECT on all payroll tables, INSERT on `payroll_adp_recon_rows` only. All other DML restricted to manager+. | Alex |
| OD-3 | Should the sentinel UUID used to backfill existing `payroll_audit_log` rows with no `actor_id` be replaced with the actual author UUID, or left as a sentinel permanently? | Left as sentinel `00000000-0000-0000-0000-000000000000` (represents "pre-migration system record"). Add a `migration_backfilled boolean DEFAULT false` column to flag these rows if needed. | Alex |
| OD-4 | What UI should non-payroll authenticated Stanton users see if they navigate to `/payroll/*`? An access-denied page, or a redirect to another app? | Redirect to `/` with a toast "You do not have payroll access. Contact your administrator." | Alex |

---

## 10. Out of Scope

- **DB-trigger actor/event spine** (`payroll_events` table, trigger-written audit trail) — deferred to PRP-04. This PRP hardens the existing `payroll_audit_log` to be actor-bound; it does not replace it with a trigger-driven spine.
- **Portfolio-level RLS scoping** (filter rows by `portfolio_id` per user) — deferred to PRP-04 per audit Part D §3.
- **API route authentication** (`/api/workyard/*`) — deferred to PRP-03.
- **Public storage bucket** (`expense-receipts`) — deferred to PRP-03.
- **Hardcoded anon key in `config.ts`** — PRP-03 moves it to env; this PRP only revokes the damage the key can do.
- **DB-enforced weekly locking / immutability** — deferred to PRP-04.
- **Test and CI substrate** — deferred to PRP-05. This PRP should be manually verified using the SQL checks in the Definition of Done.
- **Shared-DB org-wide advisor items** (212 `rls_policy_always_true` across all schemas, 146 `rls_enabled_no_policy`, Postgres 15.8 EOL) — out of scope; a separate org-level advisor sweep is recommended.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A legitimate app code path depended on the blanket always-true policy and breaks silently after Phase 1 | Medium | High — app feature stops working for authenticated users | Phase 0 Step 0.4 audits all Supabase client calls; smoke-test the full payroll UI in a dev session immediately after Phase 1 with an admin + manager account |
| Existing `payroll_audit_log` rows have `actor_id = NULL`; NOT NULL constraint fails during Phase 4 | High | Medium — migration fails and must be retried | The backfill UPDATE in Phase 4 Step 4.1 runs before the ALTER; if row count is large, run as a batched UPDATE in chunks |
| `payroll_get_role()` returning NULL breaks a `payroll_is_manager_or_above()` call that did not guard for NULL | Medium | High — manager-role users may lose access | Phase 0 Step 0.4 audits all role-function call sites; update callers before Phase 2 or ensure `payroll_is_manager_or_above()` gracefully handles a NULL return from `payroll_get_role()` (the replacement body handles this correctly: `NULL IN ('admin','manager')` = FALSE, not error) |
| Blanket policy names differ from the `*_auth`/`authenticated_access` pattern in the audit | Low | Medium — DROP POLICY fails silently if policy name is wrong; the opening persists | Phase 0 Step 0.1 captures exact names; use those verbatim; run the verification query after Phase 1 to confirm zero remaining blanket policies |
| `profiles.role` column stores values outside `{'admin','manager','bookkeeper'}` for some Stanton users | Low | Low — those users simply get no payroll access (correct behavior) | Query `SELECT DISTINCT role FROM profiles` in Phase 0 to enumerate actual values; confirm no unexpected role names |
| Phase 5 null-role change breaks a component that does not null-guard | Medium | Medium — component renders blank or throws at runtime | TypeScript `noEmit` check catches type errors; manual UI walkthrough with a null-role test user after Phase 5 |

---

## 12. Definition of Done

The following SQL queries and checks must pass. A reviewer runs these against the live DB and the running app; they must not require any interpretation beyond reading the output.

### DB checks (run in Supabase SQL editor or `psql`):

**DoD-1** — No blanket always-true policies remain on payroll tables:
```sql
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'payroll\_%'
  AND qual = 'true'
  AND 'authenticated' = ANY(roles);
-- Required result: 0 rows
```

**DoD-2** — anon has no DML on any payroll table:
```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
  AND table_name LIKE 'payroll\_%'
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
-- Required result: 0 rows
```

**DoD-3** — anon has no EXECUTE on payroll role functions:
```sql
SELECT grantee, routine_name
FROM information_schema.role_routine_grants
WHERE grantee = 'anon'
  AND routine_name IN ('payroll_get_role','payroll_is_admin','payroll_is_manager_or_above');
-- Required result: 0 rows
```

**DoD-4** — `payroll_get_role()` returns NULL for an absent profile:
```sql
-- Execute as a session where auth.uid() yields a UUID with no matching profiles row,
-- or temporarily set: SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
SELECT public.payroll_get_role();
-- Required result: NULL (not 'manager', not '')
```

**DoD-5** — All three role functions have a pinned `search_path`:
```sql
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('payroll_get_role','payroll_is_admin','payroll_is_manager_or_above');
-- Required result: proconfig = '{search_path=public,pg_temp}' for each row (3 rows total)
```

**DoD-6** — `payroll_audit_log` has a non-null actor-bound `actor_id` column:
```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'payroll_audit_log'
  AND column_name = 'actor_id';
-- Required result: 1 row, is_nullable = 'NO', column_default LIKE '%auth.uid()%'
```

**DoD-7** — `payroll_audit_log` SELECT policy is no longer universally open:
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'payroll_audit_log'
  AND cmd IN ('SELECT','ALL');
-- Required result: no row has qual = 'true' unless combined with a role check
-- (qual must reference auth.uid() or a role-function call)
```

### App-layer check:

**DoD-8** — No fail-open manager default in `useAuth.ts`:
```bash
grep -n "role.*'manager'\|'manager'.*role" src/hooks/payroll/useAuth.ts
# Required result: zero matches on the default-assignment lines (lines ~45, ~53)
```

**DoD-9** — TypeScript compiles clean after Phase 5:
```bash
npx tsc --noEmit
# Required result: exit code 0, no errors mentioning useAuth or AuthProfile
```

### Manual smoke test:

**DoD-10** — Log in as a Stanton user whose `profiles.role` is NOT `admin`/`manager`/`bookkeeper`. Navigate to `/payroll/`. Verify: no payroll data is visible; a "no payroll access" message or redirect is shown. Verify: no JS console errors about undefined `profile.role`.

---

## 13. Rollback Summary (per phase)

| Phase | Rollback method | Estimated time |
|---|---|---|
| Phase 0 | No changes made — nothing to roll back | — |
| Phase 1 | Restore saved policy names → `CREATE POLICY … USING (true)` + `GRANT DML TO anon` (script in Phase 1 Rollback section above) | ~5 min |
| Phase 2 | Run `CREATE OR REPLACE FUNCTION` from `audit/rollback_snapshots/phase1_function_bodies.sql` | ~2 min |
| Phase 3 | Restore saved policy snapshot from `audit/rollback_snapshots/phase3_pre_policy_snapshot.sql` | ~5 min |
| Phase 4 | `ALTER TABLE payroll_audit_log DROP COLUMN IF EXISTS actor_id, DROP COLUMN IF EXISTS actor_role` — note: destroys backfilled data | ~1 min |
| Phase 5 | `git revert` the useAuth.ts commit | ~1 min |

---

## 14. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-13 | PRP-01 ordered as the first PRP in the uplift sequence | The broken auth substrate is an active exploit path; no data-writing change should ship before it is closed. Per audit Part E ordering. |
| 2026-06-13 | DB-trigger actor/event spine (`payroll_events`) deferred to PRP-04 | Scope control: the trigger spine is a structural re-architecture of how audit data is written. Binding `payroll_audit_log` to `actor_id` (Phase 4) is the minimum safe hardenening achievable without that refactor. |
| 2026-06-13 | Portfolio-level RLS scoping deferred to PRP-04 | Requires a `portfolio_id` FK path and a per-user portfolio assignment table. Adding that here would widen blast radius to data-model changes on the billing/invoice side of the DB. |
| 2026-06-13 | OD-1 default: use `profiles.role` as the payroll access gate | Least new infrastructure. The role set already maps to payroll responsibilities. A dedicated `payroll_access` column is introduced only if the org structure diverges (e.g., a Stanton admin who should not see payroll). |

---

## 15. Spec Score (§5 of STANTON-spec-standard.md)

| Element | Score | Notes |
|---|---|---|
| 1. Problem statement | Y | Five numbered defects, each backed by verified evidence |
| 2. Users and roles | Y | Five actors defined with explicit in/out-of-scope |
| 3. Numbered features | Y | CF-1 through CF-7, each a named end-state with verification method |
| 4. Data model | Y | `payroll_audit_log` column change specified; no new tables; schema dependency on `profiles.role` noted with verification step |
| 5. Integration points | Y | Table of 4 integration hooks; seam owners named |
| 6. Ordered phases | Y | Phases 0–5, each independently shippable and reversible; Phase 0 is explicit recon before any write |
| 7. Open decisions with defaults | Y | Four ODs; each has a named default and owner |
| 8. Out of scope | Y | Eight deferred items explicitly named with destination PRP |
| 9. Definition of done | Y | Ten DoD items; nine are SQL or shell commands a reviewer runs without interpretation; one is a manual smoke test with a pass criterion |
