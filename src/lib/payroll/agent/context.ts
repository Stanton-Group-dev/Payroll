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
