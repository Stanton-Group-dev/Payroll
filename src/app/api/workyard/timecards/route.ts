import { NextRequest, NextResponse } from 'next/server'
import { fetchWorkyardTimecards, isWorkyardApiError } from '@/lib/payroll/workyard-api'
import { isWorkyardMockEnabled } from '@/lib/payroll/workyard-mock'

export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'weekStart param required (YYYY-MM-DD)' }, { status: 400 })
  }

  // Mock mode bypasses the credential requirement (returns dummy data).
  if (!isWorkyardMockEnabled() && (!process.env.WORKYARD_API_KEY || !process.env.WORKYARD_ORG_ID)) {
    return NextResponse.json({ error: 'Workyard API credentials not configured' }, { status: 500 })
  }

  const approvedOnly = req.nextUrl.searchParams.get('approvedOnly') !== 'false'

  try {
    const result = await fetchWorkyardTimecards(weekStart, approvedOnly)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const debug =
      process.env.NODE_ENV !== 'production' && isWorkyardApiError(err)
        ? {
            status: err.status,
            endpoint: err.debug?.endpoint,
            query: err.debug?.query,
            page: err.debug?.page,
            startUnix: err.debug?.startUnix,
            endUnix: err.debug?.endUnix,
            filterFormat: err.debug?.filterFormat,
            body: err.bodyJson ?? err.bodyText,
          }
        : undefined

    return NextResponse.json({ error: message, debug }, { status: 502 })
  }
}
