-- 20260624_01_widen_payroll_employee_holds_status.sql
--
-- Widen payroll_employee_holds.status CHECK from ('held','released') to
-- ('held','released','waived'). The 'waived' status is the lighter middle-ground
-- introduced in 53febc5 — waiveUnallocated() writes it, usePayrollWeekReview reads
-- it. The widening was applied to prod (project wkwmxxlfheywwbgdbzxe) BY HAND on
-- the day that feature shipped, but no migration file ever landed — a fresh
-- environment would still have the narrow constraint and waiveUnallocated() would
-- die on every call with Postgres 23514. This migration backfills the widened
-- constraint exactly as it lives in prod today (introspected 2026-06-24).
--
-- Idempotent: if the constraint already permits 'waived' (prod today), this is a
-- no-op. If it's still the narrow form (fresh env), the narrow CHECK is dropped
-- and re-added wide. If the constraint is missing entirely, the wide form is
-- created.
--
-- CLI-native (no explicit BEGIN/COMMIT) so it is safe under `supabase db push`.

DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO current_def
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  WHERE rel.relname = 'payroll_employee_holds'
    AND c.conname  = 'payroll_employee_holds_status_check';

  -- Existing constraint that doesn't permit 'waived' → drop it; we'll re-add wide below.
  IF current_def IS NOT NULL AND position('waived' in current_def) = 0 THEN
    ALTER TABLE public.payroll_employee_holds
      DROP CONSTRAINT payroll_employee_holds_status_check;
    current_def := NULL;
  END IF;

  -- Re-add (or first-add) the wide constraint when it isn't already present in canonical form.
  IF current_def IS NULL THEN
    ALTER TABLE public.payroll_employee_holds
      ADD CONSTRAINT payroll_employee_holds_status_check
      CHECK (status IN ('held', 'released', 'waived'));
  END IF;
END $$;
