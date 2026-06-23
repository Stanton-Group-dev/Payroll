/**
 * Workyard provisioning for the New Project Wizard (PRP-06).
 *
 * Split into two halves:
 *  - PURE planning (no network, no credentials): build the exact create
 *    payloads and decide create-vs-skip against a supplied list of existing
 *    Workyard objects. Unit-testable; safe to import from a client component
 *    (it touches no secrets).
 *  - LIVE execution (`fetchExisting`, `executeProvision`): reads
 *    WORKYARD_API_KEY / WORKYARD_ORG_ID and calls the Workyard API. Server-only.
 *    Gated behind `apply` — with apply:false it performs no writes.
 *
 * STAGED: the wizard currently calls only the pure half (dry-run preview). The
 * live executor ships when the geofence + go-live decisions land (PRP-06 OD-1).
 */

const BASE_URL = 'https://api.workyard.com'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProvisionInputs {
  /** Building S-code, e.g. "S0042". */
  sCode: string
  /** Building street address, e.g. "150 S Whitney". */
  address: string
  /** Workyard customer id for the building's owner LLC (from the customer map). */
  orgCustomerId: number
  /** Geofence id(s) for the building's location (PRP-06 OD-1). */
  geofenceIds: number[]
  /** Vendor-cluster project ids the Materials cost code also attaches to. */
  vendorClusterProjectIds: number[]
}

export interface WorkyardProjectRef {
  id: number
  name: string
}

export interface WorkyardCostCodeRef {
  id: number
  code: string | null
  name: string
}

export interface ExistingWorkyard {
  projects: WorkyardProjectRef[]
  costCodes: WorkyardCostCodeRef[]
}

export interface ProjectPayload {
  name: string
  org_customer_id: number
  geofence_ids: number[]
}

export interface CostCodePayload {
  name: string
  code: string
  project_ids: number[]
  include_all_projects: false
  cost_code_group_id: null
}

export type ProvisionAction = 'create' | 'skip'

export interface ProvisionPlan {
  project: { action: ProvisionAction; matchedId: number | null; payload: ProjectPayload }
  costCode: { action: ProvisionAction; matchedId: number | null; payload: CostCodePayload }
}

// ── Pure planning ────────────────────────────────────────────────────────────

export function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Canonical Workyard project name. Set at creation — rename via API is unreliable (DECISIONS_LOG §0.16). */
export function buildProjectName(sCode: string, address: string): string {
  return `${sCode} - ${address}`
}

/** Bilingual Materials cost-code name (EN / ES). */
export function buildCostCodeName(address: string): string {
  return `${address} - Materials / Materiales`
}

export function buildProjectPayload(inputs: ProvisionInputs): ProjectPayload {
  return {
    name: buildProjectName(inputs.sCode, inputs.address),
    org_customer_id: inputs.orgCustomerId,
    geofence_ids: inputs.geofenceIds,
  }
}

export function buildCostCodePayload(inputs: ProvisionInputs, buildingProjectId: number | null): CostCodePayload {
  return {
    name: buildCostCodeName(inputs.address),
    code: inputs.sCode,
    project_ids: [...(buildingProjectId !== null ? [buildingProjectId] : []), ...inputs.vendorClusterProjectIds],
    include_all_projects: false,
    cost_code_group_id: null,
  }
}

/**
 * Decide create-vs-skip for the project and its Materials cost code against the
 * supplied existing-objects list. Project matched by name; cost code by code
 * (the S-code) — the same checks the onboarding scripts use. Pure: no network.
 */
export function planProvision(inputs: ProvisionInputs, existing: ExistingWorkyard): ProvisionPlan {
  const projectName = buildProjectName(inputs.sCode, inputs.address)
  const matchedProject = existing.projects.find(p => norm(p.name) === norm(projectName)) ?? null
  const matchedCostCode =
    existing.costCodes.find(c => c.code != null && norm(c.code) === norm(inputs.sCode)) ?? null

  return {
    project: {
      action: matchedProject ? 'skip' : 'create',
      matchedId: matchedProject?.id ?? null,
      payload: buildProjectPayload(inputs),
    },
    costCode: {
      action: matchedCostCode ? 'skip' : 'create',
      matchedId: matchedCostCode?.id ?? null,
      // Building project id is the matched id when skipping, else resolved at
      // execution after the project is created.
      payload: buildCostCodePayload(inputs, matchedProject?.id ?? null),
    },
  }
}

// ── Live execution (server-only; gated) ──────────────────────────────────────

function wyConfig() {
  const apiKey = process.env.WORKYARD_API_KEY
  const orgId = process.env.WORKYARD_ORG_ID ?? '25316'
  if (!apiKey) throw new Error('WORKYARD_API_KEY is not set — live provisioning requires server credentials')
  return { apiKey, orgId }
}

function wyHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

async function wyGetAllPaged<T>(path: string): Promise<T[]> {
  const { apiKey } = wyConfig()
  const out: T[] = []
  let page = 1
  let last = 1
  do {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${BASE_URL}${path}${sep}limit=100&page=${page}`, {
      headers: wyHeaders(apiKey),
      cache: 'no-store',
    })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1500 * page))
      continue
    }
    if (!res.ok) throw new Error(`Workyard GET ${path} failed: ${res.status} ${await res.text()}`)
    const j = (await res.json()) as { data?: T[]; meta?: { last_page?: number } }
    out.push(...(j.data ?? []))
    last = j.meta?.last_page ?? 1
    page++
  } while (page <= last)
  return out
}

async function wyPost<T>(path: string, body: unknown): Promise<T> {
  const { apiKey } = wyConfig()
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: wyHeaders(apiKey),
      body: JSON.stringify(body),
    })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`Workyard POST ${path} failed: ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }
  throw new Error(`Workyard POST ${path} failed: rate-limited after retries`)
}

/** Read existing projects + cost codes from Workyard so a plan can be computed. Server-only. */
export async function fetchExisting(): Promise<ExistingWorkyard> {
  const { orgId } = wyConfig()
  const [projects, costCodes] = await Promise.all([
    wyGetAllPaged<{ id: number; name: string }>(`/orgs/${orgId}/projects`),
    wyGetAllPaged<{ id: number; code: string | null; name: string }>(`/orgs/${orgId}/cost_codes`),
  ])
  return {
    projects: projects.map(p => ({ id: p.id, name: p.name })),
    costCodes: costCodes.map(c => ({ id: c.id, code: c.code ?? null, name: c.name })),
  }
}

export interface ProvisionResult {
  projectAction: ProvisionAction | 'preview'
  costCodeAction: ProvisionAction | 'preview'
  workyardProjectId: number | null
  workyardCostCodeId: number | null
}

/**
 * Execute a plan. With `apply:false` (the default) this is a no-op preview and
 * writes nothing. With `apply:true` it creates the project and/or cost code as
 * the plan dictates, resolving the new project id into the cost code's
 * project_ids. Server-only.
 */
export async function executeProvision(
  inputs: ProvisionInputs,
  plan: ProvisionPlan,
  opts: { apply: boolean },
): Promise<ProvisionResult> {
  if (!opts.apply) {
    return {
      projectAction: 'preview',
      costCodeAction: 'preview',
      workyardProjectId: plan.project.matchedId,
      workyardCostCodeId: plan.costCode.matchedId,
    }
  }

  const { orgId } = wyConfig()

  let projectId = plan.project.matchedId
  if (plan.project.action === 'create') {
    const created = await wyPost<{ id: number }>(`/orgs/${orgId}/projects`, plan.project.payload)
    projectId = created.id
  }

  let costCodeId = plan.costCode.matchedId
  if (plan.costCode.action === 'create') {
    const payload = buildCostCodePayload(inputs, projectId)
    const created = await wyPost<{ id: number }>(`/orgs/${orgId}/cost_codes`, payload)
    costCodeId = created.id
  }

  return {
    projectAction: plan.project.action,
    costCodeAction: plan.costCode.action,
    workyardProjectId: projectId,
    workyardCostCodeId: costCodeId,
  }
}
