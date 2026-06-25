'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, StatusBadge } from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'
import { compareLlcOrder } from '@/lib/payroll/llcOrder'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts'
import { format } from 'date-fns'

interface PropertyRow {
  property_id: string
  property_code: string
  property_name: string
  portfolio_id: string | null
  portfolio_name: string | null
  billing_llc: string | null
  total_units: number
  weeks: { week_start: string; cost_per_unit: number; total_cost: number }[]
  current_cost_per_unit: number
  rolling_avg_cost_per_unit: number
  delta_pct: number | null
  current_total_cost: number
  threshold: number | null
  vs_threshold_pct: number | null
}

interface PortfolioRow {
  portfolio_id: string | null
  portfolio_name: string
  property_count: number
  total_units: number
  current_total_cost: number
  current_avg_cost_per_unit: number
  prior_avg_cost_per_unit: number | null
  delta_pct: number | null
}

type ViewMode = 'property' | 'portfolio'

const NAVY = '#1a2744'
const ACCENT = '#8b7355'
const SUCCESS = '#2d6a4f'
const WARNING = '#b45309'

export default function AnalyticsPage() {
  const [propertyRows, setPropertyRows] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('property')
  const [portfolioFilter, setPortfolioFilter] = useState<string>('all')
  const [portfolioNames, setPortfolioNames] = useState<{ id: string; name: string }[]>([])
  const [sortKey, setSortKey] = useState<'cost_per_unit' | 'total_cost' | 'delta' | 'property'>('cost_per_unit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const supabase = createClient()

      const [costsRes, propsRes, portsRes, weeksRes, threshRes] = await Promise.all([
        supabase
          .from('payroll_weekly_property_costs')
          .select('payroll_week_id, property_id, total_cost, cost_per_unit')
          .order('payroll_week_id', { ascending: false }),
        // Curated overlay (not raw `properties`) so operator-suppressed buildings are
        // dropped from analytics too. is_suppressed filtered out below.
        supabase
          .from('payroll_property')
          .select('id:property_id, code, name, total_units, portfolio_id, is_suppressed, billing_llc:owner_llc')
          .eq('is_active', true),
        supabase
          .from('portfolios')
          .select('id, name')
          .eq('is_active', true),
        supabase
          .from('payroll_weeks')
          .select('id, week_start')
          .order('week_start', { ascending: false }),
        supabase
          .from('payroll_property_thresholds')
          .select('property_id, threshold_per_unit, effective_date')
          .order('effective_date', { ascending: false }),
      ])

      const costs = costsRes.data ?? []
      const properties = (propsRes.data ?? []).filter(p => !p.is_suppressed)
      const portfolios = portsRes.data ?? []
      const weeks = weeksRes.data ?? []

      // Latest threshold per property
      const latestThreshold: Record<string, number> = {}
      for (const t of (threshRes.data ?? [])) {
        if (!(t.property_id in latestThreshold)) {
          latestThreshold[t.property_id] = Number(t.threshold_per_unit)
        }
      }

      setPortfolioNames(portfolios)

      const weekStartMap: Record<string, string> = {}
      for (const w of weeks) weekStartMap[w.id] = w.week_start

      const portNameMap: Record<string, string> = {}
      for (const p of portfolios) portNameMap[p.id] = p.name

      // Group costs by property
      const costsByProp: Record<string, { week_start: string; cost_per_unit: number; total_cost: number }[]> = {}
      for (const c of costs) {
        if (!costsByProp[c.property_id]) costsByProp[c.property_id] = []
        costsByProp[c.property_id].push({
          week_start: weekStartMap[c.payroll_week_id] ?? c.payroll_week_id,
          cost_per_unit: Number(c.cost_per_unit),
          total_cost: Number(c.total_cost),
        })
      }

      const rows: PropertyRow[] = []
      for (const prop of properties) {
        const propWeeks = (costsByProp[prop.id] ?? [])
          .sort((a, b) => b.week_start.localeCompare(a.week_start))
        if (propWeeks.length === 0) continue

        const current = propWeeks[0]
        const rolling_avg = propWeeks.reduce((s, w) => s + w.cost_per_unit, 0) / propWeeks.length
        const delta_pct = rolling_avg > 0
          ? ((current.cost_per_unit - rolling_avg) / rolling_avg) * 100
          : null
        const threshold = latestThreshold[prop.id] ?? null
        const vs_threshold_pct = threshold && threshold > 0
          ? ((current.cost_per_unit - threshold) / threshold) * 100
          : null

        rows.push({
          property_id: prop.id,
          property_code: prop.code,
          property_name: prop.name,
          portfolio_id: prop.portfolio_id,
          portfolio_name: prop.portfolio_id ? (portNameMap[prop.portfolio_id] ?? null) : null,
          billing_llc: prop.billing_llc ?? null,
          total_units: prop.total_units ?? 0,
          weeks: propWeeks.slice(0, 8).reverse(),
          current_cost_per_unit: current.cost_per_unit,
          rolling_avg_cost_per_unit: rolling_avg,
          delta_pct,
          current_total_cost: current.total_cost,
          threshold,
          vs_threshold_pct,
        })
      }

      setPropertyRows(rows)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    let rows = propertyRows
    if (portfolioFilter !== 'all') {
      rows = rows.filter(r => r.portfolio_id === portfolioFilter)
    }
    return [...rows].sort((a, b) => {
      let va = 0, vb = 0
      if (sortKey === 'cost_per_unit') { va = a.current_cost_per_unit; vb = b.current_cost_per_unit }
      else if (sortKey === 'total_cost') { va = a.current_total_cost; vb = b.current_total_cost }
      else if (sortKey === 'delta') { va = a.delta_pct ?? 0; vb = b.delta_pct ?? 0 }
      else if (sortKey === 'property') return sortDir === 'asc'
        ? a.property_code.localeCompare(b.property_code)
        : b.property_code.localeCompare(a.property_code)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [propertyRows, portfolioFilter, sortKey, sortDir])

  // Grouped by BILLING LLC (how Stanton invoices), not the AppFolio portfolio — so each SREP
  // Park N LLC is its own row and nothing rolls up under the "Stanton Management" catch-all.
  // (The PortfolioRow shape is reused; portfolio_id/portfolio_name carry the LLC key/name.)
  const portfolioRows = useMemo<PortfolioRow[]>(() => {
    const map: Record<string, PropertyRow[]> = {}
    for (const r of propertyRows) {
      const key = (r.billing_llc && r.billing_llc.trim()) || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    return Object.entries(map).map(([key, rows]) => {
      const totalUnits = rows.reduce((s, r) => s + r.total_units, 0)
      const totalCost = rows.reduce((s, r) => s + r.current_total_cost, 0)
      const avgCpu = totalUnits > 0 ? totalCost / totalUnits : 0
      const priorTotalCost = rows.reduce((s, r) => {
        const prior = r.weeks.length > 1 ? r.weeks[r.weeks.length - 2] : null
        return s + (prior ? prior.total_cost : 0)
      }, 0)
      const priorUnits = rows.reduce((s, r) => {
        if (r.weeks.length > 1) return s + r.total_units
        return s
      }, 0)
      const priorAvgCpu = priorUnits > 0 ? priorTotalCost / priorUnits : null
      const delta = priorAvgCpu && priorAvgCpu > 0
        ? ((avgCpu - priorAvgCpu) / priorAvgCpu) * 100
        : null

      return {
        portfolio_id: key === '__none__' ? null : key,
        portfolio_name: key === '__none__' ? 'Unassigned (no LLC)' : key,
        property_count: rows.length,
        total_units: totalUnits,
        current_total_cost: totalCost,
        current_avg_cost_per_unit: avgCpu,
        prior_avg_cost_per_unit: priorAvgCpu,
        delta_pct: delta,
      }
    }).sort((a, b) => compareLlcOrder(a.portfolio_name, b.portfolio_name))
  }, [propertyRows])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortIndicator = ({ k }: { k: typeof sortKey }) =>
    sortKey === k ? <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span> : null

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title="Cost-Per-Unit Analytics"
        subtitle="Property and portfolio cost intelligence — sourced from approved payroll weeks"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex border border-[var(--border)] overflow-hidden">
              <button
                onClick={() => setViewMode('property')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'property' ? 'bg-[var(--primary)] text-white' : 'bg-white text-[var(--muted)] hover:text-[var(--ink)]'}`}
              >
                Properties
              </button>
              <button
                onClick={() => setViewMode('portfolio')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-[var(--border)] ${viewMode === 'portfolio' ? 'bg-[var(--primary)] text-white' : 'bg-white text-[var(--muted)] hover:text-[var(--ink)]'}`}
              >
                By LLC
              </button>
            </div>
          </div>
        }
      />

      {propertyRows.length === 0 ? (
        <div className="p-8 text-center">
          <TrendingUp size={40} className="mx-auto text-[var(--muted)] mb-3 opacity-30" />
          <p className="text-[var(--muted)] text-sm font-medium">No cost data yet</p>
          <p className="text-[var(--muted)] text-xs mt-1">Run and approve at least one payroll week to populate this dashboard.</p>
        </div>
      ) : viewMode === 'property' ? (
        <PropertyView
          rows={filtered}
          portfolioFilter={portfolioFilter}
          portfolioNames={portfolioNames}
          onPortfolioFilter={setPortfolioFilter}
          toggleSort={toggleSort}
          SortIndicator={SortIndicator}
        />
      ) : (
        <PortfolioView rows={portfolioRows} />
      )}
    </div>
  )
}

function TrendSparkline({ weeks }: { weeks: { week_start: string; cost_per_unit: number }[] }) {
  if (weeks.length < 2) return <span className="text-xs text-[var(--muted)]">—</span>
  return (
    <ResponsiveContainer width={80} height={28}>
      <BarChart data={weeks} barSize={6} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Bar dataKey="cost_per_unit" radius={[1, 1, 0, 0]}>
          {weeks.map((_, i) => (
            <Cell key={i} fill={i === weeks.length - 1 ? NAVY : '#c8d0e0'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-[var(--muted)]">—</span>
  const abs = Math.abs(delta)
  const isHigh = delta > 10
  const isLow = delta < -5
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${isHigh ? 'text-[var(--warning)]' : isLow ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>
      {delta > 0.5 ? <TrendingUp size={11} /> : delta < -0.5 ? <TrendingDown size={11} /> : <Minus size={11} />}
      {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
      {isHigh && <AlertTriangle size={10} className="ml-0.5" />}
    </span>
  )
}

function PropertyView({
  rows,
  portfolioFilter,
  portfolioNames,
  onPortfolioFilter,
  toggleSort,
  SortIndicator,
}: {
  rows: PropertyRow[]
  portfolioFilter: string
  portfolioNames: { id: string; name: string }[]
  onPortfolioFilter: (v: string) => void
  toggleSort: (k: 'cost_per_unit' | 'total_cost' | 'delta' | 'property') => void
  SortIndicator: React.FC<{ k: 'cost_per_unit' | 'total_cost' | 'delta' | 'property' }>
}) {
  const flagCount = rows.filter(r => {
    if (r.threshold !== null) return r.vs_threshold_pct !== null && r.vs_threshold_pct > 0
    return r.delta_pct !== null && r.delta_pct > 10
  }).length

  return (
    <div className="p-6">
      {/* Filters + summary */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <select
            value={portfolioFilter}
            onChange={e => onPortfolioFilter(e.target.value)}
            className="text-xs border border-[var(--border)] px-2 py-1.5 bg-white rounded-none focus:outline-none focus:border-[var(--primary)]"
          >
            <option value="all">All Portfolios</option>
            {portfolioNames.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-xs text-[var(--muted)]">{rows.length} properties</span>
        </div>
        {flagCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--warning)] font-medium">
            <AlertTriangle size={13} />
            {flagCount} {flagCount === 1 ? 'property' : 'properties'} above threshold or rolling average
          </div>
        )}
      </div>

      <div className="border border-[var(--border)] overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--primary)] text-white text-xs">
              <th
                className="px-3 py-2.5 text-left font-medium cursor-pointer select-none hover:bg-white/10 whitespace-nowrap"
                onClick={() => toggleSort('property')}
              >
                Property <SortIndicator k="property" />
              </th>
              <th className="px-3 py-2.5 text-left font-medium">Portfolio</th>
              <th className="px-3 py-2.5 text-right font-medium">Units</th>
              <th
                className="px-3 py-2.5 text-right font-medium cursor-pointer select-none hover:bg-white/10 whitespace-nowrap"
                onClick={() => toggleSort('total_cost')}
              >
                Week Cost <SortIndicator k="total_cost" />
              </th>
              <th
                className="px-3 py-2.5 text-right font-medium cursor-pointer select-none hover:bg-white/10 whitespace-nowrap"
                onClick={() => toggleSort('cost_per_unit')}
              >
                $/Unit <SortIndicator k="cost_per_unit" />
              </th>
              <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Rolling Avg $/Unit</th>
              <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Threshold</th>
              <th
                className="px-3 py-2.5 text-right font-medium cursor-pointer select-none hover:bg-white/10"
                onClick={() => toggleSort('delta')}
              >
                vs Avg <SortIndicator k="delta" />
              </th>
              <th className="px-3 py-2.5 text-center font-medium">Trend</th>
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isAboveThreshold = row.threshold !== null
                ? (row.vs_threshold_pct !== null && row.vs_threshold_pct > 0)
                : (row.delta_pct !== null && row.delta_pct > 10)
              return (
                <tr
                  key={row.property_id}
                  className={`border-b border-[var(--divider)] ${
                    isAboveThreshold
                      ? 'bg-amber-50'
                      : i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'
                  } hover:bg-[var(--primary)]/5 transition-colors`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {isAboveThreshold && <AlertTriangle size={11} className="text-[var(--warning)] shrink-0" />}
                      <span className="font-mono text-xs text-[var(--muted)]">{row.property_code}</span>
                      <span className="text-[var(--ink)] truncate max-w-40">{row.property_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">
                    {row.portfolio_name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--muted)]">{row.total_units}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(row.current_total_cost)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[var(--primary)]">
                    {row.total_units > 0 ? formatCurrency(row.current_cost_per_unit) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--muted)]">
                    {row.total_units > 0 ? formatCurrency(row.rolling_avg_cost_per_unit) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.threshold !== null ? (
                      <span className="text-xs text-[var(--primary)] font-medium">{formatCurrency(row.threshold)}</span>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeltaBadge delta={row.total_units > 0 ? row.delta_pct : null} />
                  </td>
                  <td className="px-3 py-2">
                    <TrendSparkline weeks={row.weeks} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Link
                      href={`/payroll/analytics/${row.property_id}`}
                      className="text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                      title="View property detail"
                    >
                      →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PortfolioView({ rows }: { rows: PortfolioRow[] }) {
  const chartData = rows.map(r => ({
    name: r.portfolio_name.length > 18 ? r.portfolio_name.substring(0, 16) + '…' : r.portfolio_name,
    fullName: r.portfolio_name,
    cost_per_unit: Math.round(r.current_avg_cost_per_unit * 100) / 100,
    total_cost: r.current_total_cost,
  }))

  return (
    <div className="p-6 space-y-6">
      {/* Bar chart */}
      <div className="border border-[var(--border)] bg-white p-5">
        <h3 className="font-serif text-base text-[var(--primary)] mb-4">Average Cost Per Unit by Billing LLC (Current Week)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 48, left: 16 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              angle={-25}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={v => `$${v}`}
              width={48}
            />
            <Tooltip
              formatter={(value: unknown) => [formatCurrency(Number(value ?? 0)), '$/Unit']}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
              contentStyle={{ fontSize: 12, border: '1px solid #e2e2e2', borderRadius: 0 }}
            />
            <Bar dataKey="cost_per_unit" radius={[2, 2, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={i % 2 === 0 ? NAVY : ACCENT} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Portfolio table */}
      <div className="border border-[var(--border)] overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--primary)] text-white text-xs">
              <th className="px-4 py-2.5 text-left font-medium">Billing LLC</th>
              <th className="px-4 py-2.5 text-right font-medium">Properties</th>
              <th className="px-4 py-2.5 text-right font-medium">Units</th>
              <th className="px-4 py-2.5 text-right font-medium">Week Total Cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Avg $/Unit</th>
              <th className="px-4 py-2.5 text-right font-medium">vs Prior Week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.portfolio_id ?? 'none'} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <Building2 size={13} className="text-[var(--muted)]" />
                    {row.portfolio_name}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-[var(--muted)]">{row.property_count}</td>
                <td className="px-4 py-3 text-right text-[var(--muted)]">{row.total_units}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.current_total_cost)}</td>
                <td className="px-4 py-3 text-right font-semibold text-[var(--primary)]">
                  {row.total_units > 0 ? formatCurrency(row.current_avg_cost_per_unit) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <DeltaBadge delta={row.total_units > 0 ? row.delta_pct : null} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
              <td className="px-4 py-2.5">All LLCs</td>
              <td className="px-4 py-2.5 text-right">{rows.reduce((s, r) => s + r.property_count, 0)}</td>
              <td className="px-4 py-2.5 text-right">{rows.reduce((s, r) => s + r.total_units, 0)}</td>
              <td className="px-4 py-2.5 text-right">{formatCurrency(rows.reduce((s, r) => s + r.current_total_cost, 0))}</td>
              <td className="px-4 py-2.5 text-right" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
