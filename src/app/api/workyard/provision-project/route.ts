import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isWorkyardMockEnabled } from '@/lib/payroll/workyard-mock'
import {
  fetchExisting,
  planProvision,
  executeProvision,
  type ProvisionInputs,
} from '@/lib/payroll/workyard-provision'

/**
 * POST /api/workyard/provision-project
 *
 * Server-side provisioning endpoint for the New Project Wizard (PRP-06, CF-8).
 *
 * With `apply: false` (dry-run): fetches existing Workyard objects, returns a
 * plan showing `create` vs `skip` for the project and Materials cost code.
 * Nothing is written.
 *
 * With `apply: true`: executes the plan — creates the project if absent, attaches
 * the cost code if absent — then logs an audit row to
 * `payroll_workyard_provision_log` and returns the resulting ids.
 *
 * The Workyard API key lives server-side only. It is never serialized to the
 * client response.
 *
 * NOTE: Per the Workyard capability matrix (WORKYARD_GUIDE.md §4):
 *  - Project creation: POST /orgs/{org}/projects — confirmed working.
 *  - Cost code creation: POST /orgs/{org}/cost_codes — returns 404; NOT supported.
 *    The route provisions the project and attaches EXISTING cost codes only.
 *    Per-building cost-code creation remains a manual step (see "manualSteps" in
 *    the response).
 */

interface ProvisionRequestBody {
  /** Provision inputs — S-code, address, customer id, geofence ids, vendor cluster ids. */
  inputs: ProvisionInputs
  /**
   * `false` = dry-run (default): compute and return the plan without writing.
   * `true`  = apply: execute the plan, log the result.
   */
  apply?: boolean
}

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Credentials gate ─────────────────────────────────────────────────────────
  // In mock mode we skip the live Workyard calls and return a deterministic plan.
  const mock = isWorkyardMockEnabled()
  if (!mock && (!process.env.WORKYARD_API_KEY || !process.env.WORKYARD_ORG_ID)) {
    return NextResponse.json({ error: 'Workyard API credentials not configured' }, { status: 500 })
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: ProvisionRequestBody
  try {
    body = (await req.json()) as ProvisionRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { inputs, apply = false } = body

  if (
    !inputs?.sCode ||
    !inputs?.address ||
    !inputs?.orgCustomerId ||
    !Array.isArray(inputs?.geofenceIds) ||
    !Array.isArray(inputs?.vendorClusterProjectIds)
  ) {
    return NextResponse.json(
      {
        error:
          'inputs must include: sCode, address, orgCustomerId (number), geofenceIds (number[]), vendorClusterProjectIds (number[])',
      },
      { status: 400 },
    )
  }

  try {
    // ── Mock path ──────────────────────────────────────────────────────────────
    if (mock) {
      const plan = planProvision(inputs, { projects: [], costCodes: [] })
      return NextResponse.json({
        mock: true,
        apply,
        plan: {
          project: { action: plan.project.action, matchedId: plan.project.matchedId, payload: plan.project.payload },
          costCode: { action: plan.costCode.action, matchedId: plan.costCode.matchedId, payload: plan.costCode.payload },
        },
        result: apply
          ? {
              projectAction: plan.project.action,
              costCodeAction: plan.costCode.action,
              workyardProjectId: null,
              workyardCostCodeId: null,
            }
          : null,
        manualSteps: [
          'Cost-code creation via Workyard API returns 404 — create per-building cost codes manually in Workyard UI or via the onboarding scripts.',
        ],
      })
    }

    // ── Live path: fetch existing objects ─────────────────────────────────────
    const existing = await fetchExisting()
    const plan = planProvision(inputs, existing)

    if (!apply) {
      // Dry-run: return the plan only.
      return NextResponse.json({
        apply: false,
        plan: {
          project: { action: plan.project.action, matchedId: plan.project.matchedId, payload: plan.project.payload },
          costCode: { action: plan.costCode.action, matchedId: plan.costCode.matchedId, payload: plan.costCode.payload },
        },
        manualSteps: [
          'Cost-code creation via Workyard API returns 404 — create per-building cost codes manually in Workyard UI or via the onboarding scripts.',
        ],
      })
    }

    // ── Apply: execute the plan ───────────────────────────────────────────────
    const result = await executeProvision(inputs, plan, { apply: true })

    // ── Audit log ─────────────────────────────────────────────────────────────
    // Best-effort: if the table isn't applied yet, log the failure but don't
    // block the success response.
    let logId: string | null = null
    const { data: logRow, error: logErr } = await supabase
      .from('payroll_workyard_provision_log')
      .insert({
        property_code: inputs.sCode,
        workyard_project_id: result.workyardProjectId !== null ? String(result.workyardProjectId) : null,
        workyard_cost_code_id:
          result.workyardCostCodeId !== null ? String(result.workyardCostCodeId) : null,
        project_action: result.projectAction,
        cost_code_action: result.costCodeAction,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (!logErr && logRow) {
      logId = logRow.id as string
    }

    // ── Optionally persist the project id on payroll_property ─────────────────
    // Best-effort: the workyard_project_id column is additive (migration 20260623_03)
    // and may not be applied yet. If it fails, it does not block the response.
    if (result.workyardProjectId !== null) {
      try {
        await supabase
          .from('payroll_property')
          .update({ workyard_project_id: String(result.workyardProjectId) })
          .eq('property_id', inputs.sCode)
      } catch {
        // Additive column may not be applied yet — swallow and continue.
      }
    }

    return NextResponse.json({
      apply: true,
      plan: {
        project: { action: plan.project.action, matchedId: plan.project.matchedId },
        costCode: { action: plan.costCode.action, matchedId: plan.costCode.matchedId },
      },
      result: {
        projectAction: result.projectAction,
        costCodeAction: result.costCodeAction,
        workyardProjectId: result.workyardProjectId,
        workyardCostCodeId: result.workyardCostCodeId,
      },
      logId,
      manualSteps: [
        'Cost-code creation via Workyard API returns 404 — create per-building cost codes manually in Workyard UI or via the onboarding scripts.',
      ],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
