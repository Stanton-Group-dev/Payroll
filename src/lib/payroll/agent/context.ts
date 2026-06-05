/**
 * Builds an OperationContext from an incoming request: a user-scoped Supabase
 * client (RLS enforced, session-carrying) plus the resolved actor (id/email/role).
 * Used by both the agent route and the execute route so every write is attributed.
 */
import { createClient } from '@/lib/supabase/server'
import type { Actor, OperationContext, OperationSource } from '@/lib/payroll/operations/core'
import { roleAtLeast, UnauthorizedError, type ConsoleRole } from '@/lib/payroll/operations/roles'

// Re-export the authz surface so request handlers import it from one place.
export { roleAtLeast, UnauthorizedError }
export type { ConsoleRole }

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not authenticated')
    this.name = 'UnauthenticatedError'
  }
}

/** Throw UnauthorizedError unless the context's actor meets the minimum role. */
export function assertRole(ctx: OperationContext, minimum: ConsoleRole): void {
  if (!roleAtLeast(ctx.actor.role, minimum)) {
    throw new UnauthorizedError(`This action requires ${minimum} access.`)
  }
}

export async function buildOperationContext(
  source: OperationSource,
  agentPrompt?: string
): Promise<OperationContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new UnauthenticatedError()

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, role')
    .eq('id', user.id)
    .maybeSingle()

  const actor: Actor = {
    id: user.id,
    email: (profile?.email as string | undefined) ?? user.email ?? 'unknown',
    // Profiles with a null role are treated as 'manager' (see useAuth.ts).
    role: (profile?.role as string | undefined) ?? 'manager',
  }

  return { supabase, actor, source, agentPrompt }
}
