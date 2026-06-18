-- Persist the Workyard cost code on each time entry.
--
-- The cost code was parsed on import and then discarded — yet it's the key that lets
-- vendor/overhead time (Office, Park Hardware, Home Depot, …) bill to the building it
-- was actually for: an S-code in the cost code (e.g. "S0020" → "31 Park - Material
-- Pickup") names the destination property. Without storing it, that allocation is
-- impossible. We capture both halves:
--   cost_code      — the CODE ("S0020", "001"): drives bill-to-building allocation.
--   cost_code_name — the NAME ("31 Park - Material Pickup"): drives the activity label.
-- Forward-only: existing rows stay null; this changes no past billing.
alter table payroll_time_entries
  add column if not exists cost_code text,
  add column if not exists cost_code_name text;

comment on column payroll_time_entries.cost_code is
  'Workyard cost-code CODE (e.g. "S0020", "001"). An S-code names the destination building the hours bill to.';
comment on column payroll_time_entries.cost_code_name is
  'Workyard cost-code human NAME (e.g. "31 Park - Material Pickup"). Drives the customer-facing activity label.';
