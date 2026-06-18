'use client'

import { use, useEffect, useState } from 'react'
import { Printer, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/payroll/calculations'

interface LineItem {
  id: string
  description: string | null
  labor_amount: number
  spread_amount: number | null
  mgmt_fee_amount: number
  total_amount: number
  property: { code: string; name: string } | null
}
interface InvoiceRow {
  id: string
  status: string
  total_amount: number
  week: { week_start: string; week_end: string } | null
  line_items: LineItem[]
}

const longDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export default function LLCStatementPrintPage({ params }: { params: Promise<{ llc: string }> }) {
  const { llc } = use(params)
  const ownerLlc = decodeURIComponent(llc)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const sp = new URLSearchParams(window.location.search)
      const from = sp.get('from') || ''
      const to = sp.get('to') || ''
      const supabase = createClient()
      const { data } = await supabase
        .from('payroll_invoices')
        .select(`
          id, status, total_amount,
          week:payroll_weeks(week_start, week_end),
          line_items:payroll_invoice_line_items(id, description, labor_amount, spread_amount, mgmt_fee_amount, total_amount, property:properties(code, name))
        `)
        .eq('owner_llc', ownerLlc)
      let rows = (data ?? []) as unknown as InvoiceRow[]
      if (from) rows = rows.filter(r => (r.week?.week_start ?? '') >= from)
      if (to) rows = rows.filter(r => (r.week?.week_start ?? '') <= to)
      rows.sort((a, b) => (a.week?.week_start ?? '').localeCompare(b.week?.week_start ?? ''))
      setInvoices(rows)
      setLoading(false)
    }
    load()
  }, [ownerLlc])

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (invoices.length === 0) return <div className="p-8 text-gray-500">No invoices found for {ownerLlc}.</div>

  const grandTotal = invoices.reduce((s, inv) => s + Number(inv.total_amount), 0)
  const laborTotal = invoices.reduce((s, inv) => s + inv.line_items.reduce((t, li) => t + Number(li.labor_amount) + Number(li.spread_amount ?? 0), 0), 0)
  const mgmtTotal = invoices.reduce((s, inv) => s + inv.line_items.reduce((t, li) => t + Number(li.mgmt_fee_amount), 0), 0)
  const first = invoices[0].week?.week_start
  const last = invoices[invoices.length - 1].week?.week_end

  return (
    <>
      <div className="print:hidden flex items-center gap-3 p-4 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Link href="/payroll/billing" className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={14} /> Back to Invoices
        </Link>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm hover:bg-[var(--primary)]/90 transition-colors"
        >
          <Printer size={14} /> Print / Save PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto p-10 print:p-0 print:max-w-none">
        {/* Header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="font-serif text-3xl text-[#1a2744] mb-1">Stanton Management</h1>
            <p className="text-sm text-gray-500">Payroll &amp; Property Management Services</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Statement</p>
            <p className="text-sm text-gray-600 mt-1">
              {invoices.length} {invoices.length === 1 ? 'week' : 'weeks'}
            </p>
          </div>
        </div>

        {/* Bill To */}
        <div className="mb-8 p-5 bg-gray-50 border border-gray-200">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Bill To</p>
          <p className="font-semibold text-[#1a2744] text-lg">{ownerLlc}</p>
          {first && last && (
            <p className="text-sm text-gray-500 mt-1">Service period: {longDate(first)} – {longDate(last)}</p>
          )}
        </div>

        {/* Per-week sections */}
        {invoices.map(inv => (
          <div key={inv.id} className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-serif text-base text-[#1a2744]">
                Week of {inv.week ? longDate(inv.week.week_start) : '—'}
              </h2>
              <span className="text-sm font-semibold text-gray-700">{formatCurrency(Number(inv.total_amount))}</span>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#1a2744] text-white">
                  <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wider">Property</th>
                  <th className="px-4 py-2 text-right font-medium text-xs uppercase tracking-wider">Labor</th>
                  <th className="px-4 py-2 text-right font-medium text-xs uppercase tracking-wider">Allocated</th>
                  <th className="px-4 py-2 text-right font-medium text-xs uppercase tracking-wider">Mgmt Fee</th>
                  <th className="px-4 py-2 text-right font-medium text-xs uppercase tracking-wider font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {inv.line_items.map((li, i) => (
                  <tr key={li.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-gray-400 mr-2">{li.property?.code}</span>
                      <span className="text-gray-800">{li.property?.name ?? li.description}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">{formatCurrency(Number(li.labor_amount))}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{li.spread_amount ? formatCurrency(Number(li.spread_amount)) : '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{formatCurrency(Number(li.mgmt_fee_amount))}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">{formatCurrency(Number(li.total_amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* Grand totals */}
        <div className="flex justify-end mb-10">
          <div className="w-72">
            <div className="flex justify-between py-2 border-b border-gray-200 text-sm">
              <span className="text-gray-500">Labor + allocated</span>
              <span>{formatCurrency(laborTotal)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-200 text-sm">
              <span className="text-gray-500">Management fee</span>
              <span>{formatCurrency(mgmtTotal)}</span>
            </div>
            <div className="flex justify-between py-3 bg-[#1a2744] text-white px-3 mt-1">
              <span className="font-serif text-base">Total Due</span>
              <span className="font-serif text-xl font-bold">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-6 text-xs text-gray-400 flex justify-between">
          <span>Stanton Management — Payroll &amp; Invoicing System</span>
          <span>{ownerLlc}</span>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; padding: 24px; font-family: Georgia, serif; }
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:max-w-none { max-width: none !important; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>
    </>
  )
}
