/**
 * External-project operations: add, update, deactivate, reactivate.
 *
 * External projects are non-portfolio client work (e.g. "Zimmerman Project"
 * billed to a named client). They are first-class billing entities that appear
 * in invoice groupings. These are the canonical, audited mutations; the UI
 * (admin/external-projects) and the natural-language agent both call them, so
 * there is one validated, audited path for the customer/job roster.
 */
import { z } from 'zod'
import type { Operation, OperationContext, Plan, PlannedChange } from './core'

const TEXT = (max: number) => z.string().trim().min(1).max(max)

interface ProjectRow {
  id: string
  name: string
  client_name: string
  billed_to: string
  notes: string | null
  is_active: boolean
  workyard_customer_names: string[] | null
}

const PROJECT_COLUMNS = 'id, name, client_name, billed_to, notes, is_active, workyard_customer_names'

async function loadProject(ctx: OperationContext, id: string): Promise<ProjectRow | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_external_projects')
    .select(PROJECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Failed to load external project: ${error.message}`)
  return (data as ProjectRow | null) ?? null
}

/* ------------------------------------------------------------------ */
/* external_project.add                                                */
/* ------------------------------------------------------------------ */

export const addExternalProjectSchema = z.object({
  name: TEXT(200),
  clientName: TEXT(200),
  billedTo: TEXT(200),
  notes: z.string().trim().max(2000).optional(),
  workyardCustomerNames: z.array(z.string().trim().min(1)).max(50).optional(),
  isActive: z.boolean().default(true),
  reason: z.string().max(500).optional(),
})
export type AddExternalProjectInput = z.infer<typeof addExternalProjectSchema>

export const addExternalProject: Operation<AddExternalProjectInput, { projectId: string }> = {
  name: 'external_project.add',
  description:
    'Add an external (non-portfolio) client project — name, client, and who it is billed to. Used for work like "Zimmerman Project" billed to a named client.',
  schema: addExternalProjectSchema,
  async plan(ctx, input): Promise<Plan<{ projectId: string }>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    const { data: sameName, error } = await ctx.supabase
      .from('payroll_external_projects')
      .select('id')
      .ilike('name', input.name)
    if (error) throw new Error(`Failed to check for duplicate project: ${error.message}`)
    if ((sameName ?? []).length > 0) {
      warnings.push(`an external project named "${input.name}" already exists — confirm this is not a duplicate`)
    }

    changes.push({
      kind: 'create',
      entity: 'external_project',
      description: `Create external project "${input.name}" (client ${input.clientName}, billed to ${input.billedTo})`,
      after: { name: input.name, client_name: input.clientName, billed_to: input.billedTo, is_active: input.isActive },
    })

    return {
      operation: this.name,
      summary: `Add external project "${input.name}" — billed to ${input.billedTo}`,
      weekId: null,
      targetType: 'external_project',
      targetId: null,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx) {
        const { data: inserted, error: insErr } = await commitCtx.supabase
          .from('payroll_external_projects')
          .insert({
            name: input.name,
            client_name: input.clientName,
            billed_to: input.billedTo,
            notes: input.notes ?? null,
            is_active: input.isActive,
            workyard_customer_names: input.workyardCustomerNames ?? [],
            created_by: commitCtx.actor.id,
          })
          .select('id')
          .single()
        if (insErr) throw new Error(`Failed to create external project: ${insErr.message}`)
        return { projectId: inserted.id as string }
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* external_project.update                                             */
/* ------------------------------------------------------------------ */

export const updateExternalProjectSchema = z
  .object({
    projectId: z.string().uuid(),
    name: TEXT(200).optional(),
    clientName: TEXT(200).optional(),
    billedTo: TEXT(200).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    workyardCustomerNames: z.array(z.string().trim().min(1)).max(50).optional(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).some((k) => k !== 'projectId' && k !== 'reason' && v[k as keyof typeof v] !== undefined),
    { message: 'update requires at least one field to change' }
  )
export type UpdateExternalProjectInput = z.infer<typeof updateExternalProjectSchema>

export const updateExternalProject: Operation<UpdateExternalProjectInput, { projectId: string }> = {
  name: 'external_project.update',
  description: 'Change an existing external project — name, client, billed-to, notes, or Workyard customer mapping.',
  schema: updateExternalProjectSchema,
  async plan(ctx, input): Promise<Plan<{ projectId: string }>> {
    const warnings: string[] = []
    const blockers: string[] = []
    const changes: PlannedChange[] = []

    const proj = await loadProject(ctx, input.projectId)
    if (!proj) blockers.push(`external project ${input.projectId} not found`)

    const update: Record<string, unknown> = {}
    if (proj) {
      const fields = [
        ['name', 'name', input.name, proj.name],
        ['clientName', 'client_name', input.clientName, proj.client_name],
        ['billedTo', 'billed_to', input.billedTo, proj.billed_to],
        ['notes', 'notes', input.notes, proj.notes],
      ] as const
      for (const [, col, val, before] of fields) {
        if (val !== undefined && val !== before) {
          update[col] = val
          changes.push({ kind: 'update', entity: 'external_project', description: `${col} "${before ?? '—'}" → "${val ?? '—'}"` })
        }
      }
      if (input.workyardCustomerNames !== undefined) {
        update.workyard_customer_names = input.workyardCustomerNames
        changes.push({
          kind: 'update',
          entity: 'external_project',
          description: `Workyard customer mapping → [${input.workyardCustomerNames.join(', ')}]`,
        })
      }
      if (!proj.is_active) warnings.push(`"${proj.name}" is inactive — reactivate separately if this change should take effect`)
      if (changes.length === 0) warnings.push('no effective change — submitted values match the current record')
    }

    return {
      operation: this.name,
      summary: proj ? `Update external project "${proj.name}"` : `Update external project ${input.projectId}`,
      weekId: null,
      targetType: 'external_project',
      targetId: input.projectId,
      changes,
      warnings,
      blockers,
      input,
      async commit(commitCtx) {
        if (Object.keys(update).length > 0) {
          update.updated_at = new Date().toISOString()
          const { error } = await commitCtx.supabase
            .from('payroll_external_projects')
            .update(update)
            .eq('id', input.projectId)
          if (error) throw new Error(`Failed to update external project: ${error.message}`)
        }
        return { projectId: input.projectId }
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* external_project.deactivate / reactivate                            */
/* ------------------------------------------------------------------ */

export const deactivateExternalProjectSchema = z.object({
  projectId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})
export type DeactivateExternalProjectInput = z.infer<typeof deactivateExternalProjectSchema>

export const deactivateExternalProject: Operation<DeactivateExternalProjectInput, { projectId: string }> = {
  name: 'external_project.deactivate',
  description: 'Deactivate an external project (soft-remove). No hard deletes; history is preserved.',
  schema: deactivateExternalProjectSchema,
  async plan(ctx, input): Promise<Plan<{ projectId: string }>> {
    const blockers: string[] = []
    const proj = await loadProject(ctx, input.projectId)
    if (!proj) blockers.push(`external project ${input.projectId} not found`)
    else if (!proj.is_active) blockers.push(`"${proj.name}" is already inactive`)
    return {
      operation: this.name,
      summary: proj ? `Deactivate external project "${proj.name}"` : `Deactivate external project ${input.projectId}`,
      weekId: null,
      targetType: 'external_project',
      targetId: input.projectId,
      changes: [
        {
          kind: 'deactivate',
          entity: 'external_project',
          description: proj ? `Set "${proj.name}" inactive` : `Set ${input.projectId} inactive`,
        },
      ],
      warnings: [],
      blockers,
      input,
      async commit(commitCtx) {
        const { error } = await commitCtx.supabase
          .from('payroll_external_projects')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', input.projectId)
        if (error) throw new Error(`Failed to deactivate external project: ${error.message}`)
        return { projectId: input.projectId }
      },
    }
  },
}

export const reactivateExternalProjectSchema = z.object({
  projectId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})
export type ReactivateExternalProjectInput = z.infer<typeof reactivateExternalProjectSchema>

export const reactivateExternalProject: Operation<ReactivateExternalProjectInput, { projectId: string }> = {
  name: 'external_project.reactivate',
  description: 'Reactivate a previously deactivated external project.',
  schema: reactivateExternalProjectSchema,
  async plan(ctx, input): Promise<Plan<{ projectId: string }>> {
    const blockers: string[] = []
    const proj = await loadProject(ctx, input.projectId)
    if (!proj) blockers.push(`external project ${input.projectId} not found`)
    else if (proj.is_active) blockers.push(`"${proj.name}" is already active`)
    return {
      operation: this.name,
      summary: proj ? `Reactivate external project "${proj.name}"` : `Reactivate external project ${input.projectId}`,
      weekId: null,
      targetType: 'external_project',
      targetId: input.projectId,
      changes: [
        {
          kind: 'update',
          entity: 'external_project',
          description: proj ? `Set "${proj.name}" active` : `Set ${input.projectId} active`,
        },
      ],
      warnings: [],
      blockers,
      input,
      async commit(commitCtx) {
        const { error } = await commitCtx.supabase
          .from('payroll_external_projects')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('id', input.projectId)
        if (error) throw new Error(`Failed to reactivate external project: ${error.message}`)
        return { projectId: input.projectId }
      },
    }
  },
}
