-- Deactivate "delete-marked" / junk properties so they stop appearing in
-- payroll pickers, dropdowns and spread targets.
--
-- These rows have no dedicated status column; they were tagged for deletion via a
-- `delete…` (or junk `zz …`) prefix on the code/name during the AppFolio import,
-- yet still carried is_active = true. Every payroll property query filters on
-- is_active = true, so flipping the flag hides them everywhere at once. The app
-- also guards against re-imports via isDeleteMarked() in src/lib/payroll/properties.ts.
--
-- Reversible: set is_active = true to restore an individual row.

update properties
set is_active = false, updated_at = now()
where is_active = true and (
  code ilike 'delete%' or name ilike 'delete%' or
  code = 'zz' or name ilike 'zz - %' or name ilike 'zz-%'
);
