-- New Project Wizard (PRP-06, CF-6): owner LLC -> Workyard customer id map.
-- Editable config so a project can be created under the correct Workyard
-- customer without hardcoding the mapping (DECISIONS_LOG §0.13).
--
-- STAGED — not yet applied to the shared prod DB. Apply via the Supabase MCP
-- as part of the New Project Wizard go-live, alongside 20260623_02 / _03.

create table if not exists public.payroll_workyard_customer_map (
  id              uuid primary key default gen_random_uuid(),
  owner_llc       text not null,
  org_customer_id integer not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (owner_llc)
);

create index if not exists payroll_workyard_customer_map_llc_idx
  on public.payroll_workyard_customer_map (owner_llc);

-- keep updated_at fresh
create or replace function public.payroll_workyard_customer_map_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_workyard_customer_map_touch on public.payroll_workyard_customer_map;
create trigger payroll_workyard_customer_map_touch
  before update on public.payroll_workyard_customer_map
  for each row execute function public.payroll_workyard_customer_map_touch();

alter table public.payroll_workyard_customer_map enable row level security;

drop policy if exists "payroll_workyard_customer_map_select" on public.payroll_workyard_customer_map;
create policy "payroll_workyard_customer_map_select" on public.payroll_workyard_customer_map
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_workyard_customer_map_write" on public.payroll_workyard_customer_map;
create policy "payroll_workyard_customer_map_write" on public.payroll_workyard_customer_map
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());
