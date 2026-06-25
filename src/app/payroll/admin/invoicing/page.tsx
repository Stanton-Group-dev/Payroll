'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown, Briefcase, Building2, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/payroll/useAuth'
import { isHiddenProperty } from '@/lib/payroll/properties'
import { PageHeader, InfoBlock, SectionDivider, Toggle } from '@/components/form'

interface Portfolio {
  id: string
  name: string
  include_in_invoicing: boolean
}

interface Property {
  id: string
  code: string
  name: string
  total_units: number | null
  portfolio_id: string | null
  billing_llc: string | null
  include_in_invoicing: boolean
}

const UNASSIGNED = '__unassigned__'

export default function InvoicingSettingsPage() {
  const { isAdmin } = useAuth()
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [portRes, propRes] = await Promise.all([
      supabase.from('portfolios').select('id, name, include_in_invoicing').eq('is_active', true).order('name'),
      supabase.from('payroll_property')
        .select('id:property_id, code, name, total_units, portfolio_id, billing_llc:owner_llc, include_in_invoicing, is_suppressed')
        .eq('is_active', true).order('code'),
    ])
    if (portRes.error || propRes.error) {
      setError(portRes.error?.message ?? propRes.error?.message ?? 'Failed to load.')
      setLoading(false)
      return
    }
    setPortfolios((portRes.data ?? []).map(p => ({ ...p, include_in_invoicing: p.include_in_invoicing ?? true })))
    setProperties(
      (propRes.data ?? [])
        .filter(p => !isHiddenProperty(p))
        .map(p => ({ ...p, include_in_invoicing: p.include_in_invoicing ?? true })),
    )
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const portfolioMap = useMemo(() => new Map(portfolios.map(p => [p.id, p])), [portfolios])

  /** A property is billed only when its own flag AND its portfolio's flag are on. */
  const isEffectivelyBilled = useCallback((p: Property) => {
    if (!p.include_in_invoicing) return false
    if (p.portfolio_id) return portfolioMap.get(p.portfolio_id)?.include_in_invoicing ?? true
    return true
  }, [portfolioMap])

  const togglePortfolio = useCallback(async (id: string, next: boolean) => {
    setPortfolios(prev => prev.map(p => (p.id === id ? { ...p, include_in_invoicing: next } : p)))
    const supabase = createClient()
    const { error: err } = await supabase.from('portfolios').update({ include_in_invoicing: next }).eq('id', id)
    if (err) {
      setError(err.message)
      setPortfolios(prev => prev.map(p => (p.id === id ? { ...p, include_in_invoicing: !next } : p)))
    }
  }, [])

  const toggleProperty = useCallback(async (id: string, next: boolean) => {
    setProperties(prev => prev.map(p => (p.id === id ? { ...p, include_in_invoicing: next } : p)))
    const supabase = createClient()
    // Write the curated overlay (keyed by property_id) — AppFolio re-imports can't undo this.
    const { error: err } = await supabase.from('payroll_property').update({ include_in_invoicing: next }).eq('property_id', id)
    if (err) {
      setError(err.message)
      setProperties(prev => prev.map(p => (p.id === id ? { ...p, include_in_invoicing: !next } : p)))
    }
  }, [])

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Pull any AppFolio properties that don't have a curated row yet into payroll_property.
  // Insert-missing only — never overwrites existing curated corrections.
  const syncNewProperties = useCallback(async () => {
    setSyncing(true); setSyncMsg(null); setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase.rpc('payroll_property_reconcile')
    if (err) { setError(err.message) }
    else {
      const n = (data as number) ?? 0
      setSyncMsg(`Synced — ${n} new ${n === 1 ? 'property' : 'properties'} added.`)
      await load()
    }
    setSyncing(false)
  }, [load])

  const toggleExpand = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Group properties by portfolio (unassigned last).
  const groups = useMemo(() => {
    const byPortfolio = new Map<string, Property[]>()
    for (const p of properties) {
      const key = p.portfolio_id ?? UNASSIGNED
      if (!byPortfolio.has(key)) byPortfolio.set(key, [])
      byPortfolio.get(key)!.push(p)
    }
    const ordered: { key: string; name: string; portfolio: Portfolio | null; props: Property[] }[] = []
    for (const port of portfolios) {
      ordered.push({ key: port.id, name: port.name, portfolio: port, props: byPortfolio.get(port.id) ?? [] })
    }
    if (byPortfolio.has(UNASSIGNED)) {
      ordered.push({ key: UNASSIGNED, name: 'Unassigned (no portfolio)', portfolio: null, props: byPortfolio.get(UNASSIGNED)! })
    }
    return ordered
  }, [portfolios, properties])

  const billedCount = useMemo(() => properties.filter(isEffectivelyBilled).length, [properties, isEffectivelyBilled])
  const excludedCount = properties.length - billedCount
  const billedUnits = useMemo(
    () => properties.filter(isEffectivelyBilled).reduce((s, p) => s + (p.total_units ?? 0), 0),
    [properties, isEffectivelyBilled],
  )

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title="Invoicing — Included Properties"
        subtitle="Choose which portfolios and properties are billed when invoices are generated"
      />

      <div className="p-6 space-y-6">
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {!isAdmin && (
          <InfoBlock variant="warning" title="Admin access required">
            Only admins can change which properties are invoiced. The switches below are read-only for your role.
          </InfoBlock>
        )}

        <InfoBlock variant="default" title="How inclusion works">
          A property is invoiced only when <strong>both</strong> its own switch and its portfolio&apos;s switch are on.
          Properties with 0 or 1 units were turned off automatically (import artifacts / non-billable stubs) — flip
          any back on if they should be billed. Changes apply the next time invoices are generated for a week.
          These switches live in the payroll-owned <code>payroll_property</code> record, so they survive AppFolio re-imports.
        </InfoBlock>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={syncNewProperties}
              disabled={syncing}
              className="inline-flex items-center gap-2 border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--ink)] hover:bg-[var(--bg-section)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {syncing ? 'Syncing…' : 'Sync new properties'}
            </button>
            <span className="text-xs text-[var(--muted)]">
              Pulls any new AppFolio buildings into the curated list (never overwrites your corrections).
            </span>
            {syncMsg && <span className="text-xs text-[var(--success)]">{syncMsg}</span>}
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-3 border border-[var(--border)] divide-x divide-[var(--divider)] bg-white">
          {[
            { label: 'Billed properties', value: String(billedCount) },
            { label: 'Excluded', value: String(excludedCount) },
            { label: 'Billed units', value: String(billedUnits) },
          ].map(kpi => (
            <div key={kpi.label} className="px-5 py-4">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">{kpi.label}</p>
              <p className="font-serif text-2xl text-[var(--primary)]">{kpi.value}</p>
            </div>
          ))}
        </div>

        <SectionDivider label="Portfolios & Properties" />

        <div className="space-y-2">
          {groups.map(group => {
            const isOpen = expanded.has(group.key)
            const portfolioOn = group.portfolio ? group.portfolio.include_in_invoicing : true
            const billedInGroup = group.props.filter(isEffectivelyBilled).length
            return (
              <div key={group.key} className="border border-[var(--border)] bg-white">
                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleExpand(group.key)}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    <span className="text-[var(--muted)]">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <Briefcase size={14} className="text-[var(--accent)] shrink-0" />
                    <span className={`font-medium text-sm ${portfolioOn ? 'text-[var(--ink)]' : 'text-[var(--muted)] line-through'}`}>
                      {group.name}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {billedInGroup} of {group.props.length} billed
                    </span>
                    {!portfolioOn && (
                      <span className="text-xs text-[var(--error)] font-medium">Portfolio off</span>
                    )}
                  </button>
                  {group.portfolio && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-[var(--muted)]">{portfolioOn ? 'Included' : 'Excluded'}</span>
                      <Toggle
                        on={portfolioOn}
                        disabled={!isAdmin}
                        onChange={next => togglePortfolio(group.portfolio!.id, next)}
                        label={`Toggle portfolio ${group.name}`}
                      />
                    </div>
                  )}
                </div>

                {/* Properties */}
                {isOpen && (
                  group.props.length === 0 ? (
                    <div className="border-t border-[var(--divider)] px-5 py-3 text-xs text-[var(--muted)]">
                      No active properties in this portfolio.
                    </div>
                  ) : (
                    <table className="w-full text-sm border-t border-[var(--divider)]">
                      <tbody>
                        {group.props.map((p, i) => {
                          const billed = isEffectivelyBilled(p)
                          const lowUnits = (p.total_units ?? 0) <= 1
                          const blockedByPortfolio = p.include_in_invoicing && !portfolioOn
                          return (
                            <tr
                              key={p.id}
                              className={`border-b border-[var(--divider)] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}
                            >
                              <td className="pl-12 pr-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Building2 size={12} className="text-[var(--muted)] shrink-0" />
                                  <span className="font-mono text-xs text-[var(--muted)]">{p.code}</span>
                                  <span className={billed ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}>{p.name}</span>
                                  {lowUnits && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--warning)]">
                                      <AlertTriangle size={11} /> {p.total_units ?? 0} unit{(p.total_units ?? 0) === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right text-xs text-[var(--muted)] whitespace-nowrap">
                                {p.billing_llc ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                                {blockedByPortfolio ? (
                                  <span className="text-[var(--error)]">via portfolio</span>
                                ) : (
                                  <span className={billed ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>
                                    {billed ? 'Billed' : 'Excluded'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <Toggle
                                  on={p.include_in_invoicing}
                                  disabled={!isAdmin}
                                  onChange={next => toggleProperty(p.id, next)}
                                  label={`Toggle property ${p.code}`}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
