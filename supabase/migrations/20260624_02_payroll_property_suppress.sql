-- 20260624_02_payroll_property_suppress.sql
--
-- "Hide everywhere" flag for the curated property overlay.
--
-- WHY: AppFolio won't let you delete a mistakenly-created property, and buildings for
-- customers we no longer serve linger in the shared `properties` spine forever. The
-- existing include_in_invoicing switch only keeps a row off invoices — it still shows
-- in pickers, analytics, the command bar, etc. is_suppressed is the stronger switch:
-- a suppressed property is dropped from EVERY payroll surface (pickers, review, invoice
-- generation, totals, analytics, command bar) as if it never existed.
--
-- Lives on payroll_property so it is AppFolio-proof: payroll_property_reconcile() only
-- inserts missing rows, never updates, so a suppression survives re-imports forever.
-- New rows default to false (visible) — nothing is hidden until an operator says so.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`. Idempotent.

alter table public.payroll_property
  add column if not exists is_suppressed     boolean not null default false,
  add column if not exists suppressed_reason text,
  add column if not exists suppressed_at     timestamptz,
  add column if not exists suppressed_by     uuid references auth.users(id);

comment on column public.payroll_property.is_suppressed is
  'Operator "hide everywhere" switch. When true the property is dropped from every payroll '
  'surface (pickers, review, invoice generation, totals, analytics, command bar) as if it did '
  'not exist. For junk/duplicate AppFolio rows that cannot be deleted and ex-customers we no '
  'longer serve. AppFolio-proof — never touched by payroll_property_reconcile().';

-- Most properties are visible; index only the suppressed minority for fast "hidden" lookups.
create index if not exists payroll_property_is_suppressed_idx
  on public.payroll_property (is_suppressed) where is_suppressed;

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   alter table public.payroll_property
--     drop column if exists is_suppressed,
--     drop column if exists suppressed_reason,
--     drop column if exists suppressed_at,
--     drop column if exists suppressed_by;
--   drop index if exists public.payroll_property_is_suppressed_idx;
-- ============================================================================================
