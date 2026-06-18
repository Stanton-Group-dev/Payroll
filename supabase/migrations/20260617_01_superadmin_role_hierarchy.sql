-- Fix: superadmin was excluded from the payroll RLS role hierarchy.
--
-- payroll_is_manager_or_above() allowed only ('admin','manager') and
-- payroll_is_admin() only ('admin'), so a 'superadmin' (the apex role) failed
-- every manager- and admin-gated write policy (13 + 3 = 16 policies) — e.g.
-- approving mileage, generating invoices, editing employees. The apex role had
-- fewer permissions than admin. This makes the hierarchy include superadmin.
--
-- Strictly additive: grants the top role the permissions it was always meant to
-- have; no other role's access changes.

CREATE OR REPLACE FUNCTION public.payroll_is_manager_or_above()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT payroll_get_role() IN ('superadmin', 'admin', 'manager');
$function$;

CREATE OR REPLACE FUNCTION public.payroll_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT payroll_get_role() IN ('superadmin', 'admin');
$function$;
