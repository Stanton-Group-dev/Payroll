'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Check, ChevronRight, ChevronLeft, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProperties } from '@/hooks/payroll/useProperties'
import { usePayrollTravelPremiums } from '@/hooks/payroll/usePayrollTravelPremiums'
import { useWorkyardCustomerMap } from '@/hooks/payroll/useWorkyardCustomerMap'
import { buildProjectName, buildCostCodeName, norm } from '@/lib/payroll/workyard-provision'
import { PageHeader, FormButton, FormField, FormInput, FormSelect, InfoBlock } from '@/components/form'
import type { TravelPremiumType } from '@/lib/supabase/types'

const STEPS = ['Building', 'Workyard', 'Travel premium', 'Payroll wiring', 'Review & apply']

const TYPE_LABELS: Record<TravelPremiumType, string> = {
  per_day: 'Per Day',
  flat_per_job: 'Flat per Job',
}

interface ApplySummary {
  premium: boolean
  propertyUpdated: boolean
  logged: boolean
  workyardProjectId: number | null
  workyardCostCodeId: number | null
  workyardProjectAction: string | null
  workyardCostCodeAction: string | null
  manualSteps: string[]
}

export default function OnboardWizardPage() {
  const { properties } = useProperties(true)
  const { addPremium } = usePayrollTravelPremiums()
  const { rows: customerMap } = useWorkyardCustomerMap()

  const [step, setStep] = useState(0) // 0-based; index into STEPS. step === STEPS.length => done
  const [propertyId, setPropertyId] = useState('')
  const [sCode, setSCode] = useState('')
  const [address, setAddress] = useState('')
  const [ownerLlc, setOwnerLlc] = useState('')
  const [geofenceIds, setGeofenceIds] = useState('')

  const [premiumOn, setPremiumOn] = useState(false)
  const [premiumType, setPremiumType] = useState<TravelPremiumType>('per_day')
  const [premiumAmount, setPremiumAmount] = useState('')
  const [premiumEffective, setPremiumEffective] = useState(format(new Date(), 'yyyy-MM-dd'))

  const [includeInInvoicing, setIncludeInInvoicing] = useState(true)

  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [result, setResult] = useState<ApplySummary | null>(null)

  const customer = ownerLlc
    ? customerMap.find(r => norm(r.owner_llc) === norm(ownerLlc)) ?? null
    : null
  const llcUnmapped = !!ownerLlc && !customer

  const projectName = buildProjectName(sCode || 'S????', address || '(address)')
  const costCodeName = buildCostCodeName(address || '(address)')

  const onSelectProperty = (id: string) => {
    setPropertyId(id)
    const p = properties.find(pp => pp.id === id)
    if (p) {
      setSCode(p.code ?? '')
      if (!address) setAddress(p.name ?? '')
    }
  }

  const canNext = (): boolean => {
    if (step === 0) return !!propertyId && !!sCode.trim() && !!address.trim()
    if (step === 2 && premiumOn) return parseFloat(premiumAmount) > 0
    return true
  }

  const handleApply = async () => {
    setApplying(true)
    setApplyError(null)
    const supabase = createClient()
    const summary: ApplySummary = {
      premium: false,
      propertyUpdated: false,
      logged: false,
      workyardProjectId: null,
      workyardCostCodeId: null,
      workyardProjectAction: null,
      workyardCostCodeAction: null,
      manualSteps: [],
    }
    try {
      if (premiumOn) {
        const amt = parseFloat(premiumAmount)
        if (!amt || amt <= 0) throw new Error('Travel premium amount is invalid')
        await addPremium({ propertyId, premiumType, amount: amt, effectiveDate: premiumEffective })
        summary.premium = true
      }

      const { error: ppErr } = await supabase
        .from('payroll_property')
        .update({ owner_llc: ownerLlc || null, include_in_invoicing: includeInInvoicing })
        .eq('property_id', propertyId)
      if (ppErr) throw new Error(`Payroll property update failed: ${ppErr.message}`)
      summary.propertyUpdated = true

      // ── Workyard provisioning ─────────────────────────────────────────────
      // Call the server-side provisioning endpoint (CF-8). This creates the
      // Workyard project (and attaches existing cost codes) idempotently, then
      // logs an audit row. We only attempt live provisioning when geofence ids
      // have been entered — the Workyard API requires them to create a project.
      const parsedGeofenceIds = geofenceIds
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !Number.isNaN(n))

      const canProvision = parsedGeofenceIds.length > 0 && !!customer

      if (canProvision) {
        const provRes = await fetch('/api/workyard/provision-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputs: {
              sCode,
              address,
              orgCustomerId: customer!.org_customer_id,
              geofenceIds: parsedGeofenceIds,
              // Vendor cluster project ids (CF-7) are not yet configurable via
              // the UI — pass empty for now. The cost code will attach to the
              // new project only; vendor-cluster attachment is a follow-up task.
              vendorClusterProjectIds: [],
            },
            apply: true,
          }),
        })

        if (!provRes.ok) {
          const errBody = (await provRes.json().catch(() => ({}))) as { error?: string }
          throw new Error(`Workyard provisioning failed: ${errBody.error ?? provRes.status}`)
        }

        const provData = (await provRes.json()) as {
          result?: {
            projectAction: string
            costCodeAction: string
            workyardProjectId: number | null
            workyardCostCodeId: number | null
          }
          logId?: string | null
          manualSteps?: string[]
        }

        if (provData.result) {
          summary.workyardProjectId = provData.result.workyardProjectId
          summary.workyardCostCodeId = provData.result.workyardCostCodeId
          summary.workyardProjectAction = provData.result.projectAction
          summary.workyardCostCodeAction = provData.result.costCodeAction
        }
        if (provData.logId) summary.logged = true
        if (provData.manualSteps) summary.manualSteps = provData.manualSteps
      } else {
        // No geofence ids or unmapped LLC — fall back to writing a preview log
        // row directly. The table may be staged; best-effort.
        const { error: logErr } = await supabase.from('payroll_workyard_provision_log').insert({
          property_code: sCode,
          workyard_project_id: null,
          workyard_cost_code_id: null,
          project_action: 'preview',
          cost_code_action: 'preview',
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        if (!logErr) summary.logged = true
        summary.manualSteps = [
          geofenceIds.trim()
            ? 'Owner LLC is not mapped to a Workyard customer — add it in Workyard Customers settings, then re-run.'
            : 'No geofence id(s) entered — add them and re-run to provision the Workyard project.',
          'Cost-code creation via Workyard API returns 404 — create per-building cost codes manually in Workyard UI or via the onboarding scripts.',
        ]
      }

      setResult(summary)
      setStep(STEPS.length)
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="New Project"
        subtitle="Onboard a building — provision Workyard, set the travel premium, and wire billing"
      />

      <div className="p-6 max-w-3xl">
        {/* Stepper */}
        {step < STEPS.length && (
          <div className="flex items-center gap-2 mb-6">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 ${
                    i === step
                      ? 'bg-[var(--primary)] text-white font-medium'
                      : i < step
                        ? 'text-[var(--primary)]'
                        : 'text-[var(--muted)]'
                  }`}
                >
                  {i < step ? <Check size={12} /> : <span className="font-mono">{i + 1}</span>}
                  {label}
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={12} className="text-[var(--muted)]" />}
              </div>
            ))}
          </div>
        )}

        {/* Step 1 — Building */}
        {step === 0 && (
          <div className="space-y-4">
            <InfoBlock variant="default" title="Attach to an existing property">
              v1 attaches onboarding to a property that already exists. Creating a brand-new property
              in-app is pending the AppFolio-identity decision (PRP-06 OD-2).
            </InfoBlock>
            <FormField label="Property" required>
              <FormSelect value={propertyId} onChange={e => onSelectProperty(e.target.value)}>
                <option value="">— Select —</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Building S-code" required helperText="Carried in the Workyard project name; the importer resolves buildings by this.">
              <FormInput value={sCode} onChange={e => setSCode(e.target.value)} placeholder="S0042" />
            </FormField>
            <FormField label="Address" required helperText="Used in the project and cost-code names.">
              <FormInput value={address} onChange={e => setAddress(e.target.value)} placeholder="150 S Whitney" />
            </FormField>
            <FormField label="Owner LLC" helperText="Billing entity; also resolves the Workyard customer the project is created under.">
              <FormInput value={ownerLlc} onChange={e => setOwnerLlc(e.target.value)} placeholder="SREP Park 1 LLC" />
            </FormField>
          </div>
        )}

        {/* Step 2 — Workyard (preview only) */}
        {step === 1 && (
          <div className="space-y-4">
            <InfoBlock variant="warning" title="Preview only — no Workyard writes yet">
              Live project + cost-code creation is deferred until the geofence and go-live decisions
              land (PRP-06 OD-1). This shows exactly what will be created; create-vs-skip is
              determined server-side against live Workyard data at go-live.
            </InfoBlock>

            {llcUnmapped && (
              <InfoBlock variant="error" title="Owner LLC not mapped to a Workyard customer">
                <span className="flex items-center gap-1">
                  <AlertTriangle size={13} />
                  Map “{ownerLlc}” first in{' '}
                  <Link href="/payroll/admin/workyard-customers" className="underline">Workyard Customers</Link>.
                </span>
              </InfoBlock>
            )}

            <FormField label="Geofence id(s)" helperText="Comma-separated. Required by Workyard to create a project (PRP-06 OD-1).">
              <FormInput value={geofenceIds} onChange={e => setGeofenceIds(e.target.value)} placeholder="578898" />
            </FormField>

            <div className="border border-[var(--border)] text-sm">
              <div className="px-4 py-2 bg-[var(--bg-section)] border-b border-[var(--border)] font-medium">
                Workyard project
              </div>
              <dl className="px-4 py-3 space-y-1">
                <Row k="name" v={projectName} />
                <Row k="org_customer_id" v={customer ? String(customer.org_customer_id) : '(unmapped)'} />
                <Row k="geofence_ids" v={geofenceIds || '(none — required at go-live)'} />
              </dl>
            </div>

            <div className="border border-[var(--border)] text-sm">
              <div className="px-4 py-2 bg-[var(--bg-section)] border-b border-[var(--border)] font-medium">
                Materials cost code
              </div>
              <dl className="px-4 py-3 space-y-1">
                <Row k="code" v={sCode} />
                <Row k="name" v={costCodeName} />
                <Row k="project_ids" v="this project + vendor clusters (resolved at go-live)" />
              </dl>
            </div>
          </div>
        )}

        {/* Step 3 — Travel premium */}
        {step === 2 && (
          <div className="space-y-4">
            <InfoBlock variant="warning" title="Recorded, not yet applied">
              A travel premium is saved here, but the pay engine does not yet read it — it will not
              pay any employee or bill any property until the engine wiring ships (PRP-07).
            </InfoBlock>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={premiumOn} onChange={e => setPremiumOn(e.target.checked)} />
              Set a travel premium for this building
            </label>
            {premiumOn && (
              <>
                <FormField label="Premium type" required>
                  <FormSelect value={premiumType} onChange={e => setPremiumType(e.target.value as TravelPremiumType)}>
                    {(Object.entries(TYPE_LABELS) as [TravelPremiumType, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </FormSelect>
                </FormField>
                <FormField label="Amount ($)" required>
                  <FormInput type="number" step="0.01" min="0" value={premiumAmount}
                    onChange={e => setPremiumAmount(e.target.value)} />
                </FormField>
                <FormField label="Effective date" required>
                  <FormInput type="date" value={premiumEffective}
                    onChange={e => setPremiumEffective(e.target.value)} />
                </FormField>
              </>
            )}
          </div>
        )}

        {/* Step 4 — Payroll wiring */}
        {step === 3 && (
          <div className="space-y-4">
            <FormField label="Owner LLC (billing entity)" helperText="Written to the payroll billing overlay.">
              <FormInput value={ownerLlc} onChange={e => setOwnerLlc(e.target.value)} placeholder="SREP Park 1 LLC" />
            </FormField>
            <FormField label="Include in invoicing" required>
              <FormSelect value={includeInInvoicing ? 'yes' : 'no'} onChange={e => setIncludeInInvoicing(e.target.value === 'yes')}>
                <option value="yes">Yes — bill this property</option>
                <option value="no">No — exclude from billing</option>
              </FormSelect>
            </FormField>
          </div>
        )}

        {/* Step 5 — Review & apply */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="border border-[var(--border)] text-sm">
              <div className="px-4 py-2 bg-[var(--bg-section)] border-b border-[var(--border)] font-medium">
                On apply — written now (reversible, in-app)
              </div>
              <dl className="px-4 py-3 space-y-1">
                <Row k="Payroll overlay" v={`owner_llc = ${ownerLlc || '(none)'}, include_in_invoicing = ${includeInInvoicing ? 'yes' : 'no'}`} />
                <Row k="Travel premium" v={premiumOn ? `${TYPE_LABELS[premiumType]} $${premiumAmount} from ${premiumEffective} (recorded; not yet applied)` : '(none)'} />
                <Row k="Provision log" v="audit row (best-effort; table staged)" />
              </dl>
            </div>
            <div className="border border-[var(--border)] text-sm">
              <div className="px-4 py-2 bg-[var(--bg-section)] border-b border-[var(--border)] font-medium text-[var(--muted)]">
                Deferred — not done by this wizard yet
              </div>
              <dl className="px-4 py-3 space-y-1 text-[var(--muted)]">
                <Row k="Workyard" v={`create "${projectName}" + cost code ${sCode} (needs geofence + go-live)`} />
                <Row k="Premium effect" v="pay/billing wiring ships in PRP-07" />
              </dl>
            </div>
            {applyError && <InfoBlock variant="error">{applyError}</InfoBlock>}
          </div>
        )}

        {/* Done */}
        {step === STEPS.length && result && (
          <div className="space-y-4">
            <InfoBlock variant="success" title="Onboarding saved">
              <ul className="list-disc pl-5 space-y-0.5">
                <li>Payroll overlay {result.propertyUpdated ? 'updated' : 'not updated'}.</li>
                <li>Travel premium {result.premium ? 'recorded (not yet applied — PRP-07)' : 'not set'}.</li>
                {result.workyardProjectAction ? (
                  <>
                    <li>
                      Workyard project:{' '}
                      {result.workyardProjectAction === 'create'
                        ? `created (id ${result.workyardProjectId})`
                        : result.workyardProjectAction === 'skip'
                          ? `already exists (id ${result.workyardProjectId}) — skipped`
                          : result.workyardProjectAction}
                    </li>
                    <li>
                      Workyard cost code:{' '}
                      {result.workyardCostCodeAction === 'create'
                        ? `created (id ${result.workyardCostCodeId})`
                        : result.workyardCostCodeAction === 'skip'
                          ? `already exists (id ${result.workyardCostCodeId}) — skipped`
                          : result.workyardCostCodeAction}
                    </li>
                  </>
                ) : (
                  <li>Workyard project: deferred (no geofence ids or unmapped LLC).</li>
                )}
                <li>Audit row {result.logged ? 'written' : 'skipped (provision-log table staged)'}.</li>
              </ul>
            </InfoBlock>
            {result.manualSteps.length > 0 && (
              <InfoBlock variant="warning" title="Manual steps still required">
                <ul className="list-disc pl-5 space-y-0.5">
                  {result.manualSteps.map(s => <li key={s}>{s}</li>)}
                </ul>
              </InfoBlock>
            )}
            <InfoBlock variant="default" title="Next: ship PRP-07 to make the premium real">
              The travel premium is recorded but the pay engine does not yet apply it. Ship
              PRP-07 to wire it into pay and billing.
            </InfoBlock>
          </div>
        )}

        {/* Nav */}
        {step < STEPS.length && (
          <div className="flex gap-2 mt-6 pt-4 border-t border-[var(--divider)]">
            {step > 0 && (
              <FormButton variant="ghost" onClick={() => setStep(s => s - 1)}>
                <ChevronLeft size={14} className="mr-1" /> Back
              </FormButton>
            )}
            <div className="flex-1" />
            {step < STEPS.length - 1 ? (
              <FormButton onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
                Next <ChevronRight size={14} className="ml-1" />
              </FormButton>
            ) : (
              <FormButton onClick={handleApply} loading={applying} disabled={!propertyId}>
                Apply
              </FormButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="font-mono text-xs text-[var(--muted)] w-40 shrink-0">{k}</dt>
      <dd className="text-[var(--ink)]">{v}</dd>
    </div>
  )
}
