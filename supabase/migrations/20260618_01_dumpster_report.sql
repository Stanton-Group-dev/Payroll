-- 20260618_01_dumpster_report.sql
--
-- Dumpster sizing report (DUMPSTER_ANALYSIS_PRD.md).
--   * payroll_property_dumpsters  : per-property dumpster config — which properties have a
--       dumpster, its size, and the monthly contractor (rental/haul) cost. This is the manual
--       input the PRD calls for (tier/price is a manual input, not live-ingested).
--   * payroll_dumpster_config     : single-row global config holding the loaded labor rate used
--       to convert overflow-hauling hours into dollars. Effective-dated history is overkill here;
--       one editable row is enough (mirrors how a single tunable knob is kept elsewhere).
--
-- The report itself reads overflow hours live from Workyard (DUMP cost code, by property) — no
-- payroll data is touched, and nothing here affects invoicing. Purely additive.
--
-- RLS follows the established payroll convention (see 20260613_02 / 20260616_02):
--   SELECT -> any authenticated user; WRITE -> manager_or_above (operational config).
-- Assumes 20260613_01_harden_payroll_role_and_revoke_anon_dml.sql is applied so the role
-- helper functions fail closed.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`. Idempotent.

-- --------------------------------------------------------------------------------------------
-- (1) Per-property dumpster config (the manual inputs).
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_property_dumpsters (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.properties(id) on delete cascade,
  has_dumpster     boolean not null default true,
  size_label       text,                                   -- free-form, e.g. "6 yd", "20 yd", "2x 8 yd"
  monthly_cost     numeric not null default 0 check (monthly_cost >= 0),  -- contractor cost / month
  pickups_per_week numeric check (pickups_per_week is null or pickups_per_week >= 0),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_by       uuid references auth.users(id),
  unique (property_id)
);

create index if not exists payroll_property_dumpsters_property_idx
  on public.payroll_property_dumpsters (property_id);

-- --------------------------------------------------------------------------------------------
-- (2) Global loaded-labor-rate config (single row).
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_dumpster_config (
  id                uuid primary key default gen_random_uuid(),
  loaded_labor_rate numeric not null default 45 check (loaded_labor_rate >= 0),  -- $/hr, burden incl.
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id)
);

-- Seed exactly one row. Safe to re-run: only seeds when empty.
insert into public.payroll_dumpster_config (loaded_labor_rate)
select 45
where not exists (select 1 from public.payroll_dumpster_config);

-- --------------------------------------------------------------------------------------------
-- (3) RLS.
-- --------------------------------------------------------------------------------------------

alter table public.payroll_property_dumpsters enable row level security;
alter table public.payroll_dumpster_config    enable row level security;

drop policy if exists "payroll_property_dumpsters_select" on public.payroll_property_dumpsters;
create policy "payroll_property_dumpsters_select" on public.payroll_property_dumpsters
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_property_dumpsters_write" on public.payroll_property_dumpsters;
create policy "payroll_property_dumpsters_write" on public.payroll_property_dumpsters
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

drop policy if exists "payroll_dumpster_config_select" on public.payroll_dumpster_config;
create policy "payroll_dumpster_config_select" on public.payroll_dumpster_config
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_dumpster_config_write" on public.payroll_dumpster_config;
create policy "payroll_dumpster_config_write" on public.payroll_dumpster_config
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   drop table if exists public.payroll_property_dumpsters;
--   drop table if exists public.payroll_dumpster_config;
-- ============================================================================================
