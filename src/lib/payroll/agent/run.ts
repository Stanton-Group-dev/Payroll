/**
 * The agent loop. Runs Claude with the payroll tool surface until it either
 * replies in plain text (e.g. a clarifying question) or proposes one operation.
 * A proposal is turned into a preview via the operation layer and returned —
 * nothing is ever written here. Execution happens only on explicit confirm,
 * through executeOperation in the /execute route.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { OperationContext, PlanPreview } from '@/lib/payroll/operations/core'
import { previewOperation } from '@/lib/payroll/operations/core'
import { getOperation } from '@/lib/payroll/operations'
import { buildTools, dispatchTool, systemPrompt, type AgentMode } from './tools'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_TURNS = 6

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentProposal {
  operation: string
  input: unknown
  assumptions?: string
  preview: PlanPreview
}

export interface AgentResult {
  assistantText: string
  proposal?: AgentProposal
}

export class AgentUnavailableError extends Error {
  constructor() {
    super('Natural-language commands are unavailable: ANTHROPIC_API_KEY is not configured on the server.')
    this.name = 'AgentUnavailableError'
  }
}

export interface WeekContext {
  weekStart: string
  weekEnd: string
}

export async function runAgent(
  ctx: OperationContext,
  history: ChatTurn[],
  mode: AgentMode = 'full',
  weekContext?: WeekContext | null
): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new AgentUnavailableError()

  const client = new Anthropic({ apiKey })
  const model = process.env.PAYROLL_AGENT_MODEL || DEFAULT_MODEL
  const tools = buildTools(mode) as Anthropic.Tool[]
  const today = new Date()
  const weekAnchorIso = weekContext?.weekStart ?? null

  const messages: Anthropic.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }))

  let assistantText = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt(today, mode, weekContext),
      tools,
      messages,
    })

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (text) assistantText = text

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { assistantText }
    }

    messages.push({ role: 'assistant', content: resp.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const tu of toolUses) {
      const outcome = await dispatchTool(ctx, tu.name, (tu.input ?? {}) as Record<string, unknown>, weekAnchorIso)

      if (outcome.kind === 'proposal') {
        const op = getOperation(outcome.operation)
        if (!op) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify({ error: `unknown operation ${outcome.operation}` }),
            is_error: true,
          })
          continue
        }
        try {
          const preview = await previewOperation(ctx, op, outcome.input)
          return {
            assistantText,
            proposal: {
              operation: outcome.operation,
              input: outcome.input,
              assumptions: outcome.assumptions,
              preview,
            },
          }
        } catch (err) {
          // Feed validation errors back so the model can correct the input.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
              issues: (err as { issues?: unknown }).issues,
            }),
            is_error: true,
          })
        }
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: outcome.content })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return {
    assistantText:
      assistantText || 'I wasn\'t able to resolve that into a single action — could you rephrase?',
  }
}
