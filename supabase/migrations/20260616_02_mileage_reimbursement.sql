-- 20260616_02_mileage_reimbursement.sql
--
-- Mileage reimbursement feature.
--   * Captures raw miles per Workyard time-entry row (so each mile already carries its property).
--   * Adds an effective-dated mileage rate config (default $0.73/mi), mirroring
--     payroll_management_fee_config.
--   * Adds a per-employee eligibility flag (the "who generally gets mileage" roster).
--   * Adds a per-(week, employee) review record with editable approved-miles and an
--     approve/deny status, so a manager can trim miles and decide per run.
--
-- Pay + billing: approved mileage is added to the employee's gross AND allocated to
-- properties proportional to where the employee logged miles (scaled to approved miles).
-- That allocation is computed at calc time from payroll_time_entries.miles — no extra
-- columns needed here.
--
-- RLS follows the established payroll convention (see 20260613_02):
--   SELECT -> any authenticated user; WRITE -> function-gated.
--     payroll_mileage_rates           : admin only            (rate config)
--     payroll_mileage_reimbursements  : manager_or_above      (manager-operated review)
-- Assumes 20260613_01_harden_payroll_role_and_revoke_anon_dml.sql is applied so the
-- role helper functions fail closed.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`. For an
-- atomic manual run in the SQL editor, wrap the body in BEGIN; ... COMMIT;. Idempotent.

-- --------------------------------------------------------------------------------------------
-- (1) Capture columns on existing tables.
-- --------------------------------------------------------------------------------------------

alter table public.payroll_time_entries
  add column if not exists miles numeric not null default 0;

alter table public.payroll_employees
  add column if not exists mileage_eligible boolean not null default false;

-- --------------------------------------------------------------------------------------------
-- (2) Effective-dated mileage rate config.
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_mileage_rates (
  id             uuid primary key default gen_random_uuid(),
  rate_per_mile  numeric not null check (rate_per_mile >= 0),
  effective_date date not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index if not exists payroll_mileage_rates_effective_idx
  on public.payroll_mileage_rates (effective_date desc);

-- Seed the current IRS-style rate, effective today. Safe to re-run: only seeds when empty.
insert into public.payroll_mileage_rates (rate_per_mile, effective_date)
select 0.73, current_date
where not exists (select 1 from public.payroll_mileage_rates);

-- --------------------------------------------------------------------------------------------
-- (3) Per-(week, employee) reimbursement review record.
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_mileage_reimbursements (
  id              uuid primary key default gen_random_uuid(),
  payroll_week_id uuid not null references public.payroll_weeks(id) on delete cascade,
  employee_id     uuid not null references public.payroll_employees(id) on delete cascade,
  miles_raw       numeric not null default 0,          -- summed Workyard miles at review time
  miles_approved  numeric not null default 0,          -- editable; <= raw means miles were trimmed
  rate_per_mile   numeric not null default 0,          -- snapshot of the effective rate
  amount          numeric not null default 0,          -- miles_approved * rate_per_mile
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'denied')),
  notes           text,
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (payroll_week_id, employee_id)
);

create index if not exists payroll_mileage_reimbursements_week_idx
  on public.payroll_mileage_reimbursements (payroll_week_id);

-- --------------------------------------------------------------------------------------------
-- (4) RLS.
-- --------------------------------------------------------------------------------------------

alter table public.payroll_mileage_rates          enable row level security;
alter table public.payroll_mileage_reimbursements enable row level security;

-- payroll_mileage_rates: read all-authenticated, write admin-only.
drop policy if exists "payroll_mileage_rates_select" on public.payroll_mileage_rates;
create policy "payroll_mileage_rates_select" on public.payroll_mileage_rates
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_mileage_rates_write" on public.payroll_mileage_rates;
create policy "payroll_mileage_rates_write" on public.payroll_mileage_rates
  for all to authenticated
  using (public.payroll_is_admin())
  with check (public.payroll_is_admin());

-- payroll_mileage_reimbursements: read all-authenticated, write manager-or-above.
drop policy if exists "payroll_mileage_reimbursements_select" on public.payroll_mileage_reimbursements;
create policy "payroll_mileage_reimbursements_select" on public.payroll_mileage_reimbursements
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_mileage_reimbursements_write" on public.payroll_mileage_reimbursements;
create policy "payroll_mileage_reimbursements_write" on public.payroll_mileage_reimbursements
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   drop table if exists public.payroll_mileage_reimbursements;
--   drop table if exists public.payroll_mileage_rates;
--   alter table public.payroll_employees    drop column if exists mileage_eligible;
--   alter table public.payroll_time_entries drop column if exists miles;
-- ============================================================================================
