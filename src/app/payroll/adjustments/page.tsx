'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, Trash2, Lock } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'
import { usePayrollAdjustments } from '@/hooks/payroll/usePayrollAdjustments'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import {
  PageHeader, FormButton, FormSelect, FormField, FormInput,
  FormTextarea, InfoBlock, StatusBadge, SectionDivider, Drawer,
} from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'
import type { AdjustmentType, AllocationMethod } from '@/lib/supabase/types'
import { format } from 'date-fns'

const TYPE_LABELS: Record<AdjustmentType, string> = {
  phone: 'Phone Reimbursement',
  tool: 'Tool Purchase',
  advance: 'Advance',
  deduction_other: 'Other Deduction',
  expense_reimbursement: 'Expense Reimbursement',
  bonus: 'Bonus (Remote)',
}

const TYPE_ALLOCATION: Record<AdjustmentType, AllocationMethod> = {
  phone: 'unit_weighted',
  tool: 'unit_weighted',
  advance: 'employee_pay',
  deduction_other: 'employee_pay',
  expense_reimbursement: 'direct',
  bonus: 'employee_pay',
}

export default function AdjustmentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--muted)]">Loading adjustments…</div>}>
      <AdjustmentsPageContent />
    </Suspense>
  )
}

function AdjustmentsPageContent() {
  const { weeks } = usePayrollWeeks()
  const searchParams = useSearchParams()
  const { selectedWeekId, setSelectedWeekId } = useSelectedWeek()

  useEffect(() => {
    const weekParam = searchParams.get('week')
    if (weekParam) setSelectedWeekId(weekParam)
  }, [searchParams, setSelectedWeekId])

  const { adjustments, loading, addAdjustment, deleteAdjustment, seedPhoneReimbursements } = usePayrollAdjustments(selectedWeekId || null)
  const { employees } = usePayrollEmployees(false)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState({
    employee_id: '',
    type: 'phone' as AdjustmentType,
    amount: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeWeeks = weeks.filter(w => !['statement_sent'].includes(w.status))
  const selectedWeek = weeks.find(w => w.id === selectedWeekId)
  const isLocked = !!selectedWeek && ['payroll_approved', 'invoiced', 'statement_sent'].includes(selectedWeek.status)

  const handleSeed = async () => {
    await seedPhoneReimbursements(employees.map(e => e.id))
  }

  const handleAdd = async () => {
    if (!form.employee_id) { setError('Select an employee'); return }
    if (!form.amount || isNaN(parseFloat(form.amount))) { setError('Enter a valid amount'); return }
    if (!form.description.trim()) { setError('Description is required'); return }
    setSaving(true)
    setError(null)
    try {
      const amount = parseFloat(form.amount)
      const isDeduction = form.type === 'advance' || form.type === 'deduction_other'
      await addAdjustment({
        payroll_week_id: selectedWeekId,
        employee_id: form.employee_id,
        type: form.type,
        amount: isDeduction ? -Math.abs(amount) : Math.abs(amount),
        description: form.description,
        allocation_method: TYPE_ALLOCATION[form.type],
      })
      setDrawerOpen(false)
      setForm({ employee_id: '', type: 'phone', amount: '', description: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Running advance balance per employee
  const advanceBalances: Record<string, number> = {}
  for (const adj of adjustments) {
    if (adj.type === 'advance') {
      advanceBalances[adj.employee_id] = (advanceBalances[adj.employee_id] ?? 0) + Math.abs(adj.amount)
    }
  }

  const grouped = adjustments.reduce((acc, adj) => {
    const type = adj.type
    if (!acc[type]) acc[type] = []
    acc[type].push(adj)
    return acc
  }, {} as Record<string, typeof adjustments>)

  return (
    <div>
      <PageHeader
        title="Adjustment Manager"
        subtitle="Phone reimbursements, tools, advances, and deductions"
        actions={
          !isLocked ? (
            <div className="flex gap-2">
              {selectedWeekId && (
                <FormButton variant="secondary" size="sm" onClick={handleSeed}>
                  Seed Phone ($8 × employees)
                </FormButton>
              )}
              <FormButton size="sm" onClick={() => setDrawerOpen(true)} disabled={!selectedWeekId}>
                <Plus size={14} className="mr-1" />
                Add Adjustment
              </FormButton>
            </div>
          ) : undefined
        }
      />

      <div className="p-6">
        <div className="mb-6 max-w-xs">
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

        {isLocked && (
          <InfoBlock variant="warning" title="Payroll Locked">
            <div className="flex items-center gap-1.5">
              <Lock size={13} />
              Adjustments are read-only after payroll approval. No changes permitted.
            </div>
          </InfoBlock>
        )}

        {selectedWeekId && (
          loading ? (
            <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
          ) : adjustments.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)] text-sm">
              No adjustments for this week. Use &quot;Seed Phone&quot; to add $8 reimbursements for all active employees.
            </div>
          ) : (
            <div className="space-y-6">
              {(Object.keys(TYPE_LABELS) as AdjustmentType[]).map(type => {
                const items = grouped[type] ?? []
                if (items.length === 0) return null
                const total = items.reduce((s, a) => s + a.amount, 0)
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-serif text-base text-[var(--primary)]">{TYPE_LABELS[type]}</h3>
                      <span className={`text-sm font-medium ${total < 0 ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
                        {total < 0 ? '−' : '+'}{formatCurrency(Math.abs(total))}
                      </span>
                    </div>
                    <table className="w-full text-sm border border-[var(--border)]">
                      <thead>
                        <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                          <th className="px-3 py-2 text-left font-medium">Employee</th>
                          <th className="px-3 py-2 text-left font-medium">Description</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                          {type === 'advance' && <th className="px-3 py-2 text-right font-medium">Running Balance</th>}
                          <th className="px-3 py-2 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(adj => (
                          <tr key={adj.id} className="border-t border-[var(--divider)]">
                            <td className="px-3 py-2">{(adj.employee as {name:string})?.name ?? adj.employee_id}</td>
                            <td className="px-3 py-2 text-[var(--muted)]">{adj.description}</td>
                            <td className={`px-3 py-2 text-right ${adj.amount < 0 ? 'text-[var(--error)]' : ''}`}>
                              {adj.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(adj.amount))}
                            </td>
                            {type === 'advance' && (
                              <td className="px-3 py-2 text-right text-[var(--error)]">
                                {formatCurrency(advanceBalances[adj.employee_id] ?? 0)}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center">
                              {!isLocked && (
                                <button
                                  onClick={() => deleteAdjustment(adj.id)}
                                  className="text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Add Adjustment">
        {error && <InfoBlock variant="error">{error}</InfoBlock>}
        <FormField label="Employee" required>
          <FormSelect value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}>
            <option value="">— Select —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Type" required>
          <FormSelect value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as AdjustmentType }))}>
            {(Object.entries(TYPE_LABELS) as [AdjustmentType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Amount ($)" required helperText={form.type === 'advance' || form.type === 'deduction_other' ? 'Enter positive — will be applied as deduction' : ''}>
          <FormInput type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
        </FormField>
        <FormField label="Description / Reason" required>
          <FormTextarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
        </FormField>
        <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleAdd} loading={saving} fullWidth>Add Adjustment</FormButton>
          <FormButton variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</FormButton>
        </div>
      </Drawer>
    </div>
  )
}
