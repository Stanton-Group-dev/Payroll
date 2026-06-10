import { NextRequest, NextResponse } from 'next/server'
import { fetchMonitaskActivity, isMonitaskApiError, isMonitaskConfigured } from '@/lib/payroll/monitask-api'

export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'weekStart param required (YYYY-MM-DD)' }, { status: 400 })
  }

  // Graceful 503 when Monitask isn't set up yet (mirrors the agent/command-bar
  // convention) — the rest of the app is unaffected until creds are provided.
  if (!isMonitaskConfigured()) {
    return NextResponse.json(
      { error: 'Monitask is not configured. Set MONITASK_CLIENT_ID / MONITASK_CLIENT_SECRET / MONITASK_REFRESH_TOKEN (or MONITASK_MOCK=1 for dev).' },
      { status: 503 },
    )
  }

  try {
    const result = await fetchMonitaskActivity(weekStart)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const debug =
      process.env.NODE_ENV !== 'production' && isMonitaskApiError(err)
        ? { status: err.status, endpoint: err.debug?.endpoint, query: err.debug?.query, body: err.bodyText }
        : undefined
    return NextResponse.json({ error: message, debug }, { status: 502 })
  }
}
