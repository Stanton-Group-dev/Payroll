import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET  /api/daily-allocations?date=YYYY-MM-DD
 *   Returns all saved allocations for time cards on a given date.
 *   Auth: manager-or-above.
 *
 * POST /api/daily-allocations
 *   Body: { workyard_timecardid: string; entry_date: string; legs: { property_id: string; fraction: number }[] }
 *   Replaces (delete-then-insert) all saved legs for the given time card.
 *   Auth: manager-or-above.
 *
 * DELETE /api/daily-allocations?timecardid=...
 *   Removes all saved legs for a time card.
 *   Auth: manager-or-above.
 */

async function requireManager(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 }
  const { data: isManager } = await supabase.rpc('payroll_is_manager_or_above')
  if (!isManager) return { error: 'Forbidden', status: 403 }
  return { user }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const auth = await requireManager(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const date = req.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('payroll_daily_allocations')
    .select('id, workyard_timecardid, property_id, fraction, entry_date')
    .eq('entry_date', date)
    .order('workyard_timecardid')
    .order('fraction', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ allocations: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const auth = await requireManager(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: {
    workyard_timecardid: string
    entry_date: string
    legs: { property_id: string; fraction: number }[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { workyard_timecardid, entry_date, legs } = body

  if (!workyard_timecardid || typeof workyard_timecardid !== 'string') {
    return NextResponse.json({ error: 'workyard_timecardid required' }, { status: 400 })
  }
  if (!entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
    return NextResponse.json({ error: 'entry_date required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!Array.isArray(legs) || legs.length === 0) {
    return NextResponse.json({ error: 'legs array required and must not be empty' }, { status: 400 })
  }

  // Validate fractions sum to 1.0 (within rounding tolerance).
  const sum = legs.reduce((s, l) => s + (l.fraction ?? 0), 0)
  if (Math.abs(sum - 1.0) > 0.01) {
    return NextResponse.json(
      { error: `Leg fractions must sum to 1.0 (got ${sum.toFixed(4)})` },
      { status: 400 }
    )
  }

  // Delete-then-insert: replace all prior legs for this time card.
  const { error: delError } = await supabase
    .from('payroll_daily_allocations')
    .delete()
    .eq('workyard_timecardid', workyard_timecardid)

  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  const rows = legs.map(leg => ({
    workyard_timecardid,
    property_id: leg.property_id,
    fraction: leg.fraction,
    entry_date,
    saved_by: auth.user!.id,
  }))

  const { data, error: insError } = await supabase
    .from('payroll_daily_allocations')
    .insert(rows)
    .select('id, workyard_timecardid, property_id, fraction, entry_date')

  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
  return NextResponse.json({ saved: data ?? [] }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const auth = await requireManager(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const timecardid = req.nextUrl.searchParams.get('timecardid')
  if (!timecardid) {
    return NextResponse.json({ error: 'timecardid param required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('payroll_daily_allocations')
    .delete()
    .eq('workyard_timecardid', timecardid)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
