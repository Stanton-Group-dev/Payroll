-- New Project Wizard (PRP-06, CF-9): make the building -> Workyard project
-- mapping explicit (audit + re-run idempotency) without disturbing the existing
-- S-code-by-name resolution in workyard-api.ts. Additive, nullable column.
--
-- STAGED — not yet applied to the shared prod DB.

alter table public.payroll_property
  add column if not exists workyard_project_id text;
