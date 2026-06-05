'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Minus, GitCompareArrows } from 'lucide-react'
import { formatCurrency, type Delta, type ComparisonRow } from '@/lib/payroll/calculations'
import { usePayrollComparison } from '@/hooks/payroll/usePayrollComparison'
import { InfoBlock } from '@/components/form'

/** ↑ red = cost went up, ↓ green = cost went down. Hours pass money=false. */
function DeltaTag({ delta, pct, money = true }: { delta: number; pct: number | null; money?: boolean }) {
  const up = delta > 0
  const down = delta < 0
  const color = up ? 'text-[var(--error)]' : down ? 'text-[var(--success)]' : 'text-[var(--muted)]'
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus
  const mag = money ? formatCurrency(Math.abs(delta)) : Math.abs(delta).toLocaleString()
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${color}`}>
      <Icon size={11} />
      {mag}
      {pct !== null && <span className="text-[var(--muted)] ml-0.5">({pct > 0 ? '+' : ''}{pct}%)</span>}
    </span>
  )
}

function MetricCard({ label, metric, money = true }: { label: string; metric: Delta; money?: boolean }) {
  const fmt = (n: number) => (money ? formatCurrency(n) : n.toLocaleString())
  return (
    <div className="border border-[var(--border)] bg-white p-4">
      <div className="text-xs text-[var(--muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-serif text-[var(--primary)] mt-1">{fmt(metric.current)}</div>
      <div className="text-xs text-[var(--muted)] mt-1">
        was {fmt(metric.prior)} &nbsp;<DeltaTag delta={metric.delta} pct={metric.pct} money={money} />
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<ComparisonRow['status'], string> = {
  new: 'new',
  dropped: 'not paid',
  changed: '',
  same: '',
}

function CompareTable({ title, rows, money = true }: { title: string; rows: ComparisonRow[]; money?: boolean }) {
  const fmt = (n: number) => (money ? formatCurrency(n) : n.toLocaleString())
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className="font-serif text-sm text-[var(--primary)] mb-2">{title}</h4>
      <div className="border border-[var(--border)] overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--bg-section)] text-[var(--muted)] text-xs">
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Prior</th>
              <th className="px-3 py-2 text-right font-medium">Current</th>
              <th className="px-3 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={`border-t border-[var(--divider)] ${i % 2 ? 'bg-[var(--bg-section)]' : 'bg-white'}`}>
                <td className="px-3 py-2">
                  {r.label}
                  {STATUS_LABEL[r.status] && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--muted)] border border-[var(--divider)] px-1">
                      {STATUS_LABEL[r.status]}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-[var(--muted)]">{fmt(r.prior)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmt(r.current)}</td>
                <td className="px-3 py-2 text-right"><DeltaTag delta={r.delta} pct={r.pct} money={money} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * "Compare to prior week" — runs payroll for this week and the previous one and
 * shows the deltas. Lazy: fetches only when expanded. Same engine as the review
 * table, so the numbers reconcile.
 */
export function PayrollComparisonPanel({ weekId }: { weekId: string }) {
  const [open, setOpen] = useState(false)
  const { report, loading, error, load } = usePayrollComparison(weekId)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !report && !loading) load()
  }

  return (
    <div className="border border-[var(--border)]">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <GitCompareArrows size={15} className="text-[var(--primary)]" />
          <span className="font-serif text-base text-[var(--primary)]">Compare to Prior Week</span>
          <span className="text-xs text-[var(--muted)]">week-over-week payroll change</span>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </button>

      {open && (
        <div className="p-5 space-y-5">
          {loading && <p className="text-sm text-[var(--muted)]">Running payroll for both weeks…</p>}
          {error && <InfoBlock variant="error">{error}</InfoBlock>}

          {report && !loading && (
            <>
              <p className="text-xs text-[var(--muted)]">
                {report.currentLabel} vs {report.priorLabel}
              </p>

              {report.notable.length > 0 && (
                <InfoBlock variant="default">
                  <ul className="space-y-0.5">
                    {report.notable.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </InfoBlock>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Gross Pay" metric={report.totals.gross_pay} />
                <MetricCard label="Required Pre-Fund" metric={report.totals.required_prefund} />
                <MetricCard label="Mgmt Fee" metric={report.totals.mgmt_fee} />
                <MetricCard label="Total Hours" metric={report.totals.total_hours} money={false} />
              </div>

              <CompareTable title="By Employee (gross pay)" rows={report.byEmployee} />
              <CompareTable title="By Property (total cost)" rows={report.byProperty.slice(0, 10)} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
