/**
 * Operation registry. The single source of truth for which named operations
 * exist. Both the agent tool surface and the execute endpoint look operations
 * up here by name, so a new audited capability is added in exactly one place.
 */
import type { Operation } from './core'
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

function register(op: Operation<never, never>): RegisteredOperation {
  return op as unknown as RegisteredOperation
}

const REGISTRY: Record<string, RegisteredOperation> = {
  [addTime.name]: register(addTime as unknown as Operation<never, never>),
  [adjustTime.name]: register(adjustTime as unknown as Operation<never, never>),
  [removeTime.name]: register(removeTime as unknown as Operation<never, never>),
  [addEmployee.name]: register(addEmployee as unknown as Operation<never, never>),
  [updateEmployee.name]: register(updateEmployee as unknown as Operation<never, never>),
  [deactivateEmployee.name]: register(deactivateEmployee as unknown as Operation<never, never>),
  [reactivateEmployee.name]: register(reactivateEmployee as unknown as Operation<never, never>),
  [addExternalProject.name]: register(addExternalProject as unknown as Operation<never, never>),
  [updateExternalProject.name]: register(updateExternalProject as unknown as Operation<never, never>),
  [deactivateExternalProject.name]: register(deactivateExternalProject as unknown as Operation<never, never>),
  [reactivateExternalProject.name]: register(reactivateExternalProject as unknown as Operation<never, never>),
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
