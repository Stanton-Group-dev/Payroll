'use client'

import { useState, useEffect } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'

interface WeekPoint {
  week_start: string
  week_label: string
  labor_cost: number
  spread_cost: number
  mgmt_fee: number
  total_cost: number
  cost_per_unit: number
}

interface PropertyDetail {
  id: string
  code: string
  name: string
  total_units: number | null
  portfolio_id: string | null
  portfolio_name: string | null
  address: string | null
}

export default function PropertyDrilldownPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = use(params)
  const [property, setProperty] = useState<PropertyDetail | null>(null)
  const [weekPoints, setWeekPoints] = useState<WeekPoint[]>([])
  const [threshold, setThreshold] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const supabase = createClient()

      const [propRes, costsRes, threshRes] = await Promise.all([
        // Curated overlay so operator-suppressed buildings don't render even via deep link.
        supabase
          .from('payroll_property')
          .select('id:property_id, code, name, total_units, portfolio_id, address, is_suppressed')
          .eq('property_id', propertyId)
          .single(),
        supabase
          .from('payroll_weekly_property_costs')
          .select('payroll_week_id, labor_cost, spread_cost, total_cost, cost_per_unit, payroll_weeks(week_start)')
          .eq('property_id', propertyId)
          .order('payroll_week_id', { ascending: true }),
        supabase
          .from('payroll_property_thresholds')
          .select('threshold_per_unit')
          .eq('property_id', propertyId)
          .order('effective_date', { ascending: false })
          .limit(1),
      ])

      if (threshRes.data && threshRes.data.length > 0) {
        setThreshold(Number(threshRes.data[0].threshold_per_unit))
      }

      if (propRes.data && !propRes.data.is_suppressed) {
        const prop = propRes.data
        let portfolioName: string | null = null
        if (prop.portfolio_id) {
          const { data: port } = await supabase
            .from('portfolios')
            .select('name')
            .eq('id', prop.portfolio_id)
            .single()
          portfolioName = port?.name ?? null
        }
        setProperty({ ...prop, portfolio_name: portfolioName })
      }

      const points: WeekPoint[] = []
      for (const row of (costsRes.data ?? [])) {
        const weekData = (row.payroll_weeks as unknown as { week_start: string } | null)
        const weekStart = weekData?.week_start ?? ''
        const labor = Number(row.labor_cost ?? 0)
        const spread = Number(row.spread_cost ?? 0)
        const total = Number(row.total_cost ?? 0)
        const mgmt_fee = Math.max(0, total - labor - spread)
        points.push({
          week_start: weekStart,
          week_label: weekStart ? format(new Date(weekStart + 'T00:00:00'), 'MMM d') : '—',
          labor_cost: labor,
          spread_cost: spread,
          mgmt_fee,
          total_cost: total,
          cost_per_unit: Number(row.cost_per_unit ?? 0),
        })
      }
      setWeekPoints(points)
      setLoading(false)
    }
    load()
  }, [propertyId])

  const rollingAvg = weekPoints.length > 0
    ? weekPoints.reduce((s, w) => s + w.cost_per_unit, 0) / weekPoints.length
    : null

  const currentWeek = weekPoints[weekPoints.length - 1] ?? null

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>
  if (!property) return <div className="p-8 text-[var(--muted)]">Property not found.</div>

  return (
    <div>
      <PageHeader
        title={`${property.code} — ${property.name}`}
        subtitle={
          [property.portfolio_name, property.address].filter(Boolean).join(' · ') ||
          'Property cost trend'
        }
        actions={
          <Link
            href="/payroll/analytics"
            className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
          >
            <ArrowLeft size={12} />
            Back to Analytics
          </Link>
        }
      />

      {weekPoints.length === 0 ? (
        <div className="p-8 text-center text-[var(--muted)] text-sm">
          No cost data for this property yet.
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard label="Current Week Cost" value={currentWeek ? formatCurrency(currentWeek.total_cost) : '—'} />
            <KpiCard
              label="Current $/Unit"
              value={property.total_units && currentWeek ? formatCurrency(currentWeek.cost_per_unit) : '—'}
              highlight={threshold !== null && currentWeek ? currentWeek.cost_per_unit > threshold : false}
            />
            <KpiCard
              label="Rolling Avg $/Unit"
              value={rollingAvg && property.total_units ? formatCurrency(rollingAvg) : '—'}
              sub={`over ${weekPoints.length} week${weekPoints.length === 1 ? '' : 's'}`}
            />
            <KpiCard
              label="Budget Threshold"
              value={threshold !== null ? formatCurrency(threshold) : 'Not set'}
              sub={threshold !== null && currentWeek
                ? currentWeek.cost_per_unit > threshold
                  ? `⚠ ${((currentWeek.cost_per_unit - threshold) / threshold * 100).toFixed(1)}% over`
                  : `✓ ${((threshold - currentWeek.cost_per_unit) / threshold * 100).toFixed(1)}% under`
                : undefined}
            />
          </div>

          {/* Line chart */}
          <div className="border border-[var(--border)] bg-white p-5">
            <h3 className="font-serif text-base text-[var(--primary)] mb-4">Cost Per Unit — Weekly Trend</h3>
            {weekPoints.length < 2 ? (
              <p className="text-sm text-[var(--muted)]">Need at least 2 weeks of data to show trend.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={weekPoints} margin={{ top: 8, right: 24, bottom: 8, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="week_label"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={v => `$${v}`}
                    width={52}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [formatCurrency(Number(value ?? 0)), '$/Unit']}
                    contentStyle={{ fontSize: 12, border: '1px solid #e2e2e2', borderRadius: 0 }}
                  />
                  {rollingAvg && (
                    <ReferenceLine
                      y={rollingAvg}
                      stroke="#8b7355"
                      strokeDasharray="4 3"
                      label={{ value: 'Avg', position: 'insideTopRight', fontSize: 10, fill: '#8b7355' }}
                    />
                  )}
                  {threshold !== null && (
                    <ReferenceLine
                      y={threshold}
                      stroke="#b45309"
                      strokeDasharray="6 3"
                      label={{ value: 'Threshold', position: 'insideTopLeft', fontSize: 10, fill: '#b45309' }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="cost_per_unit"
                    stroke="#1a2744"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#1a2744' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Week-by-week table */}
          <div>
            <h3 className="font-serif text-base text-[var(--primary)] mb-3">Week-by-Week Breakdown</h3>
            <div className="border border-[var(--border)] overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--primary)] text-white text-xs">
                    <th className="px-4 py-2.5 text-left font-medium">Week</th>
                    <th className="px-4 py-2.5 text-right font-medium">Labor</th>
                    <th className="px-4 py-2.5 text-right font-medium">Spread</th>
                    <th className="px-4 py-2.5 text-right font-medium">Mgmt Fee</th>
                    <th className="px-4 py-2.5 text-right font-medium font-bold">Total Cost</th>
                    <th className="px-4 py-2.5 text-right font-medium">$/Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weekPoints].reverse().map((wp, i) => (
                    <tr key={wp.week_start} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                      <td className="px-4 py-2.5 font-medium">
                        {wp.week_start
                          ? format(new Date(wp.week_start + 'T00:00:00'), 'MMM d, yyyy')
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(wp.labor_cost)}</td>
                      <td className="px-4 py-2.5 text-right">{wp.spread_cost ? formatCurrency(wp.spread_cost) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--muted)]">{formatCurrency(wp.mgmt_fee)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(wp.total_cost)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-[var(--primary)]">
                        {property.total_units ? formatCurrency(wp.cost_per_unit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {weekPoints.length > 1 && (
                  <tfoot>
                    <tr className="bg-[var(--bg-section)] text-xs font-medium text-[var(--muted)] border-t-2 border-[var(--border)]">
                      <td className="px-4 py-2.5">Rolling Average</td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(weekPoints.reduce((s, w) => s + w.labor_cost, 0) / weekPoints.length)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(weekPoints.reduce((s, w) => s + w.spread_cost, 0) / weekPoints.length)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(weekPoints.reduce((s, w) => s + w.mgmt_fee, 0) / weekPoints.length)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(weekPoints.reduce((s, w) => s + w.total_cost, 0) / weekPoints.length)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {rollingAvg && property.total_units ? formatCurrency(rollingAvg) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`border p-4 ${highlight ? 'border-[var(--warning)] bg-amber-50' : 'border-[var(--border)] bg-white'}`}>
      <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-serif text-2xl ${highlight ? 'text-[var(--warning)]' : 'text-[var(--primary)]'}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${sub.startsWith('⚠') ? 'text-[var(--warning)]' : sub.startsWith('✓') ? 'text-[var(--success)]' : 'text-[var(--muted)]'}`}>{sub}</p>}
    </div>
  )
}
