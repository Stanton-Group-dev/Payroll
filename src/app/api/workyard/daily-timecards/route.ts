import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchDailyTimecards,
  dailyCatchupDateRange,
  isWorkyardApiError,
} from '@/lib/payroll/workyard-api'
import { isWorkyardMockEnabled } from '@/lib/payroll/workyard-mock'
import { WORKYARD_ORG_TIMEZONE } from '@/lib/payroll/config'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify manager-or-above via the DB helper (fail-closed, matches RLS convention).
  const { data: isManager } = await supabase.rpc('payroll_is_manager_or_above')
  if (!isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Optional ?date=YYYY-MM-DD override. When omitted, derive "today" in org timezone
  // and compute yesterday (or Sat+Sun on Mondays) server-side.
  let dateParam = req.nextUrl.searchParams.get('date')
  let startDate: string
  let endDate: string

  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ error: 'date param must be YYYY-MM-DD' }, { status: 400 })
    }
    startDate = dateParam
    endDate = dateParam
  } else {
    // Derive today in org timezone then compute the catch-up window.
    const todayIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: WORKYARD_ORG_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const range = dailyCatchupDateRange(todayIso)
    startDate = range.start
    endDate = range.end
  }

  if (!isWorkyardMockEnabled() && (!process.env.WORKYARD_API_KEY || !process.env.WORKYARD_ORG_ID)) {
    return NextResponse.json({ error: 'Workyard API credentials not configured' }, { status: 500 })
  }

  try {
    // Fetch each date in the range (usually one, two on Monday).
    const dates = [startDate]
    if (endDate !== startDate) dates.push(endDate)

    const results = await Promise.all(dates.map(d => fetchDailyTimecards(d)))
    const rows = results.flatMap(r => r.rows)
    const stats = {
      total: results.reduce((s, r) => s + r.stats.total, 0),
      unallocated: results.reduce((s, r) => s + r.stats.unallocated, 0),
      dates,
    }

    return NextResponse.json({ rows, stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const debug =
      process.env.NODE_ENV !== 'production' && isWorkyardApiError(err)
        ? {
            status: err.status,
            endpoint: err.debug?.endpoint,
            query: err.debug?.query,
            body: err.bodyJson ?? err.bodyText,
          }
        : undefined

    return NextResponse.json({ error: message, debug }, { status: 502 })
  }
}
