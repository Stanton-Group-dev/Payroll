import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTwilioLive } from '@/lib/payroll/twilio-api'
import {
  detectUnallocatedEmployees,
  applyUnallocatedHolds,
  releaseHold,
  waiveUnallocated,
  unwaiveUnallocated,
  UNALLOCATED_HOLD_THRESHOLD_HOURS,
} from '@/lib/payroll/unallocatedHolds'

export const runtime = 'nodejs'

const MANAGER_ROLES = ['superadmin', 'admin', 'manager']

/** Resolve the caller and enforce manager-or-above. Returns the admin client + userId. */
async function authorize() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'manager'
  if (!MANAGER_ROLES.includes(role)) {
    return { error: NextResponse.json({ error: 'Manager access required' }, { status: 403 }) }
  }
  const admin = createAdminClient()
  if (!admin) return { error: NextResponse.json({ error: 'Service role key not configured' }, { status: 503 }) }
  return { admin, userId: user.id }
}

/**
 * GET /api/payroll/holds?weekId=…
 * Returns the current state for the review panel: which employees are over the
 * unallocated threshold, the holds already on record, and whether texts will
 * actually send (vs dry-run).
 */
export async function GET(req: NextRequest) {
  const weekId = req.nextUrl.searchParams.get('weekId')
  if (!weekId) return NextResponse.json({ error: 'weekId required' }, { status: 400 })

  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { admin } = auth

  try {
    const [unallocated, holdsRes] = await Promise.all([
      detectUnallocatedEmployees(admin, weekId),
      admin
        .from('payroll_employee_holds')
        .select('*, employee:payroll_employees(id, name, phone)')
        .eq('payroll_week_id', weekId)
        .order('held_at', { ascending: false }),
    ])
    if (holdsRes.error) throw new Error(holdsRes.error.message)
    return NextResponse.json({
      threshold: UNALLOCATED_HOLD_THRESHOLD_HOURS,
      twilioLive: isTwilioLive(),
      unallocated,
      holds: holdsRes.data ?? [],
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load holds' }, { status: 500 })
  }
}

/**
 * POST /api/payroll/holds
 *   { weekId, action: 'apply', thresholdHours? }      → hold + notify everyone over threshold
 *   { holdId, action: 'release', resolutionNote }     → release one hold with the written reason
 *   { weekId, employeeId, action: 'waive' }           → write off one employee's unallocated hours (still pay allocated)
 *   { weekId, employeeId, action: 'unwaive' }         → reverse a waive (pay the unallocated hours again)
 */
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  let body: { weekId?: string; holdId?: string; employeeId?: string; action?: string; resolutionNote?: string; thresholdHours?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  try {
    if (body.action === 'apply') {
      if (!body.weekId) return NextResponse.json({ error: 'weekId required' }, { status: 400 })
      const result = await applyUnallocatedHolds(admin, {
        weekId: body.weekId,
        userId,
        threshold: typeof body.thresholdHours === 'number' ? body.thresholdHours : undefined,
      })
      return NextResponse.json({ ok: true, ...result })
    }
    if (body.action === 'release') {
      if (!body.holdId) return NextResponse.json({ error: 'holdId required' }, { status: 400 })
      const hold = await releaseHold(admin, { holdId: body.holdId, userId, resolutionNote: body.resolutionNote ?? '' })
      return NextResponse.json({ ok: true, hold })
    }
    if (body.action === 'waive') {
      if (!body.weekId || !body.employeeId) return NextResponse.json({ error: 'weekId and employeeId required' }, { status: 400 })
      const result = await waiveUnallocated(admin, { weekId: body.weekId, employeeId: body.employeeId, userId })
      return NextResponse.json({ ok: true, ...result })
    }
    if (body.action === 'unwaive') {
      if (!body.weekId || !body.employeeId) return NextResponse.json({ error: 'weekId and employeeId required' }, { status: 400 })
      await unwaiveUnallocated(admin, { weekId: body.weekId, employeeId: body.employeeId })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Operation failed' }, { status: 500 })
  }
}
