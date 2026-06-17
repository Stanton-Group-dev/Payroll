-- 20260613_02_tighten_payroll_rls_drop_blanket_auth.sql
--
-- SECURITY FIX — removes the blanket "authenticated can do anything" policies that defeat RBAC.
-- Apply AFTER 20260613_01_harden_payroll_role_and_revoke_anon_dml.sql (the _01_ / _02_ sequence
-- tokens make the order explicit and runner-independent). _01_ makes payroll_get_role() fail closed;
-- this file (_02_) removes the blanket policies that OR away the granular role checks. Together they
-- restore real per-role authorization. If _02_ is applied before _01_, the surviving function-gated
-- write policies on Group A still fail open for unauthenticated callers until _01_ lands.
--
-- Run ONCE as the postgres superuser (the Supabase Dashboard SQL editor satisfies this). DROP/CREATE
-- POLICY require ownership of the target tables.
-- Stored CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push` /
-- `supabase migration up`, which wrap each migration in their own transaction. For an ATOMIC manual
-- run in the SQL editor, wrap the body yourself in BEGIN; ... COMMIT; (every statement is idempotent).
-- Locking: this takes a brief AccessExclusiveLock on each table per DROP/CREATE POLICY (22 + 7 = 29
-- statements). Sub-ms on an idle DB; under concurrent load each may queue behind in-flight queries —
-- prefer a low-traffic window.
--
-- Root cause:
--   Each of 22 payroll_* tables carried a PERMISSIVE policy with cmd=ALL, role=authenticated,
--   USING true, WITH CHECK true. Postgres combines permissive policies with OR, so `true OR <check>`
--   is always true — every granular payroll_is_manager_or_above()/payroll_is_admin() policy is a dead
--   letter, and any authenticated user could read AND write every row regardless of payroll role.
--   Dropping a USING(true)/WITH CHECK(true) permissive policy can only REDUCE access, never widen it.
--
-- Verified against live DB wkwmxxlfheywwbgdbzxe ("Stanton Main DB") on 2026-06-13 (pg_policies census
-- re-confirmed: exactly 22 blanket policies, 1:1 with the DROP list below, none missed, none extra).
-- The 22 tables split into two groups:
--
--   GROUP A (15 tables) — blanket policy named "<table>_auth". Each ALSO has a granular SELECT policy
--     (USING auth.uid() IS NOT NULL) and function-gated INSERT/UPDATE/DELETE policies. Dropping the
--     blanket leaves these fully functional under proper RBAC. No SELECT replacement needed.
--
--   GROUP B (7 tables) — blanket policy named "authenticated_access" and it is the ONLY policy on the
--     table. Dropping it leaves ZERO policies => RLS denies everything. This migration ADDS a SELECT
--     policy (auth.uid() IS NOT NULL) to each. It does NOT add write policies (none existed to "leave
--     in place"), so these tables become READ-ONLY until you choose write policies — see the
--     "WRITE-POLICY FOLLOW-UP" block below.
--
-- ============================================================================================
-- ⚠  DECISION REQUIRED BEFORE APPLYING TO PRODUCTION — these 7 GROUP B tables become READ-ONLY (all
--     writes denied) until you uncomment write policies. Applying as-is is FAIL-SAFE (no new exposure)
--     but HARD-BREAKS these live flows (verified against the code on 2026-06-13):
--       - Expense submission:        useExpenseSubmissions.ts:226 (submissions), :261 (items)
--       - All expense approval steps: useExpenseApprovals.ts:225,239,327,334,347,351,365,366,381,389
--                                     (approve / reject / request-correction / resolve-payment / route-to-bookkeeping)
--       - Global config saves:        useAdminGlobalConfig.ts:94-107  and  useExpenseSubmissions.ts:270-284
--       - Travel premium add/delete:  usePayrollTravelPremiums.ts:37-45, 50
--       - Spread / cost allocation:   useTimesheetAdjustments.ts:225-232 (payroll_spread_events INSERT)
--     payroll_cost_codes has NO app write path in src/ as of 2026-06-13 — it can stay read-only.
--     Recommended write policies are provided (commented) at the bottom. Uncomment the ones you want
--     BEFORE relying on those flows.
-- ============================================================================================
--
-- NOTE on the SELECT predicate: `auth.uid() IS NOT NULL` (with role `authenticated`) lets ANY
-- authenticated user read ALL rows — matching the existing convention on the 15 Group A tables. It is
-- NOT per-owner/per-portfolio scoping. For the expense tables this exposes PII (amounts, receipt URLs,
-- signatures) to all staff; tightening it (e.g. payroll_is_manager_or_above() OR created_by=auth.uid())
-- is a recommended follow-up once the write model is chosen.

-- --------------------------------------------------------------------------------------------
-- (1) DROP the 22 blanket ALL/true/true policies.
-- --------------------------------------------------------------------------------------------

-- GROUP A (15) — named "<table>_auth"; a granular SELECT + function-gated writes remain afterward.
drop policy if exists "payroll_adjustments_auth"            on public.payroll_adjustments;
drop policy if exists "payroll_adp_reconciliation_auth"     on public.payroll_adp_reconciliation;
drop policy if exists "payroll_approvals_auth"              on public.payroll_approvals;
drop policy if exists "payroll_dept_split_overrides_auth"   on public.payroll_dept_split_overrides;
drop policy if exists "payroll_employee_dept_splits_auth"   on public.payroll_employee_dept_splits;
drop policy if exists "payroll_employee_rates_auth"         on public.payroll_employee_rates;
drop policy if exists "payroll_employees_auth"              on public.payroll_employees;
drop policy if exists "payroll_external_projects_auth"      on public.payroll_external_projects;
drop policy if exists "payroll_invoice_line_items_auth"     on public.payroll_invoice_line_items;
drop policy if exists "payroll_invoices_auth"               on public.payroll_invoices;
drop policy if exists "payroll_management_fee_config_auth"  on public.payroll_management_fee_config;
drop policy if exists "payroll_time_entries_auth"           on public.payroll_time_entries;
drop policy if exists "payroll_timesheet_corrections_auth"  on public.payroll_timesheet_corrections;
drop policy if exists "payroll_weekly_property_costs_auth"  on public.payroll_weekly_property_costs;
drop policy if exists "payroll_weeks_auth"                  on public.payroll_weeks;

-- GROUP B (7) — named "authenticated_access"; this is the ONLY policy on each of these tables.
drop policy if exists "authenticated_access" on public.payroll_cost_codes;
drop policy if exists "authenticated_access" on public.payroll_global_config;
drop policy if exists "authenticated_access" on public.payroll_travel_premiums;
drop policy if exists "authenticated_access" on public.payroll_spread_events;
drop policy if exists "authenticated_access" on public.payroll_expense_submissions;
drop policy if exists "authenticated_access" on public.payroll_expense_items;
drop policy if exists "authenticated_access" on public.payroll_expense_approvals;

-- --------------------------------------------------------------------------------------------
-- (2) ADD a replacement SELECT policy for the 7 GROUP B tables (they had no SELECT policy of
--     their own). Authenticated users can read; writes remain denied until policies are added.
--     drop-then-create keeps this idempotent (CREATE POLICY has no IF NOT EXISTS).
--     TODO(follow-up): tighten these from all-authenticated to per-owner/per-portfolio scoping.
-- --------------------------------------------------------------------------------------------

drop policy if exists "payroll_cost_codes_select" on public.payroll_cost_codes;
create policy "payroll_cost_codes_select" on public.payroll_cost_codes
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_global_config_select" on public.payroll_global_config;
create policy "payroll_global_config_select" on public.payroll_global_config
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_travel_premiums_select" on public.payroll_travel_premiums;
create policy "payroll_travel_premiums_select" on public.payroll_travel_premiums
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_spread_events_select" on public.payroll_spread_events;
create policy "payroll_spread_events_select" on public.payroll_spread_events
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_expense_submissions_select" on public.payroll_expense_submissions;
create policy "payroll_expense_submissions_select" on public.payroll_expense_submissions
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_expense_items_select" on public.payroll_expense_items;
create policy "payroll_expense_items_select" on public.payroll_expense_items
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_expense_approvals_select" on public.payroll_expense_approvals;
create policy "payroll_expense_approvals_select" on public.payroll_expense_approvals
  for select to authenticated using (auth.uid() is not null);

-- ============================================================================================
-- WRITE-POLICY FOLLOW-UP (NOT enabled — choose, then uncomment). DECISION REQUIRED before the 7
-- Group B write flows above will work. These candidates mirror the function-gated pattern already on
-- the 15 Group A tables and are STRICTLY more restrictive than the dropped blanket-true policy, so
-- enabling them cannot widen access. Apply _01_harden first so the role functions fail closed.
-- (If kept as a manual SQL-editor step, wrap whatever you uncomment in your own BEGIN; ... COMMIT;.)
--
-- Writer identity was verified in code: all current Supabase Auth users are payroll staff
-- (admin / manager / bookkeeper); payroll_employees are a SEPARATE table with no Auth accounts; the
-- expense UI is manager-operated (employee chosen from a dropdown), NOT self-service. So OPTION A
-- below is the right model today. OPTION B (self-service) is only needed if employees ever get logins.
--
-- ⚠ ROLE CAVEAT: payroll_is_manager_or_above() = role IN ('admin','manager') and EXCLUDES 'bookkeeper'.
--   If bookkeepers perform any expense action (e.g. route-to-bookkeeping, resolve-payment), use the
--   "any payroll-role holder" gate `public.payroll_get_role() is not null` instead of manager_or_above
--   for the expense tables. Confirm against your operating model before choosing.
--
-- ---- Config / operational tables ----
--   -- payroll_global_config — admin recommended (controls global cutoff). If managers also save cutoff
--   --   config from the expenses page (useExpenseSubmissions.saveConfig), use payroll_is_manager_or_above().
--   create policy "payroll_global_config_write" on public.payroll_global_config
--     for all to authenticated using (public.payroll_is_admin()) with check (public.payroll_is_admin());
--   -- payroll_travel_premiums — admin (rate config). Use payroll_is_manager_or_above() if managers edit rates.
--   create policy "payroll_travel_premiums_write" on public.payroll_travel_premiums
--     for all to authenticated using (public.payroll_is_admin()) with check (public.payroll_is_admin());
--   -- payroll_spread_events — manager_or_above (written during manager-operated cost allocation).
--   create policy "payroll_spread_events_write" on public.payroll_spread_events
--     for all to authenticated using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());
--   -- payroll_cost_codes — no app write path found (2026-06-13); leave read-only until a use case exists.
--   --   If a backend/seed/admin process writes it, add an admin- or service-gated policy then.
--
-- ---- Expense flow — OPTION A (manager-operated; recommended today) ----
--   -- Swap payroll_is_manager_or_above() -> (public.payroll_get_role() is not null) if bookkeepers write (see caveat).
--   create policy "payroll_expense_submissions_write" on public.payroll_expense_submissions
--     for all to authenticated using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());
--   create policy "payroll_expense_items_write" on public.payroll_expense_items
--     for all to authenticated using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());
--   create policy "payroll_expense_approvals_write" on public.payroll_expense_approvals
--     for all to authenticated using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());
--
-- ---- Expense flow — OPTION B (self-service; only if employees get Auth logins later) ----
--   -- Also tighten the expense SELECT policies to own-rows, and note: the items EXISTS-subquery below
--   -- re-evaluates the submissions SELECT policy under RLS — if you later scope submissions SELECT to
--   -- own-rows, route the ownership join through a SECURITY DEFINER helper to avoid blocking managers.
--   create policy "payroll_expense_submissions_write_self" on public.payroll_expense_submissions
--     for all to authenticated
--     using (created_by = auth.uid() or public.payroll_is_manager_or_above())
--     with check (created_by = auth.uid() or public.payroll_is_manager_or_above());
--   create policy "payroll_expense_items_write_self" on public.payroll_expense_items
--     for all to authenticated
--     using (public.payroll_is_manager_or_above() or exists (
--       select 1 from public.payroll_expense_submissions s
--       where s.id = payroll_expense_items.submission_id and s.created_by = auth.uid()))
--     with check (public.payroll_is_manager_or_above() or exists (
--       select 1 from public.payroll_expense_submissions s
--       where s.id = payroll_expense_items.submission_id and s.created_by = auth.uid()));
--   -- approvals are an approver action -> manager-or-above only, even under self-service:
--   create policy "payroll_expense_approvals_write" on public.payroll_expense_approvals
--     for all to authenticated using (public.payroll_is_manager_or_above()) with check (public.payroll_is_manager_or_above());
-- ============================================================================================
-- PRE-EXISTING POSTURE NOTES (unmasked by dropping the blanket; address in a separate follow-up):
--   - payroll_adp_reconciliation INSERT (WITH CHECK auth.uid() IS NOT NULL) and UPDATE (USING
--     auth.uid() IS NOT NULL) are weaker than every other Group A table (which gate on the role
--     functions). After this migration that "any authenticated" rule is load-bearing. Tighten both to
--     payroll_is_manager_or_above() in a follow-up.
--   - payroll_approvals and payroll_timesheet_corrections have NO DELETE policy. The blanket was
--     supplying delete; post-drop, deletes are denied (immutability — likely desirable, but confirm no
--     app flow deletes from them; add a manager-gated DELETE policy if needed).
--   - All 15 Group A INSERT/UPDATE/DELETE policies bind to role PUBLIC (not authenticated). Harmless
--     once _01_harden lands (the function checks reject anon), but the intent is clearly `authenticated`;
--     ALTER them in a follow-up.
-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
-- ⚠ ATOMICITY: run the ENTIRE block below together (wrap in BEGIN; ... COMMIT; for a manual run). A
--   partial rollback — e.g. dropping the 7 SELECT policies but not recreating the 22 blanket policies —
--   leaves Group B tables deny-all.
-- ⚠ Recreating the blanket policies REINTRODUCES the vulnerability this migration closes — emergency only.
--   -- drop the SELECT policies added in step (2):
--   drop policy if exists "payroll_cost_codes_select"          on public.payroll_cost_codes;
--   drop policy if exists "payroll_global_config_select"       on public.payroll_global_config;
--   drop policy if exists "payroll_travel_premiums_select"     on public.payroll_travel_premiums;
--   drop policy if exists "payroll_spread_events_select"       on public.payroll_spread_events;
--   drop policy if exists "payroll_expense_submissions_select" on public.payroll_expense_submissions;
--   drop policy if exists "payroll_expense_items_select"       on public.payroll_expense_items;
--   drop policy if exists "payroll_expense_approvals_select"   on public.payroll_expense_approvals;
--   -- recreate the 15 GROUP A blanket policies:
--   create policy "payroll_adjustments_auth"           on public.payroll_adjustments           for all to authenticated using (true) with check (true);
--   create policy "payroll_adp_reconciliation_auth"    on public.payroll_adp_reconciliation    for all to authenticated using (true) with check (true);
--   create policy "payroll_approvals_auth"             on public.payroll_approvals             for all to authenticated using (true) with check (true);
--   create policy "payroll_dept_split_overrides_auth"  on public.payroll_dept_split_overrides  for all to authenticated using (true) with check (true);
--   create policy "payroll_employee_dept_splits_auth"  on public.payroll_employee_dept_splits  for all to authenticated using (true) with check (true);
--   create policy "payroll_employee_rates_auth"        on public.payroll_employee_rates        for all to authenticated using (true) with check (true);
--   create policy "payroll_employees_auth"             on public.payroll_employees             for all to authenticated using (true) with check (true);
--   create policy "payroll_external_projects_auth"     on public.payroll_external_projects     for all to authenticated using (true) with check (true);
--   create policy "payroll_invoice_line_items_auth"    on public.payroll_invoice_line_items    for all to authenticated using (true) with check (true);
--   create policy "payroll_invoices_auth"              on public.payroll_invoices              for all to authenticated using (true) with check (true);
--   create policy "payroll_management_fee_config_auth" on public.payroll_management_fee_config for all to authenticated using (true) with check (true);
--   create policy "payroll_time_entries_auth"          on public.payroll_time_entries          for all to authenticated using (true) with check (true);
--   create policy "payroll_timesheet_corrections_auth" on public.payroll_timesheet_corrections for all to authenticated using (true) with check (true);
--   create policy "payroll_weekly_property_costs_auth" on public.payroll_weekly_property_costs for all to authenticated using (true) with check (true);
--   create policy "payroll_weeks_auth"                 on public.payroll_weeks                 for all to authenticated using (true) with check (true);
--   -- recreate the 7 GROUP B blanket policies:
--   create policy "authenticated_access" on public.payroll_cost_codes          for all to authenticated using (true) with check (true);
--   create policy "authenticated_access" on public.payroll_global_config       for all to authenticated using (true) with check (true);
--   create policy "authenticated_access" on public.payroll_travel_premiums     for all to authenticated using (true) with check (true);
--   create policy "authenticated_access" on public.payroll_spread_events       for all to authenticated using (true) with check (true);
--   create policy "authenticated_access" on public.payroll_expense_submissions for all to authenticated using (true) with check (true);
--   create policy "authenticated_access" on public.payroll_expense_items       for all to authenticated using (true) with check (true);
--   create policy "authenticated_access" on public.payroll_expense_approvals   for all to authenticated using (true) with check (true);
-- ============================================================================================
