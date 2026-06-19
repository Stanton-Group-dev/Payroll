import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchDumpsterOverflowByProperty, isWorkyardApiError } from '@/lib/payroll/workyard-api'
import { isWorkyardMockEnabled } from '@/lib/payroll/workyard-mock'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/workyard/dumpster-overflow?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns Dumpster-Overflow (DUMP) hauling hours per property over the range, read live from
 * Workyard. `end` is exclusive. Feeds the dumpster sizing report.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const start = req.nextUrl.searchParams.get('start')
  const end = req.nextUrl.searchParams.get('end')

  if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) {
    return NextResponse.json({ error: 'start and end params required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (end <= start) {
    return NextResponse.json({ error: 'end must be after start' }, { status: 400 })
  }

  // Mock mode bypasses the credential requirement (returns dummy data).
  if (!isWorkyardMockEnabled() && (!process.env.WORKYARD_API_KEY || !process.env.WORKYARD_ORG_ID)) {
    return NextResponse.json({ error: 'Workyard API credentials not configured' }, { status: 500 })
  }

  const approvedOnly = req.nextUrl.searchParams.get('approvedOnly') !== 'false'

  try {
    const result = await fetchDumpsterOverflowByProperty(start, end, approvedOnly)
    return NextResponse.json(result)
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
