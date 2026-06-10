import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchMonitaskActivity, isMonitaskConfigured } from '@/lib/payroll/monitask-api'

export const runtime = 'nodejs'

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Pull a remote run's Monitask activity and store it as REFERENCE data
 * (monitask_activity) for the overpay review. Never writes paid hours. Analyst/
 * admin only. Matches Monitask users to remote workers by monitask_id, then name.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'manager'
  if (!['analyst', 'admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Analyst or admin access required' }, { status: 403 })
  }

  if (!isMonitaskConfigured()) {
    return NextResponse.json(
      { error: 'Monitask is not configured. Set Monitask credentials (or MONITASK_MOCK=1 for dev).' },
      { status: 503 },
    )
  }

  let body: { weekId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.weekId) return NextResponse.json({ error: 'weekId required' }, { status: 400 })

  const { data: week } = await supabase
    .from('payroll_weeks')
    .select('id, week_start, pay_group')
    .eq('id', body.weekId)
    .maybeSingle()
  if (!week) return NextResponse.json({ error: 'Week not found' }, { status: 404 })
  if (week.pay_group !== 'remote') return NextResponse.json({ error: 'Not a remote run' }, { status: 400 })

  // Remote roster, for matching.
  const { data: emps } = await supabase
    .from('payroll_employees')
    .select('id, name, monitask_id')
    .eq('pay_group', 'remote')
  const byMonitaskId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const e of (emps ?? []) as { id: string; name: string; monitask_id: string | null }[]) {
    if (e.monitask_id) byMonitaskId.set(e.monitask_id.toLowerCase(), e.id)
    byName.set(normalizeName(e.name), e.id)
  }

  let activity
  try {
    activity = await fetchMonitaskActivity(week.week_start)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Monitask fetch failed' }, { status: 502 })
  }

  const rows: Record<string, unknown>[] = []
  let unmatched = 0
  for (const r of activity.rows) {
    const empId =
      byMonitaskId.get(r.monitaskUserId.toLowerCase()) ?? byName.get(normalizeName(r.employeeName))
    if (!empId) { unmatched++; continue }
    rows.push({
      employee_id: empId,
      payroll_week_id: week.id,
      entry_date: r.entryDate,
      active_hours: r.activeHours,
      productivity_pct: r.productivityPct,
      raw: r.raw ?? null,
      created_by: user.id,
    })
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('monitask_activity')
      .upsert(rows, { onConflict: 'employee_id,entry_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, imported: rows.length, unmatched, stats: activity.stats })
}
