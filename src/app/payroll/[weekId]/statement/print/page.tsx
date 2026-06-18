'use client'

/**
 * Printable weekly statement — the summary final output.
 *   One page: each billing LLC and its amount, with the grand total.
 * Itemized detail lives in the per-invoice prints and the Invoice Preview.
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
  const { week, loading, error, invoices } = useInvoiceBuild(weekId)
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

  const rows = [...invoices].sort((a, b) => b.total - a.total)
  const grand = rows.reduce((s, i) => s + i.total, 0)

  return (
    <div className="bg-white">
      {/* Screen controls (hidden on print) */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Link href={`/payroll/${weekId}/statement`} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={14} /> Back
        </Link>
        <span className="text-sm text-[var(--muted)]">
          {rows.length} LLCs · {formatCurrency(grand)} billed
        </span>
        <button onClick={handleDownload} disabled={saving} className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {saving ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      {/* Summary — each LLC and its amount, with the total */}
      <section className="max-w-3xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="font-serif text-3xl text-[var(--ink)]">Weekly Payroll Statement</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Amount due by billing LLC</p>
          </div>
          <p className="text-sm text-[var(--muted)]">Week {week?.week_start} – {week?.week_end}</p>
        </div>

        <table className="w-full text-sm border border-[var(--border)]">
          <thead>
            <tr className="bg-[var(--primary)] text-white text-xs">
              <th className="px-4 py-2 text-left font-medium">Billing LLC</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv, i) => (
              <tr key={inv.llc} className={`border-t border-[var(--divider)] ${i % 2 ? 'bg-[var(--bg-section)]/40' : ''}`}>
                <td className="px-4 py-2 text-[var(--ink)]">{inv.llc}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(inv.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={2} className="px-4 py-8 text-center text-[var(--muted)]">No billable costs for this week.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-semibold">
              <td className="px-4 py-3 font-serif text-[var(--primary)]">Total — {rows.length} LLCs</td>
              <td className="px-4 py-3 text-right font-serif text-[var(--primary)]">{formatCurrency(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <style>{`@media print { @page { margin: 0.5in; } }`}</style>
    </div>
  )
}
