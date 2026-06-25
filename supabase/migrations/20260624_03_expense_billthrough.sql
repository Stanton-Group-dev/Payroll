-- Expense bill-through: allocated reimbursed expenses are billed to the customer LLC.
--
-- Until now an approved expense (gas, materials, tools, …) was paid to the employee
-- via a payroll_adjustments row but NEVER reached the property/LLC invoice — the
-- billing engine builds property costs from labor + phone/tool spread + mileage only.
-- The carefully-computed per-property gas split (and the unit-weighted tools spread)
-- were stored and then ignored by the bill. Business rule: every expense Stanton fronts
-- is billed through to the owner LLC at cost (pass-through, like mileage — no mgmt fee).
--
-- This migration adds the storage the engine and invoice need, plus a new submitter
-- allocation mode ('custom_split') for dividing one receipt across several properties.

-- 1. Allow a submitter-chosen split across selected properties. The split detail lives
--    in payroll_expense_items.allocation_detail (same shape gas uses post-approval);
--    at approval it explodes into one 'direct' payroll_adjustments row per property, so
--    the payroll_adjustments check constraint needs no change.
alter table payroll_expense_items
  drop constraint if exists payroll_expense_items_allocation_method_check;
alter table payroll_expense_items
  add constraint payroll_expense_items_allocation_method_check
  check (allocation_method = any (array['direct'::text, 'unit_weighted'::text, 'gas_auto'::text, 'custom_split'::text]));

-- 2. Persist the per-property expense bucket alongside labor/spread so the invoice can
--    break it out (rather than silently folding it into total_cost like mileage is today).
alter table payroll_weekly_property_costs
  add column if not exists expense_cost numeric not null default 0;

comment on column payroll_weekly_property_costs.expense_cost is
  'Reimbursed expenses billed to this property this week (gas/materials/tools/…), at cost. Direct allocations land on their property; unit-weighted ones are spread by unit count. Pass-through — not in the mgmt-fee base.';

-- 3. The invoice line item gets its own Expenses column so the customer sees it broken out.
alter table payroll_invoice_line_items
  add column if not exists expense_amount numeric not null default 0;

comment on column payroll_invoice_line_items.expense_amount is
  'Pass-through reimbursed expenses billed on this line, at cost (no mgmt fee).';
