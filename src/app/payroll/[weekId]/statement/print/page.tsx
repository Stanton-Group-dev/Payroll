'use client'

/**
 * Printable weekly statement — the final output, in order:
 *   Page 1: Statement — each billing LLC and its amount, with total payroll.
 *   Page 2: Hourly summary — on-site employees' hours & wages (remote run excluded).
 *   Page 3: Reimbursements & adjustments — per-employee phone, mileage, other
 *           adjustments, and advances/deductions (the non-wage payments this PDF
 *           authorizes). All employees with activity, remote included.
 *   Then one page PER billing LLC: that LLC's itemized invoice. Each LLC starts on
 *   a fresh page; a large LLC may run 2–3 pages.
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
  const { week, loading, error, wyError, invoices, employeeSummaries, remoteEmployeeIds } = useInvoiceBuild(weekId)
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

  // Statement summary — each LLC and its amount, biggest first.
  const llcRows = [...invoices].sort((a, b) => b.total - a.total)
  const grand = llcRows.reduce((s, i) => s + i.total, 0)

  // On-site hourly summary — exclude remote-run employees.
  const emp = employeeSummaries
    .filter(e => !remoteEmployeeIds.has(e.employee_id))
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name))
  const tot = emp.reduce(
    (t, e) => ({
      reg: t.reg + e.regular_hours, ot: t.ot + e.ot_hours, pto: t.pto + e.pto_hours,
      rw: t.rw + e.regular_wages, ow: t.ow + e.ot_wages, gross: t.gross + e.gross_pay,
    }),
    { reg: 0, ot: 0, pto: 0, rw: 0, ow: 0, gross: 0 },
  )

  // Reimbursements & adjustments — the non-wage payments (and deductions) this PDF
  // authorizes accounting to pay out. Unlike the hourly summary, this includes EVERY
  // employee with any phone / mileage / other-adjustment / advance activity — remote
  // staff too, since reimbursements are real payouts regardless of which run their
  // wages land on. reimb_total = phone + mileage + other − advances (the net the
  // employee receives on top of, or against, their wages).
  const reimb = employeeSummaries
    .map(e => ({
      ...e,
      is_remote: remoteEmployeeIds.has(e.employee_id),
      reimb_total: e.phone_reimbursement + e.mileage_reimbursement + e.other_adjustments - e.advances,
    }))
    .filter(e => e.phone_reimbursement || e.mileage_reimbursement || e.other_adjustments || e.advances)
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name))
  const rtot = reimb.reduce(
    (t, e) => ({
      phone: t.phone + e.phone_reimbursement, mileage: t.mileage + e.mileage_reimbursement,
      other: t.other + e.other_adjustments, adv: t.adv + e.advances, total: t.total + e.reimb_total,
    }),
    { phone: 0, mileage: 0, other: 0, adv: 0, total: 0 },
  )

  return (
    <div className="bg-white">
      {/* Screen controls (hidden on print) */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Link href={`/payroll/${weekId}/statement`} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          <ArrowLeft size={14} /> Back
        </Link>
        <span className="text-sm text-[var(--muted)]">
          {llcRows.length} LLCs · {emp.length} on-site employees · {formatCurrency(grand)} billed
          {wyError && <span className="text-[var(--error)]"> · cost codes unavailable</span>}
        </span>
        <button onClick={handleDownload} disabled={saving} className="ml-auto flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white text-sm disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {saving ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      {/* ── PAGE 1 — Statement: each LLC and its amount ── */}
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
            {llcRows.map((inv, i) => (
              <tr key={inv.llc} className={`border-t border-[var(--divider)] ${i % 2 ? 'bg-[var(--bg-section)]/40' : ''}`}>
                <td className="px-4 py-2 text-[var(--ink)]">{inv.llc}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(inv.total)}</td>
              </tr>
            ))}
            {llcRows.length === 0 && (
              <tr><td colSpan={2} className="px-4 py-8 text-center text-[var(--muted)]">No billable costs for this week.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-semibold">
              <td className="px-4 py-3 font-serif text-[var(--primary)]">Total Payroll</td>
              <td className="px-4 py-3 text-right font-serif text-[var(--primary)]">{formatCurrency(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* ── PAGE 2 — On-site hourly summary (remote run excluded) ── */}
      <section className="max-w-4xl mx-auto px-8 py-10 break-before-page">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-serif text-2xl text-[var(--ink)]">Hourly Summary</h2>
            <p className="text-sm text-[var(--muted)] mt-1">On-site employees — hours &amp; preliminary wages</p>
          </div>
          <p className="text-sm text-[var(--muted)]">Week {week?.week_start} – {week?.week_end}</p>
        </div>

        <p className="text-xs text-[var(--muted)] italic mb-4">
          Remote employees are paid on a separate run and are not shown here. Wage figures are preliminary —
          calculated by the payroll system for cost allocation.
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

      {/* ── PAGE 3 — Reimbursements & adjustments (per employee, remote included) ── */}
      {reimb.length > 0 && (
        <section className="max-w-4xl mx-auto px-8 py-10 break-before-page">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h2 className="font-serif text-2xl text-[var(--ink)]">Reimbursements &amp; Adjustments</h2>
              <p className="text-sm text-[var(--muted)] mt-1">Per employee — non-wage payments authorized this week</p>
            </div>
            <p className="text-sm text-[var(--muted)]">Week {week?.week_start} – {week?.week_end}</p>
          </div>

          <p className="text-xs text-[var(--muted)] italic mb-4">
            Phone and mileage are tax-free reimbursements; Other Adj. covers tools, expense receipts, and bonuses;
            Advances / Deductions reduce the payout (shown in parentheses). All employees with activity are listed,
            including remote-run staff (tagged).
          </p>

          <table className="w-full text-sm border border-[var(--border)]">
            <thead>
              <tr className="bg-[var(--primary)] text-white text-xs">
                <th className="px-3 py-2 text-left font-medium">Employee</th>
                <th className="px-3 py-2 text-right font-medium">Phone</th>
                <th className="px-3 py-2 text-right font-medium">Mileage</th>
                <th className="px-3 py-2 text-right font-medium">Other Adj.</th>
                <th className="px-3 py-2 text-right font-medium">Advances / Deductions</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {reimb.map((e, i) => (
                <tr key={e.employee_id} className={`border-t border-[var(--divider)] ${i % 2 ? 'bg-[var(--bg-section)]/40' : ''}`}>
                  <td className="px-3 py-1.5 text-[var(--ink)]">
                    {e.employee_name}
                    {e.is_remote && <span className="ml-2 text-xs text-[var(--muted)]">(remote)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">{e.phone_reimbursement ? formatCurrency(e.phone_reimbursement) : '—'}</td>
                  <td className="px-3 py-1.5 text-right">{e.mileage_reimbursement ? formatCurrency(e.mileage_reimbursement) : '—'}</td>
                  <td className="px-3 py-1.5 text-right">{e.other_adjustments ? formatCurrency(e.other_adjustments) : '—'}</td>
                  <td className="px-3 py-1.5 text-right">{e.advances ? `(${formatCurrency(e.advances)})` : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{formatCurrency(e.reimb_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5 font-semibold">
                <td className="px-3 py-2 text-[var(--ink)]">Total — {reimb.length} employees</td>
                <td className="px-3 py-2 text-right">{formatCurrency(rtot.phone)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(rtot.mileage)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(rtot.other)}</td>
                <td className="px-3 py-2 text-right">{rtot.adv ? `(${formatCurrency(rtot.adv)})` : '—'}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(rtot.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {/* ── One page per LLC — itemized invoice (each starts on a fresh page) ── */}
      {llcRows.map(inv => (
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
                    <td className="px-3 py-2 text-right">{formatCurrency(p.labor_cost + p.spread_cost + p.mileage_cost + p.expense_cost)}</td>
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

      <style>{`@media print {
        @page { margin: 0.5in; }
        .break-before-page { break-before: page; }
        /* Multi-page LLC tables: repeat the column header, don't split a row. */
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
      }`}</style>
    </div>
  )
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
