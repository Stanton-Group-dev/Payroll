-- 20260617_04_waive_unallocated_hours.sql
--
-- Add a third hold status: 'waived'.
--
-- 'held'    : the whole employee is pulled from the run (existing). No pay, no
--             billing, until they bring a written reason (-> 'released').
-- 'waived'  : NEW. Write off only the employee's unallocated (no-property) hours.
--             They are still paid for their allocated work; just the unallocated
--             portion is dropped from pay (and stays unbilled, as it always was).
--             No notification is sent. Reversible by deleting the row.
--
-- This lets a manager "just not pay" the unallocated hours without withholding the
-- employee's entire check — the middle ground between paying everything and the
-- full hold-and-notify.
--
-- The (week, employee) unique constraint still holds: an employee is normal, held,
-- released, or waived for a given week — never two at once.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`.
-- Idempotent: drops the old check and re-adds the widened one under a stable name.

alter table public.payroll_employee_holds
  drop constraint if exists payroll_employee_holds_status_check;

alter table public.payroll_employee_holds
  add constraint payroll_employee_holds_status_check
  check (status in ('held', 'released', 'waived'));

-- ============================================================================================
-- ROLLBACK (run only to revert this migration; first clear any 'waived' rows).
--   delete from public.payroll_employee_holds where status = 'waived';
--   alter table public.payroll_employee_holds drop constraint if exists payroll_employee_holds_status_check;
--   alter table public.payroll_employee_holds add constraint payroll_employee_holds_status_check
--     check (status in ('held', 'released'));
-- ============================================================================================
