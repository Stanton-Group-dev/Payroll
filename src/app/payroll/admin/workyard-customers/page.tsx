'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useWorkyardCustomerMap } from '@/hooks/payroll/useWorkyardCustomerMap'
import {
  PageHeader, FormButton, FormField, FormInput, InfoBlock, Drawer,
} from '@/components/form'

/**
 * Owner-LLC -> Workyard-customer map (PRP-06 CF-6). A new building's project is
 * created under its owner LLC's Workyard customer; this is the editable mapping
 * the New Project Wizard reads. Config, not hardcode (DECISIONS_LOG §0.13).
 */
export default function WorkyardCustomersPage() {
  const { rows, loading, pending, error, addMapping, deleteMapping } = useWorkyardCustomerMap()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState({ ownerLlc: '', orgCustomerId: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleAdd = async () => {
    setFormError(null)
    if (!form.ownerLlc.trim()) { setFormError('Enter the owner LLC name'); return }
    const cid = parseInt(form.orgCustomerId, 10)
    if (!cid || cid <= 0) { setFormError('Enter a valid Workyard customer id'); return }
    setSaving(true)
    try {
      await addMapping({ ownerLlc: form.ownerLlc.trim(), orgCustomerId: cid })
      setDrawerOpen(false)
      setForm({ ownerLlc: '', orgCustomerId: '' })
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Workyard Customers"
        subtitle="Map each owner LLC to its Workyard customer id so the New Project Wizard creates projects under the right customer"
        actions={
          <FormButton size="sm" onClick={() => { setDrawerOpen(true); setFormError(null) }}>
            <Plus size={14} className="mr-1" />
            Add Mapping
          </FormButton>
        }
      />

      <div className="p-6">
        {pending && (
          <InfoBlock variant="warning" title="Not yet live">
            The mapping table is staged but not yet applied to the database (migration
            20260623_01). Mappings can be added once the New Project Wizard go-live migration runs.
          </InfoBlock>
        )}
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {loading ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm">
            No LLC → Workyard customer mappings yet.
          </div>
        ) : (
          <div className="border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)] border-b border-[var(--divider)] bg-[var(--bg-section)]">
                  <th className="px-4 py-2 text-left font-medium">Owner LLC</th>
                  <th className="px-4 py-2 text-right font-medium">Workyard customer id</th>
                  <th className="px-4 py-2 text-center font-medium">Active</th>
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-[var(--divider)] last:border-0">
                    <td className="px-4 py-2 font-medium text-[var(--ink)]">{r.owner_llc}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.org_customer_id}</td>
                    <td className="px-4 py-2 text-center text-[var(--muted)]">{r.is_active ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => deleteMapping(r.id)}
                        className="text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Add LLC → Customer mapping">
        {formError && <InfoBlock variant="error">{formError}</InfoBlock>}
        <FormField label="Owner LLC" required>
          <FormInput
            value={form.ownerLlc}
            onChange={e => setForm(f => ({ ...f, ownerLlc: e.target.value }))}
            placeholder="e.g. SREP Park 1 LLC"
          />
        </FormField>
        <FormField label="Workyard customer id" required helperText="The org_customer_id a project is created under (e.g. 317292 for Westend).">
          <FormInput
            type="number"
            min="1"
            value={form.orgCustomerId}
            onChange={e => setForm(f => ({ ...f, orgCustomerId: e.target.value }))}
          />
        </FormField>
        <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleAdd} loading={saving} fullWidth>Add Mapping</FormButton>
          <FormButton variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</FormButton>
        </div>
      </Drawer>
    </div>
  )
}
