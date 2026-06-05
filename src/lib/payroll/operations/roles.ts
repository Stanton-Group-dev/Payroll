/**
 * Authorization primitives for the payroll console — deliberately dependency-free
 * (no Supabase, no next/headers) so both the operation core and the request-context
 * layer can import it without creating an import cycle or leaking server-only deps.
 *
 * Role hierarchy: superadmin ⊃ admin ⊃ manager. 'bookkeeper' and any unknown role
 * get no console access. A null DB role is mapped to 'manager' upstream
 * (see buildOperationContext / useAuth.ts), so it never reaches here as null.
 */
export type ConsoleRole = 'manager' | 'admin' | 'superadmin'

const RANK: Record<string, number> = { manager: 1, admin: 2, superadmin: 3 }

export function roleAtLeast(role: string, minimum: ConsoleRole): boolean {
  const have = RANK[role] ?? 0
  return have >= RANK[minimum]
}

export class UnauthorizedError extends Error {
  constructor(message = 'You do not have access to this action') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}
