'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  FileSpreadsheet, Printer, ChevronRight, ChevronDown, FileText, Plus, ArrowRight,
} from 'lucide-react'
import { useBillingLedger } from '@/hooks/payroll/useBillingLedger'
import { buildBillingLedger, UNASSIGNED_LLC, type BillingFilters } from '@/lib/payroll/billing'
import type { InvoiceStatus } from '@/lib/supabase/types'
import { exportBillingXlsx } from '@/lib/payroll/billing-export'
import { formatCurrency } from '@/lib/payroll/calculations'
import { PageHeader, FormButton, FormInput, FormSelect, StatusBadge, InfoBlock } from '@/components/form'

const fmtRange = (start: string, end: string) => {
  if (!start) return '—'
  const s = new Date(start + 'T00:00:00')
  const e = new Date((end || start) + 'T00:00:00')
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

/** Does this week support invoice creation yet? Invoices come from approved payroll costs. */
function weekAction(status: string, weekId: string, invoiceCount: number) {
  if (invoiceCount > 0) {
    return { href: `/payroll/${weekId}/invoices`, label: 'View invoices', icon: ArrowRight, primary: false }
  }
  const approved = status === 'payroll_approved' || status === 'invoiced' || status === 'statement_sent'
  if (approved) {
    return { href: `/payroll/${weekId}/invoices`, label: 'Create invoices', icon: Plus, primary: true }
  }
  return { href: `/payroll/${weekId}/review`, label: 'Approve payroll first', icon: ArrowRight, primary: false }
}

export default function BillingPage() {
  const { invoices, weeks, loading, error } = useBillingLedger()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const [llcSearch, setLlcSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filters: BillingFilters = useMemo(
    () => ({ from: from || undefined, to: to || undefined, status, llc: llcSearch || undefined }),
    [from, to, status, llcSearch],
  )
  const ledger = useMemo(() => buildBillingLedger(invoices, weeks, filters), [invoices, weeks, filters])

  const toggle = (llc: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(llc)) next.delete(llc)
      else next.add(llc)
      return next
    })

  const rangeLabel = from || to ? `${from || 'start'}_${to || 'now'}` : undefined

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>
  if (error) return <div className="p-8 text-[var(--error)]">Failed to load billing: {error}</div>

  const hasInvoices = ledger.groups.length > 0

  return (
    <div>
      <PageHeader
        title="Invoices — by LLC"
        subtitle="Every invoice, grouped by billing entity, across all weeks"
        actions={
          <FormButton size="sm" variant="secondary" disabled={!hasInvoices} onClick={() => exportBillingXlsx(ledger, rangeLabel)}>
            <FileSpreadsheet size={14} className="mr-1.5" />
            Export Excel
          </FormButton>
        }
      />

      <div className="p-6 space-y-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 border border-[var(--border)] divide-x divide-[var(--divider)] bg-white">
          {[
            { label: 'Total billed', value: formatCurrency(ledger.grand_total), accent: true },
            { label: 'Billing LLCs', value: String(ledger.llc_count) },
            { label: 'Invoices', value: String(ledger.invoice_count) },
            { label: 'Mgmt fee billed', value: formatCurrency(ledger.mgmt_fee_total) },
          ].map(kpi => (
            <div key={kpi.label} className="px-5 py-4">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">{kpi.label}</p>
              <p className={`font-serif ${kpi.accent ? 'text-2xl text-[var(--primary)]' : 'text-xl text-[var(--ink)]'}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Create invoices — per-week status */}
        <section className="border border-[var(--border)] bg-white">
          <div className="px-5 py-3 border-b border-[var(--divider)] bg-[var(--bg-section)]">
            <h3 className="text-sm font-medium text-[var(--ink)]">Create invoices</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Invoices are generated per week from approved payroll costs, one per billing LLC.
            </p>
          </div>
          {ledger.weeks.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[var(--muted)]">No payroll weeks in range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)] border-b border-[var(--divider)]">
                  <th className="px-5 py-2 text-left font-medium">Week</th>
                  <th className="px-5 py-2 text-left font-medium">Stage</th>
                  <th className="px-5 py-2 text-right font-medium">Invoices</th>
                  <th className="px-5 py-2 text-right font-medium">Billed</th>
                  <th className="px-5 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {ledger.weeks.map(w => {
                  const a = weekAction(w.status, w.week_id, w.invoice_count)
                  const Icon = a.icon
                  return (
                    <tr key={w.week_id} className="border-b border-[var(--divider)] last:border-0">
                      <td className="px-5 py-3 font-medium text-[var(--ink)]">{fmtRange(w.week_start, w.week_end)}</td>
                      <td className="px-5 py-3"><StatusBadge status={w.status} /></td>
                      <td className="px-5 py-3 text-right text-[var(--muted)]">{w.invoice_count || '—'}</td>
                      <td className="px-5 py-3 text-right">{w.invoice_count ? formatCurrency(w.invoice_total) : '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={a.href}
                          className={`inline-flex items-center gap-1 text-xs ${a.primary ? 'text-[var(--primary)] font-medium' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
                        >
                          {a.label}
                          <Icon size={13} />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">
            <span className="block mb-1">From (week start)</span>
            <FormInput type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            <span className="block mb-1">To (week start)</span>
            <FormInput type="date" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            <span className="block mb-1">Status</span>
            <FormSelect value={status} onChange={e => setStatus(e.target.value as InvoiceStatus | 'all')}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="sent">Sent</option>
            </FormSelect>
          </label>
          <label className="text-xs text-[var(--muted)] flex-1 min-w-[160px]">
            <span className="block mb-1">Search LLC</span>
            <FormInput type="text" placeholder="e.g. SREP Northend" value={llcSearch} onChange={e => setLlcSearch(e.target.value)} />
          </label>
        </div>

        {/* By-LLC ledger */}
        {!hasInvoices ? (
          <InfoBlock variant="default" title="No invoices yet">
            Once a week&apos;s payroll is approved and its invoices are generated, every billing LLC
            will roll up here — with Excel and per-LLC PDF output. Use the <strong>Create invoices</strong>{' '}
            section above to start.
          </InfoBlock>
        ) : (
          <div className="border border-[var(--border)] bg-white">
            <div className="px-5 py-3 border-b border-[var(--divider)] bg-[var(--primary)] text-white flex items-center justify-between">
              <h3 className="font-serif text-base">All Invoices — by Billing LLC</h3>
              <span className="text-xs text-white/60">{ledger.llc_count} LLCs · {ledger.invoice_count} invoices</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)] bg-[var(--bg-section)]">
                  <th className="px-5 py-2.5 text-left font-medium">Billing LLC</th>
                  <th className="px-3 py-2.5 text-right font-medium">Wks</th>
                  <th className="px-3 py-2.5 text-right font-medium">Labor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Spread</th>
                  <th className="px-3 py-2.5 text-right font-medium">Mgmt Fee</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 text-center font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {ledger.groups.map(g => {
                  const isOpen = expanded.has(g.owner_llc)
                  return (
                    <FragmentRow key={g.owner_llc}>
                      <tr className="border-t border-[var(--divider)] hover:bg-[var(--bg-section)]/50">
                        <td className="px-5 py-3">
                          <button onClick={() => toggle(g.owner_llc)} className="flex items-center gap-2 text-left">
                            {isOpen ? <ChevronDown size={14} className="text-[var(--muted)]" /> : <ChevronRight size={14} className="text-[var(--muted)]" />}
                            <FileText size={14} className="text-[var(--accent)]" />
                            <span className="font-medium text-[var(--ink)]">{g.owner_llc}</span>
                            <span className="text-xs text-[var(--muted)]">({g.invoice_count})</span>
                          </button>
                        </td>
                        <td className="px-3 py-3 text-right text-[var(--muted)]">{g.week_count}</td>
                        <td className="px-3 py-3 text-right">{formatCurrency(g.labor)}</td>
                        <td className="px-3 py-3 text-right text-[var(--muted)]">{g.spread ? formatCurrency(g.spread) : '—'}</td>
                        <td className="px-3 py-3 text-right text-[var(--muted)]">{formatCurrency(g.mgmt_fee)}</td>
                        <td className="px-5 py-3 text-right font-serif text-[var(--primary)] text-base">{formatCurrency(g.total)}</td>
                        <td className="px-3 py-3 text-center">
                          {g.owner_llc !== UNASSIGNED_LLC && (
                            <Link
                              href={`/payroll/billing/${encodeURIComponent(g.owner_llc)}/print${rangeLabel ? `?from=${from}&to=${to}` : ''}`}
                              target="_blank"
                              title={`Print statement for ${g.owner_llc}`}
                              className="inline-flex text-[var(--muted)] hover:text-[var(--primary)]"
                            >
                              <Printer size={14} />
                            </Link>
                          )}
                        </td>
                      </tr>
                      {isOpen && g.invoices.map(inv => (
                        <tr key={inv.invoice_id} className="bg-[var(--bg-section)]/40 text-xs">
                          <td className="pl-14 pr-5 py-2 text-[var(--muted)]">
                            <Link href={`/payroll/${inv.week_id}/invoices/${inv.invoice_id}/print`} target="_blank" className="hover:text-[var(--primary)]">
                              {fmtRange(inv.week_start, inv.week_end)} · {inv.property_count} properties
                            </Link>
                          </td>
                          <td />
                          <td className="px-3 py-2 text-right">{formatCurrency(inv.labor)}</td>
                          <td className="px-3 py-2 text-right text-[var(--muted)]">{inv.spread ? formatCurrency(inv.spread) : '—'}</td>
                          <td className="px-3 py-2 text-right text-[var(--muted)]">{formatCurrency(inv.mgmt_fee)}</td>
                          <td className="px-5 py-2 text-right font-medium">{formatCurrency(inv.total)}</td>
                          <td className="px-3 py-2 text-center"><StatusBadge status={inv.status} /></td>
                        </tr>
                      ))}
                    </FragmentRow>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5">
                  <td className="px-5 py-3 font-serif font-bold text-[var(--primary)]">Grand Total</td>
                  <td />
                  <td className="px-3 py-3 text-right text-sm">{formatCurrency(ledger.labor_total)}</td>
                  <td className="px-3 py-3 text-right text-sm text-[var(--muted)]">{formatCurrency(ledger.spread_total)}</td>
                  <td className="px-3 py-3 text-right text-sm text-[var(--muted)]">{formatCurrency(ledger.mgmt_fee_total)}</td>
                  <td className="px-5 py-3 text-right font-serif text-xl font-bold text-[var(--primary)]">{formatCurrency(ledger.grand_total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** React fragment that can hold multiple <tr> without an extra DOM node. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
