'use client'

import { useMemo, useState, use, type ReactNode } from 'react'
import { DollarSign, Lock } from 'lucide-react'
import { usePayrollWeekReview } from '@/hooks/payroll/usePayrollWeekReview'
import { PageHeader, FormButton, InfoBlock, StatusBadge } from '@/components/form'
import { calculatePayroll, resolveRateAsOf, formatCurrency, type EmployeePaySummary } from '@/lib/payroll/calculations'
import { PayrollComparisonPanel } from '@/components/payroll/PayrollComparisonPanel'
import { ManualReconcilePanel } from '@/components/payroll/ManualReconcilePanel'
import { UnallocatedHoldsPanel } from '@/components/payroll/UnallocatedHoldsPanel'

type EmpCol = {
  key: keyof EmployeePaySummary
  label: string
  align: 'left' | 'right'
  numeric: boolean
  /** bold the header (e.g. Gross Pay / Total Billable) */
  bold?: boolean
  tdClass?: string
  render: (e: EmployeePaySummary) => ReactNode
}

const EMP_COLS: EmpCol[] = [
  { key: 'employee_name', label: 'Employee', align: 'left', numeric: false, tdClass: 'font-medium', render: e => e.employee_name },
  { key: 'regular_hours', label: 'Reg Hrs', align: 'right', numeric: true, render: e => e.regular_hours || '—' },
  { key: 'ot_hours', label: 'OT Hrs', align: 'right', numeric: true, render: e => e.ot_hours || '—' },
  { key: 'regular_wages', label: 'Reg Wages', align: 'right', numeric: true, render: e => formatCurrency(e.regular_wages) },
  { key: 'ot_wages', label: 'OT Wages', align: 'right', numeric: true, render: e => (e.ot_wages ? formatCurrency(e.ot_wages) : '—') },
  { key: 'phone_reimbursement', label: 'Phone', align: 'right', numeric: true, render: e => (e.phone_reimbursement ? formatCurrency(e.phone_reimbursement) : '—') },
  { key: 'mileage_reimbursement', label: 'Mileage', align: 'right', numeric: true, render: e => (e.mileage_reimbursement ? formatCurrency(e.mileage_reimbursement) : '—') },
  { key: 'advances', label: 'Advances', align: 'right', numeric: true, tdClass: 'text-[var(--error)]', render: e => (e.advances ? `−${formatCurrency(e.advances)}` : '—') },
  { key: 'gross_pay', label: 'Gross Pay', align: 'right', numeric: true, bold: true, tdClass: 'font-semibold', render: e => formatCurrency(e.gross_pay) },
  { key: 'payroll_tax', label: 'Tax (8%)', align: 'right', numeric: true, tdClass: 'text-[var(--muted)]', render: e => (e.payroll_tax ? formatCurrency(e.payroll_tax) : '—') },
  { key: 'workers_comp', label: 'WC (3%)', align: 'right', numeric: true, tdClass: 'text-[var(--muted)]', render: e => (e.workers_comp ? formatCurrency(e.workers_comp) : '—') },
  { key: 'management_fee', label: 'Mgmt Fee', align: 'right', numeric: true, tdClass: 'text-[var(--muted)]', render: e => formatCurrency(e.management_fee) },
  { key: 'total_billable', label: 'Total Billable', align: 'right', numeric: true, bold: true, tdClass: 'font-semibold text-[var(--primary)]', render: e => formatCurrency(e.total_billable) },
]

export default function WeekReviewPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const {
    week, employees, entries, adjustments, feeConfigs, properties, employeeRates,
    mileageReimbursements, excludedPropertyIds,
    approved, pendingCount, loading, approving, approvePayroll, refetch,
  } = usePayrollWeekReview(weekId)

  const result = useMemo(() => {
    if (!employees.length) return null
    const weekStart = week?.week_start ?? new Date().toISOString().split('T')[0]
    const employeesWithHistoricalRates = employees.map(emp => ({
      ...emp,
      hourly_rate: resolveRateAsOf(emp.id, weekStart, employeeRates, emp.hourly_rate ?? 0),
    }))
    return calculatePayroll(employeesWithHistoricalRates, entries, adjustments, feeConfigs, properties, mileageReimbursements)
  }, [employees, employeeRates, week, entries, adjustments, feeConfigs, properties, mileageReimbursements])

  const [empSort, setEmpSort] = useState<{ key: keyof EmployeePaySummary; dir: 'asc' | 'desc' } | null>(null)
  const toggleEmpSort = (key: keyof EmployeePaySummary) =>
    setEmpSort(prev =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: EMP_COLS.find(c => c.key === key)?.numeric ? 'desc' : 'asc' })

  const empRows = useMemo(() => {
    const rows = (result?.employee_summaries ?? []).filter(e => e.gross_pay !== 0 || e.regular_hours > 0)
    if (!empSort) return rows
    const numeric = EMP_COLS.find(c => c.key === empSort.key)?.numeric ?? true
    const dir = empSort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = a[empSort.key], bv = b[empSort.key]
      return numeric ? dir * (Number(av) - Number(bv)) : dir * String(av).localeCompare(String(bv))
    })
  }, [result, empSort])

  // Property cost rows that carry a cost this week, split by whether they'll be billed.
  // Excluded properties (≤1 unit, or turned off in Invoicing settings) are dropped from
  // the summary so the review matches what invoice generation will actually produce.
  const billableCosts = useMemo(
    () => (result?.property_costs ?? []).filter(pc => pc.total_cost > 0),
    [result],
  )
  const includedCosts = useMemo(
    () => billableCosts
      .filter(pc => !excludedPropertyIds.has(pc.property_id))
      .sort((a, b) => b.total_cost - a.total_cost),
    [billableCosts, excludedPropertyIds],
  )
  const excludedCostCount = billableCosts.length - includedCosts.length

  const timesheetApproved = week?.status !== 'draft'
  const canApprovePayroll = timesheetApproved && !approved && result !== null && pendingCount === 0
  const hasPhoneReimbursements = adjustments.some(a => a.type === 'phone')
  const showAdjustmentReminder = timesheetApproved && !approved && !hasPhoneReimbursements

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title={`Payroll Review`}
        subtitle={week ? `Week of ${week.week_start} — ${week.week_end}` : ''}
        actions={<StatusBadge status={week?.status ?? 'draft'} />}
      />

      <div className="p-6 space-y-6">
        {!timesheetApproved && (
          <InfoBlock variant="warning" title="Timesheet Not Yet Approved">
            Resolve all flagged entries and approve the timesheet before payroll can be calculated.
            <div className="mt-1">
              <a href={`/payroll/timesheets?week=${weekId}`} className="underline">Go to Timesheet Adjustments →</a>
            </div>
          </InfoBlock>
        )}

        {timesheetApproved && pendingCount > 0 && !approved && (
          <InfoBlock variant="warning" title="Pending Entries Block Approval">
            {pendingCount} {pendingCount === 1 ? 'entry is' : 'entries are'} marked Pending and must be resolved or discarded before payroll can be approved.
            <div className="mt-1">
              <a href={`/payroll/timesheets?week=${weekId}`} className="underline">Go to Timesheet Adjustments →</a>
            </div>
          </InfoBlock>
        )}

        {showAdjustmentReminder && (
          <InfoBlock variant="warning" title="Check Adjustments Before Approving">
            No phone reimbursements found for this week. Have you seeded them?
            <div className="mt-1 flex gap-4">
              <a href={`/payroll/adjustments?week=${weekId}`} className="underline">Go to Adjustments →</a>
              <a href={`/payroll/splits?week=${weekId}`} className="underline">Go to Dept Splits →</a>
            </div>
          </InfoBlock>
        )}

        {approved && (
          <InfoBlock variant="success" title="Payroll Approved">
            This payroll week has been approved. Invoice generation is now unlocked.
            <div className="mt-2">
              <a href={`/payroll/${weekId}/invoices`} className="underline text-[var(--primary)]">
                Go to Invoice Generator →
              </a>
            </div>
          </InfoBlock>
        )}

        {timesheetApproved && !approved && (
          <UnallocatedHoldsPanel weekId={weekId} onChange={refetch} />
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

            {/* Week-over-week comparison */}
            <PayrollComparisonPanel weekId={weekId} />

            {/* Reconcile against the manual (Excel) payroll */}
            <ManualReconcilePanel result={result} />

            {/* Employee pay summary */}
            <div>
              <h3 className="font-serif text-base text-[var(--primary)] mb-3">Employee Pay Summary</h3>
              <div className="border border-[var(--border)] overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--primary)] text-white text-xs">
                      {EMP_COLS.map(col => (
                        <th
                          key={col.key}
                          onClick={() => toggleEmpSort(col.key)}
                          title="Click to sort"
                          className={`px-3 py-2.5 font-medium cursor-pointer select-none hover:bg-white/10 ${col.align === 'left' ? 'text-left' : 'text-right'} ${col.bold ? 'font-bold' : ''}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            <span className="w-2 text-white/60">{empSort?.key === col.key ? (empSort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {empRows.map((emp, i) => (
                      <tr key={emp.employee_id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                        {EMP_COLS.map(col => (
                          <td key={col.key} className={`px-3 py-2 ${col.align === 'left' ? '' : 'text-right'} ${col.tdClass ?? ''}`}>
                            {col.render(emp)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
                      <td className="px-3 py-2.5" colSpan={8}>Totals</td>
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
                      <th className="px-3 py-2.5 text-right font-medium">Mileage</th>
                      <th className="px-3 py-2.5 text-right font-medium">Mgmt Fee (10%)</th>
                      <th className="px-3 py-2.5 text-right font-medium font-bold">Total Cost</th>
                      <th className="px-3 py-2.5 text-right font-medium">$/Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {includedCosts.map((pc, i) => (
                      <tr key={pc.property_id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-[var(--muted)] mr-1">{pc.property_code}</span>
                          {pc.property_name}
                        </td>
                        <td className="px-3 py-2 text-right">{pc.total_units}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(pc.labor_cost)}</td>
                        <td className="px-3 py-2 text-right">{pc.spread_cost ? formatCurrency(pc.spread_cost) : '—'}</td>
                        <td className="px-3 py-2 text-right">{pc.mileage_cost ? formatCurrency(pc.mileage_cost) : '—'}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(pc.mgmt_fee)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(pc.total_cost)}</td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">{pc.cost_per_unit ? formatCurrency(pc.cost_per_unit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {excludedCostCount > 0 && (
                <p className="text-xs text-[var(--muted)] mt-2">
                  {excludedCostCount} {excludedCostCount === 1 ? 'property with cost is' : 'properties with cost are'} excluded from invoicing
                  (≤1 unit or turned off in{' '}
                  <a href="/payroll/admin/invoicing" className="underline hover:text-[var(--primary)]">Invoicing settings</a>)
                  and won&apos;t appear on invoices.
                </p>
              )}
            </div>

            {/* Approve */}
            {canApprovePayroll && (
              <div className="pt-4 border-t border-[var(--divider)]">
                <FormButton onClick={() => approvePayroll(result!)} loading={approving}>
                  <Lock size={14} className="mr-2" />
                  Approve Payroll &amp; Unlock Invoice Generation
                </FormButton>
                <p className="text-xs text-[var(--muted)] mt-2">
                  This locks the payroll calculation. Records cannot be edited after approval.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
