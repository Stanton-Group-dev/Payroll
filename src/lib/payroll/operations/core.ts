/**
 * Operation layer — the institutional backbone.
 *
 * Every payroll write goes through a named Operation that:
 *   1. validates its input with a Zod schema,
 *   2. produces a Plan (a previewable, side-effect-free description of the change,
 *      including warnings and hard blockers), and
 *   3. commits the change and records an immutable row in payroll_audit_log.
 *
 * The same Operation is invoked from UI hooks and from the natural-language agent,
 * so there is exactly one validated, audited path to mutate payroll data.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ZodType } from 'zod'
import { roleAtLeast, roleAllowed, UnauthorizedError, type ConsoleRole } from './roles'

// Re-export so callers can get the authz types/errors from the operation core.
export { UnauthorizedError }
export type { ConsoleRole }

export type OperationSource = 'ui' | 'agent' | 'system'

export interface Actor {
  /** auth.users id, or null for system actions. */
  id: string | null
  email: string
  role: string
}

export interface OperationContext {
  /** User-scoped Supabase client (respects RLS, carries the auth session). */
  supabase: SupabaseClient
  actor: Actor
  source: OperationSource
  /** Original natural-language request, when source === 'agent'. */
  agentPrompt?: string
}

/** A single, human-readable change the plan will make if committed. */
export interface PlannedChange {
  kind: 'create' | 'update' | 'deactivate'
  entity: string
  description: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/**
 * A previewable description of an operation's effect. Produced by `Operation.plan`
 * without writing anything. `commit` performs the writes and is only ever called
 * by the runner once `blockers` is empty.
 */
export interface Plan<TResult = unknown> {
  operation: string
  summary: string
  weekId: string | null
  targetType: string | null
  targetId: string | null
  changes: PlannedChange[]
  /** Non-fatal concerns the user should see (e.g. ">24h logged for the day"). */
  warnings: string[]
  /** Fatal conditions that prevent commit (e.g. week is locked, employee inactive). */
  blockers: string[]
  /** The validated input, echoed for the audit record. */
  input: unknown
  commit: (ctx: OperationContext) => Promise<TResult>
}

export interface Operation<TInput, TResult> {
  name: string
  /** Short description used in the agent tool surface. */
  description: string
  /**
   * Minimum console role required to preview or execute this operation.
   * Enforced centrally in previewOperation/executeOperation, so every caller
   * (the agent and the UI operation routes) is gated identically. Defaults to
   * 'manager' when omitted. Ignored when `allowRoles` is set.
   */
  minRole?: ConsoleRole
  /**
   * Explicit allow-list of roles permitted to run this operation, for lateral
   * roles that don't fit the linear rank (e.g. 'analyst' on remote/bonus ops).
   * When set, it takes precedence over minRole. Admins/superadmins always pass.
   */
  allowRoles?: readonly string[]
  schema: ZodType<TInput>
  plan: (ctx: OperationContext, input: TInput) => Promise<Plan<TResult>>
}

/** Serializable subset of a Plan, safe to return to the browser for confirmation. */
export interface PlanPreview {
  operation: string
  summary: string
  weekId: string | null
  targetType: string | null
  targetId: string | null
  changes: PlannedChange[]
  warnings: string[]
  blockers: string[]
  input: unknown
}

export function toPreview(plan: Plan): PlanPreview {
  return {
    operation: plan.operation,
    summary: plan.summary,
    weekId: plan.weekId,
    targetType: plan.targetType,
    targetId: plan.targetId,
    changes: plan.changes,
    warnings: plan.warnings,
    blockers: plan.blockers,
    input: plan.input,
  }
}

export class OperationError extends Error {
  constructor(message: string, readonly preview?: PlanPreview) {
    super(message)
    this.name = 'OperationError'
  }
}

/** Validation failure with field-level detail, surfaced to the caller as 400. */
export class OperationValidationError extends OperationError {
  constructor(message: string, readonly issues: { path: string; message: string }[]) {
    super(message)
    this.name = 'OperationValidationError'
  }
}

/**
 * Central authorization gate. Throws UnauthorizedError unless the actor meets the
 * operation's minimum role. Every operation goes through here for both preview and
 * execute, so authorization can never be forgotten by an individual route.
 */
function assertOperationRole(ctx: OperationContext, op: Operation<unknown, unknown>): void {
  if (op.allowRoles) {
    if (!roleAllowed(ctx.actor.role, op.allowRoles)) {
      throw new UnauthorizedError(`This action requires one of: ${op.allowRoles.join(', ')} (or admin).`)
    }
    return
  }
  const min = op.minRole ?? 'manager'
  if (!roleAtLeast(ctx.actor.role, min)) {
    throw new UnauthorizedError(`This action requires ${min} access.`)
  }
}

function validate<TInput, TResult>(op: Operation<TInput, TResult>, raw: unknown): TInput {
  const parsed = op.schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }))
    throw new OperationValidationError(`Invalid input for ${op.name}`, issues)
  }
  return parsed.data
}

/** Build a preview without mutating anything. */
export async function previewOperation<TInput, TResult>(
  ctx: OperationContext,
  op: Operation<TInput, TResult>,
  raw: unknown
): Promise<PlanPreview> {
  assertOperationRole(ctx, op as Operation<unknown, unknown>)
  const input = validate(op, raw)
  const plan = await op.plan(ctx, input)
  return toPreview(plan)
}

/**
 * Validate, re-plan from the input (never trusting any client-supplied preview),
 * refuse to commit if there are blockers, then commit and write the audit row.
 */
export async function executeOperation<TInput, TResult>(
  ctx: OperationContext,
  op: Operation<TInput, TResult>,
  raw: unknown
): Promise<{ preview: PlanPreview; result: TResult }> {
  assertOperationRole(ctx, op as Operation<unknown, unknown>)
  const input = validate(op, raw)
  const plan = await op.plan(ctx, input)
  if (plan.blockers.length > 0) {
    throw new OperationError(
      `Cannot ${op.name}: ${plan.blockers.join('; ')}`,
      toPreview(plan)
    )
  }
  const result = await plan.commit(ctx)
  await writeAudit(ctx, plan, result)
  return { preview: toPreview(plan), result }
}

/** Append an immutable record of a committed operation to payroll_audit_log. */
async function writeAudit(ctx: OperationContext, plan: Plan, result: unknown): Promise<void> {
  const { error } = await ctx.supabase.from('payroll_audit_log').insert({
    actor_id: ctx.actor.id,
    actor_email: ctx.actor.email,
    actor_role: ctx.actor.role,
    operation: plan.operation,
    source: ctx.source,
    summary: plan.summary,
    payroll_week_id: plan.weekId,
    target_type: plan.targetType,
    target_id: plan.targetId,
    input: plan.input as Record<string, unknown>,
    result: result as Record<string, unknown>,
    agent_prompt: ctx.agentPrompt ?? null,
  })
  // Audit must not silently vanish. The domain write already succeeded, so we
  // surface the failure loudly rather than rolling back a committed change.
  if (error) {
    console.error('payroll_audit_log write failed', {
      operation: plan.operation,
      error: error.message,
    })
    throw new OperationError(
      `Operation committed but the audit record failed to write: ${error.message}`
    )
  }
}
