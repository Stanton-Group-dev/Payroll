-- 20260630_01_daily_allocations.sql
--
-- Daily allocation catch-up table.
--
-- Lets a manager (e.g. Dean) review yesterday's Workyard time cards that came in
-- with NO building attached, and assign each to one building or split across
-- several buildings. The weekly import path consults this table when it encounters
-- a still-unallocated card, applying the saved allocation before inserting the
-- entry so the card lands in the right property from the start.
--
-- One row per leg; a single time card can have multiple rows (a split). The
-- workyard_timecardid+property_id combination is unique within a save: re-saving
-- a card first deletes all prior rows for that timecardid, then inserts the new
-- legs (delete-then-insert pattern enforced in the API route, not by a constraint).
--
-- RLS follows the established payroll convention (see 20260613_02 / 20260617_03):
--   SELECT -> any authenticated user; WRITE -> manager_or_above (function-gated).
-- Assumes role helpers (payroll_is_manager_or_above) are live.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`.
-- Idempotent.

-- --------------------------------------------------------------------------------------------
-- (1) Daily allocation table.
-- --------------------------------------------------------------------------------------------

create table if not exists public.payroll_daily_allocations (
  id                    uuid primary key default gen_random_uuid(),
  -- The Workyard time card ID — string, as it arrives from the API ("123456").
  workyard_timecardid   text not null,
  -- Which property this leg is allocated to.
  property_id           uuid not null references public.payroll_property(property_id) on delete cascade,
  -- The fraction of total hours assigned to this leg. Legs for the same card must
  -- sum to 1.0 (enforced by the API, not a DB constraint, because a partial save
  -- would trip the constraint mid-insert). Stored as numeric(5,4) (e.g. 0.7500).
  fraction              numeric(5,4) not null check (fraction > 0 and fraction <= 1),
  -- The calendar date of the original shift (YYYY-MM-DD). Redundant with the card
  -- but kept so queries can filter by date without a round-trip to Workyard.
  entry_date            date not null,
  -- Audit trail.
  saved_by              uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists payroll_daily_allocations_card_idx
  on public.payroll_daily_allocations (workyard_timecardid);

create index if not exists payroll_daily_allocations_date_idx
  on public.payroll_daily_allocations (entry_date);

-- --------------------------------------------------------------------------------------------
-- (2) updated_at trigger (mirrors the pattern used elsewhere).
-- --------------------------------------------------------------------------------------------

create or replace function public.payroll_daily_allocations_touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_daily_allocations_touch on public.payroll_daily_allocations;
create trigger payroll_daily_allocations_touch
  before update on public.payroll_daily_allocations
  for each row execute function public.payroll_daily_allocations_touch_updated_at();

-- --------------------------------------------------------------------------------------------
-- (3) RLS: read all-authenticated, write manager-or-above.
-- --------------------------------------------------------------------------------------------

alter table public.payroll_daily_allocations enable row level security;

drop policy if exists "payroll_daily_allocations_select" on public.payroll_daily_allocations;
create policy "payroll_daily_allocations_select" on public.payroll_daily_allocations
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "payroll_daily_allocations_write" on public.payroll_daily_allocations;
create policy "payroll_daily_allocations_write" on public.payroll_daily_allocations
  for all to authenticated
  using (public.payroll_is_manager_or_above())
  with check (public.payroll_is_manager_or_above());

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   drop table if exists public.payroll_daily_allocations;
--   drop function if exists public.payroll_daily_allocations_touch_updated_at();
-- ============================================================================================
