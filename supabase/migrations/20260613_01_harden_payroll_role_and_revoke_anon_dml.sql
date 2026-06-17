-- 20260613_01_harden_payroll_role_and_revoke_anon_dml.sql
--
-- SECURITY FIX — closes the unauthenticated-write path on payroll data.
-- Pairs with 20260613_02_tighten_payroll_rls_drop_blanket_auth.sql; apply this _01_ file FIRST.
-- Run ONCE as the postgres superuser (the Supabase Dashboard SQL editor satisfies this). A non-
-- superuser that owns only some of the payroll_* objects/functions is insufficient — REVOKE and
-- CREATE OR REPLACE require ownership/superuser.
-- Stored CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push` /
-- `supabase migration up`, which wrap each migration in their own transaction. For an ATOMIC manual
-- run in the SQL editor, wrap the body yourself in BEGIN; ... COMMIT; (every statement is idempotent,
-- so a re-run after a partial failure is safe either way).
-- Idempotent and fully reversible (rollback block at the bottom, commented out).
--
-- Root cause:
--   payroll_get_role() was:  SELECT COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), 'manager')
--   For an anon (unauthenticated) caller, auth.uid() is NULL, the subquery returns no row, and the
--   COALESCE fell back to 'manager'. So payroll_is_manager_or_above() returned TRUE for *anyone*,
--   and because the `anon` role also holds INSERT/UPDATE/DELETE/TRUNCATE on the payroll_* tables,
--   an unauthenticated request bearing only the public anon/publishable key could write payroll data.
--
-- What this migration does:
--   (1) Removes the fail-open default: an absent profile now yields NULL (no role), not 'manager'.
--   (2) Makes payroll_is_admin() / payroll_is_manager_or_above() NULL-safe (return FALSE, never NULL).
--   (3) Revokes INSERT/UPDATE/DELETE/TRUNCATE from the `anon` role on every public.payroll_* table.
--
-- Bundled hardening (called out, not silent): because we are already redefining these three
--   SECURITY DEFINER functions, we pin their search_path (= public, pg_temp). This also clears the
--   `function_search_path_mutable` advisor finding on exactly these functions. Remove the
--   `set search_path` lines if you want strictly the two requested fixes and nothing else.
--
-- Verified against live DB wkwmxxlfheywwbgdbzxe ("Stanton Main DB") on 2026-06-13:
--   - 29 public.payroll_* base tables, all granting DELETE/INSERT/TRUNCATE/UPDATE to anon.
--   - payroll_get_role() is called ONLY by the two wrapper functions below (no policy / other
--     function calls it directly), so returning NULL here has no other call-site to break.

-- (1) + hardening: fail-closed role resolver. Absent profile => NULL (no role).
create or replace function public.payroll_get_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select "role" from public.profiles where id = auth.uid()
$$;

-- (2) NULL-safe role predicates. A NULL role now resolves to FALSE, not NULL.
create or replace function public.payroll_is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(public.payroll_get_role() = 'admin', false)
$$;

create or replace function public.payroll_is_manager_or_above()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(public.payroll_get_role() in ('admin', 'manager'), false)
$$;

-- (3) Revoke unauthenticated write grants on every payroll_* base table in `public`.
--     Scoped to payroll_* only, so other departments on this shared DB are untouched.
--     NOTE: this runs ONCE — it does NOT auto-harden payroll_* tables created later; those must be
--     handled explicitly (or via ALTER DEFAULT PRIVILEGES / an event trigger) when added.
--     Source is pg_catalog (not information_schema) so the list is never silently filtered by the
--     executor's privileges. REVOKE of a privilege not held is a no-op, so this is safe to re-run.
--     On a live DB each REVOKE briefly locks the table's catalog entry (~<1ms/table when idle); with
--     concurrent payroll queries in flight it may queue, so prefer a low-traffic window.
do $$
declare
  tbl text;
begin
  for tbl in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname like 'payroll\_%'
  loop
    execute format(
      'revoke insert, update, delete, truncate on public.%I from anon',
      tbl
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Optional follow-up — INFORMATIONAL ONLY. DO NOT uncomment/run unless you specifically intend to
-- revoke anon EXECUTE on these functions. anon writes are already blocked by steps 1-3 above; with
-- the fail-open default gone, anon EXECUTE on the role functions is harmless. To revoke anyway:
--   revoke execute on function
--     public.payroll_get_role(), public.payroll_is_admin(), public.payroll_is_manager_or_above()
--   from anon;
-- ---------------------------------------------------------------------------
-- ROLLBACK (run only to revert this migration):
-- IMPORTANT: the rollback is ATOMIC — run all four parts together (the 3 function definitions AND the
-- DO grant loop). Restoring only the function bodies without re-granting anon DML leaves the DB in a
-- worse state than before (fail-open functions + anon writes still blocked, which can also block
-- legitimate role-holders). Recreating the fail-open 'manager' default below REINTRODUCES the original
-- vulnerability — emergency use only.
--   create or replace function public.payroll_get_role() returns text language sql stable security definer as $$
--     select coalesce((select role from profiles where id = auth.uid()), 'manager') $$;
--   create or replace function public.payroll_is_admin() returns boolean language sql stable security definer as $$
--     select payroll_get_role() = 'admin' $$;
--   create or replace function public.payroll_is_manager_or_above() returns boolean language sql stable security definer as $$
--     select payroll_get_role() in ('admin', 'manager') $$;
--   do $$ declare tbl text; begin
--     for tbl in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'payroll\_%'
--     loop execute format('grant insert, update, delete, truncate on public.%I to anon', tbl); end loop;
--   end; $$;
-- ---------------------------------------------------------------------------
