-- OD-5 as in-app config (per the config-driven-business-logic directive): make
-- "does the required prefund include the management fee?" an editable toggle rather
-- than a hardcoded constant. Default true = the fee is collected at prefund time
-- (the decided OD-5 behavior). Additive, idempotent.
alter table public.payroll_global_config
  add column if not exists prefund_includes_mgmt_fee boolean not null default true;
