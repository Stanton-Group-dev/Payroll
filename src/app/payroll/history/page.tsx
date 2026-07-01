'use client'

import { useState, useCallback } from 'react'
import { Download, Lock, ChevronDown, ChevronRight, Search, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { useEmployeePayHistory } from '@/hooks/payroll/usePayrollHistory'
import { PageHeader, FormButton, FormField, FormInput, FormSelect, StatusBadge } from '@/components/form'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/supabase/fetchAll'
import { formatCurrency } from '@/lib/payroll/calculations'
import { format } from 'date-fns'

type TabMode = 'weeks' | 'employee'

export default function HistoryPage() {
  const { weeks, loading } = usePayrollWeeks()
  const { employees } = usePayrollEmployees(false)
  const [tab, setTab] = useState<TabMode>('weeks')

  // Week history state
  const [expanded, setExpanded] = useState<string | null>(null)
  const [weekDataMap, setWeekDataMap] = useState<Record<string, { invoices: unknown[]; totalAmount: number }>>({})
  const [exporting, setExporting] = useState<string | null>(null)

  // Employee pay history state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [fromWeek, setFromWeek] = useState('')
  const [toWeek, setToWeek] = useState('')
  const [empSearched, setEmpSearched] = useState(false)
  const { rows: empRows, loading: empLoading, search: runEmpSearch } = useEmployeePayHistory()

  const approvedWeeks = weeks.filter(w => w.status === 'statement_sent')

  const toggleExpand = async (weekId: string) => {
    if (expanded === weekId) { setExpanded(null); return }
    setExpanded(weekId)
    if (weekDataMap[weekId]) return
    const supabase = createClient()
    const { data: invoices } = await supabase
      .from('payroll_invoices')
      .select('*')
      .eq('payroll_week_id', weekId)
      .order('owner_llc')
    const totalAmount = (invoices ?? []).reduce((s: number, inv: { total_amount: number }) => s + Number(inv.total_amount), 0)
    setWeekDataMap(prev => ({ ...prev, [weekId]: { invoices: invoices ?? [], totalAmount } }))
  }

  const exportWeek = async (weekId: string, weekStart: string) => {
    setExporting(weekId)
    const supabase = createClient()
    const [empRes, entRes, adjRes] = await Promise.all([
      supabase.from('payroll_employees').select('*'),
      // A week's entries exceed the 1,000-row select cap (spread legs) — drain in pages.
      fetchAllRows((from, to) => supabase.from('payroll_time_entries')
        .select('*, property:properties(code, name)')
        .eq('payroll_week_id', weekId)
        .order('id')
        .range(from, to)),
      supabase.from('payroll_adjustments').select('*, employee:payroll_employees(name)').eq('payroll_week_id', weekId),
    ])
    const lines: string[] = []
    lines.push(`Stanton Management — Payroll Export — Week of ${weekStart}`)
    lines.push('')
    lines.push('TIME ENTRIES')
    lines.push('"Employee","Date","Property","Regular Hrs","OT Hrs","PTO Hrs","Source","Flagged"')
    const empMap: Record<string, string> = {}
    for (const e of (empRes.data ?? [])) empMap[e.id] = e.name
    for (const entry of (entRes.data ?? [])) {
      const prop = entry.property as { code: string; name: string } | null
      lines.push([
        `"${empMap[entry.employee_id] ?? entry.employee_id}"`,
        `"${entry.entry_date}"`,
        `"${prop ? `${prop.code} — ${prop.name}` : 'N/A'}"`,
        entry.regular_hours, entry.ot_hours, entry.pto_hours,
        `"${entry.source}"`, entry.is_flagged ? 'Yes' : 'No',
      ].join(','))
    }
    lines.push('')
    lines.push('ADJUSTMENTS')
    lines.push('"Employee","Type","Amount","Description"')
    for (const adj of (adjRes.data ?? [])) {
      const empName = (adj.employee as { name: string } | null)?.name ?? adj.employee_id
      lines.push([`"${empName}"`, `"${adj.type}"`, adj.amount, `"${adj.description}"`].join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Payroll_${weekStart}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(null)
  }

  const exportWeekExcel = async (weekId: string, weekStart: string, weekEnd: string) => {
    setExporting(weekId + '-xlsx')
    const supabase = createClient()
    const [empRes, entRes, adjRes, invRes, costRes] = await Promise.all([
      supabase.from('payroll_employees').select('*'),
      fetchAllRows((from, to) => supabase.from('payroll_time_entries')
        .select('*, property:properties(code, name)')
        .eq('payroll_week_id', weekId)
        .order('id')
        .range(from, to)),
      supabase.from('payroll_adjustments')
        .select('*, employee:payroll_employees(name)')
        .eq('payroll_week_id', weekId),
      supabase.from('payroll_invoices')
        .select('*, line_items:payroll_invoice_line_items(*, property:properties(code, name))')
        .eq('payroll_week_id', weekId)
        .order('owner_llc'),
      supabase.from('payroll_weekly_property_costs')
        .select('*, property:properties(code, name, total_units)')
        .eq('payroll_week_id', weekId),
    ])

    const employees = empRes.data ?? []
    const entries = entRes.data ?? []
    const adjustments = adjRes.data ?? []
    const invoices = invRes.data ?? []
    const costs = costRes.data ?? []

    const empMap: Record<string, typeof employees[0]> = {}
    for (const e of employees) empMap[e.id] = e

    const wb = XLSX.utils.book_new()

    // ── Sheet 1: Summary ──────────────────────────────────────
    const totalGross = employees.reduce((s, e) => {
      const empEntries = entries.filter(en => en.employee_id === e.id && !en.is_flagged)
      const regWages = empEntries.reduce((es, en) => es + (en.regular_hours ?? 0) * (e.hourly_rate ?? 0), 0)
      const otWages = empEntries.reduce((es, en) => es + (en.ot_hours ?? 0) * (e.hourly_rate ?? 0), 0)
      const adjs = adjustments.filter(a => a.employee_id === e.id && a.type !== 'advance' && a.type !== 'deduction_other')
        .reduce((as, a) => as + Number(a.amount), 0)
      return s + regWages + otWages + adjs
    }, 0)
    const invoiceTotal = invoices.reduce((s, i) => s + Number(i.total_amount ?? 0), 0)

    const summaryData = [
      ['Stanton Management — Payroll Export'],
      [`Week of ${weekStart} – ${weekEnd}`],
      [],
      ['Metric', 'Value'],
      ['Total Gross Pay', totalGross],
      ['Total Invoice Amount', invoiceTotal],
      ['Employees with Hours', new Set(entries.map(e => e.employee_id)).size],
      ['Time Entries', entries.length],
      ['Adjustments', adjustments.length],
      ['Invoices Generated', invoices.length],
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

    // ── Sheet 2: Time Entries ─────────────────────────────────
    const entryRows = entries.map(en => {
      const emp = empMap[en.employee_id]
      const prop = en.property as { code: string; name: string } | null
      return {
        Employee: emp?.name ?? en.employee_id,
        Date: en.entry_date,
        Property: prop ? `${prop.code} — ${prop.name}` : 'N/A',
        'Regular Hrs': en.regular_hours ?? 0,
        'OT Hrs': en.ot_hours ?? 0,
        'PTO Hrs': en.pto_hours ?? 0,
        Source: en.source,
        Flagged: en.is_flagged ? 'Yes' : 'No',
      }
    })
    const wsEntries = XLSX.utils.json_to_sheet(entryRows)
    wsEntries['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 32 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }]
    XLSX.utils.book_append_sheet(wb, wsEntries, 'Time Entries')

    // ── Sheet 3: Adjustments ──────────────────────────────────
    const adjRows = adjustments.map(a => {
      const empName = (a.employee as { name: string } | null)?.name ?? a.employee_id
      return {
        Employee: empName,
        Type: a.type,
        Amount: Number(a.amount),
        Description: a.description,
        'Allocation Method': a.allocation_method,
      }
    })
    const wsAdj = XLSX.utils.json_to_sheet(adjRows.length > 0 ? adjRows : [{ Employee: 'No adjustments this week', Type: '', Amount: '', Description: '', 'Allocation Method': '' }])
    wsAdj['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 36 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, wsAdj, 'Adjustments')

    // ── Sheet 4: Invoice Breakdown ────────────────────────────
    const invRows: Record<string, unknown>[] = []
    for (const inv of invoices) {
      const lineItems = (inv.line_items ?? []) as Array<{
        property: { code: string; name: string } | null
        labor_amount: number
        spread_amount: number
        mgmt_fee_amount: number
        total_amount: number
      }>
      if (lineItems.length === 0) {
        invRows.push({
          LLC: inv.owner_llc,
          Property: '—',
          'Labor ($)': '',
          'Spread ($)': '',
          'Mgmt Fee ($)': '',
          'Total ($)': Number(inv.total_amount ?? 0),
          Status: inv.status,
        })
      } else {
        for (const li of lineItems) {
          const prop = li.property
          invRows.push({
            LLC: inv.owner_llc,
            Property: prop ? `${prop.code} — ${prop.name}` : '—',
            'Labor ($)': Number(li.labor_amount ?? 0),
            'Spread ($)': Number(li.spread_amount ?? 0),
            'Mgmt Fee ($)': Number(li.mgmt_fee_amount ?? 0),
            'Total ($)': Number(li.total_amount ?? 0),
            Status: inv.status,
          })
        }
      }
    }
    const wsInv = XLSX.utils.json_to_sheet(invRows.length > 0 ? invRows : [{ LLC: 'No invoices this week', Property: '', 'Labor ($)': '', 'Spread ($)': '', 'Mgmt Fee ($)': '', 'Total ($)': '', Status: '' }])
    wsInv['!cols'] = [{ wch: 32 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, wsInv, 'Invoice Breakdown')

    // ── Sheet 5: Property Costs ───────────────────────────────
    const costRows = costs.map(c => {
      const prop = c.property as { code: string; name: string; total_units: number } | null
      return {
        Code: prop?.code ?? '—',
        Property: prop?.name ?? '—',
        Units: prop?.total_units ?? '—',
        'Labor Cost ($)': Number(c.labor_cost ?? 0),
        'Spread Cost ($)': Number(c.spread_cost ?? 0),
        'Total Cost ($)': Number(c.total_cost ?? 0),
        '$/Unit': Number(c.cost_per_unit ?? 0),
      }
    })
    const wsCosts = XLSX.utils.json_to_sheet(costRows.length > 0 ? costRows : [{ Code: 'No cost data', Property: '', Units: '', 'Labor Cost ($)': '', 'Spread Cost ($)': '', 'Total Cost ($)': '', '$/Unit': '' }])
    wsCosts['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, wsCosts, 'Property Costs')

    XLSX.writeFile(wb, `Payroll_${weekStart}.xlsx`)
    setExporting(null)
  }

  const runEmployeeSearch = useCallback(async () => {
    if (!selectedEmployeeId) return
    setEmpSearched(true)
    await runEmpSearch(selectedEmployeeId, fromWeek, toWeek)
  }, [selectedEmployeeId, fromWeek, toWeek, runEmpSearch])

  const exportEmpCSV = () => {
    const empName = employees.find(e => e.id === selectedEmployeeId)?.name ?? 'Employee'
    const headers = ['Week Start', 'Week End', 'Reg Hrs', 'OT Hrs', 'PTO Hrs', 'Adjustments', 'Advances', 'Gross Pay', 'Net Pay']
    const rows = empRows.map(r => [
      r.week_start, r.week_end,
      r.regular_hours, r.ot_hours, r.pto_hours,
      r.adjustments.toFixed(2), r.advances.toFixed(2),
      r.gross_pay.toFixed(2), r.net_pay.toFixed(2),
    ])
    const totals = [
      'TOTALS', '',
      empRows.reduce((s, r) => s + r.regular_hours, 0).toFixed(2),
      empRows.reduce((s, r) => s + r.ot_hours, 0).toFixed(2),
      empRows.reduce((s, r) => s + r.pto_hours, 0).toFixed(2),
      empRows.reduce((s, r) => s + r.adjustments, 0).toFixed(2),
      empRows.reduce((s, r) => s + r.advances, 0).toFixed(2),
      empRows.reduce((s, r) => s + r.gross_pay, 0).toFixed(2),
      empRows.reduce((s, r) => s + r.net_pay, 0).toFixed(2),
    ]
    const csv = [headers, ...rows, totals].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Pay_History_${empName.replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="History Store"
        subtitle="Immutable approved payroll weeks — all records are read-only after approval"
      />

      {/* Tab bar */}
      <div className="bg-white border-b border-[var(--divider)] px-6">
        <div className="flex items-center gap-1 -mb-px">
          {([
            { key: 'weeks', label: 'Week History' },
            { key: 'employee', label: 'Employee Pay History' },
          ] as { key: TabMode; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-3 text-sm border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'border-[var(--primary)] text-[var(--primary)] font-medium'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'weeks' ? (
          <div className="p-6">
            {loading ? (
              <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
            ) : approvedWeeks.length === 0 ? (
              <div className="text-center py-12 text-[var(--muted)] text-sm">
                <Lock size={32} className="mx-auto mb-3 opacity-30" />
                No completed payroll weeks yet.
              </div>
            ) : (
              <div className="space-y-2">
                {approvedWeeks.map(week => {
                  const isOpen = expanded === week.id
                  const data = weekDataMap[week.id]
                  return (
                    <div key={week.id} className="border border-[var(--border)] bg-white">
                      <div
                        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[var(--bg-section)] transition-colors"
                        onClick={() => toggleExpand(week.id)}
                      >
                        <div className="shrink-0 text-[var(--muted)]">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-[var(--ink)] text-sm">
                            Week of {format(new Date(week.week_start + 'T00:00:00'), 'MMMM d, yyyy')}
                          </p>
                          <p className="text-xs text-[var(--muted)] mt-0.5">
                            {format(new Date(week.week_start + 'T00:00:00'), 'MMM d')} – {format(new Date(week.week_end + 'T00:00:00'), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {data && (
                            <p className="font-serif text-base text-[var(--primary)]">
                              {formatCurrency(data.totalAmount)}
                            </p>
                          )}
                          <StatusBadge status={week.status} />
                          <FormButton
                            size="sm"
                            variant="secondary"
                            loading={exporting === week.id}
                            onClick={e => { e.stopPropagation(); exportWeek(week.id, week.week_start) }}
                          >
                            <Download size={12} className="mr-1" />
                            CSV
                          </FormButton>
                          <FormButton
                            size="sm"
                            variant="secondary"
                            loading={exporting === week.id + '-xlsx'}
                            onClick={e => { e.stopPropagation(); exportWeekExcel(week.id, week.week_start, week.week_end) }}
                          >
                            <FileSpreadsheet size={12} className="mr-1" />
                            Excel
                          </FormButton>
                        </div>
                      </div>
                      {isOpen && data && (
                        <div className="border-t border-[var(--divider)] px-5 py-4">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-[var(--muted)] border-b border-[var(--divider)]">
                                <th className="pb-2 text-left font-medium">LLC</th>
                                <th className="pb-2 text-right font-medium">Invoice Total</th>
                                <th className="pb-2 text-right font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(data.invoices as Array<{ id: string; owner_llc: string; total_amount: number; status: string }>).map(inv => (
                                <tr key={inv.id} className="border-b border-[var(--divider)] last:border-0">
                                  <td className="py-2 text-[var(--ink)]">{inv.owner_llc}</td>
                                  <td className="py-2 text-right">{formatCurrency(Number(inv.total_amount))}</td>
                                  <td className="py-2 text-right"><StatusBadge status={inv.status} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
                            <Lock size={11} />
                            Approved records are read-only. No changes permitted.
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6">
            {/* Filters */}
            <div className="border border-[var(--border)] bg-white p-5 mb-6">
              <h3 className="font-serif text-base text-[var(--primary)] mb-4">Employee Pay History Query</h3>
              <div className="grid grid-cols-4 gap-4 items-end">
                <FormField label="Employee" required>
                  <FormSelect
                    value={selectedEmployeeId}
                    onChange={e => setSelectedEmployeeId(e.target.value)}
                  >
                    <option value="">— Select employee —</option>
                    {[...employees].sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </FormSelect>
                </FormField>
                <FormField label="From Week (start date)" helperText="Leave blank for all-time">
                  <FormInput
                    type="date"
                    value={fromWeek}
                    onChange={e => setFromWeek(e.target.value)}
                  />
                </FormField>
                <FormField label="To Week (start date)" helperText="Leave blank for all-time">
                  <FormInput
                    type="date"
                    value={toWeek}
                    onChange={e => setToWeek(e.target.value)}
                  />
                </FormField>
                <div className="flex gap-2">
                  <FormButton onClick={runEmployeeSearch} loading={empLoading} disabled={!selectedEmployeeId}>
                    <Search size={14} className="mr-1" />
                    Search
                  </FormButton>
                  {empRows.length > 0 && (
                    <FormButton variant="secondary" onClick={exportEmpCSV}>
                      <Download size={14} className="mr-1" />
                      CSV
                    </FormButton>
                  )}
                </div>
              </div>
            </div>

            {empLoading ? (
              <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
            ) : empSearched && empRows.length === 0 ? (
              <div className="text-center py-12 text-[var(--muted)] text-sm">
                No pay records found for this employee in the selected period.
              </div>
            ) : empRows.length > 0 ? (
              <div className="border border-[var(--border)] overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--primary)] text-white text-xs">
                      <th className="px-4 py-2.5 text-left font-medium">Week</th>
                      <th className="px-4 py-2.5 text-right font-medium">Reg Hrs</th>
                      <th className="px-4 py-2.5 text-right font-medium">OT Hrs</th>
                      <th className="px-4 py-2.5 text-right font-medium">PTO Hrs</th>
                      <th className="px-4 py-2.5 text-right font-medium">Adjustments</th>
                      <th className="px-4 py-2.5 text-right font-medium">Advances</th>
                      <th className="px-4 py-2.5 text-right font-medium font-bold">Gross Pay</th>
                      <th className="px-4 py-2.5 text-right font-medium font-bold">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empRows.map((row, i) => (
                      <tr key={row.week_id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                        <td className="px-4 py-2.5 font-medium">
                          {row.week_start
                            ? format(new Date(row.week_start + 'T00:00:00'), 'MMM d, yyyy')
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right">{row.regular_hours || '—'}</td>
                        <td className="px-4 py-2.5 text-right">{row.ot_hours || '—'}</td>
                        <td className="px-4 py-2.5 text-right">{row.pto_hours || '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          {row.adjustments ? formatCurrency(row.adjustments) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--error)]">
                          {row.advances ? `−${formatCurrency(row.advances)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {formatCurrency(row.gross_pay)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[var(--primary)]">
                          {formatCurrency(row.net_pay)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
                      <td className="px-4 py-2.5">
                        Totals — {empRows.length} week{empRows.length === 1 ? '' : 's'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {empRows.reduce((s, r) => s + r.regular_hours, 0).toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {empRows.reduce((s, r) => s + r.ot_hours, 0).toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {empRows.reduce((s, r) => s + r.pto_hours, 0).toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(empRows.reduce((s, r) => s + r.adjustments, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        −{formatCurrency(empRows.reduce((s, r) => s + r.advances, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(empRows.reduce((s, r) => s + r.gross_pay, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {formatCurrency(empRows.reduce((s, r) => s + r.net_pay, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="text-center py-16 text-[var(--muted)] text-sm">
                Select an employee and click Search to view pay history.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
