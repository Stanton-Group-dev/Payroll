'use client'

/**
 * Printable weekly statement — the final output.
 *   Page 1: every employee's hours & wages.
 *   Then one page per billing LLC: that LLC's itemized invoice (property → activity,
 *   full address, mgmt fee, total).
 * Works on a draft week (math from useInvoiceBuild — no approval/generation needed).
 */

import { use, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { useInvoiceBuild } from '@/hooks/payroll/useInvoiceBuild'
import { formatCurrency } from '@/lib/payroll/calculations'
import { downloadPdf } from '@/lib/payroll/downloadPdf'

export default function StatementPrintPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const { week, loading, error, wyError, invoices, employeeSummaries } = useInvoiceBuild(weekId)
  const [saving, setSaving] = useState(false)

  const handleDownload = async () => {
    setSaving(true)
    try {
      await downloadPdf(`/payroll/${weekId}/statement/print`, `statement-${week?.week_start ?? weekId}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not generate PDF')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>
  if (error) return <div className="p-8 text-[var(--error)]">Failed to load: {error}</div>

  const emp = [...employeeSummaries].sort((a, b) => a.employee_name.localeCompare(b.employee_name))
  const tot = emp.reduce(
    (t, e) => ({
      reg: t.reg + e.regular_hours, ot: t.ot + e.ot_hours, pto: t.pto + e.pto_hours,
      rw: t.rw + e.regular_wages, ow: t.ow + e.ot_wages, gross: t.gross + e.gross_pay,
    }),
    { reg: 0, ot: 0, pto: 0, rw: 0, ow: 0, gross: 0 },
  )
  const grand = invoices.reduce((s, i) => s + i.total, 0)

  return (
    <div className="bg-white">
      {/* Screen controls (hidden on print) */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Link href={`/payroll/${weekId}/statement`} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={14} /> Back
        </Link>
        <span className="text-sm text-[var(--muted)]">
          {emp.length} employees · {invoices.length} LLCs · {formatCurrency(grand)} billed
          {wyError && <span className="text-[var(--error)]"> · cost codes unavailable</span>}
        </span>
        <button onClick={handleDownload} disabled={saving} className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {saving ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      {/* ── PAGE 1 — Employee hours & wages ── */}
      <section className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h1 className="font-serif text-3xl text-[var(--ink)]">Weekly Payroll Statement</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Employee hours &amp; preliminary wages</p>
          </div>
          <p className="text-sm text-[var(--muted)]">Week {week?.week_start} – {week?.week_end}</p>
        </div>

        <p className="text-xs text-[var(--muted)] italic mb-4">
          Hours are from timesheets. Wage figures here are preliminary — calculated by the payroll system for cost allocation.
        </p>

        <table className="w-full text-sm border border-[var(--border)]">
          <thead>
            <tr className="bg-[var(--primary)] text-white text-xs">
              <th className="px-3 py-2 text-left font-medium">Employee</th>
              <th className="px-3 py-2 text-right font-medium">Reg Hrs</th>
              <th className="px-3 py-2 text-right font-medium">OT Hrs</th>
              <th className="px-3 py-2 text-right font-medium">PTO Hrs</th>
              <th className="px-3 py-2 text-right font-medium">Reg Wages</th>
              <th className="px-3 py-2 text-right font-medium">OT Wages</th>
              <th className="px-3 py-2 text-right font-medium">Gross Pay</th>
            </tr>
          </thead>
          <tbody>
            {emp.map((e, i) => (
              <tr key={e.employee_id} className={`border-t border-[var(--divider)] ${i % 2 ? 'bg-[var(--bg-section)]/40' : ''}`}>
                <td className="px-3 py-1.5 text-[var(--ink)]">{e.employee_name}</td>
                <td className="px-3 py-1.5 text-right">{e.regular_hours ? e.regular_hours.toFixed(1) : '—'}</td>
                <td className="px-3 py-1.5 text-right">{e.ot_hours ? e.ot_hours.toFixed(1) : '—'}</td>
                <td className="px-3 py-1.5 text-right">{e.pto_hours ? e.pto_hours.toFixed(1) : '—'}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(e.regular_wages)}</td>
                <td className="px-3 py-1.5 text-right">{e.ot_wages ? formatCurrency(e.ot_wages) : '—'}</td>
                <td className="px-3 py-1.5 text-right font-medium">{formatCurrency(e.gross_pay)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-semibold">
              <td className="px-3 py-2 text-[var(--ink)]">Total — {emp.length} employees</td>
              <td className="px-3 py-2 text-right">{tot.reg.toFixed(1)}</td>
              <td className="px-3 py-2 text-right">{tot.ot.toFixed(1)}</td>
              <td className="px-3 py-2 text-right">{tot.pto.toFixed(1)}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(tot.rw)}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(tot.ow)}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(tot.gross)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* ── One page per LLC — itemized invoice ── */}
      {invoices.map(inv => (
        <section key={inv.llc} className="max-w-4xl mx-auto px-8 py-10 break-before-page">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="font-serif text-2xl text-[var(--ink)]">{inv.llc}</h2>
              <p className="text-sm text-[var(--muted)] mt-1">Service period {week?.week_start} – {week?.week_end}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[var(--muted)] uppercase tracking-widest mb-0.5">Amount Due</p>
              <p className="font-serif text-2xl text-[var(--primary)]">{formatCurrency(inv.total)}</p>
            </div>
          </div>

          <table className="w-full text-sm border border-[var(--border)]">
            <thead>
              <tr className="bg-[var(--primary)] text-white text-xs">
                <th className="px-4 py-2 text-left font-medium">Property / Activity</th>
                <th className="px-3 py-2 text-right font-medium">Hours</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Mgmt Fee</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.props.map(p => (
                <FragmentRows key={p.property_id}>
                  <tr className="border-t border-[var(--divider)] bg-[var(--bg-section)]/40">
                    <td className="px-4 py-2 font-medium text-[var(--ink)]">
                      {p.property_code} - {p.address || p.property_name.replace(/^S\d+\s*[-–]\s*/, '')}
                    </td>
                    <td />
                    <td className="px-3 py-2 text-right">{formatCurrency(p.labor_cost + p.spread_cost + p.mileage_cost)}</td>
                    <td className="px-3 py-2 text-right text-[var(--muted)]">{formatCurrency(p.mgmt_fee)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(p.total_cost)}</td>
                  </tr>
                  {p.breakdown.map((b, i) => (
                    <tr key={i} className="text-xs text-[var(--muted)]">
                      <td className="pl-10 pr-4 py-1">{b.act}</td>
                      <td className="px-3 py-1 text-right">{b.hours ? b.hours.toFixed(1) : '—'}</td>
                      <td className="px-3 py-1 text-right">{formatCurrency(b.labor)}</td>
                      <td /><td />
                    </tr>
                  ))}
                </FragmentRows>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-medium">
                <td className="px-4 py-2 font-serif text-[var(--primary)]">Total Due</td>
                <td /><td className="px-3 py-2 text-right">{formatCurrency(inv.amount)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(inv.mgmt)}</td>
                <td className="px-4 py-2 text-right font-serif text-[var(--primary)]">{formatCurrency(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ))}

      <style>{`@media print { @page { margin: 0.5in; } .break-before-page { break-before: page; } }`}</style>
    </div>
  )
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
