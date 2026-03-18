'use client'

import { useState, useEffect, useCallback, KeyboardEvent } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  PageHeader, FormButton, FormField, FormInput, FormTextarea,
  InfoBlock, StatusBadge, Drawer, SectionDivider,
} from '@/components/form'

interface ExternalProject {
  id: string
  name: string
  client_name: string
  billed_to: string
  is_active: boolean
  notes: string | null
  workyard_customer_names: string[]
  created_at: string
}

const empty: Partial<ExternalProject> = { name: '', client_name: '', billed_to: '', is_active: true, notes: '', workyard_customer_names: [] }

export default function ExternalProjectsPage() {
  const [projects, setProjects] = useState<ExternalProject[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<ExternalProject>>(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase.from('payroll_external_projects').select('*').order('name')
    setProjects(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing({ ...empty }); setTagInput(''); setError(null); setDrawerOpen(true) }
  const openEdit = (p: ExternalProject) => { setEditing({ ...p, workyard_customer_names: p.workyard_customer_names ?? [] }); setTagInput(''); setError(null); setDrawerOpen(true) }

  const addTag = () => {
    const v = tagInput.trim()
    if (!v) return
    const current = editing.workyard_customer_names ?? []
    if (current.some(n => n.toLowerCase() === v.toLowerCase())) { setTagInput(''); return }
    setEditing(p => ({ ...p, workyard_customer_names: [...(p.workyard_customer_names ?? []), v] }))
    setTagInput('')
  }

  const removeTag = (idx: number) => {
    setEditing(p => ({ ...p, workyard_customer_names: (p.workyard_customer_names ?? []).filter((_, i) => i !== idx) }))
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag() }
  }

  const handleSave = async () => {
    if (!editing.name?.trim()) { setError('Name is required'); return }
    if (!editing.client_name?.trim()) { setError('Client name is required'); return }
    if (!editing.billed_to?.trim()) { setError('Billed to is required'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    if (editing.id) {
      const { error: err } = await supabase.from('payroll_external_projects').update(editing).eq('id', editing.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('payroll_external_projects').insert(editing)
      if (err) { setError(err.message); setSaving(false); return }
    }
    setDrawerOpen(false)
    await load()
    setSaving(false)
  }

  return (
    <div>
      <PageHeader
        title="External Projects"
        subtitle="Non-portfolio client work (Zimmerman, New City, etc.) — addable without code changes"
        actions={
          <FormButton size="sm" onClick={openNew}>
            <Plus size={14} className="mr-1" />
            Add Project
          </FormButton>
        }
      />

      <div className="p-6">
        <InfoBlock variant="default" title="About External Projects">
          External projects are treated as first-class entities. They appear in invoice groupings automatically.
          Add new clients here — no development work required.
        </InfoBlock>

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm">No external projects yet.</div>
        ) : (
          <div className="mt-5 border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--primary)] text-white text-xs">
                  <th className="px-4 py-2.5 text-left font-medium">Project Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Client</th>
                  <th className="px-4 py-2.5 text-left font-medium">Billed To</th>
                  <th className="px-4 py-2.5 text-left font-medium">Workyard Names</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody>
                {projects.map((proj, i) => (
                  <tr key={proj.id} className={`border-t border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                    <td className="px-4 py-3 font-medium">{proj.name}</td>
                    <td className="px-4 py-3">{proj.client_name}</td>
                    <td className="px-4 py-3">{proj.billed_to}</td>
                    <td className="px-4 py-3">
                      {(proj.workyard_customer_names ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {proj.workyard_customer_names.map((n, j) => (
                            <span key={j} className="inline-block px-1.5 py-0.5 bg-[var(--bg-section)] border border-[var(--border)] text-xs text-[var(--ink)]">{n}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[var(--muted)] text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={proj.is_active ? 'active' : 'inactive'} /></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(proj)} className="text-[var(--muted)] hover:text-[var(--primary)] transition-colors">
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing.id ? 'Edit Project' : 'New External Project'}>
        {error && <InfoBlock variant="error">{error}</InfoBlock>}
        <FormField label="Project Name" required>
          <FormInput value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Zimmerman Project" />
        </FormField>
        <FormField label="Client Name" required>
          <FormInput value={editing.client_name ?? ''} onChange={e => setEditing(p => ({ ...p, client_name: e.target.value }))} placeholder="e.g., Zimmerman" />
        </FormField>
        <FormField label="Billed To" required helperText="Person or entity who receives the invoice">
          <FormInput value={editing.billed_to ?? ''} onChange={e => setEditing(p => ({ ...p, billed_to: e.target.value }))} placeholder="e.g., Zach" />
        </FormField>
        <FormField label="Workyard Project Name(s)" helperText="What does this project get called in Workyard? Can add multiple if it varies.">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(editing.workyard_customer_names ?? []).map((tag, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--bg-section)] border border-[var(--border)] text-xs text-[var(--ink)]">
                {tag}
                <button type="button" onClick={() => removeTag(i)} className="text-[var(--muted)] hover:text-[var(--error)] transition-colors">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <FormInput
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Type a name, press Enter"
              className="flex-1"
            />
            <FormButton type="button" variant="secondary" size="sm" onClick={addTag} disabled={!tagInput.trim()}>Add</FormButton>
          </div>
        </FormField>
        <FormField label="Notes">
          <FormTextarea value={editing.notes ?? ''} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))} rows={2} />
        </FormField>
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={!!editing.is_active}
            onChange={e => setEditing(p => ({ ...p, is_active: e.target.checked }))}
            className="w-4 h-4 rounded-none"
          />
          Active
        </label>
        <div className="flex gap-2 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleSave} loading={saving} fullWidth>
            {editing.id ? 'Save Changes' : 'Add Project'}
          </FormButton>
          <FormButton variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</FormButton>
        </div>
      </Drawer>
    </div>
  )
}
