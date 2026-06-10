import { NextResponse } from 'next/server'
import {
  buildOperationContext,
  assertRole,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/lib/payroll/agent/context'
import { runAgent, AgentUnavailableError, type ChatTurn, type WeekContext } from '@/lib/payroll/agent/run'
import type { AgentMode } from '@/lib/payroll/agent/tools'

export const runtime = 'nodejs'

/**
 * Natural-language command endpoint. Accepts the conversation so far and returns
 * either a clarifying reply or a proposed operation + preview. NEVER writes —
 * confirmation goes to /api/payroll/agent/execute.
 *
 * mode 'report' (read-only) requires manager+; mode 'full' (read + write
 * proposals) requires super-admin.
 */
export async function POST(request: Request) {
  let body: { messages?: ChatTurn[]; message?: string; mode?: AgentMode; weekContext?: WeekContext | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const history: ChatTurn[] = Array.isArray(body.messages)
    ? body.messages
    : body.message
      ? [{ role: 'user', content: body.message }]
      : []

  if (history.length === 0) {
    return NextResponse.json({ error: 'No message provided' }, { status: 400 })
  }

  const mode: AgentMode = body.mode === 'full' ? 'full' : 'report'
  const weekContext: WeekContext | null =
    body.weekContext && body.weekContext.weekStart && body.weekContext.weekEnd
      ? { weekStart: body.weekContext.weekStart, weekEnd: body.weekContext.weekEnd }
      : null

  try {
    const prompt = [...history].reverse().find((m) => m.role === 'user')?.content
    const ctx = await buildOperationContext('agent', prompt)
    assertRole(ctx, mode === 'full' ? 'superadmin' : 'manager')
    const result = await runAgent(ctx, history, mode, weekContext)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    if (err instanceof AgentUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('payroll agent error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Agent error' },
      { status: 500 }
    )
  }
}
