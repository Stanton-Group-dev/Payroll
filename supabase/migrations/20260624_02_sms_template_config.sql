-- 20260624_01_sms_template_config.sql
--
-- Make the unallocated-hours employee SMS editable from the in-app Admin UI
-- (Admin -> Employee SMS) instead of being hardcoded in the calc module.
--
-- The body is stored on the payroll_global_config singleton (same home as the
-- editable rate/threshold settings). NULL means "use the built-in default" — the
-- code falls back to DEFAULT_UNALLOCATED_SMS_TEMPLATE so behaviour is unchanged
-- until someone edits it. The template is interpolated at send time with these
-- placeholders: {first_name} {full_name} {hours} {week_start} {week_end}.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`.
-- Idempotent.

alter table public.payroll_global_config
  add column if not exists unallocated_sms_template text;

comment on column public.payroll_global_config.unallocated_sms_template is
  'Editable SMS body sent to employees held for unallocated hours. NULL = use the '
  'built-in default. Placeholders: {first_name} {full_name} {hours} {week_start} {week_end}.';

-- Allow notification rows that aren't tied to an employee (e.g. a manager's test
-- send from Admin -> Employee SMS), so they still land in the outbox/history.
alter table public.payroll_notifications
  alter column employee_id drop not null;

-- ============================================================================================
-- ROLLBACK (run only to revert this migration).
--   alter table public.payroll_global_config drop column if exists unallocated_sms_template;
--   -- (employee_id NOT NULL is not restored; doing so would require purging null rows.)
-- ============================================================================================
