-- Fix: Workyard import was silently dropping cost-allocation legs.
--
-- A single Workyard time card splits one location into PAIRED allocations — an
-- "Office / Oficina" leg and a "Showings / Muestra" leg — with near-identical
-- hours. Both resolve to the same (property, date, timecard) and round to the same
-- 2-dp regular/ot/pto values. The dedupe index below did NOT include the cost code,
-- so the second leg was a key-for-key duplicate: its INSERT hit the unique
-- violation and the import handler's catch{} swallowed it. Net effect: ~one of every
-- OFFICE/SHOW pair vanished (≈8h lost in a single employee-week observed).
--
-- Fix: add cost_code + cost_code_name to the identity key so distinct activities on
-- the same card are no longer collapsed, while still blocking true re-import dupes.
--
-- Residual (not addressed here): geofence is not stored on payroll_time_entries, so
-- two legs at the same property + same cost code + same rounded hours on one card
-- would still collide. That pattern was not observed; the OFFICE/SHOW split is.

drop index if exists public.payroll_time_entries_workyard_identity_uniq;

create unique index payroll_time_entries_workyard_identity_uniq
  on public.payroll_time_entries (
    payroll_week_id,
    source,
    workyard_timecardid,
    employee_id,
    coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
    entry_date,
    round((regular_hours)::numeric, 2),
    round((ot_hours)::numeric, 2),
    round((pto_hours)::numeric, 2),
    coalesce(cost_code, ''),
    coalesce(cost_code_name, '')
  )
  where source = any (array['workyard'::text, 'workyard_api'::text])
    and workyard_timecardid is not null;
