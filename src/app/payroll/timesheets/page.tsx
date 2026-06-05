'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { AlertTriangle, Clock, Lock, CheckCircle2 } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { useProperties } from '@/hooks/payroll/useProperties'
import { usePortfolios } from '@/hooks/payroll/usePortfolios'
import { useTimesheetAdjustments } from '@/hooks/payroll/useTimesheetAdjustments'
import { PageHeader, FormSelect, FormField } from '@/components/form'
import { EmployeeSwitcher } from './components/EmployeeSwitcher'
import { WeekGrid } from './components/WeekGrid'
import type { SelectedCell } from './components/WeekGrid'
import { InlineDrawer } from './components/InlineDrawer'
import { ManualAddPanel } from './components/ManualAddPanel'
import { CarryForwardPanel } from './components/CarryForwardPanel'
import { AdjustmentLog } from './components/AdjustmentLog'
import { CommandBar } from '@/components/payroll/CommandBar'
import type { PayrollEmployee, PayrollTimeEntry } from '@/lib/supabase/types'

export default function TimesheetsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--muted)]">Loading timesheets…</div>}>
      <TimesheetsPageContent />
    </Suspense>
  )
}

function TimesheetsPageContent() {
  const { weeks } = usePayrollWeeks()
  const searchParams = useSearchParams()
  const [selectedWeekId, setSelectedWeekId] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)

  useEffect(() => {
    const w = searchParams.get('week')
    if (w) setSelectedWeekId(w)
  }, [searchParams])

  const {
    allEntries, unallocatedEntries, pendingEntries, corrections,
    loading, reassign, addEntry, spread, removeEntry, setPending,
    resolvePending, addCarryForward, refetch,
  } = useTimesheetAdjustments(selectedWeekId || null)

  const { employees } = usePayrollEmployees(false)
  const { properties } = useProperties(true)
  const { portfolios, allProperties } = usePortfolios()

  const activeWeeks = weeks.filter(w => !['statement_sent'].includes(w.status))
  const approvedWeeks = weeks.filter(w => ['payroll_approved', 'invoiced', 'statement_sent'].includes(w.status))
  const selectedWeek = weeks.find(w => w.id === selectedWeekId)
  const isLocked = !!selectedWeek && ['payroll_approved', 'invoiced', 'statement_sent'].includes(selectedWeek.status)

  // Reset employee/cell on week change
  useEffect(() => {
    setSelectedEmployeeId(null)
    setSelectedCell(null)
  }, [selectedWeekId])

  // Reset cell on employee change
  useEffect(() => {
    setSelectedCell(null)
  }, [selectedEmployeeId])

  // Auto-select first employee once entries load
  useEffect(() => {
    if (!selectedEmployeeId && employees.length > 0 && selectedWeekId) {
      setSelectedEmployeeId(employees[0].id)
    }
  }, [employees, selectedWeekId, selectedEmployeeId])

  // Entries for the selected employee
  const employeeEntries = useMemo(() =>
    allEntries.filter(e => e.employee_id === selectedEmployeeId),
    [allEntries, selectedEmployeeId]
  )

  const manualEntries = useMemo(() =>
    allEntries.filter(e => e.source === 'manual_manager' || e.source === 'manual_spread'),
    [allEntries]
  )

  // Per-employee stats for header
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) as PayrollEmployee | undefined
  const empUnresolved = employeeEntries.filter(e => !e.property_id && !e.pending_resolution)
  const empPending = employeeEntries.filter(e => e.pending_resolution)
  const empTotalHours = employeeEntries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)
  const empPendingHours = empPending.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)

  // Week-wide summary
  const totalUnallocated = unallocatedEntries.length
  const totalPending = pendingEntries.length
  const affectedEmployees = new Set(unallocatedEntries.map(e => e.employee_id)).size

  const handleCellClick = (cell: SelectedCell) => {
    if (isLocked) return
    if (
      selectedCell?.rowPropertyId === cell.rowPropertyId &&
      selectedCell?.dayIndex === cell.dayIndex
    ) {
      setSelectedCell(null)
    } else {
      setSelectedCell(cell)
    }
  }

  const handleDone = () => setSelectedCell(null)

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        title="Timesheet Adjustments"
        subtitle="Resolve unallocated hours, add missing entries, manage carry-forwards"
      />

      {/* Week selector */}
      <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-section)] flex items-center gap-4">
        <div className="w-64">
          <FormField label="">
            <FormSelect value={selectedWeekId} onChange={e => setSelectedWeekId(e.target.value)}>
              <option value="">— Select payroll week —</option>
              {activeWeeks.map(w => (
                <option key={w.id} value={w.id}>
                  Week of {format(new Date(w.week_start + 'T00:00:00'), 'MMM d, yyyy')}
                </option>
              ))}
            </FormSelect>
          </FormField>
        </div>

        {selectedWeekId && !loading && (
          <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
            {totalUnallocated > 0 && (
              <span className="flex items-center gap-1.5 text-[var(--warning)] font-medium">
                <AlertTriangle size={13} />
                {affectedEmployees} employee{affectedEmployees !== 1 ? 's' : ''} · {totalUnallocated} unresolved block{totalUnallocated !== 1 ? 's' : ''}
              </span>
            )}
            {totalPending > 0 && (
              <span className="flex items-center gap-1.5 text-blue-600">
                <Clock size={13} />
                {totalPending} pending
              </span>
            )}
            {totalUnallocated === 0 && totalPending === 0 && (
              <span className="flex items-center gap-1.5 text-[var(--success)]">
                <CheckCircle2 size={13} />
                All clear
              </span>
            )}
            {isLocked && (
              <span className="flex items-center gap-1.5 text-[var(--error)]">
                <Lock size={13} />
                Locked
              </span>
            )}
          </div>
        )}
      </div>

      {!selectedWeekId ? (
        <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
          Select a payroll week to begin
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
          Loading…
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Employee switcher */}
          <EmployeeSwitcher
            employees={employees}
            allEntries={allEntries}
            selectedId={selectedEmployeeId}
            onChange={setSelectedEmployeeId}
          />

          {/* Main content */}
          <div className="flex-1 overflow-auto">
            {!selectedEmployeeId ? (
              <div className="flex items-center justify-center h-40 text-[var(--muted)] text-sm">
                Select an employee
              </div>
            ) : (
              <div>
                {/* Employee header */}
                <div className="px-6 py-4 border-b border-[var(--border)]">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-serif text-xl text-[var(--primary)]">
                      {selectedEmployee?.name ?? '—'}
                      <span className="ml-3 font-sans text-sm font-normal text-[var(--muted)]">
                        — Week of {format(new Date(selectedWeek!.week_start + 'T00:00:00'), 'MMMM d, yyyy')}
                      </span>
                    </h2>
                    {isLocked && (
                      <span className="flex items-center gap-1 text-xs text-[var(--error)] border border-[var(--error)]/30 px-2 py-1">
                        <Lock size={11} /> Locked — read only
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-[var(--muted)]">
                    <span>
                      <span className="font-medium text-[var(--ink)]">{empTotalHours.toFixed(empTotalHours % 1 === 0 ? 0 : 2)}</span> hrs total
                    </span>
                    {empUnresolved.length > 0 && (
                      <span className="text-[var(--warning)] font-medium flex items-center gap-1">
                        <AlertTriangle size={13} />
                        {empUnresolved.length} unresolved block{empUnresolved.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {empPending.length > 0 && (
                      <span className="text-blue-600 flex items-center gap-1">
                        <Clock size={13} />
                        {empPendingHours.toFixed(1)} hrs pending
                      </span>
                    )}
                    {empUnresolved.length === 0 && empPending.length === 0 && (
                      <span className="text-[var(--success)] flex items-center gap-1">
                        <CheckCircle2 size={13} /> Clean
                      </span>
                    )}
                  </div>
                </div>

                {/* Week grid */}
                <div className="border-b border-[var(--border)]">
                  {employeeEntries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
                      <CheckCircle2 size={28} className="mb-2 opacity-40" />
                      <p className="text-sm">No entries this week for {selectedEmployee?.name}</p>
                    </div>
                  ) : (
                    <WeekGrid
                      entries={employeeEntries}
                      weekStart={selectedWeek!.week_start}
                      selectedCell={selectedCell}
                      onCellClick={handleCellClick}
                      drawerRowPropertyId={selectedCell ? selectedCell.rowPropertyId : undefined}
                      renderDrawer={() =>
                        selectedCell ? (
                          <InlineDrawer
                            cell={selectedCell}
                            properties={properties}
                            portfolios={portfolios}
                            allProperties={allProperties}
                            isLocked={isLocked}
                            onClose={() => setSelectedCell(null)}
                            reassign={reassign}
                            spread={spread}
                            removeEntry={removeEntry}
                            setPending={setPending}
                            resolvePending={resolvePending}
                            onDone={handleDone}
                          />
                        ) : null
                      }
                    />
                  )}
                </div>

                {/* Panels */}
                {!isLocked && (
                  <div className="p-6 space-y-4">
                    <CommandBar onExecuted={refetch} />
                    <ManualAddPanel
                      employees={employees}
                      properties={properties}
                      portfolios={portfolios}
                      allProperties={allProperties}
                      selectedWeek={selectedWeek}
                      addEntry={addEntry}
                      spread={spread}
                    />
                    <CarryForwardPanel
                      employees={employees}
                      approvedWeeks={approvedWeeks}
                      properties={properties}
                      addCarryForward={addCarryForward}
                    />
                    <AdjustmentLog
                      corrections={corrections}
                      manualEntries={manualEntries as PayrollTimeEntry[]}
                      employees={employees}
                    />
                  </div>
                )}

                {isLocked && (
                  <div className="p-6">
                    <AdjustmentLog
                      corrections={corrections}
                      manualEntries={manualEntries as PayrollTimeEntry[]}
                      employees={employees}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
