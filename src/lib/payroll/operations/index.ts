/**
 * Operation registry. The single source of truth for which named operations
 * exist. Both the agent tool surface and the execute endpoint look operations
 * up here by name, so a new audited capability is added in exactly one place.
 */
import type { Operation, ConsoleRole } from './core'
import { addTime, adjustTime, removeTime } from './timeEntries'
import {
  addEmployee,
  updateEmployee,
  deactivateEmployee,
  reactivateEmployee,
} from './employees'
import {
  addExternalProject,
  updateExternalProject,
  deactivateExternalProject,
  reactivateExternalProject,
} from './externalProjects'

/**
 * Type-erased operation handle. Each operation validates its own input via its
 * Zod schema at call time, so the registry only needs the unknown-typed surface;
 * concrete input/result types are recovered inside each operation's plan/commit.
 */
export type RegisteredOperation = Operation<unknown, unknown>

/**
 * Register an operation with the minimum console role required to run it. The
 * role assigned here is the authoritative authorization matrix for the whole
 * payroll console; previewOperation/executeOperation enforce it centrally.
 */
function register(op: Operation<never, never>, minRole: ConsoleRole): RegisteredOperation {
  return { ...(op as unknown as RegisteredOperation), minRole }
}

const REGISTRY: Record<string, RegisteredOperation> = {
  // Time entries are routine manager work.
  [addTime.name]: register(addTime as unknown as Operation<never, never>, 'manager'),
  [adjustTime.name]: register(adjustTime as unknown as Operation<never, never>, 'manager'),
  [removeTime.name]: register(removeTime as unknown as Operation<never, never>, 'manager'),
  // Employee master-record changes are admin-only.
  [addEmployee.name]: register(addEmployee as unknown as Operation<never, never>, 'admin'),
  [updateEmployee.name]: register(updateEmployee as unknown as Operation<never, never>, 'admin'),
  [deactivateEmployee.name]: register(deactivateEmployee as unknown as Operation<never, never>, 'admin'),
  [reactivateEmployee.name]: register(reactivateEmployee as unknown as Operation<never, never>, 'admin'),
  // External projects / clients are admin-only structural changes.
  [addExternalProject.name]: register(addExternalProject as unknown as Operation<never, never>, 'admin'),
  [updateExternalProject.name]: register(updateExternalProject as unknown as Operation<never, never>, 'admin'),
  [deactivateExternalProject.name]: register(deactivateExternalProject as unknown as Operation<never, never>, 'admin'),
  [reactivateExternalProject.name]: register(reactivateExternalProject as unknown as Operation<never, never>, 'admin'),
}

export function getOperation(name: string): RegisteredOperation | null {
  return REGISTRY[name] ?? null
}

export function listOperations(): RegisteredOperation[] {
  return Object.values(REGISTRY)
}

export { addTime, adjustTime, removeTime }
export { addEmployee, updateEmployee, deactivateEmployee, reactivateEmployee }
export {
  addExternalProject,
  updateExternalProject,
  deactivateExternalProject,
  reactivateExternalProject,
}
export * from './core'
