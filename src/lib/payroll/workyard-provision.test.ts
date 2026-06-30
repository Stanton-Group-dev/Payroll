import { describe, it, expect } from 'vitest'
import {
  planProvision,
  executeProvision,
  buildProjectName,
  buildCostCodeName,
  type ProvisionInputs,
  type ExistingWorkyard,
} from './workyard-provision'

const inputs: ProvisionInputs = {
  sCode: 'S0099',
  address: '1 Test St',
  orgCustomerId: 317292,
  geofenceIds: [578898],
  vendorClusterProjectIds: [101, 102, 103],
}

const empty: ExistingWorkyard = { projects: [], costCodes: [] }

describe('workyard-provision plan (dry-run)', () => {
  it('plans CREATE for a brand-new building', () => {
    const plan = planProvision(inputs, empty)
    expect(plan.project.action).toBe('create')
    expect(plan.project.matchedId).toBeNull()
    expect(plan.costCode.action).toBe('create')
    expect(plan.costCode.matchedId).toBeNull()
  })

  it('plans SKIP when the project name already exists', () => {
    const existing: ExistingWorkyard = {
      projects: [{ id: 555, name: buildProjectName(inputs.sCode, inputs.address) }],
      costCodes: [],
    }
    const plan = planProvision(inputs, existing)
    expect(plan.project.action).toBe('skip')
    expect(plan.project.matchedId).toBe(555)
    // cost code still missing -> create, attached to the matched project id
    expect(plan.costCode.action).toBe('create')
    expect(plan.costCode.payload.project_ids).toContain(555)
  })

  it('plans SKIP when the cost code (S-code) already exists, case-insensitively', () => {
    const existing: ExistingWorkyard = {
      projects: [],
      costCodes: [{ id: 777, code: 's0099', name: 'whatever' }],
    }
    const plan = planProvision(inputs, existing)
    expect(plan.costCode.action).toBe('skip')
    expect(plan.costCode.matchedId).toBe(777)
  })

  it('builds the canonical project + bilingual cost-code names', () => {
    expect(buildProjectName('S0042', '150 S Whitney')).toBe('S0042 - 150 S Whitney')
    expect(buildCostCodeName('150 S Whitney')).toBe('150 S Whitney - Materials / Materiales')
  })

  it('always attaches the vendor cluster project ids to the cost code', () => {
    const plan = planProvision(inputs, empty)
    expect(plan.costCode.payload.project_ids).toEqual(expect.arrayContaining([101, 102, 103]))
    expect(plan.costCode.payload.include_all_projects).toBe(false)
    expect(plan.costCode.payload.code).toBe('S0099')
  })
})

// ── Route CF-8: executeProvision dry-run (no network) ────────────────────────
//
// These tests cover the pure branch of executeProvision (apply:false). The live
// branch (apply:true) calls the Workyard API and is integration-tested against
// the real org; it is not exercised here. This mirrors the CF-8 DoD check:
// "Endpoint dry-run: existing object → skip, new object → create."

describe('executeProvision preview (apply:false)', () => {
  it('returns preview action and null ids when apply is false — new building', async () => {
    const plan = planProvision(inputs, empty)
    const result = await executeProvision(inputs, plan, { apply: false })
    expect(result.projectAction).toBe('preview')
    expect(result.costCodeAction).toBe('preview')
    expect(result.workyardProjectId).toBeNull()
    expect(result.workyardCostCodeId).toBeNull()
  })

  it('returns preview action with matched ids when both objects already exist', async () => {
    const existing: ExistingWorkyard = {
      projects: [{ id: 555, name: buildProjectName(inputs.sCode, inputs.address) }],
      costCodes: [{ id: 777, code: inputs.sCode, name: 'whatever' }],
    }
    const plan = planProvision(inputs, existing)
    expect(plan.project.action).toBe('skip')
    expect(plan.costCode.action).toBe('skip')
    const result = await executeProvision(inputs, plan, { apply: false })
    expect(result.projectAction).toBe('preview')
    // Matched ids are carried through on the plan but preview returns them as-is.
    expect(result.workyardProjectId).toBe(555)
    expect(result.workyardCostCodeId).toBe(777)
  })
})
