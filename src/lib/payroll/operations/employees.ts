/**
 * Employee operations: add, update, deactivate, reactivate.
 *
 * The canonical, audited mutations for the employee roster. Like the time-entry
 * operations, these deal in validated input and ids; the natural-language agent
 * resolves names → ids upstream (see lib/payroll/resolve). Rate changes append a
 * row to payroll_employee_rates, preserving the institutional rate-history
 * convention that the UI hook (usePayrollEmployees) already follows, so the
 * operation path never loses rate history.
 */
import { z } from 'zod'
import type { Operation, OperationContext, Plan, PlannedChange } from './core'

const EMPLOYEE_TYPE = z.enum(['hourly', 'salaried', 'contractor'])
const PAY_GROUP = z.enum(['field', 'remote'])
const RATE = z.number().nonnegative('rate cannot be negative').max(100000, 'rate looks too large')
const NAME = z.string().trim().min(1, 'name is required').max(200)

/** yyyy-MM-dd for the server's current day; used as the rate effective_date. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The rate column that matters for a given employee type. */
function rateForType(
  type: 'hourly' | 'salaried' | 'contractor',
  hourlyRate: number | null | undefined,
  weeklyRate: number | null | undefined
): { column: 'hourly_rate' | 'weekly_rate'; value: number | null } {
  if (type === 'salaried') return { column: 'weekly_rate', value: weeklyRate ?? null }
  return { column: 'hourly_rate', value: hourlyRate ?? null }
}

interface EmployeeRow {
  id: string
  name: string
  type: 'hourly' | 'salaried' | 'contractor'
  pay_group: 'field' | 'remote'
  hourly_rate: number | null
  weekly_rate: number | null
  trade: string | null
  workyard_id: string | null
  monitask_id: string | null
  is_active: boolean
  ot_allowed: boolean
  pay_tax: boolean
  wc: boolean
  is_management: boolean
}

const EMPLOYEE_COLUMNS =
  'id, name, type, pay_group, hourly_rate, weekly_rate, trade, workyard_id, monitask_id, is_active, ot_allowed, pay_tax, wc, is_management'

async function loadEmployee(ctx: OperationContext, id: string): Promise<EmployeeRow | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_employees')
    .select(EMPLOYEE_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load employee: ${error.message}`)
  return (data as EmployeeRow | null) ?? null
}

/** Count active time entries for an employee in still-editable weeks. */
async function activeOpenEntries(ctx: OperationContext, employeeId: string): Promise<number> {
  const { count, error } = await ctx.supabase
    .from('payroll_time_entries')
    .select('id, payroll_weeks!inner(status)', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .in('payroll_weeks.status', ['draft', 'pending_review'])
  if (error) throw new Error(`Failed to check open time entries: ${error.message}`)
  return count ?? 0
}

/** Append a rate-history row (mirrors usePayrollEmployees' convention). */
async function recordRate(
  ctx: OperationContext,
  employeeId: string,
  rate: number,
  effectiveDate: string
): Promise<void> {
  const { error } = await ctx.supabase.from('payroll_employee_rates').insert({
    employee_id: employeeId,
    rate,
    effective_date: effectiveDate,
    created_by: ctx.actor.id,
  })
  if (error) throw new Error(`Failed to record rate history: ${error.message}`)
}

/* ------------------------------------------------------------------ */
/* employee.add                                                        */
/* ------------------------------------------------------------------ */

export const addEmployeeSchema = z
  .object({
    name: NAME,
    type: EMPLOYEE_TYPE,
    payGroup: PAY_GROUP.default('field'),
    hourlyRate: RATE.optional(),
    weeklyRate: RATE.optional(),
    trade: z.string().trim().max(100).optional(),
    workyardId: z.string().trim().min(1).max(100).optional(),
    monitaskId: z.string().trim().min(1).max(100).optional(),
    otAllowed: z.boolean().default(false),
    payTax: z.boolean().default(false),
    wc: z.boolean().default(false),
    isManagement: z.boolean().default(false),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => (v.type === 'salaried' ? v.weeklyRate !== undefined : v.hourlyRate !== undefined), {
    message: 'salaried employees need weeklyRate; hourly/contractor need hourlyRate',
    path: ['hourlyRate'],
  })
export type AddEmployeeInput = z.infer<typeof addEmployeeSchema>

export interface AddEmployeeResult {
  employeeId: string
}

export const addEmployee: Operation<AddEmployeeInput, AddEmployeeResult> = {
  name: 'employee.add',
  description:
    'Add a new employee to the roster (hourly, salaried, or contractor) with a starting rate. Records initial rate history.',
  schema: addEmployeeSchema,
  async plan(ctx, input): Promise<Plan<AddEmployeeResult>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    // Duplicate-name check: legitimately two people can share a name, so this is
    // a warning the manager confirms, not a hard block.
    const { data: sameName, error: nameErr } = await ctx.supabase
      .from('payroll_employees')
      .select('id, is_active')
      .ilike('name', input.name)
    if (nameErr) throw new Error(`Failed to check for duplicate name: ${nameErr.message}`)
    if ((sameName ?? []).length > 0) {
      warnings.push(`an employee named "${input.name}" already exists — confirm this is a different person`)
    }

    // workyard_id is UNIQUE in the DB; a clash is a real error, so block early
    // with a clear message rather than letting the insert fail opaquely.
    if (input.workyardId) {
      const { data: sameWy, error: wyErr } = await ctx.supabase
        .from('payroll_employees')
        .select('id, name')
        .eq('workyard_id', input.workyardId)
        .maybeSingle()
      if (wyErr) throw new Error(`Failed to check Workyard id: ${wyErr.message}`)
      if (sameWy) blockers.push(`Workyard id ${input.workyardId} is already used by ${sameWy.name}`)
    }

    if (input.monitaskId) {
      const { data: sameMt, error: mtErr } = await ctx.supabase
        .from('payroll_employees')
        .select('id, name')
        .eq('monitask_id', input.monitaskId)
        .maybeSingle()
      if (mtErr) throw new Error(`Failed to check Monitask id: ${mtErr.message}`)
      if (sameMt) blockers.push(`Monitask id ${input.monitaskId} is already used by ${sameMt.name}`)
    }

    const rate = rateForType(input.type, input.hourlyRate, input.weeklyRate)
    const effectiveDate = today()
    const rateLabel =
      rate.value === null
        ? 'no rate'
        : input.type === 'salaried'
          ? `$${rate.value}/wk`
          : `$${rate.value}/hr`

    const groupLabel = input.payGroup === 'remote' ? ' [remote]' : ''
    changes.push({
      kind: 'create',
      entity: 'employee',
      description: `Create ${input.type} employee "${input.name}" (${rateLabel})${groupLabel}`,
      after: {
        name: input.name,
        type: input.type,
        pay_group: input.payGroup,
        [rate.column]: rate.value,
        is_management: input.isManagement,
      },
    })
    if (rate.value !== null) {
      changes.push({
        kind: 'create',
        entity: 'employee_rate',
        description: `Record starting rate ${rateLabel} effective ${effectiveDate}`,
      })
    }

    return {
      operation: this.name,
      summary: `Add ${input.type} employee "${input.name}" (${rateLabel})`,
      weekId: null,
      targetType: 'employee',
      targetId: null,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx): Promise<AddEmployeeResult> {
        const { data: inserted, error } = await commitCtx.supabase
          .from('payroll_employees')
          .insert({
            name: input.name,
            type: input.type,
            pay_group: input.payGroup,
            hourly_rate: input.type === 'salaried' ? null : (input.hourlyRate ?? null),
            weekly_rate: input.type === 'salaried' ? (input.weeklyRate ?? null) : null,
            trade: input.trade ?? null,
            workyard_id: input.workyardId ?? null,
            monitask_id: input.monitaskId ?? null,
            ot_allowed: input.otAllowed,
            pay_tax: input.payTax,
            wc: input.wc,
            is_management: input.isManagement,
            created_by: commitCtx.actor.id,
          })
          .select('id')
          .single()
        if (error) throw new Error(`Failed to create employee: ${error.message}`)
        const employeeId = inserted.id as string
        if (rate.value !== null) await recordRate(commitCtx, employeeId, rate.value, effectiveDate)
        return { employeeId }
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* employee.update                                                     */
/* ------------------------------------------------------------------ */

export const updateEmployeeSchema = z
  .object({
    employeeId: z.string().uuid(),
    name: NAME.optional(),
    type: EMPLOYEE_TYPE.optional(),
    payGroup: PAY_GROUP.optional(),
    hourlyRate: RATE.optional(),
    weeklyRate: RATE.optional(),
    trade: z.string().trim().max(100).nullable().optional(),
    workyardId: z.string().trim().min(1).max(100).nullable().optional(),
    monitaskId: z.string().trim().min(1).max(100).nullable().optional(),
    otAllowed: z.boolean().optional(),
    payTax: z.boolean().optional(),
    wc: z.boolean().optional(),
    isManagement: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some((k) => k !== 'employeeId' && k !== 'reason' && v[k as keyof typeof v] !== undefined),
    { message: 'update requires at least one field to change' }
  )
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

export const updateEmployee: Operation<UpdateEmployeeInput, { employeeId: string }> = {
  name: 'employee.update',
  description:
    'Change an existing employee — name, type, rate, trade, Workyard id, or flags (ot/tax/wc/management). Rate changes append to rate history.',
  schema: updateEmployeeSchema,
  async plan(ctx, input): Promise<Plan<{ employeeId: string }>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    const emp = await loadEmployee(ctx, input.employeeId)
    if (!emp) blockers.push(`employee ${input.employeeId} not found`)

    const update: Record<string, unknown> = {}
    const effectiveDate = today()
    let newRate: number | null = null

    if (emp) {
      const effectiveType = input.type ?? emp.type

      if (input.name !== undefined && input.name !== emp.name) {
        update.name = input.name
        changes.push({ kind: 'update', entity: 'employee', description: `name "${emp.name}" → "${input.name}"` })
      }
      if (input.type !== undefined && input.type !== emp.type) {
        update.type = input.type
        changes.push({ kind: 'update', entity: 'employee', description: `type ${emp.type} → ${input.type}` })
      }
      if (input.payGroup !== undefined && input.payGroup !== emp.pay_group) {
        update.pay_group = input.payGroup
        changes.push({ kind: 'update', entity: 'employee', description: `pay group ${emp.pay_group} → ${input.payGroup}` })
      }
      if (input.trade !== undefined && input.trade !== emp.trade) {
        update.trade = input.trade
        changes.push({ kind: 'update', entity: 'employee', description: `trade ${emp.trade ?? '—'} → ${input.trade ?? '—'}` })
      }
      if (input.workyardId !== undefined && input.workyardId !== emp.workyard_id) {
        if (input.workyardId) {
          const { data: clash, error: wyErr } = await ctx.supabase
            .from('payroll_employees')
            .select('id, name')
            .eq('workyard_id', input.workyardId)
            .neq('id', emp.id)
            .maybeSingle()
          if (wyErr) throw new Error(`Failed to check Workyard id: ${wyErr.message}`)
          if (clash) blockers.push(`Workyard id ${input.workyardId} is already used by ${clash.name}`)
        }
        update.workyard_id = input.workyardId
        changes.push({ kind: 'update', entity: 'employee', description: `Workyard id ${emp.workyard_id ?? '—'} → ${input.workyardId ?? '—'}` })
      }
      if (input.monitaskId !== undefined && input.monitaskId !== emp.monitask_id) {
        if (input.monitaskId) {
          const { data: clash, error: mtErr } = await ctx.supabase
            .from('payroll_employees')
            .select('id, name')
            .eq('monitask_id', input.monitaskId)
            .neq('id', emp.id)
            .maybeSingle()
          if (mtErr) throw new Error(`Failed to check Monitask id: ${mtErr.message}`)
          if (clash) blockers.push(`Monitask id ${input.monitaskId} is already used by ${clash.name}`)
        }
        update.monitask_id = input.monitaskId
        changes.push({ kind: 'update', entity: 'employee', description: `Monitask id ${emp.monitask_id ?? '—'} → ${input.monitaskId ?? '—'}` })
      }
      for (const [field, col, before] of [
        ['otAllowed', 'ot_allowed', emp.ot_allowed],
        ['payTax', 'pay_tax', emp.pay_tax],
        ['wc', 'wc', emp.wc],
        ['isManagement', 'is_management', emp.is_management],
      ] as const) {
        const val = input[field]
        if (val !== undefined && val !== before) {
          update[col] = val
          changes.push({ kind: 'update', entity: 'employee', description: `${col} ${before} → ${val}` })
        }
      }

      // Rate: a salaried employee's rate lives in weekly_rate, otherwise hourly_rate.
      // A type switch moves the rate to the other column and nulls the old one.
      const target = rateForType(effectiveType, input.hourlyRate, input.weeklyRate)
      const providedRate = effectiveType === 'salaried' ? input.weeklyRate : input.hourlyRate
      const currentRate = effectiveType === 'salaried' ? emp.weekly_rate : emp.hourly_rate

      if (input.type !== undefined && input.type !== emp.type) {
        // On a type change, ensure the correct rate column ends up populated and
        // the other is cleared.
        const resolvedRate = providedRate ?? currentRate ?? null
        if (resolvedRate === null) {
          blockers.push(`changing type to ${input.type} requires a ${target.column === 'weekly_rate' ? 'weeklyRate' : 'hourlyRate'}`)
        }
        update.hourly_rate = effectiveType === 'salaried' ? null : resolvedRate
        update.weekly_rate = effectiveType === 'salaried' ? resolvedRate : null
        if (resolvedRate !== null && resolvedRate !== currentRate) newRate = resolvedRate
      } else if (providedRate !== undefined && providedRate !== currentRate) {
        update[target.column] = providedRate
        newRate = providedRate
        changes.push({
          kind: 'update',
          entity: 'employee',
          description: `${target.column} ${currentRate ?? '—'} → ${providedRate}`,
        })
      }

      if (newRate !== null) {
        changes.push({
          kind: 'create',
          entity: 'employee_rate',
          description: `Record rate change ${newRate} effective ${effectiveDate}`,
        })
      }

      if (!emp.is_active) {
        warnings.push(`${emp.name} is inactive — reactivate separately if this change should take effect`)
      }
      if (changes.length === 0) {
        warnings.push('no effective change — submitted values match the current record')
      }
    }

    return {
      operation: this.name,
      summary: emp ? `Update employee "${emp.name}"` : `Update employee ${input.employeeId}`,
      weekId: null,
      targetType: 'employee',
      targetId: input.employeeId,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx) {
        if (Object.keys(update).length > 0) {
          update.updated_at = new Date().toISOString()
          const { error } = await commitCtx.supabase
            .from('payroll_employees')
            .update(update)
            .eq('id', input.employeeId)
          if (error) throw new Error(`Failed to update employee: ${error.message}`)
        }
        if (newRate !== null) await recordRate(commitCtx, input.employeeId, newRate, effectiveDate)
        return { employeeId: input.employeeId }
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* employee.deactivate / employee.reactivate                          */
/* ------------------------------------------------------------------ */

export const deactivateEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})
export type DeactivateEmployeeInput = z.infer<typeof deactivateEmployeeSchema>

export const deactivateEmployee: Operation<DeactivateEmployeeInput, { employeeId: string }> = {
  name: 'employee.deactivate',
  description: 'Deactivate an employee (soft-remove from the active roster). No hard deletes; history is preserved.',
  schema: deactivateEmployeeSchema,
  async plan(ctx, input): Promise<Plan<{ employeeId: string }>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const emp = await loadEmployee(ctx, input.employeeId)
    if (!emp) blockers.push(`employee ${input.employeeId} not found`)
    else if (!emp.is_active) blockers.push(`${emp.name} is already inactive`)
    else {
      const open = await activeOpenEntries(ctx, input.employeeId)
      if (open > 0) {
        warnings.push(
          `${emp.name} has ${open} active time ${open === 1 ? 'entry' : 'entries'} in an open week — those stay but no new time can be added`
        )
      }
    }
    return {
      operation: this.name,
      summary: emp ? `Deactivate employee "${emp.name}"` : `Deactivate employee ${input.employeeId}`,
      weekId: null,
      targetType: 'employee',
      targetId: input.employeeId,
      changes: [
        {
          kind: 'deactivate',
          entity: 'employee',
          description: emp ? `Set ${emp.name} inactive` : `Set ${input.employeeId} inactive`,
        },
      ],
      warnings,
      blockers,
      input,
      async commit(commitCtx) {
        const { error } = await commitCtx.supabase
          .from('payroll_employees')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', input.employeeId)
        if (error) throw new Error(`Failed to deactivate employee: ${error.message}`)
        return { employeeId: input.employeeId }
      },
    }
  },
}

export const reactivateEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})
export type ReactivateEmployeeInput = z.infer<typeof reactivateEmployeeSchema>

export const reactivateEmployee: Operation<ReactivateEmployeeInput, { employeeId: string }> = {
  name: 'employee.reactivate',
  description: 'Reactivate a previously deactivated employee, returning them to the active roster.',
  schema: reactivateEmployeeSchema,
  async plan(ctx, input): Promise<Plan<{ employeeId: string }>> {
    const blockers: string[] = []
    const emp = await loadEmployee(ctx, input.employeeId)
    if (!emp) blockers.push(`employee ${input.employeeId} not found`)
    else if (emp.is_active) blockers.push(`${emp.name} is already active`)
    return {
      operation: this.name,
      summary: emp ? `Reactivate employee "${emp.name}"` : `Reactivate employee ${input.employeeId}`,
      weekId: null,
      targetType: 'employee',
      targetId: input.employeeId,
      changes: [
        {
          kind: 'update',
          entity: 'employee',
          description: emp ? `Set ${emp.name} active` : `Set ${input.employeeId} active`,
        },
      ],
      warnings: [],
      blockers,
      input,
      async commit(commitCtx) {
        const { error } = await commitCtx.supabase
          .from('payroll_employees')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('id', input.employeeId)
        if (error) throw new Error(`Failed to reactivate employee: ${error.message}`)
        return { employeeId: input.employeeId }
      },
    }
  },
}
