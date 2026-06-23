-- Master on/off switch for the automated unallocated-hours daily notification job.
--
-- The detection + SMS machinery already exists (src/lib/payroll/unallocatedHolds.ts,
-- twilio-api.ts) and is driven manually today from the weekly review screen. This flag
-- gates the new UNATTENDED daily run (GET /api/payroll/holds/cron): when false, the cron
-- does nothing and no employee is ever texted automatically.
--
-- Default is FALSE on purpose: the feature ships dormant. An admin turns it on from the
-- Settings page (Management Fee Configuration → Automated Unallocated-Hours Notifications)
-- only when the office is ready to start texting employees. The manual "Hold & notify"
-- button is unaffected by this flag.

alter table public.payroll_global_config
  add column if not exists unallocated_notifications_enabled boolean not null default false;

comment on column public.payroll_global_config.unallocated_notifications_enabled is
  'Master switch for the automated daily unallocated-hours SMS job (/api/payroll/holds/cron). '
  'False (default) = the cron sends nothing; managers can still notify by hand. '
  'True = the daily job texts employees with hours not yet assigned to a property.';
