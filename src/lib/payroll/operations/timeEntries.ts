/**
 * Time-entry operations: add, adjust, remove.
 *
 * These are the canonical, audited mutations for payroll time. The UI and the
 * natural-language agent both call them; resolution of names → ids happens
 * upstream (see lib/payroll/resolve), so these operations deal only in ids and
 * are fully deterministic.
 */
import { z } from 'zod'
import type { Operation, OperationContext, Plan, PlannedChange } from './core'
import {
  resolveWeekForDate,
  isWeekEditable,
  type ResolvedWeek,
} from '@/lib/payroll/resolve/dates'
import { propertiesInPortfolio, type ResolvedProperty } from '@/lib/payroll/resolve/entities'

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-MM-dd')
const HOURS = z.number().positive('hours must be > 0').max(24, 'hours cannot exceed 24 for a single day')
const HOUR_TYPE = z.enum(['regular', 'ot', 'pto']).default('regular')

const allocationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('property'), propertyId: z.string().uuid() }),
  z.object({ mode: z.literal('portfolio'), portfolioId: z.string().min(1) }),
  z.object({ mode: z.literal('unallocated') }),
])

export const addTimeSchema = z.object({
  employeeId: z.string().uuid(),
  date: ISO_DATE,
  hours: HOURS,
  hourType: HOUR_TYPE,
  allocation: allocationSchema,
  reason: z.string().max(500).optional(),
})
export type AddTimeInput = z.infer<typeof addTimeSchema>

interface EmployeeRow {
  id: string
  name: string
  is_active: boolean
}

const HOUR_COLUMN: Record<'regular' | 'ot' | 'pto', 'regular_hours' | 'ot_hours' | 'pto_hours'> = {
  regular: 'regular_hours',
  ot: 'ot_hours',
  pto: 'pto_hours',
}

async function loadEmployee(ctx: OperationContext, id: string): Promise<EmployeeRow | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_employees')
    .select('id, name, is_active')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load employee: ${error.message}`)
  return (data as EmployeeRow | null) ?? null
}

async function hoursLoggedOnDate(
  ctx: OperationContext,
  employeeId: string,
  weekId: string,
  date: string
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('payroll_time_entries')
    .select('regular_hours, ot_hours, pto_hours')
    .eq('employee_id', employeeId)
    .eq('payroll_week_id', weekId)
    .eq('entry_date', date)
    .eq('is_active', true)
  if (error) throw new Error(`Failed to total existing hours: ${error.message}`)
  return (data ?? []).reduce(
    (sum: number, r: { regular_hours: number; ot_hours: number; pto_hours: number }) =>
      sum + Number(r.regular_hours) + Number(r.ot_hours) + Number(r.pto_hours),
    0
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Split `total` hours across properties weighted by unit count (even fallback). */
export function splitHoursByUnits(
  total: number,
  props: ResolvedProperty[]
): { property: ResolvedProperty; hours: number }[] {
  if (props.length === 0) return []
  const weights = props.map((p) => Math.max(p.total_units ?? 0, 0))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const even = weightSum <= 0

  const allocated = props.map((p, i) => ({
    property: p,
    hours: round2(total * (even ? 1 / props.length : weights[i] / weightSum)),
  }))

  // Push any rounding remainder onto the largest allocation so the split sums
  // exactly to `total`.
  const diff = round2(total - allocated.reduce((s, a) => s + a.hours, 0))
  if (diff !== 0) {
    let idx = 0
    for (let i = 1; i < allocated.length; i++) if (allocated[i].hours > allocated[idx].hours) idx = i
    allocated[idx].hours = round2(allocated[idx].hours + diff)
  }
  return allocated.filter((a) => a.hours > 0)
}

function entryRow(params: {
  weekId: string
  employeeId: string
  propertyId: string | null
  date: string
  hours: number
  hourType: 'regular' | 'ot' | 'pto'
  source: string
  flagged: boolean
  flagReason: string | null
  spreadEventId: string | null
  actorId: string | null
}) {
  return {
    payroll_week_id: params.weekId,
    employee_id: params.employeeId,
    property_id: params.propertyId,
    entry_date: params.date,
    regular_hours: params.hourType === 'regular' ? params.hours : 0,
    ot_hours: params.hourType === 'ot' ? params.hours : 0,
    pto_hours: params.hourType === 'pto' ? params.hours : 0,
    source: params.source,
    is_flagged: params.flagged,
    flag_reason: params.flagReason,
    spread_event_id: params.spreadEventId,
    created_by: params.actorId,
  }
}

export interface AddTimeResult {
  weekId: string
  entryIds: string[]
  spreadEventId: string | null
}

export const addTime: Operation<AddTimeInput, AddTimeResult> = {
  name: 'time_entry.add',
  description:
    'Add hours for an employee on a date, allocated to a single property, spread across a portfolio (unit-weighted), or left unallocated.',
  schema: addTimeSchema,
  async plan(ctx, input): Promise<Plan<AddTimeResult>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    const employee = await loadEmployee(ctx, input.employeeId)
    if (!employee) blockers.push(`employee ${input.employeeId} not found`)
    else if (!employee.is_active) blockers.push(`employee ${employee.name} is inactive`)

    const week: ResolvedWeek | null = await resolveWeekForDate(ctx, input.date)
    if (!week) {
      blockers.push(`no payroll week contains ${input.date} (create the week first)`)
    } else if (!isWeekEditable(week.status)) {
      blockers.push(
        `week of ${week.week_start} is ${week.status} and locked — use a carry-forward adjustment instead`
      )
    }

    const empName = employee?.name ?? input.employeeId
    const hourLabel = input.hourType === 'regular' ? 'h' : ` ${input.hourType} h`

    // Hours sanity vs. what's already on the day.
    if (week && employee) {
      const existing = await hoursLoggedOnDate(ctx, input.employeeId, week.id, input.date)
      if (existing + input.hours > 24) {
        warnings.push(
          `${empName} would have ${round2(existing + input.hours)}h logged on ${input.date} (over 24h)`
        )
      }
    }

    const reason = input.reason ?? 'manual entry via operation layer'
    const rowsToInsert: ReturnType<typeof entryRow>[] = []
    let spreadEvent: { date: string; hours: number; portfolioId: string; reason: string } | null = null
    let targetType = 'time_entry'
    let targetDescr = ''

    if (input.allocation.mode === 'property') {
      const { data: prop, error } = await ctx.supabase
        .from('properties')
        .select('id, code, name, is_active')
        .eq('id', input.allocation.propertyId)
        .maybeSingle()
      if (error) throw new Error(`Failed to load property: ${error.message}`)
      if (!prop) blockers.push(`property ${input.allocation.propertyId} not found`)
      else if (!prop.is_active) blockers.push(`property ${prop.code} is inactive`)
      const label = prop ? `${prop.code} — ${prop.name}` : input.allocation.propertyId
      targetDescr = label
      if (week) {
        rowsToInsert.push(
          entryRow({
            weekId: week.id,
            employeeId: input.employeeId,
            propertyId: input.allocation.propertyId,
            date: input.date,
            hours: input.hours,
            hourType: input.hourType,
            source: 'manual_manager',
            flagged: false,
            flagReason: null,
            spreadEventId: null,
            actorId: ctx.actor.id,
          })
        )
      }
      changes.push({
        kind: 'create',
        entity: 'time_entry',
        description: `${input.hours}${hourLabel} for ${empName} on ${input.date} → ${label}`,
      })
    } else if (input.allocation.mode === 'unallocated') {
      targetDescr = 'unallocated (flagged)'
      if (week) {
        rowsToInsert.push(
          entryRow({
            weekId: week.id,
            employeeId: input.employeeId,
            propertyId: null,
            date: input.date,
            hours: input.hours,
            hourType: input.hourType,
            source: 'manual_manager',
            flagged: true,
            flagReason: 'manual unallocated — needs property assignment',
            spreadEventId: null,
            actorId: ctx.actor.id,
          })
        )
      }
      changes.push({
        kind: 'create',
        entity: 'time_entry',
        description: `${input.hours}${hourLabel} for ${empName} on ${input.date} → unallocated (flagged for correction)`,
      })
    } else {
      // Portfolio spread.
      targetType = 'spread_event'
      const portfolioId = input.allocation.portfolioId
      const { data: portfolio } = await ctx.supabase
        .from('portfolios')
        .select('id, name')
        .eq('id', portfolioId)
        .maybeSingle()
      const portfolioName = portfolio?.name ?? portfolioId
      targetDescr = `${portfolioName} (spread)`
      const props = week ? await propertiesInPortfolio(ctx, portfolioId) : []
      if (week && props.length === 0) {
        blockers.push(`portfolio ${portfolioName} has no active properties to spread across`)
      }
      const split = splitHoursByUnits(input.hours, props)
      spreadEvent = { date: input.date, hours: input.hours, portfolioId, reason }
      changes.push({
        kind: 'create',
        entity: 'spread_event',
        description: `Spread ${input.hours}${hourLabel} for ${empName} on ${input.date} across ${split.length} ${portfolioName} properties (unit-weighted)`,
      })
      for (const part of split) {
        changes.push({
          kind: 'create',
          entity: 'time_entry',
          description: `  • ${part.hours}${hourLabel} → ${part.property.code} ${part.property.name}`,
        })
        if (week) {
          rowsToInsert.push(
            entryRow({
              weekId: week.id,
              employeeId: input.employeeId,
              propertyId: part.property.id,
              date: input.date,
              hours: part.hours,
              hourType: input.hourType,
              source: 'manual_spread',
              flagged: false,
              flagReason: null,
              spreadEventId: null, // set after the spread event is created in commit
              actorId: ctx.actor.id,
            })
          )
        }
      }
    }

    const summary = `Add ${input.hours}${hourLabel} for ${empName} on ${input.date} → ${targetDescr}`

    return {
      operation: this.name,
      summary,
      weekId: week?.id ?? null,
      targetType,
      targetId: input.employeeId,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx): Promise<AddTimeResult> {
        if (!week) throw new Error('cannot commit: no week resolved')
        let spreadEventId: string | null = null

        if (spreadEvent) {
          const { data: se, error: seErr } = await commitCtx.supabase
            .from('payroll_spread_events')
            .insert({
              payroll_week_id: week.id,
              employee_id: input.employeeId,
              entry_date: spreadEvent.date,
              total_hours: spreadEvent.hours,
              portfolio_id: spreadEvent.portfolioId,
              reason: spreadEvent.reason,
              created_by: commitCtx.actor.id,
            })
            .select('id')
            .single()
          if (seErr) throw new Error(`Failed to create spread event: ${seErr.message}`)
          spreadEventId = se.id as string
        }

        const rows = rowsToInsert.map((r) =>
          spreadEventId ? { ...r, spread_event_id: spreadEventId } : r
        )
        const { data: inserted, error } = await commitCtx.supabase
          .from('payroll_time_entries')
          .insert(rows)
          .select('id')
        if (error) throw new Error(`Failed to insert time entries: ${error.message}`)

        return {
          weekId: week.id,
          entryIds: (inserted ?? []).map((r: { id: string }) => r.id),
          spreadEventId,
        }
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* adjust + remove                                                     */
/* ------------------------------------------------------------------ */

interface EntryWithWeek {
  id: string
  payroll_week_id: string
  employee_id: string
  property_id: string | null
  entry_date: string
  regular_hours: number
  ot_hours: number
  pto_hours: number
  is_active: boolean
  week: { status: string; week_start: string } | null
  employee: { name: string } | null
}

async function loadEntry(ctx: OperationContext, id: string): Promise<EntryWithWeek | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_time_entries')
    .select(
      `id, payroll_week_id, employee_id, property_id, entry_date,
       regular_hours, ot_hours, pto_hours, is_active,
       week:payroll_weeks(status, week_start),
       employee:payroll_employees(name)`
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load time entry: ${error.message}`)
  if (!data) return null
  // Supabase returns embedded to-one relations as arrays under some configs.
  const row = data as unknown as Record<string, unknown>
  const week = Array.isArray(row.week) ? row.week[0] : row.week
  const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee
  return { ...(data as unknown as EntryWithWeek), week: (week as EntryWithWeek['week']) ?? null, employee: (employee as EntryWithWeek['employee']) ?? null }
}

export const adjustTimeSchema = z
  .object({
    entryId: z.string().uuid(),
    hours: HOURS.optional(),
    hourType: HOUR_TYPE.optional(),
    propertyId: z.string().uuid().nullable().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.hours !== undefined || v.propertyId !== undefined, {
    message: 'adjust requires at least one of hours or propertyId',
  })
export type AdjustTimeInput = z.infer<typeof adjustTimeSchema>

export const adjustTime: Operation<AdjustTimeInput, { entryId: string }> = {
  name: 'time_entry.adjust',
  description: 'Change the hours and/or property of an existing time entry.',
  schema: adjustTimeSchema,
  async plan(ctx, input): Promise<Plan<{ entryId: string }>> {
    const blockers: string[] = []
    const warnings: string[] = []
    const changes: PlannedChange[] = []
    const entry = await loadEntry(ctx, input.entryId)
    if (!entry) blockers.push(`time entry ${input.entryId} not found`)
    else if (!entry.is_active) blockers.push('time entry is inactive')
    else if (entry.week && !isWeekEditable(entry.week.status)) {
      blockers.push(`week of ${entry.week.week_start} is ${entry.week.status} and locked`)
    }

    const update: Record<string, unknown> = {}
    if (entry && input.hours !== undefined) {
      const col = HOUR_COLUMN[input.hourType ?? 'regular']
      update[col] = input.hours
      const before = Number(entry[col])
      changes.push({
        kind: 'update',
        entity: 'time_entry',
        description: `${col} ${before} → ${input.hours} for ${entry.employee?.name ?? entry.employee_id} on ${entry.entry_date}`,
      })
    }
    if (entry && input.propertyId !== undefined) {
      update.property_id = input.propertyId
      update.is_flagged = input.propertyId === null
      changes.push({
        kind: 'update',
        entity: 'time_entry',
        description: `property → ${input.propertyId ?? 'unallocated'}`,
      })
    }

    return {
      operation: this.name,
      summary: entry
        ? `Adjust time entry for ${entry.employee?.name ?? entry.employee_id} on ${entry.entry_date}`
        : `Adjust time entry ${input.entryId}`,
      weekId: entry?.payroll_week_id ?? null,
      targetType: 'time_entry',
      targetId: input.entryId,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx) {
        const { error } = await commitCtx.supabase
          .from('payroll_time_entries')
          .update(update)
          .eq('id', input.entryId)
        if (error) throw new Error(`Failed to adjust time entry: ${error.message}`)
        return { entryId: input.entryId }
      },
    }
  },
}

export const removeTimeSchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})
export type RemoveTimeInput = z.infer<typeof removeTimeSchema>

export const removeTime: Operation<RemoveTimeInput, { entryId: string }> = {
  name: 'time_entry.remove',
  description: 'Deactivate (soft-delete) a time entry. No hard deletes.',
  schema: removeTimeSchema,
  async plan(ctx, input): Promise<Plan<{ entryId: string }>> {
    const blockers: string[] = []
    const entry = await loadEntry(ctx, input.entryId)
    if (!entry) blockers.push(`time entry ${input.entryId} not found`)
    else if (!entry.is_active) blockers.push('time entry is already inactive')
    else if (entry.week && !isWeekEditable(entry.week.status)) {
      blockers.push(`week of ${entry.week.week_start} is ${entry.week.status} and locked`)
    }
    const hours = entry ? Number(entry.regular_hours) + Number(entry.ot_hours) + Number(entry.pto_hours) : 0
    return {
      operation: this.name,
      summary: entry
        ? `Remove ${hours}h entry for ${entry.employee?.name ?? entry.employee_id} on ${entry.entry_date}`
        : `Remove time entry ${input.entryId}`,
      weekId: entry?.payroll_week_id ?? null,
      targetType: 'time_entry',
      targetId: input.entryId,
      changes: [
        {
          kind: 'deactivate',
          entity: 'time_entry',
          description: entry
            ? `Deactivate ${hours}h on ${entry.entry_date}`
            : `Deactivate ${input.entryId}`,
        },
      ],
      warnings: [],
      blockers,
      input,
      async commit(commitCtx) {
        const { error } = await commitCtx.supabase
          .from('payroll_time_entries')
          .update({ is_active: false })
          .eq('id', input.entryId)
        if (error) throw new Error(`Failed to remove time entry: ${error.message}`)
        return { entryId: input.entryId }
      },
    }
  },
}
