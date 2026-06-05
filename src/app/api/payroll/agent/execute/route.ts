import { NextResponse } from 'next/server'
import { buildOperationContext, UnauthenticatedError } from '@/lib/payroll/agent/context'
import { getOperation } from '@/lib/payroll/operations'
import {
  executeOperation,
  OperationError,
  OperationValidationError,
} from '@/lib/payroll/operations/core'

export const runtime = 'nodejs'

/**
 * Confirm-and-execute endpoint. Takes an operation name + the validated input
 * that was previewed, then RE-validates and RE-plans server-side (never trusting
 * a client-supplied preview) before committing and writing the audit row.
 */
export async function POST(request: Request) {
  let body: { operation?: string; input?: unknown; agentPrompt?: string }
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
    const ctx = await buildOperationContext('agent', body.agentPrompt)
    const { preview, result } = await executeOperation(ctx, op, body.input)
    return NextResponse.json({ ok: true, preview, result })
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (err instanceof OperationValidationError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 })
    }
    if (err instanceof OperationError) {
      return NextResponse.json({ error: err.message, preview: err.preview }, { status: 409 })
    }
    console.error('payroll execute error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Execution error' },
      { status: 500 }
    )
  }
}
