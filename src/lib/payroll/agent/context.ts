/**
 * Builds an OperationContext from an incoming request: a user-scoped Supabase
 * client (RLS enforced, session-carrying) plus the resolved actor (id/email/role).
 * Used by both the agent route and the execute route so every write is attributed.
 */
import { createClient } from '@/lib/supabase/server'
import type { Actor, OperationContext, OperationSource } from '@/lib/payroll/operations/core'

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not authenticated')
    this.name = 'UnauthenticatedError'
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'You do not have access to this action') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * Role hierarchy used to gate the console. superadmin ⊃ admin ⊃ manager.
 * A null role is treated as 'manager' (see buildOperationContext / useAuth.ts).
 */
export function roleAtLeast(role: string, minimum: 'manager' | 'admin' | 'superadmin'): boolean {
  const rank: Record<string, number> = { manager: 1, admin: 2, superadmin: 3 }
  const have = rank[role] ?? 0 // unknown roles (e.g. bookkeeper) get no console access; null is mapped to 'manager' upstream
  return have >= rank[minimum]
}

/** Throw UnauthorizedError unless the context's actor meets the minimum role. */
export function assertRole(
  ctx: OperationContext,
  minimum: 'manager' | 'admin' | 'superadmin'
): void {
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
