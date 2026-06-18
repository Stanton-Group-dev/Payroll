'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import type { PayrollEmployee, PayrollWeek } from '@/lib/supabase/types'
import type { PropertyOption } from '@/hooks/payroll/useProperties'
import { FormSelect, FormField, FormInput, FormTextarea, FormButton, InfoBlock } from '@/components/form'

interface CarryForwardPanelProps {
  selectedEmployee: PayrollEmployee | undefined
  approvedWeeks: PayrollWeek[]
  properties: PropertyOption[]
  addCarryForward: (params: { employeeId: string; priorWeekId: string; amount: number; description: string; propertyId?: string }) => Promise<void>
}

export function CarryForwardPanel({ selectedEmployee, approvedWeeks, properties, addCarryForward }: CarryForwardPanelProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<'dollars' | 'hours'>('dollars')

  const [form, setForm] = useState({ priorWeekId: '', amount: '', propertyId: '', reason: '' })
  const set = (k: Partial<typeof form>) => setForm(f => ({ ...f, ...k }))

  const hourlyRate = selectedEmployee?.hourly_rate ?? null
  const derivedDollars = inputMode === 'hours' && hourlyRate && form.amount
    ? parseFloat((parseFloat(form.amount) * hourlyRate).toFixed(2))
    : null

  const handleAdd = async () => {
    setErr(null)
    if (!selectedEmployee) { setErr('No employee selected'); return }
    if (!form.priorWeekId) { setErr('Select the prior week'); return }
    const rawAmt = parseFloat(form.amount)
    if (!rawAmt || rawAmt <= 0) { setErr(`Enter a valid ${inputMode === 'hours' ? 'hour count' : 'amount'} (> 0)`); return }
    if (inputMode === 'hours' && !hourlyRate) { setErr('This employee has no hourly rate on file — enter a dollar amount instead'); return }
    if (!form.reason.trim()) { setErr('Reason required'); return }

    const dollarAmount = inputMode === 'hours' ? derivedDollars! : rawAmt
    const priorWeek = approvedWeeks.find(w => w.id === form.priorWeekId)
    const selectedProp = properties.find(p => p.id === form.propertyId)
    const descParts = [
      `Back pay — week of ${priorWeek ? format(new Date(priorWeek.week_start + 'T00:00:00'), 'M/d') : '?'}`,
      selectedProp ? `(${selectedProp.code})` : null,
      form.reason,
    ].filter(Boolean).join(' · ')

    setSaving(true)
    try {
      await addCarryForward({
        employeeId: selectedEmployee.id,
        priorWeekId: form.priorWeekId,
        amount: dollarAmount,
        description: descParts,
        propertyId: form.propertyId || undefined,
      })
      setForm({ priorWeekId: '', amount: '', propertyId: '', reason: '' })
      setOpen(false)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add carry-forward')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-[var(--border)]">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors duration-200">
        <div>
          <span className="font-serif text-base text-[var(--primary)]">Carry-Forward</span>
          <span className="ml-3 text-xs text-[var(--muted)]">Prior-week underpayment into current week</span>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </button>

      {open && (
        <div className="p-5 max-w-xl">
          {approvedWeeks.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No approved prior weeks available to reference.</p>
          ) : (
            <>
              {err && <InfoBlock variant="error">{err}</InfoBlock>}

              <div className="grid grid-cols-2 gap-4 mb-4">
                <FormField label="Employee">
                  <div className="px-3 py-2 text-sm text-[var(--primary)] bg-[var(--bg-section)] border border-[var(--border)]">
                    {selectedEmployee?.name ?? '—'}
                  </div>
                </FormField>

                <FormField label="Prior Week (approved)" required>
                  <FormSelect value={form.priorWeekId} onChange={e => set({ priorWeekId: e.target.value })}>
                    <option value="">— Select —</option>
                    {approvedWeeks.map(w => (
                      <option key={w.id} value={w.id}>
                        Week of {format(new Date(w.week_start + 'T00:00:00'), 'MMM d, yyyy')}
                      </option>
                    ))}
                  </FormSelect>
                </FormField>

                <FormField label="Amount" required>
                  <div className="space-y-1.5">
                    <div className="flex border border-[var(--border)] w-fit">
                      {(['dollars', 'hours'] as const).map(m => (
                        <button key={m} type="button" onClick={() => { setInputMode(m); set({ amount: '' }) }}
                          className={`px-3 py-1 text-xs transition-colors ${
                            m === 'hours' ? 'border-l border-[var(--border)]' : ''
                          } ${inputMode === m
                            ? 'bg-[var(--primary)] text-white'
                            : 'text-[var(--muted)] hover:bg-[var(--bg-section)]'
                          }`}>
                          {m === 'dollars' ? '$' : 'hrs'}
                        </button>
                      ))}
                    </div>
                    <FormInput
                      type="number"
                      step={inputMode === 'dollars' ? '0.01' : '0.25'}
                      min={inputMode === 'dollars' ? '0.01' : '0.25'}
                      value={form.amount}
                      onChange={e => set({ amount: e.target.value })}
                      placeholder={inputMode === 'dollars' ? 'e.g. 120.00' : 'e.g. 4'}
                    />
                    {inputMode === 'hours' && form.amount && (
                      <p className="text-xs text-[var(--muted)]">
                        {hourlyRate
                          ? <><span className="font-medium text-[var(--ink)]">${derivedDollars?.toFixed(2)}</span> at ${hourlyRate}/hr</>
                          : <span className="text-[var(--warning)]">No hourly rate on file for this employee</span>
                        }
                      </p>
                    )}
                  </div>
                </FormField>

                <FormField label="Property / Portfolio">
                  <FormSelect value={form.propertyId} onChange={e => set({ propertyId: e.target.value })}>
                    <option value="">— Optional —</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </FormSelect>
                </FormField>
              </div>

              <FormField label="Reason" required>
                <FormTextarea value={form.reason} onChange={e => set({ reason: e.target.value })}
                  placeholder="e.g. Missed 4h allocation at Whitfield" rows={2} />
              </FormField>

              <InfoBlock variant="default" title="Prior week stays locked">
                This adjustment will appear in the current week. The referenced week is not modified.
                On the employee pay summary it shows as &quot;Back pay — week of [date]&quot;.
              </InfoBlock>

              <div className="flex gap-2 mt-4">
                <FormButton onClick={handleAdd} loading={saving}>Add Carry-Forward</FormButton>
                <FormButton variant="ghost" onClick={() => setOpen(false)}>Cancel</FormButton>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
