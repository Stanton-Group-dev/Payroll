'use client'

import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { PayrollEmployee, PayrollTimeEntry } from '@/lib/supabase/types'
import type { AdjustmentLogEntry } from '@/hooks/payroll/useTimesheetAdjustments'
import { FormSelect } from '@/components/form'

interface AdjustmentLogProps {
  corrections: AdjustmentLogEntry[]
  manualEntries: PayrollTimeEntry[]
  employees: PayrollEmployee[]
  defaultEmployeeId?: string
}

export function AdjustmentLog({ corrections, manualEntries, employees, defaultEmployeeId }: AdjustmentLogProps) {
  const [open, setOpen] = useState(false)
  const [filterEmployeeId, setFilterEmployeeId] = useState(defaultEmployeeId ?? '')
  const [filterOperation, setFilterOperation] = useState('')
  const [filterDate, setFilterDate] = useState('')

  // Re-target the log to the currently-viewed employee when it changes.
  useEffect(() => {
    setFilterEmployeeId(defaultEmployeeId ?? '')
  }, [defaultEmployeeId])

  const filteredCorrections = useMemo(() => {
    return corrections.filter(c => {
      if (filterOperation && c.operation !== filterOperation) return false
      if (filterEmployeeId) {
        const emp = (c.time_entry as unknown as { employee_id?: string } | null)?.employee_id
        if (emp !== filterEmployeeId) return false
      }
      if (filterDate) {
        const entryDate = (c.time_entry as unknown as { entry_date?: string } | null)?.entry_date
        if (entryDate !== filterDate) return false
      }
      return true
    })
  }, [corrections, filterEmployeeId, filterOperation, filterDate])

  const filteredManual = useMemo(() => {
    if (filterOperation && filterOperation !== 'add') return []
    return manualEntries.filter(e => {
      if (filterEmployeeId && e.employee_id !== filterEmployeeId) return false
      if (filterDate && e.entry_date !== filterDate) return false
      return true
    })
  }, [manualEntries, filterEmployeeId, filterOperation, filterDate])

  const total = corrections.length + manualEntries.length

  return (
    <div className="border border-[var(--border)]">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors duration-200">
        <div className="flex items-center gap-3">
          <span className="font-serif text-base text-[var(--primary)]">Adjustment Log</span>
          <span className="text-xs text-[var(--muted)]">{total} record{total !== 1 ? 's' : ''}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </button>

      {open && (
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <FormSelect value={filterEmployeeId} onChange={e => setFilterEmployeeId(e.target.value)} className="w-44 text-sm">
              <option value="">All employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </FormSelect>
            <FormSelect value={filterOperation} onChange={e => setFilterOperation(e.target.value)} className="w-36 text-sm">
              <option value="">All operations</option>
              <option value="reassign">Reassign</option>
              <option value="split">Split</option>
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </FormSelect>
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="px-2 py-1.5 text-sm border border-[var(--border)] bg-white focus:outline-none focus:border-[var(--primary)]"
            />
            {(filterEmployeeId || filterOperation || filterDate) && (
              <button type="button" onClick={() => { setFilterEmployeeId(''); setFilterOperation(''); setFilterDate('') }}
                className="text-xs text-[var(--muted)] hover:text-[var(--ink)] underline">
                Clear filters
              </button>
            )}
          </div>

          {filteredManual.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">Manually Added Entries</p>
              <table className="w-full text-sm border border-[var(--border)]">
                <thead>
                  <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="px-3 py-2 text-left font-medium">Employee</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-left font-medium">Property</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManual.map(e => {
                    const emp = e.employee as unknown as { name: string } | null
                    const prop = e.property as unknown as { code: string; name: string } | null
                    return (
                      <tr key={e.id} className="border-t border-[var(--divider)]">
                        <td className="px-3 py-2 text-sm font-semibold text-[var(--ink)] whitespace-nowrap">{emp?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-[var(--muted)]">{e.entry_date}</td>
                        <td className="px-3 py-2 text-right">{(e.regular_hours + e.ot_hours).toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{prop?.code ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-[var(--muted)]">{e.source}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filteredCorrections.length === 0 && filteredManual.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-6">No corrections recorded.</p>
          ) : filteredCorrections.length > 0 && (
            <table className="w-full text-sm border border-[var(--border)]">
              <thead>
                <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="px-3 py-2 text-left font-medium">Employee</th>
                  <th className="px-3 py-2 text-left font-medium">Operation</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Hours</th>
                  <th className="px-3 py-2 text-left font-medium">Destination</th>
                  <th className="px-3 py-2 text-left font-medium">Reason</th>
                  <th className="px-3 py-2 text-left font-medium">Adjusted by</th>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {filteredCorrections.map(c => {
                  const te = c.time_entry as unknown as { entry_date?: string; employee?: { name: string } | null } | null
                  const toProp = c.to_property as unknown as { code: string; name: string } | null
                  const corrector = c.corrector as unknown as { email: string; full_name: string | null } | null
                  const correctorLabel = corrector?.full_name ?? corrector?.email?.split('@')[0] ?? '—'
                  const opColor =
                    c.operation === 'remove' ? 'bg-[var(--error)]/10 text-[var(--error)]' :
                    c.operation === 'add'    ? 'bg-[var(--success)]/10 text-[var(--success)]' :
                                               'bg-[var(--primary)]/10 text-[var(--primary)]'
                  return (
                    <tr key={c.id} className="border-t border-[var(--divider)]">
                      <td className="px-3 py-2 text-sm font-semibold text-[var(--ink)] whitespace-nowrap">
                        {te?.employee?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 font-medium uppercase tracking-wide ${opColor}`}>
                          {c.operation ?? 'reassign'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">{te?.entry_date ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-sm">{Number(c.hours).toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs font-mono">
                        {toProp ? `${toProp.code} — ${toProp.name}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)] max-w-48 truncate">{c.reason}</td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">{correctorLabel}</td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">
                        {format(parseISO(c.corrected_at), 'MMM d, h:mma')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
