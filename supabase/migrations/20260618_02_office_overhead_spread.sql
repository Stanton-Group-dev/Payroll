-- Office (and future overhead) labor with no single billable property.
--
-- Some Workyard time is logged to a project like "Office" that maps to no property
-- and was previously flagged "not found in system" and dropped from pay entirely.
-- That labor is real and must be paid; it simply has no single property to bill, so
-- it is allocated like salaried pay — spread across all billable properties by unit
-- count, with the management fee applying.
--
-- This flag marks such an entry. The payroll engine pays its hours (the worker is on
-- the run as normal) and folds its wages into the unit-weighted spread instead of
-- direct-billing one property. It is also excluded from the unallocated-hours hold,
-- since it is intentionally allocated-by-spread, not unresolved.
alter table payroll_time_entries
  add column if not exists is_overhead_spread boolean not null default false;

comment on column payroll_time_entries.is_overhead_spread is
  'When true, this entry has no single billable property; its wages are spread across all billable properties by unit count (like salaried), and it is excluded from unallocated-hours holds.';
