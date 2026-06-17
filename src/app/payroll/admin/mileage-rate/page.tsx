'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAdminMileageRate } from '@/hooks/payroll/useAdminMileageRate'
import { PageHeader, FormButton, FormField, FormInput, InfoBlock, SectionDivider } from '@/components/form'
import { format } from 'date-fns'

export default function MileageRatePage() {
  const { rates, loading, addRate } = useAdminMileageRate()

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ rate_per_mile: '0.73', effective_date: format(new Date(), 'yyyy-MM-dd') })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const rate = parseFloat(form.rate_per_mile)
    if (isNaN(rate) || rate < 0) { setError('Enter a valid rate (USD per mile)'); return }
    if (!form.effective_date) { setError('Effective date is required'); return }
    setSaving(true)
    setError(null)
    try {
      await addRate(rate, form.effective_date)
      setShowForm(false)
      setForm({ rate_per_mile: '0.73', effective_date: format(new Date(), 'yyyy-MM-dd') })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Mileage Rate Configuration"
        subtitle="Reimbursement rate per mile, with effective dates — rate history is append-only"
        actions={
          <FormButton size="sm" onClick={() => { setShowForm(true); setError(null) }}>
            <Plus size={14} className="mr-1" />
            Add Rate
          </FormButton>
        }
      />

      <div className="p-6 max-w-2xl">
        <InfoBlock variant="default" title="How the rate works">
          The most recent rate effective on or before a payroll week&apos;s start date is used for that
          week. Each approved mileage reimbursement snapshots the rate at approval time, so later changes
          never alter past runs. Reviews happen on the <a href="/payroll/mileage" className="underline">Mileage</a> page.
        </InfoBlock>

        {showForm && (
          <div className="border border-[var(--border)] bg-white p-5 mt-5 mb-5">
            <h3 className="font-serif text-base text-[var(--primary)] mb-4">New Rate Entry</h3>
            {error && <InfoBlock variant="error">{error}</InfoBlock>}
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Rate ($/mile)" required>
                <FormInput
                  type="number" step="0.01" min="0"
                  value={form.rate_per_mile}
                  onChange={e => setForm(p => ({ ...p, rate_per_mile: e.target.value }))}
                />
              </FormField>
              <FormField label="Effective Date" required>
                <FormInput type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))} />
              </FormField>
            </div>
            <div className="flex gap-2 mt-2">
              <FormButton onClick={handleSave} loading={saving}>Save Rate</FormButton>
              <FormButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</FormButton>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : (
          <>
            <SectionDivider label="Rate History" />
            <table className="w-full text-sm border border-[var(--border)]">
              <thead>
                <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                  <th className="px-4 py-2.5 text-left font-medium">Rate</th>
                  <th className="px-4 py-2.5 text-left font-medium">Effective Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {rates.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-3 text-[var(--muted)] text-sm">No rate configured — the system default of $0.73/mi applies.</td></tr>
                ) : rates.map((r, i) => (
                  <tr key={r.id} className={`border-t border-[var(--divider)] ${i === 0 ? 'font-semibold' : 'text-[var(--muted)]'}`}>
                    <td className="px-4 py-2.5">
                      ${Number(r.rate_per_mile).toFixed(2)}/mi
                      {i === 0 && <span className="ml-2 text-xs text-[var(--success)] font-normal">current</span>}
                    </td>
                    <td className="px-4 py-2.5">{r.effective_date}</td>
                    <td className="px-4 py-2.5 text-xs">{format(new Date(r.created_at), 'MMM d, yyyy')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
