import { NextResponse } from 'next/server'
import { buildOperationContext, UnauthenticatedError, UnauthorizedError } from '@/lib/payroll/agent/context'
import { getOperation } from '@/lib/payroll/operations'
import {
  executeOperation,
  OperationError,
  OperationValidationError,
} from '@/lib/payroll/operations/core'

export const runtime = 'nodejs'

/**
 * General operation-execute endpoint (source: ui). Re-validates and RE-plans
 * server-side (never trusting a client preview), refuses to commit on blockers,
 * then commits and writes the audit row. This is the audited write path shared
 * by UI surfaces; the agent has its own /agent/execute that records source=agent.
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
    const { preview, result } = await executeOperation(ctx, op, body.input)
    return NextResponse.json({ ok: true, preview, result })
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
    if (err instanceof OperationError) {
      return NextResponse.json({ error: err.message, preview: err.preview }, { status: 409 })
    }
    console.error('payroll ui execute error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Execution error' },
      { status: 500 }
    )
  }
}
