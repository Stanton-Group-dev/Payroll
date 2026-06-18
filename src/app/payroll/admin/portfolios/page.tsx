'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronRight, ChevronDown, Pencil, Check, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/payroll/useAuth'
import {
  PageHeader, FormButton, FormField, FormInput, FormTextarea, FormSelect,
  InfoBlock, SectionDivider, Drawer,
} from '@/components/form'
import { format } from 'date-fns'

interface Portfolio {
  id: string
  name: string
  description: string | null
  owner_llc: string | null
  is_active: boolean
  created_at: string
  property_count: number
  total_units: number
}

interface Property {
  id: string
  appfolio_property_id: string
  code: string
  name: string
  address: string | null
  total_units: number | null
  portfolio_id: string | null
  billing_llc: string | null
  is_active: boolean
}

interface CreatePropertyInput {
  appfolio_property_id: string
  code: string
  name: string
  address: string | null
  total_units: number | null
  billing_llc: string | null
  portfolio_id: string | null
  is_active: boolean
}

type WizardStep = 'details' | 'properties' | 'llc' | 'fee' | 'confirm'

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'properties', label: 'Properties' },
  { key: 'llc', label: 'LLC Groupings' },
  { key: 'fee', label: 'Mgmt Fee' },
  { key: 'confirm', label: 'Confirm' },
]

interface WizardState {
  name: string
  description: string
  selectedPropertyIds: string[]
  llcGroupings: { llcName: string; propertyIds: string[] }[]
  feeRate: string
  feeEffectiveDate: string
}

const emptyWizard = (): WizardState => ({
  name: '',
  description: '',
  selectedPropertyIds: [],
  llcGroupings: [],
  feeRate: '10',
  feeEffectiveDate: new Date().toISOString().split('T')[0],
})

const emptyPropertyForm = (): CreatePropertyInput => ({
  appfolio_property_id: '',
  code: '',
  name: '',
  address: null,
  total_units: null,
  billing_llc: null,
  portfolio_id: null,
  is_active: true,
})

export default function PortfoliosPage() {
  const { isAdmin } = useAuth()
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [allProperties, setAllProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('details')
  const [wizard, setWizard] = useState<WizardState>(emptyWizard())
  const [saving, setSaving] = useState(false)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingLLC, setEditingLLC] = useState<string>('')
  const [newLLCName, setNewLLCName] = useState('')
  const [propertyDrawerOpen, setPropertyDrawerOpen] = useState(false)
  const [propertyForm, setPropertyForm] = useState<CreatePropertyInput>(emptyPropertyForm())
  const [propertySaving, setPropertySaving] = useState(false)
  const [propertyError, setPropertyError] = useState<string | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [editForm, setEditForm] = useState<{ id: string; name: string; description: string; owner_llc: string; is_active: boolean } | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [portRes, propRes] = await Promise.all([
      supabase.from('portfolios').select('id, name, description, owner_llc, is_active, created_at').eq('is_active', true).order('name'),
      supabase.from('properties').select('id, appfolio_property_id, code, name, address, total_units, portfolio_id, billing_llc, is_active').eq('is_active', true).order('code'),
    ])
    const props = propRes.data ?? []
    setAllProperties(props)

    const portfolioList = (portRes.data ?? []).map(p => {
      const pp = props.filter(prop => prop.portfolio_id === p.id)
      return {
        ...p,
        property_count: pp.length,
        total_units: pp.reduce((s, x) => s + (x.total_units ?? 0), 0),
      }
    })
    setPortfolios(portfolioList)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const selectedProperties = allProperties.filter(p => wizard.selectedPropertyIds.includes(p.id))

  const stepIndex = STEPS.findIndex(s => s.key === wizardStep)

  const canAdvance = (): boolean => {
    if (wizardStep === 'details') return wizard.name.trim().length > 0
    if (wizardStep === 'properties') return wizard.selectedPropertyIds.length > 0
    if (wizardStep === 'llc') return true
    if (wizardStep === 'fee') {
      const r = parseFloat(wizard.feeRate)
      return !isNaN(r) && r >= 0 && r <= 100
    }
    return true
  }

  const advance = () => {
    const next = STEPS[stepIndex + 1]
    if (next) setWizardStep(next.key)
  }

  const back = () => {
    const prev = STEPS[stepIndex - 1]
    if (prev) setWizardStep(prev.key)
  }

  const addLLCGroup = () => {
    if (!newLLCName.trim()) return
    setWizard(p => ({ ...p, llcGroupings: [...p.llcGroupings, { llcName: newLLCName.trim(), propertyIds: [] }] }))
    setNewLLCName('')
  }

  const togglePropertyInLLC = (llcName: string, propertyId: string) => {
    setWizard(p => ({
      ...p,
      llcGroupings: p.llcGroupings.map(g =>
        g.llcName === llcName
          ? {
              ...g,
              propertyIds: g.propertyIds.includes(propertyId)
                ? g.propertyIds.filter(id => id !== propertyId)
                : [...g.propertyIds, propertyId],
            }
          : g
      ),
    }))
  }

  const handleCreate = async () => {
    setSaving(true)
    setWizardError(null)
    const supabase = createClient()
    const portfolioId = `portfolio-${Date.now()}`

    const { error: portErr } = await supabase.from('portfolios').insert({
      id: portfolioId,
      name: wizard.name.trim(),
      description: wizard.description.trim() || null,
      is_active: true,
    })
    if (portErr) { setWizardError(portErr.message); setSaving(false); return }

    // Assign properties to portfolio
    if (wizard.selectedPropertyIds.length > 0) {
      const { error: propErr } = await supabase
        .from('properties')
        .update({ portfolio_id: portfolioId })
        .in('id', wizard.selectedPropertyIds)
      if (propErr) { setWizardError(propErr.message); setSaving(false); return }
    }

    // Set portfolio-specific management fee if it differs from default
    const feeRate = parseFloat(wizard.feeRate)
    if (!isNaN(feeRate)) {
      await supabase.from('payroll_management_fee_config').insert({
        rate_pct: feeRate / 100,
        portfolio_id: portfolioId,
        effective_date: wizard.feeEffectiveDate,
      })
    }

    setShowWizard(false)
    setWizard(emptyWizard())
    setWizardStep('details')
    await load()
    setSaving(false)
  }

  const unassignedProperties = allProperties.filter(p => !p.portfolio_id)

  const selectedPropertyPortfolio = portfolios.find(p => p.id === propertyForm.portfolio_id)
  const fallbackOwnerLLC = selectedPropertyPortfolio?.owner_llc?.trim() ?? ''

  const handleCreateProperty = async () => {
    setPropertyError(null)
    if (!isAdmin) { setPropertyError('Only admins can add properties.'); return }

    const normalizedAppfolioId = propertyForm.appfolio_property_id.trim().toUpperCase()
    const normalizedCode = propertyForm.code.trim().toUpperCase()
    const normalizedName = propertyForm.name.trim()
    const normalizedAddress = propertyForm.address?.trim() ? propertyForm.address.trim() : null
    const normalizedBillingLLC = propertyForm.billing_llc?.trim() ? propertyForm.billing_llc.trim() : null

    if (!normalizedAppfolioId) { setPropertyError('AppFolio Property ID is required.'); return }
    if (!normalizedCode) { setPropertyError('Property code is required.'); return }
    if (!normalizedName) { setPropertyError('Property name is required.'); return }

    let parsedUnits: number | null = null
    if (propertyForm.total_units !== null && String(propertyForm.total_units).trim() !== '') {
      parsedUnits = Number(propertyForm.total_units)
      if (!Number.isInteger(parsedUnits) || parsedUnits < 0) {
        setPropertyError('Unit count must be a whole number greater than or equal to 0.')
        return
      }
    }

    setPropertySaving(true)
    const supabase = createClient()

    const [codeCheck, appfolioCheck] = await Promise.all([
      supabase.from('properties').select('id').ilike('code', normalizedCode).limit(1),
      supabase.from('properties').select('id').eq('appfolio_property_id', normalizedAppfolioId).limit(1),
    ])

    if (codeCheck.error || appfolioCheck.error) {
      setPropertyError(codeCheck.error?.message ?? appfolioCheck.error?.message ?? 'Failed to validate property uniqueness.')
      setPropertySaving(false)
      return
    }

    if ((codeCheck.data ?? []).length > 0) {
      setPropertyError('A property with this code already exists. Use a unique code.')
      setPropertySaving(false)
      return
    }
    if ((appfolioCheck.data ?? []).length > 0) {
      setPropertyError('A property with this AppFolio Property ID already exists.')
      setPropertySaving(false)
      return
    }

    const payload: CreatePropertyInput = {
      appfolio_property_id: normalizedAppfolioId,
      code: normalizedCode,
      name: normalizedName,
      address: normalizedAddress,
      total_units: parsedUnits,
      billing_llc: normalizedBillingLLC,
      portfolio_id: propertyForm.portfolio_id,
      is_active: propertyForm.is_active,
    }

    const { error } = await supabase.from('properties').insert(payload)
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('appfolio_property_id')) {
        setPropertyError('This AppFolio Property ID is already used by another property.')
      } else if (msg.includes('code')) {
        setPropertyError('This property code is already in use.')
      } else {
        setPropertyError(error.message)
      }
      setPropertySaving(false)
      return
    }

    setPropertyDrawerOpen(false)
    setPropertyForm(emptyPropertyForm())
    await load()
    setPropertySaving(false)
  }

  const openEdit = (p: Portfolio) => {
    setEditError(null)
    setEditForm({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      owner_llc: p.owner_llc ?? '',
      is_active: p.is_active,
    })
    setEditDrawerOpen(true)
  }

  const handleUpdatePortfolio = async () => {
    if (!editForm) return
    setEditError(null)
    if (!isAdmin) { setEditError('Only admins can edit portfolios.'); return }

    const name = editForm.name.trim()
    if (!name) { setEditError('Portfolio name is required.'); return }

    setEditSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('portfolios')
      .update({
        name,
        description: editForm.description.trim() || null,
        owner_llc: editForm.owner_llc.trim() || null,
        is_active: editForm.is_active,
      })
      .eq('id', editForm.id)

    if (error) { setEditError(error.message); setEditSaving(false); return }

    setEditDrawerOpen(false)
    setEditForm(null)
    await load()
    setEditSaving(false)
  }

  return (
    <div>
      <PageHeader
        title="Portfolio Management"
        subtitle="Onboard new management portfolios — no development work required"
        actions={
          isAdmin ? (
            <div className="flex gap-2">
              <FormButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPropertyError(null)
                  setPropertyForm(emptyPropertyForm())
                  setPropertyDrawerOpen(true)
                }}
              >
                <Plus size={14} className="mr-1" />
                Add Property
              </FormButton>
              <FormButton size="sm" onClick={() => { setShowWizard(true); setWizardStep('details'); setWizard(emptyWizard()); setWizardError(null) }}>
                <Plus size={14} className="mr-1" />
                New Portfolio
              </FormButton>
            </div>
          ) : undefined
        }
      />

      <div className="p-6">
        {!isAdmin && (
          <InfoBlock variant="warning" title="Admin access required">
            Only admins can create or modify portfolios.
          </InfoBlock>
        )}

        {/* Wizard */}
        {showWizard && (
          <div className="border-2 border-[var(--primary)] bg-white mb-8">
            {/* Step indicator */}
            <div className="flex border-b border-[var(--divider)] bg-[var(--bg-section)]">
              {STEPS.map((step, i) => {
                const isCurrent = step.key === wizardStep
                const isDone = i < stepIndex
                return (
                  <div
                    key={step.key}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium border-r border-[var(--divider)] last:border-0 ${
                      isCurrent ? 'bg-[var(--primary)] text-white' :
                      isDone ? 'text-[var(--success)]' :
                      'text-[var(--muted)]'
                    }`}
                  >
                    {isDone && <Check size={11} />}
                    <span>{i + 1}. {step.label}</span>
                  </div>
                )
              })}
            </div>

            <div className="p-6">
              {wizardError && <InfoBlock variant="error">{wizardError}</InfoBlock>}

              {/* Step 1: Details */}
              {wizardStep === 'details' && (
                <div className="max-w-lg space-y-4">
                  <h3 className="font-serif text-base text-[var(--primary)]">Portfolio Details</h3>
                  <FormField label="Portfolio Name" required>
                    <FormInput
                      value={wizard.name}
                      onChange={e => setWizard(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g., SREP Southend LLC"
                    />
                  </FormField>
                  <FormField label="Description">
                    <FormTextarea
                      value={wizard.description}
                      onChange={e => setWizard(p => ({ ...p, description: e.target.value }))}
                      rows={2}
                      placeholder="Optional notes about this portfolio"
                    />
                  </FormField>
                </div>
              )}

              {/* Step 2: Properties */}
              {wizardStep === 'properties' && (
                <div>
                  <h3 className="font-serif text-base text-[var(--primary)] mb-1">Assign Properties</h3>
                  <p className="text-sm text-[var(--muted)] mb-4">Select the properties that belong to this portfolio.</p>
                  {unassignedProperties.length === 0 && allProperties.length > 0 && (
                    <InfoBlock variant="default">All properties are already assigned to a portfolio. You can still select properties to reassign them.</InfoBlock>
                  )}
                  <div className="border border-[var(--border)] max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--bg-section)]">
                        <tr className="border-b border-[var(--divider)] text-xs text-[var(--muted)]">
                          <th className="px-3 py-2 text-left w-8"></th>
                          <th className="px-3 py-2 text-left font-medium">Code</th>
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-right font-medium">Units</th>
                          <th className="px-3 py-2 text-left font-medium">Current Portfolio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allProperties.map((prop, i) => {
                          const checked = wizard.selectedPropertyIds.includes(prop.id)
                          const currentPortfolio = portfolios.find(p => p.id === prop.portfolio_id)
                          return (
                            <tr
                              key={prop.id}
                              className={`border-b border-[var(--divider)] cursor-pointer ${checked ? 'bg-[var(--primary)]/5' : i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}
                              onClick={() => setWizard(p => ({
                                ...p,
                                selectedPropertyIds: checked
                                  ? p.selectedPropertyIds.filter(id => id !== prop.id)
                                  : [...p.selectedPropertyIds, prop.id],
                              }))}
                            >
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={checked} onChange={() => {}} className="w-3.5 h-3.5 rounded-none" />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{prop.code}</td>
                              <td className="px-3 py-2">{prop.name}</td>
                              <td className="px-3 py-2 text-right">{prop.total_units ?? '—'}</td>
                              <td className="px-3 py-2 text-xs text-[var(--muted)]">{currentPortfolio?.name ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-2">
                    {wizard.selectedPropertyIds.length} selected — {selectedProperties.reduce((s, p) => s + (p.total_units ?? 0), 0)} total units
                  </p>
                </div>
              )}

              {/* Step 3: LLC Groupings */}
              {wizardStep === 'llc' && (
                <div>
                  <h3 className="font-serif text-base text-[var(--primary)] mb-1">LLC Invoice Groupings</h3>
                  <p className="text-sm text-[var(--muted)] mb-4">
                    Define which properties belong to which owner LLC. Each LLC gets its own invoice. You can skip this and configure it later.
                  </p>

                  {/* Add LLC */}
                  <div className="flex gap-2 mb-4">
                    <FormInput
                      value={newLLCName}
                      onChange={e => setNewLLCName(e.target.value)}
                      placeholder="LLC name, e.g., SREP Park 1 LLC"
                      onKeyDown={e => e.key === 'Enter' && addLLCGroup()}
                    />
                    <FormButton size="sm" onClick={addLLCGroup} disabled={!newLLCName.trim()}>
                      <Plus size={13} className="mr-1" />
                      Add LLC
                    </FormButton>
                  </div>

                  {wizard.llcGroupings.length === 0 ? (
                    <p className="text-sm text-[var(--muted)] py-4 text-center border border-dashed border-[var(--border)]">
                      No LLC groups defined yet — invoices will be generated per property code.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {wizard.llcGroupings.map(group => (
                        <div key={group.llcName} className="border border-[var(--border)] bg-white">
                          <div
                            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-section)] border-b border-[var(--divider)] cursor-pointer"
                            onClick={() => setEditingLLC(editingLLC === group.llcName ? '' : group.llcName)}
                          >
                            <Building2 size={13} className="text-[var(--muted)]" />
                            <span className="font-medium text-sm">{group.llcName}</span>
                            <span className="text-xs text-[var(--muted)] ml-auto">{group.propertyIds.length} properties</span>
                            {editingLLC === group.llcName ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </div>
                          {editingLLC === group.llcName && (
                            <div className="p-3 grid grid-cols-2 gap-1">
                              {selectedProperties.map(prop => (
                                <label key={prop.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={group.propertyIds.includes(prop.id)}
                                    onChange={() => togglePropertyInLLC(group.llcName, prop.id)}
                                    className="w-3 h-3 rounded-none"
                                  />
                                  <span className="font-mono text-[var(--muted)]">{prop.code}</span> {prop.name}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Fee */}
              {wizardStep === 'fee' && (
                <div className="max-w-sm space-y-4">
                  <h3 className="font-serif text-base text-[var(--primary)]">Management Fee Rate</h3>
                  <InfoBlock variant="default">
                    The global rate is currently 10%. Set a portfolio-specific rate here if this portfolio has a different contract.
                  </InfoBlock>
                  <FormField label="Management Fee Rate (%)" required>
                    <FormInput
                      type="number" step="0.1" min="0" max="100"
                      value={wizard.feeRate}
                      onChange={e => setWizard(p => ({ ...p, feeRate: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Effective Date" required>
                    <FormInput
                      type="date"
                      value={wizard.feeEffectiveDate}
                      onChange={e => setWizard(p => ({ ...p, feeEffectiveDate: e.target.value }))}
                    />
                  </FormField>
                </div>
              )}

              {/* Step 5: Confirm */}
              {wizardStep === 'confirm' && (
                <div className="max-w-lg">
                  <h3 className="font-serif text-base text-[var(--primary)] mb-4">Confirm New Portfolio</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex gap-3 py-2 border-b border-[var(--divider)]">
                      <span className="text-[var(--muted)] w-36 shrink-0">Portfolio Name</span>
                      <span className="font-medium">{wizard.name}</span>
                    </div>
                    {wizard.description && (
                      <div className="flex gap-3 py-2 border-b border-[var(--divider)]">
                        <span className="text-[var(--muted)] w-36 shrink-0">Description</span>
                        <span>{wizard.description}</span>
                      </div>
                    )}
                    <div className="flex gap-3 py-2 border-b border-[var(--divider)]">
                      <span className="text-[var(--muted)] w-36 shrink-0">Properties</span>
                      <span>{wizard.selectedPropertyIds.length} properties ({selectedProperties.reduce((s, p) => s + (p.total_units ?? 0), 0)} units)</span>
                    </div>
                    <div className="flex gap-3 py-2 border-b border-[var(--divider)]">
                      <span className="text-[var(--muted)] w-36 shrink-0">LLC Groups</span>
                      <span>{wizard.llcGroupings.length > 0 ? wizard.llcGroupings.map(g => g.llcName).join(', ') : 'None defined'}</span>
                    </div>
                    <div className="flex gap-3 py-2 border-b border-[var(--divider)]">
                      <span className="text-[var(--muted)] w-36 shrink-0">Mgmt Fee Rate</span>
                      <span>{wizard.feeRate}% effective {wizard.feeEffectiveDate}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-2 mt-6 pt-4 border-t border-[var(--divider)]">
                {wizardStep !== 'details' && (
                  <FormButton variant="secondary" onClick={back}>← Back</FormButton>
                )}
                {wizardStep !== 'confirm' ? (
                  <FormButton onClick={advance} disabled={!canAdvance()}>
                    Next: {STEPS[stepIndex + 1]?.label} →
                  </FormButton>
                ) : (
                  <FormButton onClick={handleCreate} loading={saving}>
                    <Check size={14} className="mr-1" />
                    Create Portfolio
                  </FormButton>
                )}
                <FormButton variant="ghost" onClick={() => setShowWizard(false)}>Cancel</FormButton>
              </div>
            </div>
          </div>
        )}

        {/* Existing portfolios */}
        <SectionDivider label="Existing Portfolios" />

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : portfolios.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm">No portfolios found.</div>
        ) : (
          <div className="space-y-2 mt-4">
            {portfolios.map(p => {
              const props = allProperties.filter(prop => prop.portfolio_id === p.id)
              const isOpen = expanded === p.id
              return (
                <div key={p.id} className="border border-[var(--border)] bg-white">
                  <div
                    className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[var(--bg-section)] transition-colors"
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                  >
                    <div className="shrink-0 text-[var(--muted)]">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-[var(--ink)] text-sm">{p.name}</p>
                      {p.description && <p className="text-xs text-[var(--muted)] mt-0.5">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
                      <span>{p.property_count} properties</span>
                      <span>{p.total_units} units</span>
                      {p.created_at && <span>Created {format(new Date(p.created_at), 'MMM yyyy')}</span>}
                      {isAdmin && (
                        <button
                          onClick={e => { e.stopPropagation(); openEdit(p) }}
                          title="Edit portfolio"
                          className="text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && props.length > 0 && (
                    <div className="border-t border-[var(--divider)] px-5 py-3">
                      <div className="grid grid-cols-3 gap-2">
                        {props.map(prop => (
                          <div key={prop.id} className="text-xs py-1">
                            <span className="font-mono text-[var(--muted)] mr-1">{prop.code}</span>
                            <span className="text-[var(--ink)]">{prop.name}</span>
                            {prop.total_units && <span className="text-[var(--muted)] ml-1">({prop.total_units}u)</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {isOpen && props.length === 0 && (
                    <div className="border-t border-[var(--divider)] px-5 py-3 text-xs text-[var(--muted)]">
                      No properties assigned to this portfolio.
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Drawer open={propertyDrawerOpen} onClose={() => setPropertyDrawerOpen(false)} title="Add Property">
        {propertyError && <InfoBlock variant="error">{propertyError}</InfoBlock>}

        <FormField label="AppFolio Property ID" required helperText="Canonical dedup ID from AppFolio (required and unique).">
          <FormInput
            value={propertyForm.appfolio_property_id}
            onChange={e => setPropertyForm(f => ({ ...f, appfolio_property_id: e.target.value }))}
            placeholder="e.g., B-1034"
          />
        </FormField>

        <FormField label="Property Code" required>
          <FormInput
            value={propertyForm.code}
            onChange={e => setPropertyForm(f => ({ ...f, code: e.target.value }))}
            placeholder="e.g., PINE-01"
          />
        </FormField>

        <FormField label="Property Name" required>
          <FormInput
            value={propertyForm.name}
            onChange={e => setPropertyForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g., Pine Street Apartments"
          />
        </FormField>

        <FormField label="Address">
          <FormTextarea
            value={propertyForm.address ?? ''}
            onChange={e => setPropertyForm(f => ({ ...f, address: e.target.value }))}
            rows={2}
          />
        </FormField>

        <FormField label="Unit Count" helperText="Whole number (0 or greater)">
          <FormInput
            type="number"
            min="0"
            step="1"
            value={propertyForm.total_units ?? ''}
            onChange={e => setPropertyForm(f => ({
              ...f,
              total_units: e.target.value === '' ? null : Number(e.target.value),
            }))}
          />
        </FormField>

        <FormField label="Owner LLC (Billing Entity)" helperText="Overrides portfolio owner for invoice grouping when provided.">
          <FormInput
            value={propertyForm.billing_llc ?? ''}
            onChange={e => setPropertyForm(f => ({ ...f, billing_llc: e.target.value }))}
            placeholder="e.g., SREP Park 1 LLC"
          />
        </FormField>

        <FormField label="Portfolio">
          <FormSelect
            value={propertyForm.portfolio_id ?? ''}
            onChange={e => setPropertyForm(f => ({ ...f, portfolio_id: e.target.value || null }))}
          >
            <option value="">— Unassigned —</option>
            {portfolios.map(port => (
              <option key={port.id} value={port.id}>{port.name}</option>
            ))}
          </FormSelect>
        </FormField>

        {!propertyForm.billing_llc?.trim() && fallbackOwnerLLC && (
          <InfoBlock variant="default">
            Billing fallback: this property will use portfolio owner LLC &ldquo;{fallbackOwnerLLC}&rdquo; when invoices are generated.
          </InfoBlock>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={propertyForm.is_active}
            onChange={e => setPropertyForm(f => ({ ...f, is_active: e.target.checked }))}
            className="w-4 h-4 rounded-none"
          />
          Active
        </label>

        <div className="flex gap-2 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleCreateProperty} loading={propertySaving} fullWidth>
            Add Property
          </FormButton>
          <FormButton variant="ghost" onClick={() => setPropertyDrawerOpen(false)}>Cancel</FormButton>
        </div>
      </Drawer>

      <Drawer open={editDrawerOpen} onClose={() => setEditDrawerOpen(false)} title="Edit Portfolio">
        {editError && <InfoBlock variant="error">{editError}</InfoBlock>}

        {editForm && (
          <>
            <FormField label="Portfolio Name" required>
              <FormInput
                value={editForm.name}
                onChange={e => setEditForm(f => f && ({ ...f, name: e.target.value }))}
                placeholder="e.g., SREP Southend LLC"
              />
            </FormField>

            <FormField label="Description">
              <FormTextarea
                value={editForm.description}
                onChange={e => setEditForm(f => f && ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Optional notes about this portfolio"
              />
            </FormField>

            <FormField label="Owner LLC (Billing Entity)" helperText="Default billing entity for properties in this portfolio that don't set their own.">
              <FormInput
                value={editForm.owner_llc}
                onChange={e => setEditForm(f => f && ({ ...f, owner_llc: e.target.value }))}
                placeholder="e.g., SREP Westend LLC"
              />
            </FormField>

            <label className="flex items-center gap-2 text-sm cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={e => setEditForm(f => f && ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded-none"
              />
              Active
            </label>
            {!editForm.is_active && (
              <InfoBlock variant="warning">
                Deactivating hides this portfolio from the list. Its properties keep their assignment but won&rsquo;t show here until it&rsquo;s reactivated.
              </InfoBlock>
            )}

            <div className="flex gap-2 pt-4 border-t border-[var(--divider)]">
              <FormButton onClick={handleUpdatePortfolio} loading={editSaving} fullWidth>
                Save Changes
              </FormButton>
              <FormButton variant="ghost" onClick={() => setEditDrawerOpen(false)}>Cancel</FormButton>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
