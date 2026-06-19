-- Move discretionary payroll rate constants into payroll_global_config so they
-- can be edited from the in-app Settings / Admin UI without a code deploy.
-- Default values match the constants in src/lib/payroll/config.ts exactly so
-- existing behaviour is unchanged after migration.  Idempotent (add if not exists).

alter table public.payroll_global_config
  add column if not exists payroll_tax_rate     numeric not null default 0.08,
  add column if not exists workers_comp_rate    numeric not null default 0.03,
  add column if not exists phone_reimbursement_amount numeric not null default 8,
  add column if not exists ot_threshold_hours   numeric not null default 40;

comment on column public.payroll_global_config.payroll_tax_rate is
  'Employer FICA/SUTA burden applied to taxable gross pay (default 0.08 = 8%).';
comment on column public.payroll_global_config.workers_comp_rate is
  'Workers-compensation rate applied to taxable gross pay (default 0.03 = 3%).';
comment on column public.payroll_global_config.phone_reimbursement_amount is
  'Weekly phone-reimbursement amount per eligible employee, in USD (default 8).';
comment on column public.payroll_global_config.ot_threshold_hours is
  'Weekly hours threshold above which OT-eligible employees earn overtime (default 40, per FLSA).';
