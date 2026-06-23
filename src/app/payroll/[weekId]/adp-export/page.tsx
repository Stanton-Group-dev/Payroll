'use client'

import { useState, useEffect } from 'react'
import { use } from 'react'
import { Download, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, FormButton, InfoBlock } from '@/components/form'
import { calculatePayroll, resolveRateAsOf, formatCurrency } from '@/lib/payroll/calculations'
import {
  curatedToProperty,
  CURATED_PROPERTY_COLUMNS,
  type CuratedPropertyRow,
} from '@/lib/payroll/properties'
import type { PayrollWeek } from '@/lib/supabase/types'

interface ADPRow {
  employee_name: string
  // Raw hours as reported by the engine — ADP applies the 1.5x OT premium itself.
  // Do NOT inflate OT hours by 1.5x here.
  regular_hours: number
  ot_hours: number
  pto_hours: number
  gross_pay: number
  adjustments: number
  advances: number
  net_pay: number
}

export default function ADPExportPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = use(params)
  const [week, setWeek] = useState<PayrollWeek | null>(null)
  const [rows, setRows] = useState<ADPRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statementApproved, setStatementApproved] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const supabase = createClient()
      const [weekRes, empRes, entRes, adjRes, approvalRes, feeRes, propRes, ratesRes, mileageRes] = await Promise.all([
        supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
        supabase.from('payroll_employees').select('*').eq('is_active', true),
        supabase.from('payroll_time_entries').select('*').eq('payroll_week_id', weekId).eq('is_flagged', false),
        supabase.from('payroll_adjustments').select('*').eq('payroll_week_id', weekId),
        supabase.from('payroll_approvals').select('*').eq('payroll_week_id', weekId).eq('stage', 'statement'),
        supabase.from('payroll_management_fee_config').select('*').order('effective_date', { ascending: false }),
        supabase.from('payroll_property').select(CURATED_PROPERTY_COLUMNS).eq('is_active', true),
        supabase.from('payroll_employee_rates').select('*'),
        supabase.from('payroll_mileage_reimbursements').select('*').eq('payroll_week_id', weekId),
      ])
      setWeek(weekRes.data)
      setStatementApproved((approvalRes.data?.length ?? 0) > 0)

      const weekStart = weekRes.data?.week_start as string
      const employeeRates = ratesRes.data ?? []

      // Pre-resolve effective-dated rates for each employee, exactly as the review hook does.
      const employees = (empRes.data ?? []).map(e => ({
        ...e,
        hourly_rate: resolveRateAsOf(e.id, weekStart, employeeRates, e.hourly_rate ?? 0),
      }))

      const properties = (propRes.data ?? []).map(r => curatedToProperty(r as unknown as CuratedPropertyRow))

      // Delegate all gross/hours computation to the single engine.
      const result = calculatePayroll(
        employees,
        entRes.data ?? [],
        adjRes.data ?? [],
        feeRes.data ?? [],
        properties,
        mileageRes.data ?? [],
        {},         // no dept splits needed for export
        weekStart,
      )

      // Build a lookup of per-employee adjustments and advances for display columns.
      const adjByEmp: Record<string, { adjustments: number; advances: number }> = {}
      for (const adj of (adjRes.data ?? [])) {
        if (!adjByEmp[adj.employee_id]) adjByEmp[adj.employee_id] = { adjustments: 0, advances: 0 }
        if (adj.type === 'advance' || adj.type === 'deduction_other') {
          adjByEmp[adj.employee_id].advances += Math.abs(adj.amount)
        } else {
          adjByEmp[adj.employee_id].adjustments += adj.amount
        }
      }

      // Map engine summaries to ADP rows.
      // CRITICAL: use engine's raw regular_hours / ot_hours — ADP applies the 1.5x
      // premium itself, so we must not feed premium-inflated wages as hours here.
      const adpRows: ADPRow[] = result.employee_summaries
        .filter(s => s.gross_pay > 0 || s.regular_hours > 0)
        .map(s => {
          const adj = adjByEmp[s.employee_id] ?? { adjustments: 0, advances: 0 }
          return {
            employee_name: s.employee_name,
            regular_hours: s.regular_hours,
            ot_hours: s.ot_hours,
            pto_hours: s.pto_hours,
            gross_pay: s.gross_pay,
            adjustments: adj.adjustments,
            advances: adj.advances,
            net_pay: Math.round((s.gross_pay - adj.advances) * 100) / 100,
          }
        })

      setRows(adpRows)
      setLoading(false)
    }
    load()
  }, [weekId])

  const exportCSV = () => {
    const headers = ['Employee Name', 'Regular Hours', 'OT Hours', 'PTO Hours', 'Adjustments', 'Advances', 'Gross Pay', 'Net Pay']
    const csvRows = rows.map(r => [
      r.employee_name,
      r.regular_hours,
      r.ot_hours,
      r.pto_hours,
      r.adjustments.toFixed(2),
      r.advances.toFixed(2),
      r.gross_pay.toFixed(2),
      r.net_pay.toFixed(2),
    ])
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ADP_Export_${week?.week_start ?? 'week'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title="ADP Export"
        subtitle={week ? `Gross pay summary for ADP submission — week of ${week.week_start}` : ''}
        actions={
          statementApproved && rows.length > 0 ? (
            <FormButton size="sm" onClick={exportCSV}>
              <Download size={14} className="mr-1" />
              Download CSV for ADP
            </FormButton>
          ) : undefined
        }
      />

      <div className="p-6">
        {!statementApproved && (
          <InfoBlock variant="warning" title="Statement Not Yet Approved">
            The weekly statement must be approved before ADP export is available.
            <div className="mt-1">
              <a href={`/payroll/${weekId}/statement`} className="underline">Go to Statement →</a>
            </div>
          </InfoBlock>
        )}

        {statementApproved && rows.length > 0 && (
          <>
            <InfoBlock variant="default" title="Ready for ADP Submission">
              Download this file and submit to ADP via Kathleen. After ADP runs, upload the ADP report in the Reconciliation tab to auto-reconcile.
            </InfoBlock>

            <div className="mt-5 border border-[var(--border)] overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--primary)] text-white text-xs">
                    <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                    <th className="px-4 py-2.5 text-right font-medium">Reg Hrs</th>
                    <th className="px-4 py-2.5 text-right font-medium">OT Hrs</th>
                    <th className="px-4 py-2.5 text-right font-medium">PTO Hrs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Adjustments</th>
                    <th className="px-4 py-2.5 text-right font-medium">Advances</th>
                    <th className="px-4 py-2.5 text-right font-medium font-bold">Gross Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.employee_name} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                      <td className="px-4 py-2 font-medium">{row.employee_name}</td>
                      <td className="px-4 py-2 text-right">{row.regular_hours || '—'}</td>
                      <td className="px-4 py-2 text-right">{row.ot_hours || '—'}</td>
                      <td className="px-4 py-2 text-right">{row.pto_hours || '—'}</td>
                      <td className="px-4 py-2 text-right">{row.adjustments ? formatCurrency(row.adjustments) : '—'}</td>
                      <td className="px-4 py-2 text-right text-[var(--error)]">{row.advances ? `−${formatCurrency(row.advances)}` : '—'}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCurrency(row.gross_pay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
                    <td className="px-4 py-2.5" colSpan={6}>Total Gross Pay</td>
                    <td className="px-4 py-2.5 text-right">{formatCurrency(rows.reduce((s, r) => s + r.gross_pay, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
