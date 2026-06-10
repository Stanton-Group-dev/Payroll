import type { SupabaseClient } from '@supabase/supabase-js'
import { EDITABLE_WEEK_STATUSES } from '@/lib/payroll/resolve/dates'

/**
 * Remote-portal helpers. The portal authenticates a worker by an unguessable
 * token (remote_portal_tokens) rather than a Supabase session, so all access goes
 * through the service-role client and is scoped IN CODE to the token's own worker
 * and the currently-open remote run. This avoids exposing the wide-open
 * authenticated RLS to non-staff users.
 */

export interface PortalWorker {
  id: string
  name: string
  pay_group: string
  is_active: boolean
}

export interface PortalWeek {
  id: string
  week_start: string
  week_end: string
  status: string
}

export interface PortalContext {
  worker: PortalWorker
  /** The open remote run the worker can submit against, or null if none is open. */
  week: PortalWeek | null
}

/** Resolve a portal token to its worker and the currently-open remote run. */
export async function resolvePortalContext(
  admin: SupabaseClient,
  token: string,
): Promise<PortalContext | null> {
  if (!token) return null
  const { data: tok } = await admin
    .from('remote_portal_tokens')
    .select('employee_id, is_active')
    .eq('token', token)
    .maybeSingle()
  if (!tok || tok.is_active === false) return null

  const { data: worker } = await admin
    .from('payroll_employees')
    .select('id, name, pay_group, is_active')
    .eq('id', tok.employee_id)
    .maybeSingle()
  if (!worker || worker.pay_group !== 'remote') return null

  // The open remote run: an editable remote week, most recent first.
  const { data: week } = await admin
    .from('payroll_weeks')
    .select('id, week_start, week_end, status')
    .eq('pay_group', 'remote')
    .in('status', EDITABLE_WEEK_STATUSES as readonly string[])
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    worker: worker as PortalWorker,
    week: (week as PortalWeek | null) ?? null,
  }
}
