'use client'

import { Suspense, useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Pencil, Trash2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'
import { usePayrollEmployees, useEmployeeDeptSplits } from '@/hooks/payroll/usePayrollEmployees'
import { useDeptSplitOverrides } from '@/hooks/payroll/useDeptSplitOverrides'
import {
  PageHeader, FormButton, FormField, FormSelect, FormInput, FormTextarea,
  InfoBlock, SectionDivider, StatusBadge,
} from '@/components/form'
import { format } from 'date-fns'

const DEPARTMENTS = ['Acquisitions', 'Asset Management', 'Collections', 'Maintenance', 'Leasing', 'Administration']

interface SplitRow { department: string; pct: string }

function DefaultSplitsDisplay({ employeeId }: { employeeId: string }) {
  const { splits } = useEmployeeDeptSplits(employeeId)
  if (splits.length === 0) return <span className="text-xs text-[var(--muted)]">No default splits</span>
  return (
    <span className="text-xs text-[var(--muted)]">
      {splits.map(s => `${s.department} ${(s.allocation_pct * 100).toFixed(0)}%`).join(' · ')}
    </span>
  )
}

export default function SplitsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--muted)]">Loading split overrides…</div>}>
      <SplitsPageContent />
    </Suspense>
  )
}

function SplitsPageContent() {
  const { weeks } = usePayrollWeeks()
  const { employees } = usePayrollEmployees(false)
  const searchParams = useSearchParams()
  const { selectedWeekId, setSelectedWeekId } = useSelectedWeek()

  useEffect(() => {
    const weekParam = searchParams.get('week')
    if (weekParam) setSelectedWeekId(weekParam)
  }, [searchParams, setSelectedWeekId])

  const { overrides, loading, saveOverrides, deleteOverrides } = useDeptSplitOverrides(selectedWeekId || null)

  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)
  const [splitRows, setSplitRows] = useState<SplitRow[]>([{ department: '', pct: '' }])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeWeeks = weeks.filter(w => !['statement_sent'].includes(w.status))
  const selectedWeek = weeks.find(w => w.id === selectedWeekId)
  const isLocked = !!selectedWeek && ['payroll_approved', 'invoiced', 'statement_sent'].includes(selectedWeek.status)

  const salaryEmployees = employees.filter(e => e.type === 'salaried')

  // Group overrides by employee
  const overridesByEmployee = useMemo(() => {
    const map: Record<string, typeof overrides> = {}
    for (const o of overrides) {
      if (!map[o.employee_id]) map[o.employee_id] = []
      map[o.employee_id].push(o)
    }
    return map
  }, [overrides])

  const openEdit = (employeeId: string) => {
    const existing = overridesByEmployee[employeeId]
    if (existing && existing.length > 0) {
      setSplitRows(existing.map(o => ({ department: o.department, pct: String(Math.round(o.allocation_pct * 100)) })))
      setReason(existing[0].reason)
    } else {
      setSplitRows([{ department: '', pct: '' }])
      setReason('')
    }
    setEditingEmployeeId(employeeId)
    setError(null)
  }

  const handleSave = async () => {
    if (!editingEmployeeId || !selectedWeekId) return
    setError(null)

    const filled = splitRows.filter(r => r.department && r.pct)
    if (filled.length === 0) { setError('Add at least one split row'); return }
    if (!reason.trim()) { setError('Reason is required'); return }

    const total = filled.reduce((s, r) => s + parseFloat(r.pct || '0'), 0)
    if (Math.abs(total - 100) > 0.01) {
      setError(`Splits must sum to 100% — current total: ${total.toFixed(0)}%`)
      return
    }

    setSaving(true)
    try {
      await saveOverrides(
        editingEmployeeId,
        filled.map(r => ({ department: r.department, allocation_pct: parseFloat(r.pct) / 100 })),
        reason
      )
      setEditingEmployeeId(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (employeeId: string) => {
    await deleteOverrides(employeeId)
  }

  const currentTotal = splitRows.reduce((s, r) => s + parseFloat(r.pct || '0'), 0)
  const totalOk = Math.abs(currentTotal - 100) < 0.01

  return (
    <div>
      <PageHeader
        title="Dept Split Overrides"
        subtitle="Per-week department allocation overrides for salaried employees"
      />

      <div className="p-6 space-y-5">
        <div className="max-w-xs">
          <FormField label="Payroll Week">
            <FormSelect value={selectedWeekId} onChange={e => setSelectedWeekId(e.target.value)}>
              <option value="">— Select week —</option>
              {activeWeeks.map(w => (
                <option key={w.id} value={w.id}>
                  Week of {format(new Date(w.week_start + 'T00:00:00'), 'MMM d, yyyy')}
                </option>
              ))}
            </FormSelect>
          </FormField>
        </div>

        {selectedWeekId && (
          <>
            {selectedWeek && (
              <div className="flex items-center gap-2">
                <StatusBadge status={selectedWeek.status} />
                <span className="text-xs text-[var(--muted)]">
                  {overrides.length > 0
                    ? `${Object.keys(overridesByEmployee).length} employee(s) have overrides this week`
                    : 'No overrides set — all salaried employees using default splits'
                  }
                </span>
              </div>
            )}

            {isLocked && (
              <InfoBlock variant="warning" title="Payroll Locked">
                <div className="flex items-center gap-1.5">
                  <Lock size={13} />
                  Dept splits are read-only after payroll approval. No changes permitted.
                </div>
              </InfoBlock>
            )}

            <InfoBlock variant="default" title="How this works">
              Salaried employees have default dept splits defined on their employee record. Use this page to override those splits for a specific week — for example, if someone spent more time in a different department. Overrides must sum to 100%. The payroll calculation uses these overrides when generating property costs.
            </InfoBlock>

            {loading ? (
              <div className="text-[var(--muted)] text-sm py-8 text-center">Loading…</div>
            ) : (
              <div className="space-y-3">
                {salaryEmployees.map(emp => {
                  const empOverrides = overridesByEmployee[emp.id] ?? []
                  const hasOverride = empOverrides.length > 0
                  const isEditing = editingEmployeeId === emp.id

                  return (
                    <div key={emp.id} className="border border-[var(--border)] bg-white">
                      {/* Employee header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--divider)] bg-[var(--bg-section)]">
                        <div>
                          <p className="font-medium text-sm text-[var(--ink)]">{emp.name}</p>
                          <div className="mt-0.5">
                            <DefaultSplitsDisplay employeeId={emp.id} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasOverride && (
                            <span className="text-xs px-2 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                              Override active
                            </span>
                          )}
                          {!isLocked && (
                            <FormButton size="sm" variant="secondary" onClick={() => isEditing ? setEditingEmployeeId(null) : openEdit(emp.id)}>
                              <Pencil size={12} className="mr-1" />
                              {isEditing ? 'Cancel' : (hasOverride ? 'Edit' : 'Add Override')}
                            </FormButton>
                          )}
                          {!isLocked && hasOverride && !isEditing && (
                            <FormButton size="sm" variant="ghost" onClick={() => handleDelete(emp.id)}>
                              <Trash2 size={12} />
                            </FormButton>
                          )}
                        </div>
                      </div>

                      {/* Active override display */}
                      {hasOverride && !isEditing && (
                        <div className="px-4 py-3">
                          <p className="text-xs text-[var(--muted)] mb-2">Current override:</p>
                          <div className="flex flex-wrap gap-2">
                            {empOverrides.map(o => (
                              <span key={o.id} className="text-xs px-2.5 py-1 bg-[var(--bg-section)] border border-[var(--divider)]">
                                {o.department}: <strong>{(o.allocation_pct * 100).toFixed(0)}%</strong>
                              </span>
                            ))}
                          </div>
                          {empOverrides[0]?.reason && (
                            <p className="text-xs text-[var(--muted)] mt-2 italic">&ldquo;{empOverrides[0].reason}&rdquo;</p>
                          )}
                        </div>
                      )}

                      {/* Edit form */}
                      {isEditing && (
                        <div className="px-4 py-4 space-y-3">
                          <SectionDivider label="Set Override Splits" />

                          {splitRows.map((row, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <FormSelect
                                value={row.department}
                                onChange={e => {
                                  const updated = [...splitRows]
                                  updated[i] = { ...updated[i], department: e.target.value }
                                  setSplitRows(updated)
                                }}
                                className="flex-1"
                              >
                                <option value="">— Department —</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                              </FormSelect>
                              <div className="flex items-center gap-1">
                                <FormInput
                                  type="number" min="0" max="100" step="1"
                                  value={row.pct}
                                  onChange={e => {
                                    const updated = [...splitRows]
                                    updated[i] = { ...updated[i], pct: e.target.value }
                                    setSplitRows(updated)
                                  }}
                                  className="w-20"
                                  placeholder="%"
                                />
                                <span className="text-xs text-[var(--muted)]">%</span>
                              </div>
                              {splitRows.length > 1 && (
                                <button
                                  onClick={() => setSplitRows(rows => rows.filter((_, j) => j !== i))}
                                  className="text-[var(--muted)] hover:text-[var(--error)] text-xs"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setSplitRows(rows => [...rows, { department: '', pct: '' }])}
                              className="text-xs text-[var(--primary)] hover:underline"
                            >
                              + Add row
                            </button>
                            <span className={`text-xs ml-auto font-medium ${totalOk ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                              {totalOk ? (
                                <><CheckCircle2 size={11} className="inline mr-1" />100%</>
                              ) : (
                                <><AlertTriangle size={11} className="inline mr-1" />Total: {currentTotal.toFixed(0)}%</>
                              )}
                            </span>
                          </div>

                          <FormField label="Reason" required helperText="Why are these splits different from the default?">
                            <FormTextarea
                              value={reason}
                              onChange={e => setReason(e.target.value)}
                              rows={2}
                              placeholder="e.g. Blake covered Maintenance tasks this week due to staffing"
                            />
                          </FormField>

                          {error && <p className="text-xs text-[var(--error)]">{error}</p>}

                          <div className="flex gap-2 pt-1">
                            <FormButton size="sm" onClick={handleSave} loading={saving}>Save Override</FormButton>
                            <FormButton size="sm" variant="ghost" onClick={() => setEditingEmployeeId(null)}>Cancel</FormButton>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {!selectedWeekId && (
          <div className="text-center py-16 text-[var(--muted)] text-sm">
            Select a payroll week to manage dept split overrides.
          </div>
        )}
      </div>
    </div>
  )
}
