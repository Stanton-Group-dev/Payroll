/**
 * Agent tool surface. Claude is given read/resolve tools plus a terminal
 * `propose_operation` tool. The model resolves names → ids and a date, then
 * proposes a structured operation; the server turns that proposal into a
 * preview (never executing inside the agent turn). All execution flows back
 * through the audited operation layer on explicit user confirmation.
 */
import { parseISO } from 'date-fns'
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
import { resolveWeeks, queryPay, queryTimeEntries, queryPayrollComparison } from './queries'

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ToolOutcome =
  | { kind: 'tool_result'; content: string }
  | { kind: 'proposal'; operation: string; input: unknown; assumptions?: string }

/**
 * 'report' mode exposes only read/resolve tools (no writes). 'full' mode adds
 * the terminal propose_operation write tool. The console picks the mode by role.
 */
export type AgentMode = 'report' | 'full'

export function buildTools(mode: AgentMode = 'full'): ToolDef[] {
  const opList = listOperations()
    .map((o) => `- ${o.name}: ${o.description}`)
    .join('\n')

  const readTools: ToolDef[] = [
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
      name: 'resolve_date_range',
      description:
        'Resolve a span of payroll weeks for reporting. Use lastNWeeks for "last/past N weeks", or fromPhrase/toPhrase for an explicit range ("from march 1 to april 1"). Returns the weeks plus the overall fromDate/toDate (ISO) to pass to query_time_entries.',
      input_schema: {
        type: 'object',
        properties: {
          lastNWeeks: { type: 'number', description: 'e.g. 5 for "the last 5 weeks"' },
          fromPhrase: { type: 'string', description: 'Natural-language start, e.g. "march 1"' },
          toPhrase: { type: 'string', description: 'Natural-language end, e.g. "today"' },
        },
      },
    },
    {
      name: 'query_pay',
      description:
        'Report how much an employee was paid (gross pay) over a span of weeks, using the canonical payroll math. Pass employeeId (from resolve_employee) and a span via lastNWeeks OR fromDate/toDate (ISO). Omit employeeId to get per-week totals across everyone. Returns a per-week breakdown and the total.',
      input_schema: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          lastNWeeks: { type: 'number' },
          fromDate: { type: 'string', description: 'ISO yyyy-MM-dd' },
          toDate: { type: 'string', description: 'ISO yyyy-MM-dd' },
        },
      },
    },
    {
      name: 'query_time_entries',
      description:
        'Report hours worked. Filter by employeeId, propertyId (answers "was he at <property>"), and a date window fromDate/toDate (ISO). status:"active" (default) counts current hours; status:"removed" counts knocked-off / soft-deleted hours ("how many hours did we knock off"); status:"all" counts both. Returns the matching entries and the summed hours.',
      input_schema: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          propertyId: { type: 'string' },
          fromDate: { type: 'string', description: 'ISO yyyy-MM-dd' },
          toDate: { type: 'string', description: 'ISO yyyy-MM-dd' },
          status: { type: 'string', enum: ['active', 'removed', 'all'] },
        },
      },
    },
    {
      name: 'compare_payroll',
      description:
        'Run payroll for a week and compare it to the prior week. Identify the week with weekId, or with a date inside it via the `date` phrase ("this week", "wednesday of last week", "2026-05-27"). Returns total deltas (gross pay, taxes, workers comp, mgmt fee, prefund, hours), per-employee and per-property changes, and plain-language highlights. Use this for "run payroll and compare to last week".',
      input_schema: {
        type: 'object',
        properties: {
          weekId: { type: 'string' },
          date: { type: 'string', description: 'A natural-language date or ISO date inside the target week.' },
        },
      },
    },
  ]

  if (mode === 'report') return readTools

  const proposeOperation: ToolDef = {
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
  }

  return [...readTools, proposeOperation]
}

export function systemPrompt(
  today: Date,
  mode: AgentMode = 'full',
  weekContext?: { weekStart: string; weekEnd: string } | null
): string {
  const iso = today.toISOString().slice(0, 10)
  const viewedWeek = weekContext
    ? `The user is currently viewing the payroll week of ${weekContext.weekStart} through ${weekContext.weekEnd}. Bare or relative weekday phrases ("monday", "wednesday", "this week") refer to THIS week, not the calendar week containing today. The resolvers already anchor to it — just pass the phrase. Phrases like "today", "yesterday", "last friday", or an explicit date are still literal.`
    : ''
  const common = [
    'You are the payroll assistant for Stanton Management.',
    `Today is ${iso}. Payroll weeks run Sunday through Saturday.`,
    ...(viewedWeek ? ['', viewedWeek] : []),
    '',
    'Reading & reporting (always available):',
    '- Never invent ids. Use resolve_employee / resolve_property / resolve_portfolio to turn names into ids, and resolve_date / resolve_date_range to turn phrases into ISO dates and payroll weeks.',
    '- If a resolver returns status "ambiguous" or "none", ask a brief clarifying question instead of guessing.',
    '- For "how much was X paid": resolve_employee, then query_pay with that employeeId and the span (lastNWeeks, or fromDate/toDate). Report the per-week amounts and the total. Use only the numbers the tools return — never estimate.',
    '- For "how many hours" / "was X at <property>": use query_time_entries. Resolve the property first when one is named, and a date window with resolve_date_range when a span is implied. "How many hours did we knock off" means status:"removed".',
    '- For "run payroll and compare to last week" (or any week-over-week payroll question): use compare_payroll with a `date` inside the target week (e.g. "this week", "last week") or a weekId. Lead with the gross-pay delta and the notable highlights, then offer the per-employee breakdown.',
    '- Format money as US dollars and keep replies tight; a short summary plus a small table is ideal.',
  ]

  if (mode === 'report') {
    return [
      ...common,
      '',
      'You are in READ-ONLY mode: you answer questions and produce reports to help managers respond to employees. You CANNOT change any data and have no write tools. If asked to add, edit, or remove anything, explain that changes must be made by a super-admin.',
    ].join('\n')
  }

  return [
    ...common,
    '',
    'Writing (super-admin):',
    '- "across the <X> portfolio" means allocation mode "portfolio" (hours are spread, unit-weighted, across that portfolio\'s properties).',
    '- A single named property means mode "property". If no location is given, ask; do not silently leave it unallocated unless the user says "unallocated".',
    '- For employee changes (add/update/deactivate/reactivate): adding a new hire needs no resolve (it is a new name); for changes to an existing person, use resolve_employee first (pass includeInactive:true when reactivating). New hires need a type and the matching rate (hourly/contractor → hourlyRate, salaried → weeklyRate); if the type or rate is missing, ask.',
    '- For external projects (non-portfolio client work like "Zimmerman"): adding is a new name (no resolve); to change/deactivate/reactivate an existing one, use resolve_external_project first (includeInactive:true when reactivating). Adding one needs name, clientName, and billedTo; if billedTo is missing, ask who receives the invoice.',
    '- To make a change, call propose_operation exactly once after everything is resolved. Do not execute anything yourself — the user confirms the preview.',
  ].join('\n')
}

/**
 * Execute a non-terminal tool call and return content to feed back to the model.
 * `weekAnchorIso` is the Sunday week_start of the week the user is viewing, used
 * to anchor bare/relative weekday phrases ("monday", "this week") to that week.
 */
export async function dispatchTool(
  ctx: OperationContext,
  name: string,
  input: Record<string, unknown>,
  weekAnchorIso?: string | null
): Promise<ToolOutcome> {
  const weekAnchor = weekAnchorIso ? parseISO(weekAnchorIso) : undefined
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
      const parsed = parseRelativeDate(String(input.phrase ?? ''), new Date(), weekAnchor)
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
    case 'resolve_date_range': {
      const opts: { lastNWeeks?: number; fromDate?: string; toDate?: string } = {}
      if (typeof input.lastNWeeks === 'number') opts.lastNWeeks = input.lastNWeeks
      if (input.fromPhrase) {
        const p = parseRelativeDate(String(input.fromPhrase), new Date(), weekAnchor)
        if (p) opts.fromDate = p.iso
      }
      if (input.toPhrase) {
        const p = parseRelativeDate(String(input.toPhrase), new Date(), weekAnchor)
        if (p) opts.toDate = p.iso
      }
      const weeks = await resolveWeeks(ctx, opts)
      if (weeks.length === 0) return ok({ status: 'none', message: 'No payroll weeks found in that span.' })
      return ok({
        status: 'ok',
        weeks,
        fromDate: weeks[0].week_start,
        toDate: weeks[weeks.length - 1].week_end,
      })
    }
    case 'query_pay': {
      const weeks = await resolveWeeks(ctx, {
        lastNWeeks: typeof input.lastNWeeks === 'number' ? input.lastNWeeks : undefined,
        fromDate: input.fromDate ? String(input.fromDate) : undefined,
        toDate: input.toDate ? String(input.toDate) : undefined,
      })
      if (weeks.length === 0) return ok({ status: 'none', message: 'No payroll weeks found in that span.' })
      const report = await queryPay(ctx, {
        employeeId: input.employeeId ? String(input.employeeId) : undefined,
        weeks,
      })
      return ok({ status: 'ok', ...report })
    }
    case 'query_time_entries': {
      const report = await queryTimeEntries(ctx, {
        employeeId: input.employeeId ? String(input.employeeId) : undefined,
        propertyId: input.propertyId ? String(input.propertyId) : undefined,
        fromDate: input.fromDate ? String(input.fromDate) : undefined,
        toDate: input.toDate ? String(input.toDate) : undefined,
        status:
          input.status === 'removed' || input.status === 'all' ? input.status : 'active',
      })
      return ok({ ...report, status: 'ok' })
    }
    case 'compare_payroll': {
      try {
        const report = await queryPayrollComparison(ctx, {
          weekId: input.weekId ? String(input.weekId) : undefined,
          date: input.date ? String(input.date) : undefined,
        })
        return ok({ status: 'ok', ...report })
      } catch (err) {
        return ok({ status: 'error', message: err instanceof Error ? err.message : 'comparison failed' })
      }
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
