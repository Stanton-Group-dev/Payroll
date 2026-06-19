-- 20260619_04_lock_approved_weeks.sql
-- PRP-04: DB-level post-approval immutability (BACKSTOP). Once a payroll week reaches
-- payroll_approved (or invoiced / statement_sent), its pay-determining inputs are frozen.
-- The app also adds graceful server-side guards so these writes are rejected with a
-- friendly message before reaching this trigger; this is the enforcement floor.
--
-- Locked tables (verified against the approval/invoice/statement/recon write-paths):
--   payroll_time_entries, payroll_adjustments, payroll_dept_split_overrides,
--   payroll_spread_events, payroll_weekly_property_costs, payroll_mileage_reimbursements.
-- Notes:
--   - payroll_weekly_property_costs is upserted DURING approvePayroll BEFORE the status
--     flips to payroll_approved, so that write is not blocked.
--   - Invoicing/statement only READ weekly_property_costs and write payroll_invoices /
--     payroll_invoice_line_items / payroll_approvals (none locked) — later stages keep working.
--   - Carry-forward stays legal: it writes the CURRENT (open) week, not the locked prior week.
--   - The trigger fires for ALL roles incl. service_role (unlike RLS) — true immutability.

create or replace function public.payroll_reject_if_week_locked()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare wk uuid; st text;
begin
  wk := coalesce(NEW.payroll_week_id, OLD.payroll_week_id);
  if wk is null then return coalesce(NEW, OLD); end if;
  select status into st from public.payroll_weeks where id = wk;
  if st in ('payroll_approved','invoiced','statement_sent') then
    raise exception 'Payroll week is locked (status=%): pay inputs are immutable after payroll approval. Use a current-week carry-forward instead.', st using errcode = 'check_violation';
  end if;
  return coalesce(NEW, OLD);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'payroll_time_entries','payroll_adjustments','payroll_dept_split_overrides',
    'payroll_spread_events','payroll_weekly_property_costs','payroll_mileage_reimbursements'
  ] loop
    execute format('drop trigger if exists trg_lock_after_approval on public.%I', t);
    execute format('create trigger trg_lock_after_approval before insert or update or delete on public.%I for each row execute function public.payroll_reject_if_week_locked()', t);
  end loop;
end $$;

-- ROLLBACK (emergency only):
--   drop function if exists public.payroll_reject_if_week_locked() cascade;
--   -- cascade drops all six trg_lock_after_approval triggers.
