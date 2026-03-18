'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Calendar, ChevronRight, AlertCircle, CheckCircle2, Clock, Trash2 } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { PageHeader, FormButton, FormField, FormInput, StatusBadge } from '@/components/form'
import { format, addDays, startOfWeek } from 'date-fns'
import type { PayrollWeek } from '@/lib/supabase/types'
import { getStepHref } from '@/lib/payroll/stepRouting'

const statusOrder: Record<string, number> = {
  draft: 0,
  corrections_complete: 1,
  payroll_approved: 2,
  invoiced: 3,
  statement_sent: 4,
}

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  corrections_complete: 'Corrections Done',
  payroll_approved: 'Payroll Approved',
  invoiced: 'Invoiced',
  statement_sent: 'Statement Sent',
}

export default function PayrollDashboard() {
  const { weeks, loading, createWeek, deleteWeek } = usePayrollWeeks()
  const [showNew, setShowNew] = useState(false)
  const [weekStart, setWeekStart] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PayrollWeek | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteWeek(confirmDelete.id)
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleCreate = async () => {
    if (!weekStart) return
    setSaving(true)
    try {
      const start = new Date(weekStart + 'T00:00:00')
      const end = addDays(start, 6)
      await createWeek(
        format(start, 'yyyy-MM-dd'),
        format(end, 'yyyy-MM-dd')
      )
      setShowNew(false)
      setWeekStart('')
    } finally {
      setSaving(false)
    }
  }

  const suggestedStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const firstAwaitingWeek = weeks.find(w => w.status === 'corrections_complete')
  const awaitingHref = firstAwaitingWeek ? getStepHref(firstAwaitingWeek.id, firstAwaitingWeek.status) : '/payroll'

  return (
    <div>
      <PageHeader
        title="Payroll Dashboard"
        subtitle="Weekly payroll processing for Stanton Management"
        actions={
          <FormButton size="sm" onClick={() => setShowNew(true)}>
            <Plus size={14} className="mr-1" />
            New Week
          </FormButton>
        }
      />

      <div className="p-6">
        {/* New week form */}
        {showNew && (
          <div className="border border-[var(--border)] bg-white p-5 mb-6">
            <h3 className="font-serif text-base text-[var(--primary)] mb-4">Create New Payroll Week</h3>
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <FormField label="Week Start Date">
                  <FormInput
                    type="date"
                    value={weekStart}
                    onChange={e => setWeekStart(e.target.value)}
                    placeholder={suggestedStart}
                  />
                </FormField>
              </div>
              {weekStart && (
                <p className="text-sm text-[var(--muted)] mb-4">
                  Ends: {format(addDays(new Date(weekStart + 'T00:00:00'), 6), 'MMM d, yyyy')}
                </p>
              )}
              <div className="flex gap-2 mb-4">
                <FormButton onClick={handleCreate} loading={saving} disabled={!weekStart}>
                  Create
                </FormButton>
                <FormButton variant="ghost" onClick={() => setShowNew(false)}>
                  Cancel
                </FormButton>
              </div>
            </div>
          </div>
        )}

        {/* Weeks list */}
        {loading ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
        ) : weeks.length === 0 ? (
          <div className="text-center py-16">
            <Calendar size={40} className="mx-auto text-[var(--muted)] mb-3 opacity-40" />
            <p className="text-[var(--muted)] text-sm">No payroll weeks yet.</p>
            <p className="text-[var(--muted)] text-xs mt-1">Create the first week to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {weeks.map(week => {
              const stageNum = statusOrder[week.status] ?? 0
              const totalStages = 4
              return (
                <Link
                  key={week.id}
                  href={getStepHref(week.id, week.status)}
                  className="flex items-center gap-4 px-5 py-4 bg-white border border-[var(--border)] hover:border-[var(--primary)]/30 hover:bg-[var(--bg-section)] transition-colors group"
                >
                  <div className="shrink-0">
                    <Calendar size={18} className="text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-medium text-[var(--ink)] text-sm">
                        Week of {format(new Date(week.week_start + 'T00:00:00'), 'MMM d, yyyy')}
                      </p>
                      <span className="text-xs text-[var(--muted)]">
                        — {format(new Date(week.week_end + 'T00:00:00'), 'MMM d')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 ${i <= stageNum ? 'bg-[var(--accent)]' : 'bg-[var(--divider)]'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <StatusBadge status={week.status} label={statusLabel[week.status]} />
                    <button
                      onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(week) }}
                      className="p-1.5 rounded text-[var(--muted)] hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete week"
                    >
                      <Trash2 size={14} />
                    </button>
                    <ChevronRight size={16} className="text-[var(--muted)] group-hover:text-[var(--primary)] transition-colors" />
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* Quick links */}
        {weeks.length > 0 && (
          <div className="mt-8 grid grid-cols-3 gap-4">
            <QuickCard
              icon={<AlertCircle size={16} />}
              label="Open Corrections"
              value={weeks.filter(w => w.status === 'draft').length.toString()}
              href="/payroll/corrections"
              color="warning"
            />
            <QuickCard
              icon={<Clock size={16} />}
              label="Awaiting Approval"
              value={weeks.filter(w => w.status === 'corrections_complete').length.toString()}
              href={awaitingHref}
              color="accent"
            />
            <QuickCard
              icon={<CheckCircle2 size={16} />}
              label="Completed Weeks"
              value={weeks.filter(w => w.status === 'statement_sent').length.toString()}
              href="/payroll/history"
              color="success"
            />
          </div>
        )}
      </div>
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white border border-[var(--border)] p-6 max-w-md w-full mx-4 shadow-lg">
            <h3 className="font-serif text-base text-[var(--primary)] mb-2">Delete Payroll Week</h3>
            <p className="text-sm text-[var(--muted)] mb-1">
              Are you sure you want to delete the week of{' '}
              <strong>{format(new Date(confirmDelete.week_start + 'T00:00:00'), 'MMM d, yyyy')}</strong>?
            </p>
            <p className="text-xs text-red-600 mb-5">
              This will permanently delete all time entries, adjustments, approvals, invoices, and other data associated with this week.
            </p>
            <div className="flex justify-end gap-2">
              <FormButton variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                Cancel
              </FormButton>
              <FormButton onClick={handleDelete} loading={deleting} className="bg-red-600 hover:bg-red-700 text-white border-red-600">
                Delete
              </FormButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function QuickCard({
  icon, label, value, href, color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  href: string
  color: 'warning' | 'accent' | 'success'
}) {
  const colors = {
    warning: 'text-[var(--warning)]',
    accent: 'text-[var(--accent)]',
    success: 'text-[var(--success)]',
  }
  return (
    <Link href={href} className="bg-white border border-[var(--border)] p-4 hover:border-[var(--primary)]/30 transition-colors">
      <div className={`flex items-center gap-2 mb-2 ${colors[color]}`}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-serif text-3xl text-[var(--primary)]">{value}</p>
    </Link>
  )
}
