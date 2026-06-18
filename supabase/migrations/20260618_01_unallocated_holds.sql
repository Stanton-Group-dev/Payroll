-- 20260618_01_unallocated_holds.sql
--
-- Unallocated-hours payroll hold + employee notification.
--
-- Policy: when an employee leaves hours unallocated (time entries with no
-- property) above a small threshold, the whole employee is PULLED from the pay
-- run for that week — they are paid nothing until they come into the office with
-- a written reason explaining why the hours weren't allocated. They're texted to
-- that effect. Allocated work on a held employee is also withheld from billing,
-- since you can't bill labor you didn't pay (the calc drops the employee whole).
--
-- Two tables:
--   payroll_employee_holds  : one row per (week, employee) that is held/released,
--                             carrying the unallocated-hour count and the written
--                             reason captured when the hold is released.
--   payroll_notifications   : an outbox of messages (SMS today). A row is written
--                             whether the message was actually sent, dry-run, or
--                             skipped, so there is an audit trail of what each
--                             employee was told and when.
--
-- RLS follows the established payroll convention (see 20260613_02 / 20260616_02):
--   SELECT -> any authenticated user; WRITE -> manager_or_above (function-gated).
-- Assumes 20260613_01 + 20260617_01 are applied so the role helpers exist and
-- include superadmin.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`.
-- Idempotent.

-- --------------------------------------------------------------------------------------------
-- (1) Per-(week, employee) hold record.
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_employee_holds (
  id                 uuid primary key default gen_random_uuid(),
  payroll_week_id    uuid not null references public.payroll_weeks(id) on delete cascade,
  employee_id        uuid not null references public.payroll_employees(id) on delete cascade,
  -- Why the employee was pulled. 'unallocated_hours' is the only producer today;
  -- kept as text so future hold reasons don't need a migration.
  reason             text not null default 'unallocated_hours',
  -- Snapshot of unallocated hours at the moment the hold was applied.
  unallocated_hours  numeric not null default 0,
  status             text not null default 'held'
                       check (status in ('held', 'released')),
  held_by            uuid references auth.users(id),
  held_at            timestamptz not null default now(),
  -- The written reason the employee brings to the office; set when the hold is released.
  resolution_note    text,
  released_by        uuid references auth.users(id),
  released_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (payroll_week_id, employee_id)
);

create index if not exists payroll_employee_holds_week_idx
  on public.payroll_employee_holds (payroll_week_id);

create index if not exists payroll_employee_holds_active_idx
  on public.payroll_employee_holds (payroll_week_id, status);

-- --------------------------------------------------------------------------------------------
-- (2) Notification outbox (SMS today; channel column leaves room for email later).
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_notifications (
  id                 uuid primary key default gen_random_uuid(),
  payroll_week_id    uuid references public.payroll_weeks(id) on delete set null,
  employee_id        uuid not null references public.payroll_employees(id) on delete cascade,
  channel            text not null default 'sms'
                       check (channel in ('sms', 'email')),
  -- What we addressed it to (phone snapshot), and the exact body sent.
  to_address         text,
  body               text not null,
  -- 'sent'    : provider accepted it
  -- 'dry_run' : composed + recorded, but no provider configured (or mock forced)
  -- 'skipped' : no destination (e.g. employee has no phone on file)
  -- 'failed'  : provider rejected it (see error)
  status             text not null default 'queued'
                       check (status in ('queued', 'sent', 'dry_run', 'skipped', 'failed')),
  provider           text,                  -- 'twilio' | 'mock' | null
  provider_ref       text,                  -- e.g. Twilio message SID
  error              text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);

create index if not exists payroll_notifications_week_idx
  on public.payroll_notifications (payroll_week_id);

create index if not exists payroll_notifications_employee_idx
  on public.payroll_notifications (employee_id, created_at desc);

-- --------------------------------------------------------------------------------------------
-- (3) updated_at trigger for holds (mirrors the pattern used elsewhere).
-- --------------------------------------------------------------------------------------------

create or replace function public.payroll_employee_holds_touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_employee_holds_touch on public.payroll_employee_holds;
create trigger payroll_employee_holds_touch
  before update on public.payroll_employee_holds
  for each row execute function public.payroll_employee_holds_touch_updated_at();

-- --------------------------------------------------------------------------------------------
-- (4) RLS: read all-authenticated, write manager-or-above.
-- --------------------------------------------------------------------------------------------

alter table public.payroll_employee_holds enable row level security;
alter table public.payroll_notifications  enable row level security;

drop policy if exists "payroll_employee_holds_select" on public.payroll_employee_holds;
create policy "payroll_employee_holds_select" on public.payroll_employee_holds
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_employee_holds_write" on public.payroll_employee_holds;
create policy "payroll_employee_holds_write" on public.payroll_employee_holds
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

drop policy if exists "payroll_notifications_select" on public.payroll_notifications;
create policy "payroll_notifications_select" on public.payroll_notifications
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_notifications_write" on public.payroll_notifications;
create policy "payroll_notifications_write" on public.payroll_notifications
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   drop table if exists public.payroll_notifications;
--   drop table if exists public.payroll_employee_holds;
--   drop function if exists public.payroll_employee_holds_touch_updated_at();
-- ============================================================================================
