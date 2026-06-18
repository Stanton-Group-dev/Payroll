'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, X, RotateCcw, Car, Lock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'
import { usePayrollMileage, type MileageRow } from '@/hooks/payroll/usePayrollMileage'
import {
  PageHeader, FormButton, FormSelect, FormField, InfoBlock, StatusBadge,
} from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'
import type { MileageStatus } from '@/lib/supabase/types'

const STATUS_BADGE: Record<MileageStatus, { status: string; label: string }> = {
  pending: { status: 'flagged', label: 'Pending' },
  approved: { status: 'approved', label: 'Approved' },
  denied: { status: 'inactive', label: 'Denied' },
}

export default function MileagePage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--muted)]">Loading mileage…</div>}>
      <MileagePageContent />
    </Suspense>
  )
}

function MileagePageContent() {
  const { weeks } = usePayrollWeeks()
  const searchParams = useSearchParams()
  const { selectedWeekId, setSelectedWeekId, hydrated } = useSelectedWeek()

  // URL param wins; otherwise keep the persisted selection, falling back to the
  // most recent week only once nothing is stored.
  useEffect(() => {
    const weekParam = searchParams.get('week')
    if (weekParam) { setSelectedWeekId(weekParam); return }
    if (hydrated && !selectedWeekId && weeks.length) setSelectedWeekId(weeks[0].id)
  }, [searchParams, weeks, selectedWeekId, hydrated, setSelectedWeekId])

  const { rows, rate, loading, error, saveReview } = usePayrollMileage(selectedWeekId || undefined)

  const selectedWeek = weeks.find(w => w.id === selectedWeekId)
  const isLocked = !!selectedWeek && ['payroll_approved', 'invoiced', 'statement_sent'].includes(selectedWeek.status)

  return (
    <div>
      <PageHeader
        title="Mileage Reimbursement"
        subtitle="Review Workyard miles, approve or deny per employee, and bill the miles to properties"
        actions={
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Car size={14} />
            Rate: <span className="font-medium text-[var(--ink)]">{formatCurrency(rate)}/mi</span>
          </div>
        }
      />

      <div className="p-6 max-w-5xl">
        {/* Week selector */}
        <div className="mb-5 flex items-end gap-4">
          <FormField label="Payroll Week">
            <FormSelect
              value={selectedWeekId}
              onChange={e => setSelectedWeekId(e.target.value)}
              className="max-w-xs"
            >
              <option value="">— Select week —</option>
              {weeks.map(w => (
                <option key={w.id} value={w.id}>
                  Week of {format(parseISO(w.week_start), 'MMM d, yyyy')}
                  {w.status !== 'draft' ? ` · ${w.status.replace(/_/g, ' ')}` : ''}
                </option>
              ))}
            </FormSelect>
          </FormField>
        </div>

        <InfoBlock variant="default" title="How mileage works">
          Eligible employees (set on <a href="/payroll/employees" className="underline">Employees &amp; Rates</a>) and
          anyone with imported miles appear below. Approved miles × the week&apos;s rate are added to the employee&apos;s
          pay and billed to the properties where they logged the miles. Trim the approved miles to reduce both.
          The rate is configured under <a href="/payroll/admin/mileage-rate" className="underline">Admin → Mileage Rate</a>.
        </InfoBlock>

        {isLocked && (
          <InfoBlock variant="warning" title="Week locked">
            <Lock size={13} className="inline mr-1" />
            This payroll week is {selectedWeek?.status.replace(/_/g, ' ')}. Mileage can no longer be edited.
          </InfoBlock>
        )}

        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {!selectedWeekId ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm">Select a payroll week to review mileage.</div>
        ) : loading ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm">
            No eligible employees and no imported miles for this week.
          </div>
        ) : (
          <MileageTable rows={rows} rate={rate} locked={isLocked} onSave={saveReview} />
        )}
      </div>
    </div>
  )
}

function MileageTable({
  rows, rate, locked, onSave,
}: {
  rows: MileageRow[]
  rate: number
  locked: boolean
  onSave: ReturnType<typeof usePayrollMileage>['saveReview']
}) {
  const approvedTotal = useMemo(
    () => rows.reduce((s, r) => s + (r.record?.status === 'approved' ? Number(r.record.amount) : 0), 0),
    [rows]
  )

  return (
    <div className="mt-5">
      <div className="border border-[var(--border)] overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--primary)] text-white text-xs">
              <th className="px-3 py-2.5 text-left font-medium">Employee</th>
              <th className="px-3 py-2.5 text-center font-medium">Roster</th>
              <th className="px-3 py-2.5 text-right font-medium">Raw Miles</th>
              <th className="px-3 py-2.5 text-right font-medium">Approved Miles</th>
              <th className="px-3 py-2.5 text-right font-medium">Amount</th>
              <th className="px-3 py-2.5 text-center font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <MileageTableRow
                key={row.employee.id}
                row={row}
                rate={rate}
                locked={locked}
                striped={i % 2 === 1}
                onSave={onSave}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
              <td className="px-3 py-2.5" colSpan={4}>Approved Total</td>
              <td className="px-3 py-2.5 text-right">{formatCurrency(approvedTotal)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function MileageTableRow({
  row, rate, locked, striped, onSave,
}: {
  row: MileageRow
  rate: number
  locked: boolean
  striped: boolean
  onSave: ReturnType<typeof usePayrollMileage>['saveReview']
}) {
  const initialMiles = row.record?.miles_approved ?? row.milesRaw
  const [miles, setMiles] = useState<string>(String(initialMiles))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Keep the input in sync when the underlying record/raw miles change (e.g. after save/refetch).
  useEffect(() => {
    setMiles(String(row.record?.miles_approved ?? row.milesRaw))
  }, [row.record?.miles_approved, row.milesRaw])

  const parsedMiles = parseFloat(miles) || 0
  const liveAmount = Math.round(parsedMiles * rate * 100) / 100
  const status = row.record?.status ?? 'pending'
  const badge = STATUS_BADGE[status]

  const save = async (newStatus: MileageStatus) => {
    setBusy(true)
    setSaveError(null)
    try {
      await onSave({
        employeeId: row.employee.id,
        milesRaw: row.milesRaw,
        milesApproved: newStatus === 'denied' ? 0 : parsedMiles,
        status: newStatus,
        notes: row.record?.notes ?? null,
      })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className={`border-b border-[var(--divider)] ${striped ? 'bg-[var(--bg-section)]' : 'bg-white'}`}>
      <td className="px-3 py-2 font-medium">{row.employee.name}</td>
      <td className="px-3 py-2 text-center">
        {row.eligible
          ? <span className="text-xs text-[var(--success)]">on roster</span>
          : <span className="text-xs text-[var(--warning)]" title="Has miles but not on the mileage roster">not on roster</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.milesRaw || '—'}</td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min="0"
          step="0.1"
          value={miles}
          disabled={locked || busy}
          onChange={e => setMiles(e.target.value)}
          className="w-24 text-right border border-[var(--divider)] px-2 py-1 text-sm disabled:bg-[var(--bg-section)] disabled:text-[var(--muted)]"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(liveAmount)}</td>
      <td className="px-3 py-2 text-center">
        <StatusBadge status={badge.status} label={badge.label} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <FormButton size="sm" type="button" loading={busy} disabled={locked} onClick={() => save('approved')}>
            <Check size={13} className="mr-1" /> Approve
          </FormButton>
          <FormButton size="sm" variant="ghost" type="button" disabled={locked || busy} onClick={() => save('denied')}>
            <X size={13} className="mr-1" /> Deny
          </FormButton>
          {parsedMiles !== row.milesRaw && !locked && (
            <button
              type="button"
              title="Reset to raw miles"
              disabled={busy}
              onClick={() => setMiles(String(row.milesRaw))}
              className="text-[var(--muted)] hover:text-[var(--ink)] p-1"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
        {saveError && <p className="mt-1 text-right text-xs text-[var(--error)]">{saveError}</p>}
      </td>
    </tr>
  )
}
