import { NextResponse } from 'next/server'
import { buildOperationContext, UnauthenticatedError, UnauthorizedError } from '@/lib/payroll/agent/context'
import { getOperation } from '@/lib/payroll/operations'
import { previewOperation, OperationValidationError } from '@/lib/payroll/operations/core'

export const runtime = 'nodejs'

/**
 * General operation-preview endpoint (source: ui). Validates + plans an operation
 * without writing, returning the same PlanPreview (changes / warnings / blockers)
 * the agent shows. Lets any UI surface a confirmable preview before committing.
 */
export async function POST(request: Request) {
  let body: { operation?: string; input?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.operation) {
    return NextResponse.json({ error: 'operation is required' }, { status: 400 })
  }
  const op = getOperation(body.operation)
  if (!op) {
    return NextResponse.json({ error: `Unknown operation ${body.operation}` }, { status: 400 })
  }
  try {
    const ctx = await buildOperationContext('ui')
    const preview = await previewOperation(ctx, op, body.input)
    return NextResponse.json({ ok: true, preview })
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    if (err instanceof OperationValidationError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 })
    }
    console.error('payroll preview error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preview error' },
      { status: 500 }
    )
  }
}
