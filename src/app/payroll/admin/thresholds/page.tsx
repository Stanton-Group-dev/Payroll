'use client'

import { useState, useEffect, useCallback } from 'react'
import { Target, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/payroll/useAuth'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect,
  InfoBlock, SectionDivider,
} from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'
import { format } from 'date-fns'

interface PropertyRow {
  id: string
  code: string
  name: string
  total_units: number | null
  portfolio_id: string | null
  portfolio_name: string | null
  current_threshold: number | null
  threshold_id: string | null
  threshold_effective: string | null
}

interface Portfolio {
  id: string
  name: string
}

export default function ThresholdsPage() {
  const { isAdmin, isManager } = useAuth()
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [loading, setLoading] = useState(true)
  const [filterPortfolio, setFilterPortfolio] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [bulkValue, setBulkValue] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [effectiveDate] = useState(new Date().toISOString().split('T')[0])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [propRes, portRes, threshRes] = await Promise.all([
      supabase.from('payroll_property').select('id:property_id, code, name, total_units, portfolio_id, is_suppressed').eq('is_active', true).order('code'),
      supabase.from('portfolios').select('id, name').eq('is_active', true).order('name'),
      supabase.from('payroll_property_thresholds').select('id, property_id, threshold_per_unit, effective_date').order('effective_date', { ascending: false }),
    ])

    const portMap: Record<string, string> = {}
    for (const p of (portRes.data ?? [])) portMap[p.id] = p.name
    setPortfolios(portRes.data ?? [])

    // Get the most recent threshold per property
    const latestThreshold: Record<string, { id: string; threshold_per_unit: number; effective_date: string }> = {}
    for (const t of (threshRes.data ?? [])) {
      if (!latestThreshold[t.property_id]) {
        latestThreshold[t.property_id] = { id: t.id, threshold_per_unit: t.threshold_per_unit, effective_date: t.effective_date }
      }
    }

    const rows: PropertyRow[] = (propRes.data ?? []).filter(p => !p.is_suppressed).map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      total_units: p.total_units,
      portfolio_id: p.portfolio_id,
      portfolio_name: p.portfolio_id ? (portMap[p.portfolio_id] ?? null) : null,
      current_threshold: latestThreshold[p.id]?.threshold_per_unit ?? null,
      threshold_id: latestThreshold[p.id]?.id ?? null,
      threshold_effective: latestThreshold[p.id]?.effective_date ?? null,
    }))

    setProperties(rows)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filteredProperties = filterPortfolio
    ? properties.filter(p => p.portfolio_id === filterPortfolio)
    : properties

  const handleSaveThreshold = async (propertyId: string) => {
    const val = edits[propertyId]
    if (val === undefined || val === '') return
    const threshold = parseFloat(val)
    if (isNaN(threshold) || threshold < 0) return

    setSaving(propertyId)
    const supabase = createClient()
    const { error: saveErr } = await supabase.from('payroll_property_thresholds').insert({
      property_id: propertyId,
      threshold_per_unit: threshold,
      effective_date: effectiveDate,
    })
    if (saveErr) { setSaving(null); throw saveErr }
    setSaved(p => ({ ...p, [propertyId]: true }))
    setTimeout(() => setSaved(p => ({ ...p, [propertyId]: false })), 2000)
    setSaving(null)
    setEdits(p => { const n = { ...p }; delete n[propertyId]; return n })
    await load()
  }

  const handleBulkSet = async () => {
    const threshold = parseFloat(bulkValue)
    if (isNaN(threshold) || threshold < 0) return
    setBulkSaving(true)
    const supabase = createClient()
    const rows = filteredProperties.map(p => ({
      property_id: p.id,
      threshold_per_unit: threshold,
      effective_date: effectiveDate,
    }))
    const { error: bulkErr } = await supabase.from('payroll_property_thresholds').insert(rows)
    if (bulkErr) { setBulkSaving(false); throw bulkErr }
    setBulkValue('')
    setBulkSaving(false)
    await load()
  }

  const setEdit = (propertyId: string, value: string) => {
    setEdits(p => ({ ...p, [propertyId]: value }))
  }

  const propertiesWithThreshold = properties.filter(p => p.current_threshold !== null).length
  const propertiesWithoutThreshold = properties.filter(p => p.current_threshold === null).length

  return (
    <div>
      <PageHeader
        title="Budget Thresholds"
        subtitle="Set per-property $/unit alert thresholds — analytics will flag properties exceeding these values"
      />

      <div className="p-6">
        {!isManager && (
          <InfoBlock variant="warning" title="Access restricted">
            Manager or admin access required.
          </InfoBlock>
        )}

        <InfoBlock variant="default" title="How thresholds work">
          When a property&apos;s weekly cost-per-unit exceeds its threshold, it&apos;s flagged in the analytics dashboard.
          If no threshold is set, the dashboard falls back to the portfolio average comparison (±10%).
          Thresholds are append-only — changes create a new entry with an effective date.
        </InfoBlock>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mt-5 mb-5">
          <div className="border border-[var(--border)] bg-white p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Properties with Threshold</p>
            <p className="font-serif text-2xl text-[var(--success)]">{propertiesWithThreshold}</p>
          </div>
          <div className="border border-[var(--border)] bg-white p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Properties without Threshold</p>
            <p className="font-serif text-2xl text-[var(--warning)]">{propertiesWithoutThreshold}</p>
          </div>
          <div className="border border-[var(--border)] bg-white p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Total Properties</p>
            <p className="font-serif text-2xl text-[var(--primary)]">{properties.length}</p>
          </div>
        </div>

        {/* Filters + bulk set */}
        <div className="flex items-end gap-4 mb-5">
          <div className="w-64">
            <FormField label="Filter by Portfolio">
              <FormSelect value={filterPortfolio} onChange={e => setFilterPortfolio(e.target.value)}>
                <option value="">All portfolios</option>
                {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </FormSelect>
            </FormField>
          </div>
          {isManager && (
            <div className="flex items-end gap-2">
              <div className="w-36">
                <FormField label="Bulk Set $/Unit" helperText={filterPortfolio ? 'For filtered portfolio' : 'For all properties'}>
                  <FormInput
                    type="number" step="0.01" min="0"
                    value={bulkValue}
                    onChange={e => setBulkValue(e.target.value)}
                    placeholder="e.g. 25.00"
                  />
                </FormField>
              </div>
              <FormButton
                size="sm"
                variant="secondary"
                loading={bulkSaving}
                disabled={!bulkValue}
                onClick={handleBulkSet}
              >
                Apply to {filterPortfolio ? 'Portfolio' : 'All'}
              </FormButton>
            </div>
          )}
        </div>

        <SectionDivider label={`${filteredProperties.length} properties`} />

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : (
          <div className="border border-[var(--border)] overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--primary)] text-white text-xs">
                  <th className="px-4 py-2.5 text-left font-medium">Property</th>
                  <th className="px-4 py-2.5 text-left font-medium">Portfolio</th>
                  <th className="px-4 py-2.5 text-right font-medium">Units</th>
                  <th className="px-4 py-2.5 text-right font-medium">Current Threshold</th>
                  <th className="px-4 py-2.5 text-left font-medium">Since</th>
                  <th className="px-4 py-2.5 text-right font-medium">New Threshold ($/unit)</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {filteredProperties.map((prop, i) => {
                  const editVal = edits[prop.id]
                  const isSaved = saved[prop.id]
                  return (
                    <tr key={prop.id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-[var(--muted)] mr-1">{prop.code}</span>
                        {prop.name}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted)]">{prop.portfolio_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">{prop.total_units ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {prop.current_threshold !== null ? (
                          <span className="text-[var(--primary)]">{formatCurrency(prop.current_threshold)}</span>
                        ) : (
                          <span className="text-[var(--muted)] text-xs">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                        {prop.threshold_effective ? format(new Date(prop.threshold_effective + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isManager && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editVal ?? ''}
                            onChange={e => setEdit(prop.id, e.target.value)}
                            placeholder={prop.current_threshold !== null ? prop.current_threshold.toFixed(2) : '0.00'}
                            className="w-24 px-2 py-1 border border-[var(--border)] rounded-none bg-white text-sm text-right focus:outline-none focus:border-[var(--primary)]"
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isManager && editVal !== undefined && editVal !== '' && (
                          <FormButton
                            size="sm"
                            loading={saving === prop.id}
                            onClick={() => handleSaveThreshold(prop.id)}
                          >
                            {isSaved ? <><Save size={11} className="mr-1" />Saved</> : 'Save'}
                          </FormButton>
                        )}
                        {isSaved && !editVal && (
                          <span className="text-xs text-[var(--success)] flex items-center gap-1 justify-end">
                            <Target size={11} /> Set
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
