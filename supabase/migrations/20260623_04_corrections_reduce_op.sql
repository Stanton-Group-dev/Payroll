-- Timesheet adjustments: allow partial hour reductions (cut an entry's worked
-- hours down, keeping the rest, with a reason) by adding a distinct 'reduce'
-- operation to the corrections audit log. Additive + reversible: just widens the
-- CHECK to include the new value. Without it the correction insert silently fails
-- (swallowed error) and the reason/audit record would be lost.
--
-- STAGED — NOT yet applied to the shared prod DB (wkwmxxlfheywwbgdbzxe).
-- Until applied, the 'reduce' correction insert fails the CHECK and is swallowed
-- (console.error), so a partial cut still reduces the hours but writes no audit
-- row. Apply via the Supabase MCP before relying on the reduce audit trail.

alter table public.payroll_timesheet_corrections
  drop constraint if exists payroll_timesheet_corrections_operation_check;

alter table public.payroll_timesheet_corrections
  add constraint payroll_timesheet_corrections_operation_check
  check (operation = any (array['reassign'::text, 'split'::text, 'add'::text, 'remove'::text, 'reduce'::text]));
