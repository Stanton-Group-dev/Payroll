-- 20260619_01_complete_payroll_rls.sql
--
-- PRP-01 completion. Apply AFTER 20260613_01_harden_payroll_role_and_revoke_anon_dml.sql
-- (fail-closed role funcs + anon DML revoke) and 20260613_02_tighten_payroll_rls_drop_blanket_auth.sql
-- (drops the 22 blanket policies, adds Group B SELECT). This file does the two things _02 left open:
--   (A) Adds WRITE policies for the 7 Group B tables (else they are read-only and the expense /
--       config / travel / spread flows hard-break). Manager-operated model per DECISIONS_LOG §0.7/§3.
--   (B) Closes the 4 always-true policies the _02 DROP list missed (full pg_policies census,
--       live DB wkwmxxlfheywwbgdbzxe, 2026-06-19): payroll_audit_log (SELECT+INSERT),
--       payroll_onboarding_audit.auth_read_audit, capex_expenses.capex_expenses_policy.
--
-- Idempotent (drop-then-create / IF EXISTS). For a manual SQL-editor run wrap in BEGIN; ... COMMIT;.
-- Role helpers (after _01 patch): payroll_is_admin() = role in (superadmin,admin);
-- payroll_is_manager_or_above() = role in (superadmin,admin,manager); payroll_get_role() is not null
-- = "any payroll-role holder" (used where bookkeepers also act, e.g. expense flows).
--
-- ⚠ capex_expenses is NOT touched here: grep of the payroll app finds ZERO references to it, so it
--   is owned by a different module on this shared DB. Its blanket policy (ALL, authenticated, true)
--   is a real hole, but dropping it without that module's role model would break the owning app.
--   FLAGGED for the owning module — fix it there, not blind from payroll.

-- ============================================================================================
-- (A) GROUP B WRITE POLICIES  (OPTION A — manager-operated; mirrors the commented block in _02)
-- ============================================================================================
-- Config / operational tables. Managers save cutoff config from the expenses page
-- (useExpenseSubmissions.saveConfig) and edit travel rates, so these are manager_or_above, not admin-only.
drop policy if exists "payroll_global_config_write" on public.payroll_global_config;
create policy "payroll_global_config_write" on public.payroll_global_config
  for all to authenticated
  using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());

drop policy if exists "payroll_travel_premiums_write" on public.payroll_travel_premiums;
create policy "payroll_travel_premiums_write" on public.payroll_travel_premiums
  for all to authenticated
  using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());

drop policy if exists "payroll_spread_events_write" on public.payroll_spread_events;
create policy "payroll_spread_events_write" on public.payroll_spread_events
  for all to authenticated
  using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());

-- Expense flow: any payroll-role holder (admin/manager/bookkeeper) may act — route-to-bookkeeping
-- and resolve-payment are bookkeeper actions, so manager_or_above would be too narrow. The SELECT
-- policies from _02 already allow authenticated read; these add the writes the UI needs.
drop policy if exists "payroll_expense_submissions_write" on public.payroll_expense_submissions;
create policy "payroll_expense_submissions_write" on public.payroll_expense_submissions
  for all to authenticated
  using (public.payroll_get_role() is not null) with check (public.payroll_get_role() is not null);

drop policy if exists "payroll_expense_items_write" on public.payroll_expense_items;
create policy "payroll_expense_items_write" on public.payroll_expense_items
  for all to authenticated
  using (public.payroll_get_role() is not null) with check (public.payroll_get_role() is not null);

drop policy if exists "payroll_expense_approvals_write" on public.payroll_expense_approvals;
create policy "payroll_expense_approvals_write" on public.payroll_expense_approvals
  for all to authenticated
  using (public.payroll_get_role() is not null) with check (public.payroll_get_role() is not null);

-- payroll_cost_codes: no app write path found (2026-06-13/19) — intentionally left read-only.

-- ============================================================================================
-- (B) CLOSE THE 4 ORPHAN ALWAYS-TRUE POLICIES MISSED BY _02
-- ============================================================================================
-- payroll_audit_log: blanket SELECT(true) let any authenticated user read ALL audit rows, and
-- blanket INSERT(check true) let anyone forge rows. Replace with role-gated policies. Append-only
-- enforcement + actor binding (actor_id = auth.uid()) is layered on by PRP-04's trigger spine;
-- here we only remove the always-true hole without breaking legitimate writes.
drop policy if exists "payroll_audit_log_select" on public.payroll_audit_log;
drop policy if exists "payroll_audit_log_insert" on public.payroll_audit_log;

-- Read: managers+ (incl. superadmin) see all; everyone else sees only rows they authored.
create policy "payroll_audit_log_select" on public.payroll_audit_log
  for select to authenticated
  using (public.payroll_is_manager_or_above() or actor_id = auth.uid());

-- Insert: any payroll-role holder may write an audit row. Service-role server writes bypass RLS.
create policy "payroll_audit_log_insert" on public.payroll_audit_log
  for insert to authenticated
  with check (public.payroll_get_role() is not null);

-- payroll_onboarding_audit: drop the blanket SELECT(true). admin_all_audit (role='admin') already
-- covers admin ALL; add a payroll_is_admin() SELECT so superadmin is not locked out (admin_all_audit
-- checks role='admin' literally and would exclude superadmin).
drop policy if exists "auth_read_audit" on public.payroll_onboarding_audit;
create policy "payroll_onboarding_audit_select" on public.payroll_onboarding_audit
  for select to authenticated
  using (public.payroll_is_admin());

-- ============================================================================================
-- ROLLBACK (emergency only — REINTRODUCES the always-true holes / removes the Group B writes):
--   -- (A) drop the Group B write policies:
--   drop policy if exists "payroll_global_config_write"       on public.payroll_global_config;
--   drop policy if exists "payroll_travel_premiums_write"     on public.payroll_travel_premiums;
--   drop policy if exists "payroll_spread_events_write"       on public.payroll_spread_events;
--   drop policy if exists "payroll_expense_submissions_write" on public.payroll_expense_submissions;
--   drop policy if exists "payroll_expense_items_write"       on public.payroll_expense_items;
--   drop policy if exists "payroll_expense_approvals_write"   on public.payroll_expense_approvals;
--   -- (B) restore the orphan blanket policies:
--   drop policy if exists "payroll_audit_log_select" on public.payroll_audit_log;
--   drop policy if exists "payroll_audit_log_insert" on public.payroll_audit_log;
--   create policy "payroll_audit_log_select" on public.payroll_audit_log for select to authenticated using (true);
--   create policy "payroll_audit_log_insert" on public.payroll_audit_log for insert to authenticated with check (true);
--   drop policy if exists "payroll_onboarding_audit_select" on public.payroll_onboarding_audit;
--   create policy "auth_read_audit" on public.payroll_onboarding_audit for select to authenticated using (true);
-- ============================================================================================
