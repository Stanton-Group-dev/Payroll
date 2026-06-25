-- 20260625_01_payroll_cost_tax_wc.sql
--
-- Bill employer burden (payroll tax + workers' comp) back to the LLCs.
--
-- WHY: required_prefund = gross + payroll_tax + workers_comp + mgmt_fee, but the per-property
-- billing only carried labor + spread + mileage + expense + mgmt_fee — the employer tax/WC was
-- computed for the prefund yet never allocated onto any building, so it was billed to no one
-- and every weekly statement under-collected by the burden amount. The engine now allocates
-- tax/WC onto properties by each employee's wage placement and folds it into total_cost; these
-- columns let the STORED per-property cost (and the billing-admin page that reads it) carry the
-- same breakdown for new weeks. (DECISIONS_LOG §1 reversed: prefund is now the billing target.)
--
-- Additive + reversible. money = numeric(10,2). Default 0 so historical rows read cleanly — their
-- burden wasn't allocated under the old model, and the printable statement recomputes live from
-- the engine anyway, so no backfill is required.

alter table public.payroll_weekly_property_costs
  add column if not exists tax_cost numeric(10,2) not null default 0,
  add column if not exists wc_cost  numeric(10,2) not null default 0;

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   alter table public.payroll_weekly_property_costs drop column if exists tax_cost;
--   alter table public.payroll_weekly_property_costs drop column if exists wc_cost;
-- ============================================================================================
