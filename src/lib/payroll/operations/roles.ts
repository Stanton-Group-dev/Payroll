/**
 * Authorization primitives for the payroll console — deliberately dependency-free
 * (no Supabase, no next/headers) so both the operation core and the request-context
 * layer can import it without creating an import cycle or leaking server-only deps.
 *
 * Role hierarchy: superadmin ⊃ admin ⊃ manager. 'bookkeeper' and any unknown role
 * get no console access. A null DB role is mapped to 'manager' upstream
 * (see buildOperationContext / useAuth.ts), so it never reaches here as null.
 *
 * 'analyst' is a LATERAL role, not part of the linear rank: it is deliberately
 * absent from RANK so it satisfies no minRole gate (it cannot run field-payroll
 * operations). Remote-run / bonus operations opt analyst in explicitly via an
 * allow-list (see Operation.allowRoles + roleAllowed). Admins/superadmins still
 * pass everything through the rank.
 */
export type ConsoleRole = 'manager' | 'admin' | 'superadmin' | 'analyst'

const RANK: Record<string, number> = { manager: 1, admin: 2, superadmin: 3 }

export function roleAtLeast(role: string, minimum: ConsoleRole): boolean {
  const min = RANK[minimum]
  // A lateral role (not in RANK) is never "at least" a ranked minimum.
  if (min === undefined) return false
  const have = RANK[role] ?? 0
  return have >= min
}

/**
 * Authorize against an explicit allow-list. The actor passes if their role is in
 * the list, or if they are admin-or-above (admins retain access to everything
 * without being listed on every operation).
 */
export function roleAllowed(role: string, allow: readonly string[]): boolean {
  return allow.includes(role) || roleAtLeast(role, 'admin')
}

export class UnauthorizedError extends Error {
  constructor(message = 'You do not have access to this action') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}
