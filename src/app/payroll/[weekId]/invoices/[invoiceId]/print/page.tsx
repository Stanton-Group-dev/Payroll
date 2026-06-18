'use client'

import { useState, useEffect, useMemo } from 'react'
import { use } from 'react'
import { Download, Loader2, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { downloadPdf } from '@/lib/payroll/downloadPdf'
import { formatCurrency } from '@/lib/payroll/calculations'
import { buildActivityHoursByCode, splitLaborByActivity } from '@/lib/payroll/cost-code-breakdown'
import type { WorkyardRow } from '@/lib/payroll/csv-parser'

interface LineItem {
  id: string
  property_id: string
  description: string
  labor_amount: number
  spread_amount: number | null
  mgmt_fee_amount: number
  total_amount: number
  property: { code: string; name: string } | null
}

interface Invoice {
  id: string
  payroll_week_id: string
  owner_llc: string
  status: string
  total_amount: number
  approved_at: string | null
  line_items: LineItem[]
}

interface Week {
  week_start: string
  week_end: string
}

export default function InvoicePrintPage({ params }: { params: Promise<{ weekId: string; invoiceId: string }> }) {
  const { weekId, invoiceId } = use(params)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [week, setWeek] = useState<Week | null>(null)
  const [loading, setLoading] = useState(true)
  // Live Workyard cost-code hours for the week, used to split each property's labor
  // into activity sub-lines. If this fails the invoice still renders (no sub-lines).
  const [wyRows, setWyRows] = useState<WorkyardRow[]>([])
  // Collapsed property line ids (default: all expanded). Print always shows sub-lines.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const handleDownload = async () => {
    setSaving(true)
    try {
      await downloadPdf(`/payroll/${weekId}/invoices/${invoiceId}/print`, `invoice-${invoiceId}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not generate PDF')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const [invRes, weekRes] = await Promise.all([
        supabase
          .from('payroll_invoices')
          .select(`*, line_items:payroll_invoice_line_items(*, property:properties(code, name))`)
          .eq('id', invoiceId)
          .single(),
        supabase.from('payroll_weeks').select('week_start, week_end').eq('id', weekId).single(),
      ])
      setInvoice(invRes.data as Invoice)
      setWeek(weekRes.data)
      setLoading(false)
    }
    load()
  }, [weekId, invoiceId])

  // Pull the week's Workyard timecards once we know the week start (same source as the
  // itemized Preview). Best-effort — a failure just leaves labor un-itemized.
  useEffect(() => {
    if (!week?.week_start) return
    fetch(`/api/workyard/timecards?weekStart=${week.week_start}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setWyRows(d.rows ?? []) })
      .catch(() => { /* leave labor un-itemized */ })
  }, [week?.week_start])

  const hoursByCode = useMemo(() => buildActivityHoursByCode(wyRows), [wyRows])

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!invoice || !week) return <div className="p-8 text-gray-500">Invoice not found.</div>

  const subtotal = (invoice.line_items ?? []).reduce((s, li) => s + Number(li.labor_amount) + Number(li.spread_amount ?? 0), 0)
  const mgmtFeeTotal = (invoice.line_items ?? []).reduce((s, li) => s + Number(li.mgmt_fee_amount), 0)
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <>
      {/* Screen-only controls */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Link
          href={`/payroll/${weekId}/invoices`}
          className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={14} />
          Back to Invoices
        </Link>
        <button
          onClick={handleDownload}
          disabled={saving}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {saving ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      {/* Invoice document */}
      <div className="max-w-3xl mx-auto p-10 print:p-0 print:max-w-none">
        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="font-serif text-3xl text-[#1a2744] mb-1">Stanton Management</h1>
            <p className="text-sm text-gray-500">Payroll & Property Management Services</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Invoice</p>
            <p className="font-mono text-xs text-gray-500">{invoiceId.slice(0, 8).toUpperCase()}</p>
            <p className="text-sm text-gray-600 mt-1">
              Week ending {new Date(week.week_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Bill To */}
        <div className="mb-8 p-5 bg-gray-50 border border-gray-200">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Bill To</p>
          <p className="font-semibold text-[#1a2744] text-lg">{invoice.owner_llc}</p>
          <p className="text-sm text-gray-500 mt-1">
            Service period: {new Date(week.week_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} –{' '}
            {new Date(week.week_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* Line items */}
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-[#1a2744] text-white">
              <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wider">Property / Activity</th>
              <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider">Labor</th>
              <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider">Allocated Costs</th>
              <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider">Mgmt Fee (10%)</th>
              <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.line_items ?? []).map((li) => {
              const labor = Number(li.labor_amount)
              // Real activity sub-lines only (hours > 0). When Workyard has no cost-code
              // data for the property, splitLaborByActivity returns a single 0-hour
              // fallback that just echoes the headline Labor — drop it rather than print it.
              const breakdown = (labor > 0 ? splitLaborByActivity(li.property?.code, labor, hoursByCode) : [])
                .filter(b => b.hours > 0)
              const isOpen = !collapsed.has(li.id)
              return (
                <FragmentRows key={li.id}>
                  <tr className="border-t border-gray-200 bg-white">
                    <td className="px-4 py-3">
                      {breakdown.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(li.id)}
                          className="print:hidden align-middle mr-1 text-gray-400 hover:text-gray-600"
                          aria-label={isOpen ? 'Collapse activity breakdown' : 'Expand activity breakdown'}
                        >
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      )}
                      <span className="font-mono text-xs text-gray-400 mr-2">{li.property?.code}</span>
                      <span className="text-gray-800">{li.property?.name ?? li.description}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(labor)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{li.spread_amount ? formatCurrency(Number(li.spread_amount)) : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(Number(li.mgmt_fee_amount))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(Number(li.total_amount))}</td>
                  </tr>
                  {breakdown.map((b, j) => (
                    <tr
                      key={`${li.id}-${j}`}
                      className={`text-xs text-gray-500 bg-gray-50/60 ${isOpen ? '' : 'hidden print:table-row'}`}
                    >
                      <td className="py-1.5 pl-12 pr-4">
                        {b.act}
                        {b.hours > 0 && <span className="text-gray-400 ml-2">{b.hours.toFixed(1)} hrs</span>}
                      </td>
                      <td className="py-1.5 px-4 text-right">{formatCurrency(b.labor)}</td>
                      <td /><td /><td />
                    </tr>
                  ))}
                </FragmentRows>
              )
            })}
          </tbody>
        </table>

        {/* Totals block */}
        <div className="flex justify-end mb-10">
          <div className="w-72">
            <div className="flex justify-between py-2 border-b border-gray-200 text-sm">
              <span className="text-gray-500">Labor subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-200 text-sm">
              <span className="text-gray-500">Management fee (10%)</span>
              <span>{formatCurrency(mgmtFeeTotal)}</span>
            </div>
            <div className="flex justify-between py-3 bg-[#1a2744] text-white px-3 mt-1">
              <span className="font-serif text-base">Total Due</span>
              <span className="font-serif text-xl font-bold">{formatCurrency(Number(invoice.total_amount))}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 pt-6 text-xs text-gray-400 flex justify-between">
          <span>Stanton Management — Payroll & Invoicing System</span>
          <span>
            {invoice.approved_at
              ? `Approved ${new Date(invoice.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : invoice.status
            }
          </span>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; padding: 24px; font-family: Georgia, serif; }
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:max-w-none { max-width: none !important; }
          .print\\:table-row { display: table-row !important; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>
    </>
  )
}

/** Groups a property row with its activity sub-rows without an extra DOM wrapper. */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
