-- Timesheet adjustments: allow partial hour reductions (cut an entry's worked
-- hours down, keeping the rest, with a reason) by adding a distinct 'reduce'
-- operation to the corrections audit log. Additive + reversible: just widens the
-- CHECK to include the new value. Without it the correction insert silently fails
-- (swallowed error) and the reason/audit record would be lost.
--
-- APPLIED to the shared prod DB (wkwmxxlfheywwbgdbzxe) via the Supabase MCP
-- on 2026-06-23. The 'reduce' correction now passes the CHECK, so partial cuts
-- record their audit row (who/when/why) like every other adjustment.

alter table public.payroll_timesheet_corrections
  drop constraint if exists payroll_timesheet_corrections_operation_check;

alter table public.payroll_timesheet_corrections
  add constraint payroll_timesheet_corrections_operation_check
  check (operation = any (array['reassign'::text, 'split'::text, 'add'::text, 'remove'::text, 'reduce'::text]));
