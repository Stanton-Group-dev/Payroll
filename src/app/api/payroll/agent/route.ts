import { NextResponse } from 'next/server'
import { buildOperationContext, UnauthenticatedError } from '@/lib/payroll/agent/context'
import { runAgent, AgentUnavailableError, type ChatTurn } from '@/lib/payroll/agent/run'

export const runtime = 'nodejs'

/**
 * Natural-language command endpoint. Accepts the conversation so far and returns
 * either a clarifying reply or a proposed operation + preview. NEVER writes —
 * confirmation goes to /api/payroll/agent/execute.
 */
export async function POST(request: Request) {
  let body: { messages?: ChatTurn[]; message?: string }
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

  try {
    const prompt = [...history].reverse().find((m) => m.role === 'user')?.content
    const ctx = await buildOperationContext('agent', prompt)
    const result = await runAgent(ctx, history)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
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
