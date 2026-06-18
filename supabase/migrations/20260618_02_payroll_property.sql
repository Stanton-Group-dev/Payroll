-- 20260618_02_payroll_property.sql
--
-- payroll_property: the payroll app's curated, AppFolio-proof property record.
--
-- WHY: `properties` is the shared platform spine (its id is referenced by ~41 tables across
-- leasing/MOC/TR/PM/accounting/payroll) AND the AppFolio import target. AppFolio re-imports
-- keep wiping manual billing corrections (owner LLC, include_in_invoicing) and the junk
-- placeholder rows can't be deleted in AppFolio. So payroll owns a 1:1 overlay, keyed by
-- property_id (= the shared properties.id). AppFolio only ever writes `properties`; payroll
-- only ever trusts `payroll_property`. Corrections made here are permanent.
--
-- New AppFolio buildings flow in via payroll_property_reconcile() — insert-missing ONLY, so a
-- curated row is never clobbered.
--
-- RLS follows the established payroll convention (see 20260618_01 / 20260616_02):
--   SELECT -> any authenticated user; WRITE -> manager_or_above.
-- Assumes 20260613_01_harden_payroll_role_and_revoke_anon_dml.sql is applied so the role
-- helper functions fail closed.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`. Idempotent.

-- --------------------------------------------------------------------------------------------
-- (1) The curated overlay table.
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_property (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties(id) on delete cascade,
  appfolio_property_id text,                                    -- durable backup link to AppFolio
  code                 text,
  name                 text,
  address              text,
  total_units          integer,
  portfolio_id         text,                                   -- portfolios.id is text (e.g. af-portfolio-6)
  owner_llc            text,                                   -- the billing entity (replaces billing_llc)
  include_in_invoicing boolean not null default true,
  is_active            boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  updated_by           uuid references auth.users(id),
  unique (property_id)
);

create index if not exists payroll_property_property_idx  on public.payroll_property (property_id);
create index if not exists payroll_property_code_idx      on public.payroll_property (code);
create index if not exists payroll_property_owner_llc_idx on public.payroll_property (owner_llc);

-- --------------------------------------------------------------------------------------------
-- (2) updated_at trigger (same pattern as payroll_employee_holds_touch).
-- --------------------------------------------------------------------------------------------

create or replace function public.payroll_property_touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_property_touch on public.payroll_property;
create trigger payroll_property_touch
  before update on public.payroll_property
  for each row execute function public.payroll_property_touch_updated_at();

-- --------------------------------------------------------------------------------------------
-- (3) Reconcile: insert a curated row for every property that doesn't have one yet.
--     NEVER updates an existing row -> curated corrections are immortal across AppFolio syncs.
--     Mirrors the isNonBillableProperty() gate (code 000 / test / delete… / zz…) plus units<=1,
--     so junk and tiny rows seed as excluded.
-- --------------------------------------------------------------------------------------------

create or replace function public.payroll_property_reconcile()
  returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  insert into public.payroll_property
    (property_id, appfolio_property_id, code, name, address, total_units, portfolio_id,
     owner_llc, include_in_invoicing, is_active)
  select
    p.id,
    p.appfolio_property_id,
    p.code,
    p.name,
    p.address,
    p.total_units,
    p.portfolio_id,
    coalesce(nullif(trim(p.billing_llc), ''), nullif(trim(pf.owner_llc), '')),
    case
      when lower(trim(coalesce(p.code, ''))) = '000'
        or lower(trim(coalesce(p.name, ''))) like '%test property%'
        or lower(trim(coalesce(p.code, ''))) like 'delete%'
        or lower(trim(coalesce(p.name, ''))) like 'delete%'
        or lower(trim(coalesce(p.code, ''))) = 'zz'
        or lower(trim(coalesce(p.name, ''))) like 'zz -%'
        or lower(trim(coalesce(p.name, ''))) like 'zz-%'
        or coalesce(p.total_units, 0) <= 1
      then false
      else coalesce(p.include_in_invoicing, true)
    end,
    coalesce(p.is_active, true)
  from public.properties p
  left join public.portfolios pf on pf.id = p.portfolio_id
  where not exists (
    select 1 from public.payroll_property pp where pp.property_id = p.id
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- --------------------------------------------------------------------------------------------
-- (4) Seed.
-- --------------------------------------------------------------------------------------------

-- 4a. First reconcile inserts a curated row for every current property.
select public.payroll_property_reconcile();

-- 4b. Apply the authoritative Asset ID -> Owner LLC mapping (S0001-S0067), including the
--     granular Westend 81 / 77 / Oxford split. Keyed by code but joined through property_id and
--     skipping the "…Bookkeeping" aggregate, so the duplicate S0042 row is disambiguated.
with canonical(code, owner_llc) as (values
  ('S0001','STANTON REP 90 PARK STREET HARTFORD LLC'),
  ('S0002','SREP SOUTHEND 1 LLC'),('S0003','SREP SOUTHEND 2 LLC'),('S0004','SREP SOUTHEND 2 LLC'),
  ('S0005','SREP SOUTHEND 2 LLC'),('S0006','SREP SOUTHEND 3 LLC'),('S0007','SREP SOUTHEND 3 LLC'),
  ('S0008','SREP SOUTHEND 3 LLC'),('S0009','SREP SOUTHEND LLC'),('S0010','SREP Hartford 1 LLC'),
  ('S0011','SREP NORTHEND LLC'),('S0012','SREP NORTHEND LLC'),('S0013','SREP NORTHEND LLC'),
  ('S0014','SREP NORTHEND LLC'),('S0015','SREP NORTHEND LLC'),('S0016','SREP NORTHEND LLC'),
  ('S0017','SREP NORTHEND LLC'),('S0018','SREP NORTHEND LLC'),('S0019','SREP Hartford 1 LLC'),
  ('S0020','SREP Park 1 LLC'),('S0021','SREP Park 2 LLC'),('S0022','SREP Park 3 LLC'),
  ('S0023','SREP Park 4 LLC'),('S0024','SREP Park 5 LLC'),('S0025','SREP PARK 6 LLC'),
  ('S0026','SREP PARK 7 LLC'),('S0027','SREP PARK 7 LLC'),('S0028','SREP PARK 7 LLC'),
  ('S0029','SREP PARK 7 LLC'),('S0030','SREP PARK 8 LLC'),('S0031','SREP PARK 9 LLC'),
  ('S0032','SREP PARK 9 LLC'),('S0033','SREP PARK 10 LLC'),('S0034','SREP PARK 10 LLC'),
  ('S0035','SREP PARK 10 LLC'),('S0036','SREP PARK 10 LLC'),('S0037','SREP PARK 10 LLC'),
  ('S0038','SREP PARK 10 LLC'),('S0039','SREP PARK 10 LLC'),('S0040','SREP PARK 11 LLC'),
  ('S0041','SREP PARK 12 LLC'),
  ('S0042','SREP Westend 81 LLC'),('S0043','SREP Westend 81 LLC'),('S0044','SREP Westend 81 LLC'),
  ('S0045','SREP Westend 81 LLC'),('S0046','SREP Westend 81 LLC'),('S0047','SREP Westend 77 LLC'),
  ('S0048','SREP Westend 81 LLC'),('S0049','SREP Westend 81 LLC'),('S0050','SREP Westend 81 LLC'),
  ('S0051','SREP Westend 81 LLC'),('S0052','SREP Westend 81 LLC'),('S0053','SREP Westend 81 LLC'),
  ('S0054','SREP Westend 81 LLC'),('S0055','SREP Westend 77 LLC'),('S0056','SREP Westend 77 LLC'),
  ('S0057','SREP Westend 77 LLC'),('S0058','SREP Westend 77 LLC'),('S0059','SREP Westend 77 LLC'),
  ('S0060','SREP Westend 77 LLC'),('S0061','SREP Westend 77 LLC'),('S0062','SREP Westend 77 LLC'),
  ('S0063','SREP Westend 77 LLC'),('S0064','SREP Westend 77 LLC'),('S0065','SREP Westend 77 LLC'),
  ('S0066','SREP Westend Oxford LLC'),('S0067','SREP Westend Oxford LLC')
)
update public.payroll_property pp
set owner_llc = c.owner_llc
from canonical c
join public.properties p
  on trim(p.code) = c.code and coalesce(p.name, '') not ilike '%bookkeeping%'
where pp.property_id = p.id
  and pp.owner_llc is distinct from c.owner_llc;

-- 4c. Force-exclude the Westend portfolio bookkeeping aggregate durably (immune to AppFolio).
update public.payroll_property pp
set include_in_invoicing = false
from public.properties p
where pp.property_id = p.id
  and coalesce(p.name, '') ilike '%bookkeeping%'
  and pp.include_in_invoicing is distinct from false;

-- --------------------------------------------------------------------------------------------
-- (5) RLS.
-- --------------------------------------------------------------------------------------------

alter table public.payroll_property enable row level security;

drop policy if exists "payroll_property_select" on public.payroll_property;
create policy "payroll_property_select" on public.payroll_property
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_property_write" on public.payroll_property;
create policy "payroll_property_write" on public.payroll_property
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   drop function if exists public.payroll_property_reconcile();
--   drop function if exists public.payroll_property_touch_updated_at() cascade;
--   drop table if exists public.payroll_property;
-- ============================================================================================
