import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePortalContext } from '@/lib/payroll/portal'

export const runtime = 'nodejs'

interface SubmitBody {
  token: string
  /** Per-day hours for the open remote run. Days with 0/empty are dropped. */
  days: { date: string; hours: number }[]
}

/**
 * Worker self-submission. Replaces the worker's remote_submitted entries for the
 * open remote run with the posted per-day hours. These are the DEFAULT paid hours;
 * Monitask activity is only reference (overpay review happens on the analyst side).
 */
export async function POST(req: NextRequest) {
  let body: SubmitBody
  try {
    body = (await req.json()) as SubmitBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const token = body.token?.trim()
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Portal not configured (missing service role key)' }, { status: 503 })

  const ctx = await resolvePortalContext(admin, token)
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  if (!ctx.week) return NextResponse.json({ error: 'No remote run is currently open for submission' }, { status: 409 })

  // Validate + clamp the posted days to the run week.
  const weekDates = new Set<string>()
  {
    const start = new Date(ctx.week.week_start + 'T00:00:00Z')
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      weekDates.add(d.toISOString().slice(0, 10))
    }
  }
  const rows = (body.days ?? [])
    .filter((d) => d && weekDates.has(d.date) && Number(d.hours) > 0)
    .map((d) => {
      const hours = Math.min(Math.round(Number(d.hours) * 100) / 100, 24)
      return {
        payroll_week_id: ctx.week!.id,
        employee_id: ctx.worker.id,
        property_id: null,
        entry_date: d.date,
        regular_hours: hours,
        ot_hours: 0,
        pto_hours: 0,
        source: 'remote_submitted',
        is_flagged: false,
      }
    })

  // Replace prior submission for this worker+run, then insert the new set.
  const { error: delErr } = await admin
    .from('payroll_time_entries')
    .delete()
    .eq('employee_id', ctx.worker.id)
    .eq('payroll_week_id', ctx.week.id)
    .eq('source', 'remote_submitted')
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (rows.length > 0) {
    const { error: insErr } = await admin.from('payroll_time_entries').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  const { error: tokenErr } = await admin.from('remote_portal_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token)
  if (tokenErr) console.error('remote_portal_tokens last_used_at update failed', tokenErr)

  const total = rows.reduce((s, r) => s + r.regular_hours, 0)
  return NextResponse.json({ ok: true, submittedDays: rows.length, totalHours: total })
}
