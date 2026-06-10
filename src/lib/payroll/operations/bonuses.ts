/**
 * Remote-worker bonus operations — the payroll analyst's audited toolset.
 *
 * Two operations:
 *   - remote_bonus.set_config: record/replace the standing bonus arrangement for a
 *     remote worker (a row in remote_bonus_config). This is descriptive structure,
 *     not a payout.
 *   - remote_bonus.add: add a per-run bonus payout as a payroll_adjustments row with
 *     type='bonus' (allocation_method='employee_pay'), so it flows into the remote
 *     run's gross pay through the existing adjustments path.
 *
 * Both are gated to the lateral 'analyst' role (admins/superadmins also pass). A
 * bonus only makes sense on the REMOTE run, so both validate pay_group='remote'.
 */
import { z } from 'zod'
import type { Operation, OperationContext, Plan, PlannedChange } from './core'
import { isWeekEditable } from '@/lib/payroll/resolve/dates'

const AMOUNT = z.number().positive('bonus amount must be > 0').max(1_000_000, 'amount looks too large')
const NOTE = z.string().trim().min(1, 'a structure note is required').max(1000)
const BONUS_BASIS = z.enum(['manual', 'per_week', 'per_hour', 'pct_of_pay'])

interface RemoteEmployeeRow {
  id: string
  name: string
  is_active: boolean
  pay_group: 'field' | 'remote'
}

async function loadRemoteEmployee(ctx: OperationContext, id: string): Promise<RemoteEmployeeRow | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_employees')
    .select('id, name, is_active, pay_group')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load employee: ${error.message}`)
  return (data as RemoteEmployeeRow | null) ?? null
}

interface WeekRow {
  id: string
  week_start: string
  status: string
  pay_group: 'field' | 'remote'
}

async function loadWeek(ctx: OperationContext, id: string): Promise<WeekRow | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_weeks')
    .select('id, week_start, status, pay_group')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load payroll week: ${error.message}`)
  return (data as WeekRow | null) ?? null
}

/* ------------------------------------------------------------------ */
/* remote_bonus.set_config                                             */
/* ------------------------------------------------------------------ */

export const setBonusConfigSchema = z.object({
  employeeId: z.string().uuid(),
  structureNote: NOTE,
  basis: BONUS_BASIS.default('manual'),
  targetAmount: z.number().nonnegative().max(1_000_000).optional(),
  reason: z.string().max(500).optional(),
})
export type SetBonusConfigInput = z.infer<typeof setBonusConfigSchema>

export const setBonusConfig: Operation<SetBonusConfigInput, { configId: string }> = {
  name: 'remote_bonus.set_config',
  description:
    "Record the standing bonus structure for a remote worker (note + basis + optional target amount). Supersedes the worker's previous active config.",
  allowRoles: ['analyst'],
  schema: setBonusConfigSchema,
  async plan(ctx, input): Promise<Plan<{ configId: string }>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    const emp = await loadRemoteEmployee(ctx, input.employeeId)
    if (!emp) blockers.push(`employee ${input.employeeId} not found`)
    else {
      if (emp.pay_group !== 'remote') blockers.push(`${emp.name} is not a remote worker (pay group: ${emp.pay_group})`)
      if (!emp.is_active) warnings.push(`${emp.name} is inactive`)
    }

    const amountLabel = input.targetAmount != null ? ` (target $${input.targetAmount}, ${input.basis})` : ` (${input.basis})`
    changes.push({
      kind: 'create',
      entity: 'remote_bonus_config',
      description: `Set bonus structure for ${emp?.name ?? input.employeeId}${amountLabel}: "${input.structureNote}"`,
    })

    return {
      operation: this.name,
      summary: `Set bonus structure for ${emp?.name ?? input.employeeId}`,
      weekId: null,
      targetType: 'employee',
      targetId: input.employeeId,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx): Promise<{ configId: string }> {
        // One active config per worker: deactivate any prior, then insert the new.
        const { error: deErr } = await commitCtx.supabase
          .from('remote_bonus_config')
          .update({ is_active: false })
          .eq('employee_id', input.employeeId)
          .eq('is_active', true)
        if (deErr) throw new Error(`Failed to supersede prior bonus config: ${deErr.message}`)

        const { data: inserted, error } = await commitCtx.supabase
          .from('remote_bonus_config')
          .insert({
            employee_id: input.employeeId,
            structure_note: input.structureNote,
            basis: input.basis,
            target_amount: input.targetAmount ?? null,
            is_active: true,
            created_by: commitCtx.actor.id,
          })
          .select('id')
          .single()
        if (error) throw new Error(`Failed to save bonus config: ${error.message}`)
        return { configId: inserted.id as string }
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* remote_bonus.add                                                    */
/* ------------------------------------------------------------------ */

export const addBonusSchema = z.object({
  employeeId: z.string().uuid(),
  weekId: z.string().uuid(),
  amount: AMOUNT,
  description: z.string().trim().min(1, 'a description is required').max(500),
  reason: z.string().max(500).optional(),
})
export type AddBonusInput = z.infer<typeof addBonusSchema>

export const addBonus: Operation<AddBonusInput, { adjustmentId: string }> = {
  name: 'remote_bonus.add',
  description:
    'Add a bonus payout for a remote worker on a remote payroll run. Records a payroll_adjustments row (type=bonus) that flows into the run’s gross pay.',
  allowRoles: ['analyst'],
  schema: addBonusSchema,
  async plan(ctx, input): Promise<Plan<{ adjustmentId: string }>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    const emp = await loadRemoteEmployee(ctx, input.employeeId)
    if (!emp) blockers.push(`employee ${input.employeeId} not found`)
    else {
      if (emp.pay_group !== 'remote') blockers.push(`${emp.name} is not a remote worker (pay group: ${emp.pay_group})`)
      if (!emp.is_active) blockers.push(`${emp.name} is inactive`)
    }

    const week = await loadWeek(ctx, input.weekId)
    if (!week) blockers.push(`payroll week ${input.weekId} not found`)
    else {
      if (week.pay_group !== 'remote') blockers.push(`week of ${week.week_start} is the ${week.pay_group} run — bonuses belong to a remote run`)
      if (!isWeekEditable(week.status)) blockers.push(`week of ${week.week_start} is ${week.status} and locked`)
    }

    changes.push({
      kind: 'create',
      entity: 'payroll_adjustment',
      description: `Bonus $${input.amount} for ${emp?.name ?? input.employeeId}${week ? ` (run of ${week.week_start})` : ''}: ${input.description}`,
    })

    return {
      operation: this.name,
      summary: `Add $${input.amount} bonus for ${emp?.name ?? input.employeeId}`,
      weekId: week?.id ?? null,
      targetType: 'employee',
      targetId: input.employeeId,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx): Promise<{ adjustmentId: string }> {
        const { data: inserted, error } = await commitCtx.supabase
          .from('payroll_adjustments')
          .insert({
            payroll_week_id: input.weekId,
            employee_id: input.employeeId,
            type: 'bonus',
            amount: input.amount,
            description: input.description,
            allocation_method: 'employee_pay',
            created_by: commitCtx.actor.id,
          })
          .select('id')
          .single()
        if (error) throw new Error(`Failed to add bonus: ${error.message}`)
        return { adjustmentId: inserted.id as string }
      },
    }
  },
}
