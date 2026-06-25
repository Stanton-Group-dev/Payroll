-- 20260625_02_consolidate_llcs.sql
--
-- Consolidate the granular Westend and Southend owner LLCs into one billing entity each, and
-- re-enable invoicing for S0009 (236 Maple).
--
-- WHY: each family runs through a single combined bank account, so they're billed as one LLC.
--   • Westend 81 / 77 / Oxford  -> 'SREP Westend LLC'  (the placeholder/aggregate already uses it)
--   • Southend 1 / 2 / 3 / base  -> 'SREP Southend LLC'
-- This only changes how per-property costs GROUP onto statements (keyed by property_id, so the
-- math is untouched). Reverses the granular split seeded in 20260618_02 §4b.
--
-- S0009 (236 Maple, Southend) had include_in_invoicing = false, so its labor billed to no one.
-- It's a real billable property -> flip it on. (curated overlay; survives AppFolio re-imports.)
--
-- Idempotent: each UPDATE is guarded by "is distinct from" the target, so re-runs are no-ops.

-- 1. Westend consolidation.
update public.payroll_property
set owner_llc = 'SREP Westend LLC'
where owner_llc in ('SREP Westend 81 LLC', 'SREP Westend 77 LLC', 'SREP Westend Oxford LLC')
  and owner_llc is distinct from 'SREP Westend LLC';

-- 2. Southend consolidation (includes the base 'SREP SOUTHEND LLC' = S0009).
update public.payroll_property
set owner_llc = 'SREP Southend LLC'
where owner_llc in ('SREP SOUTHEND 1 LLC', 'SREP SOUTHEND 2 LLC', 'SREP SOUTHEND 3 LLC', 'SREP SOUTHEND LLC')
  and owner_llc is distinct from 'SREP Southend LLC';

-- 3. Re-enable invoicing for S0009 (236 Maple) so its labor bills to SREP Southend LLC.
update public.payroll_property pp
set include_in_invoicing = true
from public.properties p
where pp.property_id = p.id
  and trim(p.code) = 'S0009'
  and pp.include_in_invoicing is distinct from true;

-- ============================================================================================
-- ROLLBACK (run only to revert): re-apply the granular Asset-ID -> Owner-LLC mapping from
-- 20260618_02 §4b, and set S0009's include_in_invoicing back to false. The granular split is
-- the source of truth for the per-LLC names if the combined-account decision is ever undone.
-- ============================================================================================
