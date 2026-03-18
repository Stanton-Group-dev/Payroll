'use client'

import { useMemo } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { DollarSign, Lock, CheckSquare, Square, ChevronRight } from 'lucide-react'
import { usePayrollWeekReview } from '@/hooks/payroll/usePayrollWeekReview'
import { PageHeader, FormButton, InfoBlock, StatusBadge } from '@/components/form'
import { format } from 'date-fns'
import { calculatePayroll, resolveRateAsOf, formatCurrency } from '@/lib/payroll/calculations'

export default function WeekReviewPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const {
    week, employees, entries, adjustments, feeConfigs, properties, employeeRates,
    approved, pendingCount, flaggedCount, deptSplitsComplete, loading, approving, approvePayroll,
  } = usePayrollWeekReview(weekId)

  const result = useMemo(() => {
    if (!employees.length) return null
    const weekStart = week?.week_start ?? new Date().toISOString().split('T')[0]
    const employeesWithHistoricalRates = employees.map(emp => ({
      ...emp,
      hourly_rate: resolveRateAsOf(emp.id, weekStart, employeeRates, emp.hourly_rate ?? 0),
    }))
    return calculatePayroll(employeesWithHistoricalRates, entries, adjustments, feeConfigs, properties)
  }, [employees, employeeRates, week, entries, adjustments, feeConfigs, properties])

  const hasTimeCards = entries.length > 0
  const flagsResolved = flaggedCount === 0 && pendingCount === 0
  const hasPhoneReimbursements = adjustments.some(a => a.type === 'phone')
  const allChecked = hasTimeCards && flagsResolved && hasPhoneReimbursements && deptSplitsComplete
  const canApprovePayroll = allChecked && !approved && result !== null

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title={`Payroll Review`}
        subtitle={week ? `Week of ${week.week_start} — ${week.week_end}` : ''}
        actions={<StatusBadge status={week?.status ?? 'draft'} />}
      />

      <div className="p-6 space-y-6">
        {/* Week Status Board — always visible */}
        {!approved ? (
          <div className="border border-[var(--border)] bg-white p-5">
            <p className="text-xs text-[var(--muted)] uppercase tracking-widest font-medium mb-3">
              Before you can approve payroll
            </p>
            <div className="space-y-2">
              <ChecklistRow
                checked={hasTimeCards}
                label="Time cards imported"
                href={`/payroll/import`}
                linkLabel="Go to Import"
              />
              <ChecklistRow
                checked={flagsResolved}
                label="Flagged entries resolved"
                detail={!flagsResolved ? `${flaggedCount + pendingCount} unresolved` : undefined}
                href={`/payroll/timesheets?week=${weekId}`}
                linkLabel="Go to Timesheet Adjustments"
              />
              <ChecklistRow
                checked={hasPhoneReimbursements}
                label="Phone reimbursements seeded"
                href={`/payroll/adjustments?week=${weekId}`}
                linkLabel="Go to Adjustments"
              />
              <ChecklistRow
                checked={deptSplitsComplete}
                label="Dept splits confirmed"
                href={`/payroll/splits?week=${weekId}`}
                linkLabel="Go to Dept Splits"
              />
            </div>
            <div className="mt-5 pt-4 border-t border-[var(--divider)]">
              <FormButton
                onClick={() => result && approvePayroll(result)}
                loading={approving}
                disabled={!canApprovePayroll}
              >
                <Lock size={14} className="mr-2" />
                Approve Payroll &amp; Unlock Invoice Generation
              </FormButton>
              {!allChecked && (
                <p className="text-xs text-[var(--muted)] mt-2">
                  Complete all items above to unlock approval.
                </p>
              )}
              {allChecked && (
                <p className="text-xs text-[var(--muted)] mt-2">
                  This locks the payroll calculation. Records cannot be edited after approval.
                </p>
              )}
            </div>
          </div>
        ) : (
          <InfoBlock variant="success" title="Payroll Approved">
            This payroll week has been approved. Invoice generation is now unlocked.
            <div className="mt-2">
              <a href={`/payroll/${weekId}/invoices`} className="underline text-[var(--primary)]">
                Go to Invoice Generator →
              </a>
            </div>
          </InfoBlock>
        )}

        {result && (
          <>
            {/* Pre-fund estimate */}
            <div className="border-2 border-[var(--accent)] bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign size={18} className="text-[var(--accent)]" />
                <h2 className="font-serif text-lg text-[var(--primary)]">Required Pre-Fund Amount</h2>
              </div>
              <p className="text-4xl font-serif text-[var(--primary)] mb-2">
                {formatCurrency(result.required_prefund)}
              </p>
              <p className="text-xs text-[var(--muted)]">
                Gross Pay {formatCurrency(result.total_gross_pay)} + Payroll Tax {formatCurrency(result.total_payroll_tax)} + Workers&apos; Comp {formatCurrency(result.total_workers_comp)}
              </p>
              <p className="text-xs text-[var(--warning)] mt-2">
                ADP pulls from bank before LLC transfers arrive — fund this amount before submitting to ADP.
              </p>
            </div>

            {/* Employee pay summary */}
            <div>
              <h3 className="font-serif text-base text-[var(--primary)] mb-3">Employee Pay Summary</h3>
              <div className="border border-[var(--border)] overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--primary)] text-white text-xs">
                      <th className="px-3 py-2.5 text-left font-medium">Employee</th>
                      <th className="px-3 py-2.5 text-right font-medium">Reg Hrs</th>
                      <th className="px-3 py-2.5 text-right font-medium">OT Hrs</th>
                      <th className="px-3 py-2.5 text-right font-medium">Reg Wages</th>
                      <th className="px-3 py-2.5 text-right font-medium">OT Wages</th>
                      <th className="px-3 py-2.5 text-right font-medium">Phone</th>
                      <th className="px-3 py-2.5 text-right font-medium">Advances</th>
                      <th className="px-3 py-2.5 text-right font-medium font-bold">Gross Pay</th>
                      <th className="px-3 py-2.5 text-right font-medium">Tax (8%)</th>
                      <th className="px-3 py-2.5 text-right font-medium">WC (3%)</th>
                      <th className="px-3 py-2.5 text-right font-medium">Mgmt Fee</th>
                      <th className="px-3 py-2.5 text-right font-medium font-bold">Total Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.employee_summaries
                      .filter(e => e.gross_pay !== 0 || e.regular_hours > 0)
                      .map((emp, i) => (
                      <tr key={emp.employee_id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                        <td className="px-3 py-2 font-medium">{emp.employee_name}</td>
                        <td className="px-3 py-2 text-right">{emp.regular_hours || '—'}</td>
                        <td className="px-3 py-2 text-right">{emp.ot_hours || '—'}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(emp.regular_wages)}</td>
                        <td className="px-3 py-2 text-right">{emp.ot_wages ? formatCurrency(emp.ot_wages) : '—'}</td>
                        <td className="px-3 py-2 text-right">{emp.phone_reimbursement ? formatCurrency(emp.phone_reimbursement) : '—'}</td>
                        <td className="px-3 py-2 text-right text-[var(--error)]">{emp.advances ? `−${formatCurrency(emp.advances)}` : '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(emp.gross_pay)}</td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">{emp.payroll_tax ? formatCurrency(emp.payroll_tax) : '—'}</td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">{emp.workers_comp ? formatCurrency(emp.workers_comp) : '—'}</td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">{formatCurrency(emp.management_fee)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-[var(--primary)]">{formatCurrency(emp.total_billable)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
                      <td className="px-3 py-2.5" colSpan={7}>Totals</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(result.total_gross_pay)}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(result.total_payroll_tax)}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(result.total_workers_comp)}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(result.total_mgmt_fee)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {formatCurrency(result.total_gross_pay + result.total_payroll_tax + result.total_workers_comp + result.total_mgmt_fee)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Property cost summary */}
            <div>
              <h3 className="font-serif text-base text-[var(--primary)] mb-3">Property Cost Summary</h3>
              <div className="border border-[var(--border)] overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--primary)] text-white text-xs">
                      <th className="px-3 py-2.5 text-left font-medium">Property</th>
                      <th className="px-3 py-2.5 text-right font-medium">Units</th>
                      <th className="px-3 py-2.5 text-right font-medium">Labor</th>
                      <th className="px-3 py-2.5 text-right font-medium">Spread</th>
                      <th className="px-3 py-2.5 text-right font-medium">Mgmt Fee (10%)</th>
                      <th className="px-3 py-2.5 text-right font-medium font-bold">Total Cost</th>
                      <th className="px-3 py-2.5 text-right font-medium">$/Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.property_costs
                      .filter(pc => pc.total_cost > 0)
                      .sort((a, b) => b.total_cost - a.total_cost)
                      .map((pc, i) => (
                      <tr key={pc.property_id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-[var(--muted)] mr-1">{pc.property_code}</span>
                          {pc.property_name}
                        </td>
                        <td className="px-3 py-2 text-right">{pc.total_units}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(pc.labor_cost)}</td>
                        <td className="px-3 py-2 text-right">{pc.spread_cost ? formatCurrency(pc.spread_cost) : '—'}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(pc.mgmt_fee)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(pc.total_cost)}</td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">{pc.cost_per_unit ? formatCurrency(pc.cost_per_unit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  )
}

function ChecklistRow({
  checked,
  label,
  detail,
  href,
  linkLabel,
}: {
  checked: boolean
  label: string
  detail?: string
  href: string
  linkLabel: string
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {checked ? (
        <CheckSquare size={16} className="text-[var(--success)] shrink-0" />
      ) : (
        <Square size={16} className="text-[var(--muted)] shrink-0" />
      )}
      <span className={`text-sm flex-1 ${checked ? 'text-[var(--muted)] line-through' : 'text-[var(--ink)]'}`}>
        {label}
      </span>
      {detail && (
        <span className="text-xs text-[var(--warning)] font-medium">{detail}</span>
      )}
      {!checked && (
        <Link
          href={href}
          className="flex items-center gap-1 text-xs text-[var(--accent)] hover:text-[var(--primary)] transition-colors font-medium"
        >
          {linkLabel}
          <ChevronRight size={12} />
        </Link>
      )}
    </div>
  )
}
