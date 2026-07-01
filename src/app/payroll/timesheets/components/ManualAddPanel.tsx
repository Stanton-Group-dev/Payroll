'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PayrollEmployee, PayrollWeek } from '@/lib/supabase/types'
import type { PropertyOption } from '@/hooks/payroll/useProperties'
import type { PortfolioWithProperties } from '@/hooks/payroll/usePortfolios'
import { FormSelect, FormField, FormInput, FormTextarea, FormButton, InfoBlock } from '@/components/form'
import { MultiPortfolioSpreadPicker } from './InlineDrawer'

interface ManualAddPanelProps {
  selectedEmployee: PayrollEmployee | undefined
  properties: PropertyOption[]
  portfolios: PortfolioWithProperties[]
  allProperties: PropertyOption[]
  selectedWeek: PayrollWeek | undefined
  addEntry: (params: { employeeId: string; date: string; hours: number; propertyId: string; reason: string; payType?: 'regular' | 'overtime' | 'pto' }) => Promise<void>
  spread: (params: { employeeId: string; date: string; totalHours: number; propertyIds: string[]; portfolioId?: string; reason: string }) => Promise<void>
}

export function ManualAddPanel({
  selectedEmployee, properties, portfolios, allProperties, selectedWeek, addEntry, spread,
}: ManualAddPanelProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [form, setForm] = useState({
    date: '',
    hours: '',
    propertyId: '',
    payType: 'regular' as 'regular' | 'overtime' | 'pto',
    useSpread: false,
    spreadPropertyIds: [] as string[],
    reason: '',
  })

  const set = (k: Partial<typeof form>) => { setSuccess(null); setForm(f => ({ ...f, ...k })) }

  const PAY_TYPE_LABEL: Record<'regular' | 'overtime' | 'pto', string> = {
    regular: 'regular h', overtime: 'OT h', pto: 'PTO h',
  }

  const getSpreadPortfolioId = (): string | undefined => {
    const matching = portfolios.filter(port =>
      port.properties.some(p => form.spreadPropertyIds.includes(p.id))
    )
    return matching.length === 1 ? matching[0].id : undefined
  }

  const handleAdd = async () => {
    setErr(null)
    setSuccess(null)
    if (!selectedEmployee) { setErr('No employee selected'); return }
    if (!form.date) { setErr('Select a date'); return }
    const hrs = parseFloat(form.hours)
    if (!hrs || hrs <= 0) { setErr('Enter valid hours (> 0)'); return }
    if (selectedWeek) {
      if (form.date < selectedWeek.week_start || form.date > selectedWeek.week_end) {
        setErr('Date must be within the selected week (' + selectedWeek.week_start + ' – ' + selectedWeek.week_end + ')')
        return
      }
    }
    if (!form.reason.trim()) { setErr('Reason required'); return }
    if (form.useSpread) {
      if (form.spreadPropertyIds.length === 0) { setErr('Select at least one property to spread across'); return }
    } else {
      if (!form.propertyId) { setErr('Select a destination property'); return }
    }

    setSaving(true)
    try {
      if (form.useSpread) {
        await spread({
          employeeId: selectedEmployee.id,
          date: form.date,
          totalHours: hrs,
          propertyIds: form.spreadPropertyIds,
          portfolioId: getSpreadPortfolioId(),
          reason: form.reason,
        })
      } else {
        await addEntry({
          employeeId: selectedEmployee.id,
          date: form.date,
          hours: hrs,
          propertyId: form.propertyId,
          reason: form.reason,
          payType: form.payType,
        })
      }
      // Confirm the add explicitly. The panel stays OPEN with a success line so the
      // user sees it landed (the new row shows far down the grid, in the rightmost
      // day column — easy to miss), rather than the panel silently collapsing and
      // reading as a no-op — which led to repeated re-adds and duplicate entries.
      const dest = form.useSpread
        ? `spread across ${form.spreadPropertyIds.length} propert${form.spreadPropertyIds.length === 1 ? 'y' : 'ies'}`
        : `→ ${properties.find(p => p.id === form.propertyId)?.code ?? 'property'}`
      const dayLabel = format(new Date(form.date + 'T00:00:00'), 'EEE M/d')
      setSuccess(`Added ${hrs} ${PAY_TYPE_LABEL[form.payType]} for ${selectedEmployee.name} on ${dayLabel} ${dest}. Add another or close.`)
      // Preserve date + pay type so a follow-up add on the same day/type doesn't
      // silently revert to Regular; clear only the entry-specific fields.
      setForm(f => ({ ...f, hours: '', propertyId: '', spreadPropertyIds: [], reason: '' }))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add entry')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-[var(--border)]">
      <button type="button" onClick={() => { setOpen(v => !v); setSuccess(null); setErr(null) }}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors duration-200">
        <div>
          <span className="font-serif text-base text-[var(--primary)]">Add Hours</span>
          <span className="ml-3 text-xs text-[var(--muted)]">
            {selectedEmployee ? `Add missing hours for ${selectedEmployee.name}` : 'Add missing hours'}
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </button>

      {open && (
        <div className="p-5 max-w-xl">
          {err && <InfoBlock variant="error">{err}</InfoBlock>}
          {success && <InfoBlock variant="success">{success}</InfoBlock>}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <FormField label="Employee">
              <div className="px-3 py-2 text-sm text-[var(--primary)] bg-[var(--bg-section)] border border-[var(--border)]">
                {selectedEmployee?.name ?? '—'}
              </div>
            </FormField>

            <FormField label="Date" required>
              <FormInput type="date" value={form.date} onChange={e => set({ date: e.target.value })}
                min={selectedWeek?.week_start} max={selectedWeek?.week_end} />
            </FormField>

            <FormField label="Hours" required>
              <FormInput type="number" step="0.25" min="0.25" value={form.hours}
                onChange={e => set({ hours: e.target.value })} placeholder="e.g. 4" />
            </FormField>

            <FormField label="Pay Type" required>
              <FormSelect value={form.payType} onChange={e => set({ payType: e.target.value as 'regular' | 'overtime' | 'pto' })}>
                <option value="regular">Regular</option>
                <option value="overtime">Overtime</option>
                <option value="pto">PTO</option>
              </FormSelect>
            </FormField>

            <FormField label="Destination" required>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.useSpread}
                    onChange={e => set({ useSpread: e.target.checked, propertyId: '', spreadPropertyIds: [] })}
                    className="accent-[var(--primary)]" />
                  <span>Spread across properties</span>
                </label>
                {!form.useSpread && (
                  <FormSelect value={form.propertyId} onChange={e => set({ propertyId: e.target.value })}>
                    <option value="">— Select property —</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </FormSelect>
                )}
              </div>
            </FormField>
          </div>

          {form.useSpread && (
            <div className="mb-4">
              <MultiPortfolioSpreadPicker
                portfolios={portfolios}
                allProperties={allProperties}
                selectedPropertyIds={form.spreadPropertyIds}
                onPropertyIdsChange={ids => set({ spreadPropertyIds: ids })}
                totalHours={parseFloat(form.hours) || 0}
              />
            </div>
          )}

          <FormField label="Reason" required>
            <FormTextarea value={form.reason} onChange={e => set({ reason: e.target.value })}
              placeholder="e.g. Manager dispatch — boiler repair at 15 Whit" rows={2} />
          </FormField>

          <div className="flex gap-2 mt-4">
            <FormButton onClick={handleAdd} loading={saving}>Add Entry</FormButton>
            <FormButton variant="ghost" onClick={() => setOpen(false)}>Cancel</FormButton>
          </div>
        </div>
      )}
    </div>
  )
}
