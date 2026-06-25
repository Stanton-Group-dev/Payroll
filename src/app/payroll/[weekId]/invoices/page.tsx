'use client'

import { use } from 'react'
import { Plus, CheckCircle2, FileText, Download } from 'lucide-react'
import Link from 'next/link'
import { usePayrollWeekInvoices } from '@/hooks/payroll/usePayrollWeekInvoices'
import { usePayrollInvoices } from '@/hooks/payroll/usePayrollInvoices'
import { PageHeader, FormButton, InfoBlock, StatusBadge } from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'

export default function InvoicesPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const { week, propertyCosts, loading, generating, approvingAll, generateInvoices, approveAll } = usePayrollWeekInvoices(weekId)
  const { invoices, refetch: refetchInvoices, approveInvoice, allApproved } = usePayrollInvoices(weekId)

  const payrollApproved = week?.status === 'payroll_approved' || week?.status === 'invoiced' || week?.status === 'statement_sent'

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title="Invoice Generator"
        subtitle={week ? `Week of ${week.week_start}` : ''}
        actions={
          <div className="flex gap-2">
            <Link
              href={`/payroll/${weekId}/invoices/preview`}
              className="inline-flex items-center px-3 py-1.5 text-sm border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--bg-section)]"
            >
              Preview (itemized)
            </Link>
            {payrollApproved && invoices.length === 0 && (
              <FormButton size="sm" onClick={() => generateInvoices(refetchInvoices)} loading={generating}>
                <Plus size={14} className="mr-1" />
                Generate Invoices
              </FormButton>
            )}
            {invoices.length > 0 && !allApproved && (
              <FormButton size="sm" onClick={() => approveAll(invoices.filter(i => i.status === 'draft').map(i => i.id), approveInvoice)} loading={approvingAll}>
                Approve All
              </FormButton>
            )}
          </div>
        }
      />

      <div className="p-6">
        {!payrollApproved && (
          <InfoBlock variant="warning" title="Payroll Not Yet Approved">
            Approve the payroll calculation before generating invoices.
            <div className="mt-1">
              <a href={`/payroll/${weekId}/review`} className="underline">Go to Payroll Review →</a>
            </div>
          </InfoBlock>
        )}

        {allApproved && (
          <InfoBlock variant="success" title="All Invoices Approved">
            All invoices approved. Statement generation is now unlocked.
            <div className="mt-1">
              <a href={`/payroll/${weekId}/statement`} className="underline text-[var(--primary)]">Go to Statement →</a>
            </div>
          </InfoBlock>
        )}

        {invoices.length === 0 && payrollApproved ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm">
            {propertyCosts.length === 0
              ? 'No property costs found for this week. Ensure payroll calculation has been run.'
              : 'Click "Generate Invoices" to create invoices for all LLCs.'}
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map(inv => (
              <div key={inv.id} className="border border-[var(--border)] bg-white">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--divider)]">
                  <div className="flex items-center gap-3">
                    <FileText size={16} className="text-[var(--accent)]" />
                    <div>
                      <p className="font-medium text-sm text-[var(--ink)]">{inv.owner_llc}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {inv.line_items?.length ?? 0} properties
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-serif text-xl text-[var(--primary)]">{formatCurrency(inv.total_amount)}</p>
                    <StatusBadge status={inv.status} />
                    {inv.status === 'draft' && (
                      <FormButton size="sm" onClick={() => approveInvoice(inv.id)}>Approve</FormButton>
                    )}
                    {inv.status === 'approved' && (
                      <CheckCircle2 size={16} className="text-[var(--success)]" />
                    )}
                    <Link
                      href={`/payroll/${weekId}/invoices/${inv.id}/print`}
                      target="_blank"
                      className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                      title="Download invoice PDF"
                    >
                      <Download size={13} />
                    </Link>
                  </div>
                </div>

                {/* Line items */}
                {inv.line_items && inv.line_items.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg-section)] text-[var(--muted)]">
                        <th className="px-4 py-2 text-left font-medium">Property</th>
                        <th className="px-4 py-2 text-right font-medium">Labor</th>
                        <th className="px-4 py-2 text-right font-medium">Spread</th>
                        <th className="px-4 py-2 text-right font-medium">Expenses</th>
                        <th className="px-4 py-2 text-right font-medium">Mgmt Fee (10%)</th>
                        <th className="px-4 py-2 text-right font-medium font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.line_items.map(li => (
                        <tr key={li.id} className="border-t border-[var(--divider)]">
                          <td className="px-4 py-2">
                            <span className="font-mono text-[var(--muted)] mr-1">
                              {(li.property as {code:string})?.code}
                            </span>
                            {(li.property as {name:string})?.name ?? li.description}
                          </td>
                          <td className="px-4 py-2 text-right">{formatCurrency(li.labor_amount)}</td>
                          <td className="px-4 py-2 text-right">{li.spread_amount ? formatCurrency(li.spread_amount) : '—'}</td>
                          <td className="px-4 py-2 text-right">{li.expense_amount ? formatCurrency(li.expense_amount) : '—'}</td>
                          <td className="px-4 py-2 text-right text-[var(--muted)]">{formatCurrency(li.mgmt_fee_amount)}</td>
                          <td className="px-4 py-2 text-right font-semibold">{formatCurrency(li.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
