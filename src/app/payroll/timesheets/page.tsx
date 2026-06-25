'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { AlertTriangle, Clock, Lock, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { useProperties } from '@/hooks/payroll/useProperties'
import { usePortfolios } from '@/hooks/payroll/usePortfolios'
import { useTimesheetAdjustments } from '@/hooks/payroll/useTimesheetAdjustments'
import { useWorkyardReconciliation } from '@/hooks/payroll/useWorkyardReconciliation'
import { useAccountedRemovedHours } from '@/hooks/payroll/useAccountedRemovedHours'
import { PageHeader, FormSelect, FormField, FormButton } from '@/components/form'
import { EmployeeSwitcher } from './components/EmployeeSwitcher'
import { WeekGrid } from './components/WeekGrid'
import type { SelectedCell } from './components/WeekGrid'
import { InlineDrawer } from './components/InlineDrawer'
import { ManualAddPanel } from './components/ManualAddPanel'
import { CarryForwardPanel } from './components/CarryForwardPanel'
import { AdjustmentLog } from './components/AdjustmentLog'
import { CommandBar } from '@/components/payroll/CommandBar'
import { useAuth } from '@/hooks/payroll/useAuth'
import { useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'
import type { PayrollEmployee, PayrollTimeEntry } from '@/lib/supabase/types'

export default function TimesheetsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--muted)]">Loading timesheets…</div>}>
      <TimesheetsPageContent />
    </Suspense>
  )
}

function TimesheetsPageContent() {
  const { weeks, refetch: refetchWeeks } = usePayrollWeeks()
  const { isSuperAdmin } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { selectedWeekId, setSelectedWeekId } = useSelectedWeek()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)
  const [drawerDirty, setDrawerDirty] = useState(false)
  const [approvingTimesheet, setApprovingTimesheet] = useState(false)

  useEffect(() => {
    const w = searchParams.get('week')
    if (w) setSelectedWeekId(w)
  }, [searchParams, setSelectedWeekId])

  const {
    allEntries, unallocatedEntries, pendingEntries, corrections,
    loading, reassign, addEntry, spread, removeEntry, reduceHours, setPending,
    resolvePending, addCarryForward, refetch,
  } = useTimesheetAdjustments(selectedWeekId || null)

  const { employees } = usePayrollEmployees(false)
  const { properties } = useProperties(true)
  const { portfolios, allProperties } = usePortfolios()

  // Live Workyard reconciliation: flag employees whose recorded hours fall SHORT of
  // the Workyard source total for the week (the guardrail the import drop-bug slipped
  // past). Over-hours aren't flagged — manual adds / carry-forwards legitimately
  // exceed Workyard. Fails soft when Workyard is unreachable.
  const { hoursByWorkyardId, available: reconAvailable } = useWorkyardReconciliation(
    weeks.find(w => w.id === selectedWeekId)?.week_start ?? null
  )
  const { accountedRemovedByEmployee } = useAccountedRemovedHours(selectedWeekId || null)
  const SHORT_THRESHOLD = 0.05
  const shortByEmployee = useMemo(() => {
    const m = new Map<string, { expected: number; recorded: number; short: number }>()
    if (!reconAvailable) return m
    for (const emp of employees) {
      if (!emp.workyard_id) continue
      const expected = hoursByWorkyardId.get(emp.workyard_id)
      if (expected == null) continue
      // recorded_effective = active hours + hours removed WITH a logged correction
      // (deliberate docks / reallocations), so only never-captured or unlogged-deleted
      // Workyard time reads as short.
      const active = allEntries
        .filter(e => e.employee_id === emp.id)
        .reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)
      const recorded = active + (accountedRemovedByEmployee.get(emp.id) ?? 0)
      const short = Math.round((expected - recorded) * 100) / 100
      if (short > SHORT_THRESHOLD) m.set(emp.id, { expected, recorded, short })
    }
    return m
  }, [reconAvailable, employees, hoursByWorkyardId, allEntries, accountedRemovedByEmployee])

  const activeWeeks = weeks.filter(w => !['statement_sent'].includes(w.status))
  const approvedWeeks = weeks.filter(w => ['payroll_approved', 'invoiced', 'statement_sent'].includes(w.status))
  const selectedWeek = weeks.find(w => w.id === selectedWeekId)
  const isLocked = !!selectedWeek && ['payroll_approved', 'invoiced', 'statement_sent'].includes(selectedWeek.status)

  // Reset employee/cell on week change
  useEffect(() => {
    setSelectedEmployeeId(null)
    setSelectedCell(null)
    setDrawerDirty(false)
  }, [selectedWeekId])

  // Reset cell on employee change
  useEffect(() => {
    setSelectedCell(null)
    setDrawerDirty(false)
  }, [selectedEmployeeId])

  // Auto-select once entries load. If the URL names an employee (e.g. a name link
  // from the Review pay summary), land on that person; otherwise prefer the first
  // employee with something to resolve (unresolved blocks first, then pending) so
  // the user lands on a problem instead of whoever's alphabetically first.
  const employeeParam = searchParams.get('employee')
  useEffect(() => {
    if (selectedEmployeeId || employees.length === 0 || !selectedWeekId || loading) return
    if (employeeParam) {
      const target = employees.find(e => e.id === employeeParam)
      if (target) { setSelectedEmployeeId(target.id); return }
    }
    const needsAttention = (emp: PayrollEmployee, predicate: (e: PayrollTimeEntry) => boolean) =>
      allEntries.some(e => e.employee_id === emp.id && predicate(e))
    const firstUnresolved = employees.find(emp => needsAttention(emp, e => !e.property_id && !e.pending_resolution))
    const firstPending = employees.find(emp => needsAttention(emp, e => !!e.pending_resolution))
    setSelectedEmployeeId((firstUnresolved ?? firstPending ?? employees[0]).id)
  }, [employees, allEntries, selectedWeekId, selectedEmployeeId, loading, employeeParam])

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
  // An unresolved block is unallocated *work* — a pure PTO entry has no property by
  // design and must not masquerade as something needing a building.
  const empUnresolved = employeeEntries.filter(e => !e.property_id && !e.pending_resolution && (e.regular_hours + e.ot_hours) > 0)
  const empPending = employeeEntries.filter(e => e.pending_resolution)
  const empTotalHours = employeeEntries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)
  const empPendingHours = empPending.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)
  const empPtoHours = employeeEntries.reduce((s, e) => s + (e.pto_hours ?? 0), 0)

  // Week-wide summary
  const totalUnallocated = unallocatedEntries.length
  const totalPending = pendingEntries.length
  const affectedEmployees = new Set(unallocatedEntries.map(e => e.employee_id)).size

  // Timesheet approval (draft → corrections_complete) is what unlocks payroll
  // calculation on the review page. Only offer it once everything is clear.
  const isDraft = selectedWeek?.status === 'draft'
  const canApproveTimesheet = !!selectedWeekId && isDraft && totalUnallocated === 0 && totalPending === 0

  const handleApproveTimesheet = async () => {
    if (!canApproveTimesheet) return
    setApprovingTimesheet(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('payroll_weeks')
        .update({ status: 'corrections_complete' })
        .eq('id', selectedWeekId)
        .eq('status', 'draft')
      if (error) throw error
      await refetchWeeks()
      router.push(`/payroll/${selectedWeekId}/review`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not approve the timesheet.')
      setApprovingTimesheet(false)
    }
  }

  const closeDrawer = () => {
    setSelectedCell(null)
    setDrawerDirty(false)
  }

  const handleCellClick = (cell: SelectedCell) => {
    if (isLocked) return
    const isSameCell =
      selectedCell?.rowPropertyId === cell.rowPropertyId &&
      selectedCell?.dayIndex === cell.dayIndex
    // Clicking the open cell again closes it (explicit dismiss — no prompt).
    if (isSameCell) {
      closeDrawer()
      return
    }
    // Switching to a different cell would discard in-progress edits — confirm first.
    if (selectedCell && drawerDirty && !window.confirm('Discard unsaved changes?')) {
      return
    }
    setSelectedCell(cell)
    setDrawerDirty(false)
  }

  const handleDone = () => closeDrawer()

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
            {shortByEmployee.size > 0 && (
              <span className="flex items-center gap-1.5 text-[var(--error)] font-medium">
                <AlertTriangle size={13} />
                {shortByEmployee.size} short vs Workyard
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
            {canApproveTimesheet && (
              <FormButton size="sm" onClick={handleApproveTimesheet} loading={approvingTimesheet} className="ml-auto">
                <CheckCircle2 size={13} className="mr-1.5 inline" />
                Approve Timesheet
              </FormButton>
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
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Employee switcher */}
          <EmployeeSwitcher
            employees={employees}
            allEntries={allEntries}
            selectedId={selectedEmployeeId}
            onChange={setSelectedEmployeeId}
            shortIds={new Set(shortByEmployee.keys())}
          />

          {/* Main content */}
          <div className="flex-1 overflow-auto min-w-0">
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
                    {empPtoHours > 0 && (
                      <span className="text-[var(--muted)] flex items-center gap-1">
                        {empPtoHours.toFixed(2)} hrs PTO
                      </span>
                    )}
                    {empUnresolved.length === 0 && empPending.length === 0 && (
                      <span className="text-[var(--success)] flex items-center gap-1">
                        <CheckCircle2 size={13} /> Clean
                      </span>
                    )}
                    {selectedEmployeeId && shortByEmployee.has(selectedEmployeeId) && (
                      <span className="text-[var(--error)] font-medium flex items-center gap-1">
                        <AlertTriangle size={13} />
                        {shortByEmployee.get(selectedEmployeeId)!.short.toFixed(2)}h short vs Workyard
                        <span className="text-[var(--muted)] font-normal">
                          (Workyard {shortByEmployee.get(selectedEmployeeId)!.expected.toFixed(2)} · recorded {shortByEmployee.get(selectedEmployeeId)!.recorded.toFixed(2)})
                        </span>
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
                            key={`${selectedCell.rowPropertyId}-${selectedCell.dayIndex}`}
                            cell={selectedCell}
                            properties={properties}
                            portfolios={portfolios}
                            allProperties={allProperties}
                            isLocked={isLocked}
                            onClose={closeDrawer}
                            reassign={reassign}
                            spread={spread}
                            removeEntry={removeEntry}
                            reduceHours={reduceHours}
                            setPending={setPending}
                            resolvePending={resolvePending}
                            onDone={handleDone}
                            onDirtyChange={setDrawerDirty}
                          />
                        ) : null
                      }
                    />
                  )}
                </div>

                {/* Panels */}
                {!isLocked && (
                  <div className="p-6 space-y-4">
                    {isSuperAdmin && (
                      <CommandBar
                        onExecuted={refetch}
                        weekContext={
                          selectedWeek
                            ? { weekStart: selectedWeek.week_start, weekEnd: selectedWeek.week_end }
                            : null
                        }
                      />
                    )}
                    <ManualAddPanel
                      selectedEmployee={selectedEmployee}
                      properties={properties}
                      portfolios={portfolios}
                      allProperties={allProperties}
                      selectedWeek={selectedWeek}
                      addEntry={addEntry}
                      spread={spread}
                    />
                    <CarryForwardPanel
                      selectedEmployee={selectedEmployee}
                      approvedWeeks={approvedWeeks}
                      properties={properties}
                      addCarryForward={addCarryForward}
                    />
                    <AdjustmentLog
                      corrections={corrections}
                      manualEntries={manualEntries as PayrollTimeEntry[]}
                      employees={employees}
                      defaultEmployeeId={selectedEmployeeId ?? undefined}
                    />
                  </div>
                )}

                {isLocked && (
                  <div className="p-6">
                    <AdjustmentLog
                      corrections={corrections}
                      manualEntries={manualEntries as PayrollTimeEntry[]}
                      employees={employees}
                      defaultEmployeeId={selectedEmployeeId ?? undefined}
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
