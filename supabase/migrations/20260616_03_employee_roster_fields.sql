-- Make payroll_employees the single source of truth for the corporate master roster
-- (previously maintained in Excel). All new columns are additive and nullable, so this
-- is non-breaking for existing payroll mechanics.

alter table public.payroll_employees
  add column if not exists department          text,
  add column if not exists role                text,
  add column if not exists phone               text,
  add column if not exists email               text,
  add column if not exists employee_code       text,
  add column if not exists amount              numeric,
  add column if not exists phone_reimbursement numeric,
  add column if not exists monthly_bonus       numeric,
  add column if not exists bonus               numeric,
  add column if not exists rent_adjustment     numeric,
  add column if not exists pay_classification  text,
  add column if not exists hired_on            date,
  add column if not exists comp_updated_on     date;

comment on column public.payroll_employees.department         is 'Org department from the master roster, e.g. "01 - Corporate".';
comment on column public.payroll_employees.role               is 'Job title / role from the master roster (distinct from trade).';
comment on column public.payroll_employees.employee_code      is 'Department-sequence code, e.g. "01-003". NOT unique: construction techs share 02-002.';
comment on column public.payroll_employees.amount             is 'Flat pay amount from the roster "Amount" column (distinct from hourly_rate, the "Rate" column).';
comment on column public.payroll_employees.phone_reimbursement is 'Per-period phone reimbursement from the roster.';
comment on column public.payroll_employees.monthly_bonus      is 'Standing monthly bonus from the roster.';
comment on column public.payroll_employees.bonus              is 'One-off / standing bonus from the roster.';
comment on column public.payroll_employees.rent_adjustment    is 'Standing rent adjustment from the roster.';
comment on column public.payroll_employees.pay_classification is 'Roster "Type" verbatim: "1099 reimbursement" / "W-2" / "Remote".';
comment on column public.payroll_employees.hired_on           is 'Hire date from the roster.';
comment on column public.payroll_employees.comp_updated_on    is 'Roster "Updated On" — manual comp-change date.';

create index if not exists idx_payroll_employees_department on public.payroll_employees(department);
