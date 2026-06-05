import { NextResponse } from 'next/server'
import {
  buildOperationContext,
  assertRole,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/lib/payroll/agent/context'
import { queryPayrollComparison } from '@/lib/payroll/agent/queries'

export const runtime = 'nodejs'

/**
 * Run payroll for a week and compare it to the prior week. Read-only report,
 * computed by the SAME engine the review screen and the agent use. Manager+.
 */
export async function POST(request: Request) {
  let body: { weekId?: string; date?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.weekId && !body.date) {
    return NextResponse.json({ error: 'weekId or date is required' }, { status: 400 })
  }
  try {
    const ctx = await buildOperationContext('ui')
    assertRole(ctx, 'manager')
    const report = await queryPayrollComparison(ctx, { weekId: body.weekId, date: body.date })
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    console.error('payroll compare error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Comparison error' },
      { status: 500 }
    )
  }
}
