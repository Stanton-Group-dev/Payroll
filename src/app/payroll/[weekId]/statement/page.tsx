'use client'

import { use } from 'react'
import { CheckCircle2, AlertTriangle, Lock, Info } from 'lucide-react'
import { usePayrollStatement } from '@/hooks/payroll/usePayrollStatement'
import { PageHeader, FormButton, InfoBlock, StatusBadge } from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'

type ErrorCheckStatus = 'pass' | 'pass_reimbursements' | 'fail' | 'no_recon'

export default function StatementPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const {
    week, invoices, adpRecon, reimbursementsTotal, approved, loading, approving, approveStatement,
  } = usePayrollStatement(weekId)

  const allApproved = invoices.length > 0 && invoices.every(inv => inv.status === 'approved' || inv.status === 'sent')
  const grandTotal = invoices.reduce((s, inv) => s + Number(inv.total_amount), 0)

  const errorCheckStatus: ErrorCheckStatus = (() => {
    if (!adpRecon) return 'no_recon'
    const v = Math.abs(adpRecon.variance)
    if (v < 0.01) return 'pass'
    if (Math.abs(v - reimbursementsTotal) < 0.01) return 'pass_reimbursements'
    return 'fail'
  })()

  const errorCheckOk = errorCheckStatus === 'pass' || errorCheckStatus === 'pass_reimbursements' || errorCheckStatus === 'no_recon'
  const canApprove = allApproved && !approved && errorCheckOk

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title="Statement Generator"
        subtitle={week ? `Consolidated statement — week of ${week.week_start}` : ''}
        actions={
          <div className="flex items-center gap-3">
            <a href={`/payroll/${weekId}/statement/print`} target="_blank" className="text-sm text-[var(--primary)] hover:underline">
              View / Print Statement →
            </a>
            <StatusBadge status={week?.status ?? 'draft'} />
          </div>
        }
      />

      <div className="p-6 max-w-3xl">
        {!allApproved && (
          <InfoBlock variant="warning" title="Invoices Not Yet Approved">
            All invoices must be approved before the statement can be generated.
            <div className="mt-1">
              <a href={`/payroll/${weekId}/invoices`} className="underline">Go to Invoices →</a>
            </div>
          </InfoBlock>
        )}

        {approved && (
          <InfoBlock variant="success" title="Statement Approved &amp; Sent">
            This statement has been approved. ADP export is now unlocked.
            <div className="mt-1">
              <a href={`/payroll/${weekId}/adp-export`} className="underline text-[var(--primary)]">Go to ADP Export →</a>
            </div>
          </InfoBlock>
        )}

        {invoices.length > 0 && (
          <>
            {/* Statement table */}
            <div className="border border-[var(--border)] mb-6">
              <div className="bg-[var(--primary)] text-white px-5 py-3">
                <h3 className="font-serif text-base">Weekly Statement — All LLCs</h3>
                <p className="text-xs text-white/60 mt-0.5">
                  {week?.week_start} through {week?.week_end}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                    <th className="px-5 py-2.5 text-left font-medium">LLC / Entity</th>
                    <th className="px-5 py-2.5 text-right font-medium">Invoice Total</th>
                    <th className="px-5 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => (
                    <tr key={inv.id} className={`border-t border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                      <td className="px-5 py-3 font-medium text-[var(--ink)]">{inv.owner_llc}</td>
                      <td className="px-5 py-3 text-right font-semibold">{formatCurrency(Number(inv.total_amount))}</td>
                      <td className="px-5 py-3 text-right">
                        <StatusBadge status={inv.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--primary)] bg-[var(--primary)]/5">
                    <td className="px-5 py-3.5 font-serif font-bold text-[var(--primary)]">Grand Total — Required ACH Transfer</td>
                    <td className="px-5 py-3.5 text-right font-serif text-xl font-bold text-[var(--primary)]">
                      {formatCurrency(grandTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ADP reconciliation summary */}
            {adpRecon && (
              <div className="border border-[var(--border)] mb-4 text-sm">
                <div className="px-4 py-2.5 bg-[var(--bg-section)] border-b border-[var(--divider)]">
                  <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">ADP Reconciliation</p>
                </div>
                <div className="grid grid-cols-3 divide-x divide-[var(--divider)]">
                  <div className="px-4 py-3">
                    <p className="text-xs text-[var(--muted)] mb-1">System Total</p>
                    <p className="font-semibold">{formatCurrency(adpRecon.system_gross_total)}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-[var(--muted)] mb-1">ADP Total</p>
                    <p className="font-semibold">{formatCurrency(adpRecon.adp_gross_total)}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-[var(--muted)] mb-1">Variance</p>
                    <p className={`font-semibold ${Math.abs(adpRecon.variance) > 0.01 ? 'text-[var(--warning)]' : 'text-[var(--success)]'}`}>
                      {adpRecon.variance === 0 ? '—' : formatCurrency(adpRecon.variance)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error check */}
            <div className={`flex items-start gap-3 p-4 border mb-6 ${
              errorCheckStatus === 'fail'
                ? 'border-[var(--error)]/40 bg-[var(--error)]/5'
                : errorCheckStatus === 'no_recon'
                ? 'border-[var(--warning)]/40 bg-[var(--warning)]/5'
                : 'border-[var(--success)]/30 bg-[var(--success)]/5'
            }`}>
              {errorCheckStatus === 'fail' ? (
                <AlertTriangle size={18} className="text-[var(--error)] shrink-0 mt-0.5" />
              ) : errorCheckStatus === 'no_recon' ? (
                <Info size={18} className="text-[var(--warning)] shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={18} className="text-[var(--success)] shrink-0 mt-0.5" />
              )}
              <div>
                <p className={`text-sm font-medium ${
                  errorCheckStatus === 'fail' ? 'text-[var(--error)]'
                  : errorCheckStatus === 'no_recon' ? 'text-[var(--warning)]'
                  : 'text-[var(--success)]'
                }`}>
                  {errorCheckStatus === 'pass' && 'Error check passed — zero variance'}
                  {errorCheckStatus === 'pass_reimbursements' && `Error check passed — variance of ${formatCurrency(Math.abs(adpRecon!.variance))} explained by reimbursements`}
                  {errorCheckStatus === 'no_recon' && 'No ADP reconciliation on file — statement can proceed but reconciliation is recommended'}
                  {errorCheckStatus === 'fail' && `Non-zero variance of ${formatCurrency(Math.abs(adpRecon!.variance))} not explained by reimbursements (${formatCurrency(reimbursementsTotal)}) — investigation required`}
                </p>
                {errorCheckStatus === 'fail' && (
                  <p className="text-xs text-[var(--error)] mt-1">
                    Complete ADP reconciliation before approving the statement.{' '}
                    <a href={`/payroll/${weekId}/adp-reconciliation`} className="underline">Go to ADP Reconciliation →</a>
                  </p>
                )}
              </div>
            </div>

            {canApprove && (
              <FormButton onClick={() => approveStatement(invoices.map(inv => inv.id))} loading={approving}>
                <Lock size={14} className="mr-2" />
                Approve Statement &amp; Unlock ADP Export
              </FormButton>
            )}

            {allApproved && !approved && !errorCheckOk && (
              <p className="text-sm text-[var(--error)]">
                Statement approval is blocked until the ADP variance is resolved.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
