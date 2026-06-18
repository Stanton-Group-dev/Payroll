/**
 * Entity resolvers — turn human-typed names into payroll records.
 * Used by the agent (to resolve "stan" / "park portfolio") and reusable anywhere
 * a name needs to become an id. Matching is deterministic (see ./text).
 */
import type { OperationContext } from '@/lib/payroll/operations/core'
import { resolveOne, type Resolution, type Candidate } from './text'

export interface ResolvedEmployee {
  id: string
  name: string
  type: string
  is_active: boolean
}

export interface ResolvedPortfolio {
  id: string
  name: string
}

export interface ResolvedProperty {
  id: string
  code: string
  name: string
  portfolio_id: string | null
  total_units: number | null
}

export interface ResolvedExternalProject {
  id: string
  name: string
  client_name: string
  billed_to: string
  is_active: boolean
}

export async function resolveEmployee(
  ctx: OperationContext,
  query: string,
  includeInactive = false
): Promise<Resolution<ResolvedEmployee>> {
  let q = ctx.supabase
    .from('payroll_employees')
    .select('id, name, type, is_active')
    .order('name')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error(`Failed to load employees: ${error.message}`)
  return resolveOne<ResolvedEmployee>(query, (data ?? []) as ResolvedEmployee[], (e) => e.name)
}

export async function resolvePortfolio(
  ctx: OperationContext,
  query: string
): Promise<Resolution<ResolvedPortfolio>> {
  const { data, error } = await ctx.supabase
    .from('portfolios')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(`Failed to load portfolios: ${error.message}`)
  return resolveOne<ResolvedPortfolio>(query, (data ?? []) as ResolvedPortfolio[], (p) => p.name)
}

export async function resolveProperty(
  ctx: OperationContext,
  query: string,
  portfolioId?: string
): Promise<Resolution<ResolvedProperty>> {
  // Resolve against the curated overlay so command-bar matches/grouping use corrected data.
  let q = ctx.supabase
    .from('payroll_property')
    .select('id:property_id, code, name, portfolio_id, total_units')
    .eq('is_active', true)
    .order('name')
  if (portfolioId) q = q.eq('portfolio_id', portfolioId)
  const { data, error } = await q
  if (error) throw new Error(`Failed to load properties: ${error.message}`)
  // Properties are matchable by both code (e.g. "S0123") and name.
  return resolveOne<ResolvedProperty>(
    query,
    (data ?? []) as ResolvedProperty[],
    (p) => `${p.code} ${p.name}`
  )
}

export async function resolveExternalProject(
  ctx: OperationContext,
  query: string,
  includeInactive = false
): Promise<Resolution<ResolvedExternalProject>> {
  let q = ctx.supabase
    .from('payroll_external_projects')
    .select('id, name, client_name, billed_to, is_active')
    .order('name')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error(`Failed to load external projects: ${error.message}`)
  // Matchable by both the project name and the client name (e.g. "zimmerman").
  return resolveOne<ResolvedExternalProject>(
    query,
    (data ?? []) as ResolvedExternalProject[],
    (p) => `${p.name} ${p.client_name}`
  )
}

/** Active properties in a portfolio, used to spread hours across a portfolio. */
export async function propertiesInPortfolio(
  ctx: OperationContext,
  portfolioId: string
): Promise<ResolvedProperty[]> {
  const { data, error } = await ctx.supabase
    .from('payroll_property')
    .select('id:property_id, code, name, portfolio_id, total_units')
    .eq('is_active', true)
    .eq('portfolio_id', portfolioId)
    .order('name')
  if (error) throw new Error(`Failed to load portfolio properties: ${error.message}`)
  return (data ?? []) as ResolvedProperty[]
}

/** Compact candidate shape for returning disambiguation choices to the agent/UI. */
export function candidateSummary<T extends { id: string }>(
  candidates: Candidate<T>[]
): { id: string; label: string; score: number }[] {
  return candidates.map((c) => ({ id: c.item.id, label: c.label, score: Number(c.score.toFixed(3)) }))
}
