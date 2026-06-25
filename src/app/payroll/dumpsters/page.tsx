'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trash2, AlertTriangle, Save, RefreshCw, Search } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/payroll/useAuth'
import {
  PageHeader, FormButton, FormField, FormInput, InfoBlock, SectionDivider,
} from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'

const WEEKS_PER_YEAR = 52

interface PropertyRow {
  id: string
  code: string
  name: string
  total_units: number | null
  workyard_project_id: number | null
  portfolio_id: string | null
  portfolio_name: string | null
}

interface DumpsterCfg {
  property_id: string
  has_dumpster: boolean
  size_label: string | null
  monthly_cost: number
}

interface OverflowApiRow {
  projectId: number | null
  sCode: string
  customerName: string
  hours: number
}

interface OverflowResult {
  byProperty: OverflowApiRow[]
  noProjectHours: number
  totalHours: number
  weeks: number
  cardsScanned: number
  start: string
  end: string
}

interface Edit {
  has_dumpster?: boolean
  size_label?: string
  monthly_cost?: string
}

export default function DumpstersPage() {
  const { isManager } = useAuth()

  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [configs, setConfigs] = useState<Record<string, DumpsterCfg>>({})
  const [loadedRate, setLoadedRate] = useState<number>(45)
  const [rateInput, setRateInput] = useState<string>('45')
  const [loading, setLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  // Date range — default last 8 weeks through today.
  const [start, setStart] = useState(format(subDays(new Date(), 56), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))

  const [overflow, setOverflow] = useState<OverflowResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savingRate, setSavingRate] = useState(false)

  const [showAll, setShowAll] = useState(false)

  // ---- load properties + saved config ----------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [propRes, portRes, hiddenRes] = await Promise.all([
      supabase.from('properties')
        .select('id, code, name, total_units, workyard_project_id, portfolio_id')
        .eq('is_active', true).order('code'),
      supabase.from('portfolios').select('id, name'),
      // Operator-hidden properties (Admin → Hidden Items) — dropped from the report below.
      supabase.from('payroll_property').select('property_id').eq('is_suppressed', true),
    ])

    const portMap: Record<string, string> = {}
    for (const p of (portRes.data ?? [])) portMap[p.id] = p.name
    const hidden = new Set((hiddenRes.data ?? []).map(r => r.property_id))

    setProperties((propRes.data ?? []).filter(p => !hidden.has(p.id)).map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      total_units: p.total_units,
      workyard_project_id: p.workyard_project_id,
      portfolio_id: p.portfolio_id,
      portfolio_name: p.portfolio_id ? (portMap[p.portfolio_id] ?? null) : null,
    })))

    // Config tables may not exist yet (migration pending) — degrade gracefully.
    const [cfgRes, rateRes] = await Promise.all([
      supabase.from('payroll_property_dumpsters').select('property_id, has_dumpster, size_label, monthly_cost'),
      supabase.from('payroll_dumpster_config').select('loaded_labor_rate').limit(1).maybeSingle(),
    ])

    if (cfgRes.error || rateRes.error) {
      setConfigError(cfgRes.error?.message ?? rateRes.error?.message ?? 'Dumpster config unavailable')
    } else {
      setConfigError(null)
      const map: Record<string, DumpsterCfg> = {}
      for (const c of (cfgRes.data ?? [])) {
        map[c.property_id] = {
          property_id: c.property_id,
          has_dumpster: c.has_dumpster,
          size_label: c.size_label,
          monthly_cost: Number(c.monthly_cost ?? 0),
        }
      }
      setConfigs(map)
      if (rateRes.data?.loaded_labor_rate != null) {
        setLoadedRate(Number(rateRes.data.loaded_labor_rate))
        setRateInput(String(Number(rateRes.data.loaded_labor_rate)))
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ---- run the overflow report (live Workyard pull) --------------------------------------
  const runReport = useCallback(async () => {
    setRunning(true)
    setRunError(null)
    try {
      const res = await fetch(`/api/workyard/dumpster-overflow?start=${start}&end=${end}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
      setOverflow(json as OverflowResult)
    } catch (e: unknown) {
      setOverflow(null)
      setRunError(e instanceof Error ? e.message : 'Failed to load overflow data')
    } finally {
      setRunning(false)
    }
  }, [start, end])

  // Auto-run once on first load.
  useEffect(() => { runReport() }, [runReport])

  // overflow hours by property code / project id
  const overflowByCode = useMemo(() => {
    const byCode = new Map<string, number>()
    const byProject = new Map<number, number>()
    for (const o of overflow?.byProperty ?? []) {
      byCode.set(o.sCode, o.hours)
      if (o.projectId != null) byProject.set(o.projectId, o.hours)
    }
    return { byCode, byProject }
  }, [overflow])

  const weeks = overflow?.weeks ?? 1

  const rows = useMemo(() => {
    const built = properties.map(p => {
      const cfg = configs[p.id]
      const hours =
        overflowByCode.byCode.get(p.code) ??
        (p.workyard_project_id != null ? overflowByCode.byProject.get(p.workyard_project_id) : undefined) ??
        0
      const hoursPerWeek = weeks > 0 ? hours / weeks : 0
      const annualOverflowLabor = hoursPerWeek * WEEKS_PER_YEAR * loadedRate
      const monthlyCost = cfg?.monthly_cost ?? 0
      const annualContractorCost = monthlyCost * 12
      return {
        property_id: p.id,
        code: p.code,
        name: p.name,
        total_units: p.total_units,
        portfolio_name: p.portfolio_name,
        hasDumpster: cfg?.has_dumpster ?? false,
        sizeLabel: cfg?.size_label ?? '',
        monthlyCost,
        hasConfig: !!cfg,
        overflowHours: hours,
        overflowHoursPerWeek: hoursPerWeek,
        annualOverflowLabor,
        annualContractorCost,
        // overflow labor as a multiple of what's spent on the dumpster — the upsize signal
        ratio: annualContractorCost > 0 ? annualOverflowLabor / annualContractorCost : null,
      }
    })
    const visible = showAll
      ? built
      : built.filter(r => r.overflowHours > 0 || r.hasConfig)
    return visible.sort((a, b) => b.annualOverflowLabor - a.annualOverflowLabor || b.overflowHours - a.overflowHours)
  }, [properties, configs, overflowByCode, weeks, loadedRate, showAll])

  // ---- summary ---------------------------------------------------------------------------
  const summary = useMemo(() => {
    const annualOverflowTotal = rows.reduce((s, r) => s + r.annualOverflowLabor, 0)
    const withDumpster = rows.filter(r => r.hasDumpster).length
    const annualLeakage = overflow
      ? (overflow.noProjectHours / weeks) * WEEKS_PER_YEAR * loadedRate
      : 0
    return { annualOverflowTotal, withDumpster, annualLeakage }
  }, [rows, overflow, weeks, loadedRate])

  // ---- edit + save -----------------------------------------------------------------------
  const setEdit = (id: string, patch: Edit) =>
    setEdits(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  const isDirty = (id: string) => {
    const e = edits[id]
    if (!e) return false
    return e.has_dumpster !== undefined || e.size_label !== undefined || e.monthly_cost !== undefined
  }

  const saveRow = async (id: string) => {
    const e = edits[id] ?? {}
    const cfg = configs[id]
    const monthly = e.monthly_cost !== undefined ? parseFloat(e.monthly_cost) : (cfg?.monthly_cost ?? 0)
    if (e.monthly_cost !== undefined && (isNaN(monthly) || monthly < 0)) return

    const payload = {
      property_id: id,
      has_dumpster: e.has_dumpster ?? cfg?.has_dumpster ?? true,
      size_label: (e.size_label ?? cfg?.size_label ?? '') || null,
      monthly_cost: isNaN(monthly) ? 0 : monthly,
      updated_at: new Date().toISOString(),
    }

    setSavingId(id)
    const supabase = createClient()
    const { error } = await supabase
      .from('payroll_property_dumpsters')
      .upsert(payload, { onConflict: 'property_id' })
    setSavingId(null)

    if (error) { setConfigError(error.message); return }

    setConfigs(p => ({
      ...p,
      [id]: {
        property_id: id,
        has_dumpster: payload.has_dumpster,
        size_label: payload.size_label,
        monthly_cost: payload.monthly_cost,
      },
    }))
    setEdits(p => { const n = { ...p }; delete n[id]; return n })
    setSavedId(id)
    setTimeout(() => setSavedId(s => (s === id ? null : s)), 2000)
  }

  const saveRate = async () => {
    const rate = parseFloat(rateInput)
    if (isNaN(rate) || rate < 0) return
    setSavingRate(true)
    const supabase = createClient()
    // single-row config: update the existing row (seeded by the migration)
    const { data: existing } = await supabase.from('payroll_dumpster_config').select('id').limit(1).maybeSingle()
    let error
    if (existing?.id) {
      ;({ error } = await supabase.from('payroll_dumpster_config')
        .update({ loaded_labor_rate: rate, updated_at: new Date().toISOString() }).eq('id', existing.id))
    } else {
      ;({ error } = await supabase.from('payroll_dumpster_config').insert({ loaded_labor_rate: rate }))
    }
    setSavingRate(false)
    if (error) { setConfigError(error.message); return }
    setLoadedRate(rate)
  }

  const rateDirty = parseFloat(rateInput) !== loadedRate && rateInput.trim() !== ''

  return (
    <div>
      <PageHeader
        title="Dumpster Sizing"
        subtitle="Overflow-hauling labor by property vs. what the dumpster costs — find buildings to upsize"
        actions={
          <FormButton size="sm" onClick={runReport} loading={running}>
            <RefreshCw size={13} className="mr-1" />
            Refresh
          </FormButton>
        }
      />

      <div className="p-6">
        <InfoBlock variant="default" title="How this report works">
          Overflow hours are pulled live from Workyard for the date range below — every time card
          tagged <strong>Dumpster Overflow</strong>, summed by property. Hours are valued at the loaded
          labor rate, projected to a full year, and shown next to the monthly dumpster-contractor cost
          you enter per property. Where a building&apos;s annual overflow-hauling labor dwarfs its
          dumpster cost, it&apos;s a candidate to upsize. Reads Workyard only — payroll and invoicing
          are untouched.
        </InfoBlock>

        {configError && (
          <InfoBlock variant="warning" title="Dumpster config not available">
            {configError}. The report still runs, but saving inputs needs the
            <code className="mx-1">20260618_01_dumpster_report</code> migration applied.
          </InfoBlock>
        )}
        {!isManager && (
          <InfoBlock variant="warning" title="Read-only">
            Manager or admin access is required to edit dumpster inputs.
          </InfoBlock>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-4 mt-5 mb-5">
          <div className="w-40">
            <FormField label="From">
              <FormInput type="date" value={start} max={end} onChange={e => setStart(e.target.value)} />
            </FormField>
          </div>
          <div className="w-40">
            <FormField label="To">
              <FormInput type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} />
            </FormField>
          </div>
          <FormButton size="sm" variant="secondary" onClick={runReport} loading={running}>
            <Search size={13} className="mr-1" />
            Run
          </FormButton>

          <div className="flex items-end gap-2 ml-auto">
            <div className="w-40">
              <FormField label="Loaded labor rate ($/hr)" helperText="Burden included">
                <FormInput
                  type="number" step="0.01" min="0"
                  value={rateInput}
                  disabled={!isManager}
                  onChange={e => setRateInput(e.target.value)}
                />
              </FormField>
            </div>
            {isManager && rateDirty && (
              <FormButton size="sm" onClick={saveRate} loading={savingRate}>Save rate</FormButton>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="border border-[var(--border)] bg-white p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Annualized Overflow Labor</p>
            <p className="font-serif text-2xl text-[var(--primary)]">{formatCurrency(summary.annualOverflowTotal)}</p>
            <p className="text-xs text-[var(--muted)] mt-1">across shown properties</p>
          </div>
          <div className="border border-[var(--border)] bg-white p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Properties with Dumpster</p>
            <p className="font-serif text-2xl text-[var(--primary)]">{summary.withDumpster}</p>
            <p className="text-xs text-[var(--muted)] mt-1">marked &amp; configured</p>
          </div>
          <div className="border border-[var(--border)] bg-white p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Annualized Billing Leakage</p>
            <p className={`font-serif text-2xl ${summary.annualLeakage > 0 ? 'text-[var(--warning)]' : 'text-[var(--muted)]'}`}>
              {formatCurrency(summary.annualLeakage)}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">overflow tagged to no property</p>
          </div>
        </div>

        {runError && <InfoBlock variant="error" title="Could not load overflow data">{runError}</InfoBlock>}

        {overflow && (
          <p className="text-xs text-[var(--muted)] mb-3">
            {overflow.start} → {overflow.end} · {overflow.weeks.toFixed(1)} weeks ·
            {' '}{overflow.cardsScanned.toLocaleString()} time cards scanned ·
            {' '}{overflow.totalHours.toFixed(1)} h overflow total
          </p>
        )}

        <div className="flex items-center justify-between mb-2">
          <SectionDivider label={`${rows.length} ${rows.length === 1 ? 'property' : 'properties'}`} />
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] whitespace-nowrap ml-4 -mt-2">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Show all properties
          </label>
        </div>

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 text-[var(--muted)] text-sm border border-[var(--border)]">
            <Trash2 size={32} className="mx-auto mb-2 opacity-30" />
            No overflow hours in range and no dumpsters configured yet.
            <br />Tick <strong>Show all properties</strong> to add a dumpster to a building.
          </div>
        ) : (
          <div className="border border-[var(--border)] overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--primary)] text-white text-xs">
                  <th className="px-3 py-2.5 text-left font-medium">Property</th>
                  <th className="px-3 py-2.5 text-center font-medium">Has Dumpster</th>
                  <th className="px-3 py-2.5 text-left font-medium">Size</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Contractor $/mo</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Contractor $/yr</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Overflow h (range)</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">h / wk</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Overflow $/yr</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Labor ÷ Cost</th>
                  <th className="px-3 py-2.5 w-20" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const e = edits[row.property_id]
                  const hasDumpster = e?.has_dumpster ?? row.hasDumpster
                  const sizeVal = e?.size_label ?? row.sizeLabel
                  const monthlyVal = e?.monthly_cost ?? (row.monthlyCost ? String(row.monthlyCost) : '')
                  const dirty = isDirty(row.property_id)
                  // upsize signal: meaningful labor and labor far exceeds dumpster cost
                  const upsizeFlag = row.annualOverflowLabor > 500 &&
                    (row.ratio === null || row.ratio >= 1)
                  return (
                    <tr
                      key={row.property_id}
                      className={`border-b border-[var(--divider)] ${
                        upsizeFlag ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {upsizeFlag && <AlertTriangle size={11} className="text-[var(--warning)] shrink-0" />}
                          <span className="font-mono text-xs text-[var(--muted)]">{row.code}</span>
                          <span className="text-[var(--ink)] truncate max-w-44">{row.name}</span>
                        </div>
                        {row.portfolio_name && (
                          <span className="text-xs text-[var(--muted)] ml-9">{row.portfolio_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={hasDumpster}
                          disabled={!isManager}
                          onChange={ev => setEdit(row.property_id, { has_dumpster: ev.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={sizeVal}
                          disabled={!isManager}
                          placeholder="e.g. 6 yd"
                          onChange={ev => setEdit(row.property_id, { size_label: ev.target.value })}
                          className="w-20 px-2 py-1 border border-[var(--border)] rounded-none bg-white text-sm focus:outline-none focus:border-[var(--primary)] disabled:bg-[var(--bg-section)]"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" step="0.01" min="0"
                          value={monthlyVal}
                          disabled={!isManager}
                          placeholder="0.00"
                          onChange={ev => setEdit(row.property_id, { monthly_cost: ev.target.value })}
                          className="w-24 px-2 py-1 border border-[var(--border)] rounded-none bg-white text-sm text-right focus:outline-none focus:border-[var(--primary)] disabled:bg-[var(--bg-section)]"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--muted)]">
                        {row.annualContractorCost > 0 ? formatCurrency(row.annualContractorCost) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{row.overflowHours > 0 ? row.overflowHours.toFixed(1) : '—'}</td>
                      <td className="px-3 py-2 text-right text-[var(--muted)]">
                        {row.overflowHoursPerWeek > 0 ? row.overflowHoursPerWeek.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-[var(--primary)]">
                        {row.annualOverflowLabor > 0 ? formatCurrency(row.annualOverflowLabor) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.ratio !== null ? (
                          <span className={`text-xs font-medium ${row.ratio >= 1 ? 'text-[var(--warning)]' : 'text-[var(--muted)]'}`}>
                            {row.ratio.toFixed(1)}×
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isManager && dirty && (
                          <FormButton size="sm" loading={savingId === row.property_id} onClick={() => saveRow(row.property_id)}>
                            Save
                          </FormButton>
                        )}
                        {savedId === row.property_id && !dirty && (
                          <span className="text-xs text-[var(--success)] flex items-center gap-1 justify-end">
                            <Save size={11} /> Saved
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

        <p className="text-xs text-[var(--muted)] mt-3">
          <strong>Labor ÷ Cost</strong> is annual overflow-hauling labor divided by the annual
          dumpster-contractor cost. A high multiple (≥ 1×, highlighted) means you may be paying more
          in labor to haul overflow than a bigger dumpster would cost. The DUMP signal is only as
          deep as the cost code&apos;s adoption — heavier from 2026 on.
        </p>
      </div>
    </div>
  )
}
