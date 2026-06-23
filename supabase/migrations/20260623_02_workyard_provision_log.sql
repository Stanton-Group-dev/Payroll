-- New Project Wizard (PRP-06, CF-9): append-only audit of what the onboarding
-- wizard provisioned in Workyard, and the returned ids. Lets a later run know
-- the project id without re-deriving it by name.
--
-- STAGED — not yet applied to the shared prod DB.

create table if not exists public.payroll_workyard_provision_log (
  id                    uuid primary key default gen_random_uuid(),
  property_code         text not null,
  workyard_project_id   text,
  workyard_cost_code_id text,
  project_action        text not null,   -- 'created' | 'skipped' | 'preview'
  cost_code_action      text not null,   -- 'created' | 'skipped' | 'preview'
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now()
);

create index if not exists payroll_workyard_provision_log_code_idx
  on public.payroll_workyard_provision_log (property_code);

alter table public.payroll_workyard_provision_log enable row level security;

drop policy if exists "payroll_workyard_provision_log_select" on public.payroll_workyard_provision_log;
create policy "payroll_workyard_provision_log_select" on public.payroll_workyard_provision_log
  for select to authenticated using (auth.uid() is not null);

-- append-only by design: managers/admins may insert; no update/delete policy.
drop policy if exists "payroll_workyard_provision_log_insert" on public.payroll_workyard_provision_log;
create policy "payroll_workyard_provision_log_insert" on public.payroll_workyard_provision_log
  for insert to authenticated
  with check (public.payroll_is_manager_or_above());
