/**
 * Agent tool surface. Claude is given read/resolve tools plus a terminal
 * `propose_operation` tool. The model resolves names → ids and a date, then
 * proposes a structured operation; the server turns that proposal into a
 * preview (never executing inside the agent turn). All execution flows back
 * through the audited operation layer on explicit user confirmation.
 */
import type { OperationContext } from '@/lib/payroll/operations/core'
import { listOperations } from '@/lib/payroll/operations'
import {
  resolveEmployee,
  resolvePortfolio,
  resolveProperty,
  resolveExternalProject,
  candidateSummary,
} from '@/lib/payroll/resolve/entities'
import { parseRelativeDate, resolveWeekForDate } from '@/lib/payroll/resolve/dates'

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ToolOutcome =
  | { kind: 'tool_result'; content: string }
  | { kind: 'proposal'; operation: string; input: unknown; assumptions?: string }

export function buildTools(): ToolDef[] {
  const opList = listOperations()
    .map((o) => `- ${o.name}: ${o.description}`)
    .join('\n')

  return [
    {
      name: 'resolve_employee',
      description: 'Resolve a typed employee name (e.g. "stan") to an employee id.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The name as the user typed it.' },
          includeInactive: { type: 'boolean' },
        },
        required: ['query'],
      },
    },
    {
      name: 'resolve_portfolio',
      description: 'Resolve a typed portfolio name (e.g. "park") to a portfolio id.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'resolve_property',
      description: 'Resolve a typed property name or code to a property id. Optionally scope to a portfolio.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          portfolioId: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'resolve_external_project',
      description:
        'Resolve a typed external-project or client name (e.g. "zimmerman") to an external-project id. Pass includeInactive:true to also match deactivated projects (e.g. when reactivating).',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          includeInactive: { type: 'boolean' },
        },
        required: ['query'],
      },
    },
    {
      name: 'resolve_date',
      description:
        'Convert a natural-language date phrase ("wednesday of last week", "yesterday", "3/11") to an ISO date and the payroll week it falls in.',
      input_schema: {
        type: 'object',
        properties: { phrase: { type: 'string' } },
        required: ['phrase'],
      },
    },
    {
      name: 'find_time_entries',
      description:
        'List active time entries to adjust or remove. Filter by employeeId and/or ISO date. Returns entry ids.',
      input_schema: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          date: { type: 'string', description: 'ISO yyyy-MM-dd' },
        },
      },
    },
    {
      name: 'propose_operation',
      description:
        `Propose a payroll write to show the user for confirmation. Do NOT call until all names are resolved to ids and any date to ISO. Available operations:\n${opList}`,
      input_schema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Operation name, e.g. time_entry.add' },
          input: {
            type: 'object',
            description:
              'Fully-resolved operation input. Shapes by operation:\n' +
              '- time_entry.add: { employeeId, date (ISO), hours, hourType?, allocation: {mode:"property",propertyId} | {mode:"portfolio",portfolioId} | {mode:"unallocated"}, reason? }\n' +
              '- employee.add: { name, type:"hourly"|"salaried"|"contractor", hourlyRate? (hourly/contractor), weeklyRate? (salaried), trade?, workyardId?, otAllowed?, payTax?, wc?, isManagement?, reason? }\n' +
              '- employee.update: { employeeId, and any of name/type/hourlyRate/weeklyRate/trade/workyardId/otAllowed/payTax/wc/isManagement, reason? }\n' +
              '- employee.deactivate / employee.reactivate: { employeeId, reason? }\n' +
              '- external_project.add: { name, clientName, billedTo, notes?, workyardCustomerNames?, isActive?, reason? }\n' +
              '- external_project.update: { projectId, and any of name/clientName/billedTo/notes/workyardCustomerNames, reason? }\n' +
              '- external_project.deactivate / external_project.reactivate: { projectId, reason? }',
          },
          assumptions: {
            type: 'string',
            description: 'Any assumptions made (e.g. which week, even-vs-unit split) the user should verify.',
          },
        },
        required: ['operation', 'input'],
      },
    },
  ]
}

export function systemPrompt(today: Date): string {
  const iso = today.toISOString().slice(0, 10)
  return [
    'You are the payroll command assistant for Stanton Management.',
    `Today is ${iso}. Payroll weeks run Sunday through Saturday.`,
    '',
    'Your job: turn a manager\'s plain-language request into ONE proposed payroll operation.',
    'Rules:',
    '- Never invent ids. Use resolve_* tools to turn names and dates into ids/ISO dates.',
    '- If a resolver returns status "ambiguous" or "none", ask the user a brief clarifying question instead of guessing.',
    '- "across the <X> portfolio" means allocation mode "portfolio" (hours are spread, unit-weighted, across that portfolio\'s properties).',
    '- A single named property means mode "property". If no location is given, ask; do not silently leave it unallocated unless the user says "unallocated".',
    '- For employee changes (add/update/deactivate/reactivate): adding a new hire needs no resolve (it is a new name); for changes to an existing person, use resolve_employee first (pass includeInactive:true when reactivating). New hires need a type and the matching rate (hourly/contractor → hourlyRate, salaried → weeklyRate); if the type or rate is missing, ask.',
    '- For external projects (non-portfolio client work like "Zimmerman"): adding is a new name (no resolve); to change/deactivate/reactivate an existing one, use resolve_external_project first (includeInactive:true when reactivating). Adding one needs name, clientName, and billedTo; if billedTo is missing, ask who receives the invoice.',
    '- Once everything is resolved, call propose_operation exactly once. Do not execute anything yourself — the user confirms the preview.',
    '- Keep any text replies short.',
  ].join('\n')
}

/** Execute a non-terminal tool call and return content to feed back to the model. */
export async function dispatchTool(
  ctx: OperationContext,
  name: string,
  input: Record<string, unknown>
): Promise<ToolOutcome> {
  switch (name) {
    case 'resolve_employee': {
      const res = await resolveEmployee(ctx, String(input.query ?? ''), Boolean(input.includeInactive))
      if (res.status === 'unique') {
        return ok({ status: 'unique', employee: { id: res.match.id, name: res.match.name } })
      }
      return ok({ status: res.status, candidates: candidateSummary(res.candidates) })
    }
    case 'resolve_portfolio': {
      const res = await resolvePortfolio(ctx, String(input.query ?? ''))
      if (res.status === 'unique') {
        return ok({ status: 'unique', portfolio: { id: res.match.id, name: res.match.name } })
      }
      return ok({ status: res.status, candidates: candidateSummary(res.candidates) })
    }
    case 'resolve_property': {
      const res = await resolveProperty(
        ctx,
        String(input.query ?? ''),
        input.portfolioId ? String(input.portfolioId) : undefined
      )
      if (res.status === 'unique') {
        return ok({
          status: 'unique',
          property: { id: res.match.id, code: res.match.code, name: res.match.name },
        })
      }
      return ok({ status: res.status, candidates: candidateSummary(res.candidates) })
    }
    case 'resolve_external_project': {
      const res = await resolveExternalProject(
        ctx,
        String(input.query ?? ''),
        Boolean(input.includeInactive)
      )
      if (res.status === 'unique') {
        return ok({
          status: 'unique',
          project: { id: res.match.id, name: res.match.name, client_name: res.match.client_name },
        })
      }
      return ok({ status: res.status, candidates: candidateSummary(res.candidates) })
    }
    case 'resolve_date': {
      const parsed = parseRelativeDate(String(input.phrase ?? ''))
      if (!parsed) return ok({ status: 'unparsed', message: 'Could not parse that date.' })
      const week = await resolveWeekForDate(ctx, parsed.iso)
      return ok({
        status: 'ok',
        iso: parsed.iso,
        description: parsed.description,
        week: week
          ? { id: week.id, status: week.status, week_start: week.week_start, week_end: week.week_end }
          : null,
      })
    }
    case 'find_time_entries': {
      let q = ctx.supabase
        .from('payroll_time_entries')
        .select('id, entry_date, regular_hours, ot_hours, pto_hours, property_id, is_flagged')
        .eq('is_active', true)
        .order('entry_date')
        .limit(50)
      if (input.employeeId) q = q.eq('employee_id', String(input.employeeId))
      if (input.date) q = q.eq('entry_date', String(input.date))
      const { data, error } = await q
      if (error) return ok({ status: 'error', message: error.message })
      return ok({ status: 'ok', entries: data ?? [] })
    }
    case 'propose_operation': {
      return {
        kind: 'proposal',
        operation: String(input.operation ?? ''),
        input: input.input,
        assumptions: input.assumptions ? String(input.assumptions) : undefined,
      }
    }
    default:
      return ok({ status: 'error', message: `unknown tool ${name}` })
  }
}

function ok(payload: unknown): ToolOutcome {
  return { kind: 'tool_result', content: JSON.stringify(payload) }
}
