'use client'

/**
 * Itemized invoice PREVIEW — read-only, works on a draft week (no approval needed).
 * Billing math lives in useInvoiceBuild (shared with the printable statement).
 */

import { use, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Loader2, FileText } from 'lucide-react'
import { useInvoiceBuild } from '@/hooks/payroll/useInvoiceBuild'
import { formatCurrency } from '@/lib/payroll/calculations'
import { downloadPdf } from '@/lib/payroll/downloadPdf'

export default function InvoicePreviewPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const { week, loading, error, wyLoading, wyError, invoices, mgmtAllocation } = useInvoiceBuild(weekId)
  const [saving, setSaving] = useState(false)

  const handleDownload = async () => {
    setSaving(true)
    try {
      await downloadPdf(`/payroll/${weekId}/invoices/preview`, `invoice-preview-${week?.week_start ?? weekId}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not generate PDF')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading payroll…</div>
  if (error) return <div className="p-8 text-[var(--error)]">Failed to load: {error}</div>

  // An LLC's amount due includes its unit-share of the Stanton Management pass-through.
  const grand = invoices.reduce((s, i) => s + i.total + i.mgmt_allocation, 0)

  return (
    <div className="print:p-0">
      <div className="print:hidden flex items-center gap-3 p-4 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Link href={`/payroll/${weekId}/invoices`} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={14} /> Back to Invoices
        </Link>
        <Link href={`/payroll/${weekId}/statement/print`} className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline">
          <FileText size={14} /> Full Statement
        </Link>
        <button onClick={handleDownload} disabled={saving} className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {saving ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-8 space-y-8">
        <div>
          <h1 className="font-serif text-2xl text-[var(--ink)]">Invoice Preview — itemized by activity</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Week {week?.week_start} – {week?.week_end} · {invoices.length} billing LLCs · {formatCurrency(grand)} total
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            Live preview from draft payroll — no approval needed. Labor is split across activities by Workyard hours.
            {wyLoading && ' · loading cost codes…'}
            {wyError && <span className="text-[var(--error)]"> · cost codes unavailable ({wyError}); showing property totals.</span>}
          </p>
        </div>

        {/* Stanton Management pass-through — its costs billed to the ownership LLCs by unit count */}
        {mgmtAllocation && (
          <div className="border border-[var(--border)] bg-white">
            <div className="px-5 py-3 bg-[var(--primary)] text-white flex items-center justify-between">
              <span className="font-serif text-base">Stanton Management LLC — billed to ownership LLCs</span>
              <span className="font-serif text-lg">{formatCurrency(mgmtAllocation.total)}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)] bg-[var(--bg-section)]">
                  <th className="px-4 py-2 text-left font-medium">Billing LLC</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {mgmtAllocation.rows.map(r => (
                  <tr key={r.llc} className="border-t border-[var(--divider)]">
                    <td className="px-4 py-1.5 text-[var(--ink)]">{r.llc}</td>
                    <td className="px-3 py-1.5 text-right">{r.units}</td>
                    <td className="px-4 py-1.5 text-right">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-medium">
                  <td className="px-4 py-2 font-serif text-[var(--primary)]">Total Allocated</td>
                  <td className="px-3 py-2 text-right">{mgmtAllocation.totalUnits}</td>
                  <td className="px-4 py-2 text-right font-serif text-[var(--primary)]">{formatCurrency(mgmtAllocation.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {invoices.map(inv => (
          <div key={inv.llc} className="border border-[var(--border)] bg-white">
            <div className="px-5 py-3 bg-[var(--primary)] text-white flex items-center justify-between">
              <span className="font-serif text-base">{inv.llc}</span>
              <span className="font-serif text-lg">{formatCurrency(inv.total + inv.mgmt_allocation)}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)] bg-[var(--bg-section)]">
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
                      <td className="px-3 py-2 text-right">{formatCurrency(p.labor_cost + p.spread_cost + p.mileage_cost + p.expense_cost + p.tax_cost + p.wc_cost)}</td>
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
                {inv.mgmt_allocation > 0 && (
                  <tr className="border-t border-[var(--divider)] bg-[var(--bg-section)]/40">
                    <td className="px-4 py-2 font-medium text-[var(--ink)]">Stanton Management — allocated by unit count</td>
                    <td /><td /><td />
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(inv.mgmt_allocation)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-medium">
                  <td className="px-4 py-2 font-serif text-[var(--primary)]">Total Due</td>
                  <td /><td className="px-3 py-2 text-right">{formatCurrency(inv.amount)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(inv.mgmt)}</td>
                  <td className="px-4 py-2 text-right font-serif text-[var(--primary)]">{formatCurrency(inv.total + inv.mgmt_allocation)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        {invoices.length === 0 && (
          <div className="text-sm text-[var(--muted)] py-12 text-center">No billable property costs for this week.</div>
        )}
      </div>
    </div>
  )
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
