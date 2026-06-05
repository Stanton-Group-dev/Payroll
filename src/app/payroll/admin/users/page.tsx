'use client'

import { useState } from 'react'
import { Plus, Pencil, ShieldCheck, Mail } from 'lucide-react'
import { useAdminUsers, type UserRow } from '@/hooks/payroll/useAdminUsers'
import { useAuth, type UserRole } from '@/hooks/payroll/useAuth'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect,
  InfoBlock, StatusBadge, Drawer,
} from '@/components/form'
import { format } from 'date-fns'

const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  bookkeeper: 'Bookkeeper',
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  superadmin: 'Unrestricted apex access — all admin powers plus system-level controls (e.g. the command console)',
  admin: 'Full access — config, approvals, rate management, user admin',
  manager: 'Portfolio visibility, corrections, approvals, cost monitoring',
  bookkeeper: 'ADP export, upload ADP report, reconciliation view (read-only otherwise)',
}

// Roles that can be assigned through this UI. superadmin is intentionally
// excluded — it is granted directly in the database, not via the invite form.
const ASSIGNABLE_ROLES: UserRole[] = ['admin', 'manager', 'bookkeeper']

const empty = { email: '', full_name: '', role: 'manager' as UserRole, portfolio_ids: [] as string[] }

export default function UsersPage() {
  const { profile: currentProfile, isAdmin } = useAuth()
  const { users, portfolios, loading, inviteUser, updateUser, deactivateUser, reactivateUser } = useAdminUsers()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteMode, setInviteMode] = useState(false)

  const openNew = () => {
    setEditingId(null)
    setForm(empty)
    setError(null)
    setInviteMode(true)
    setDrawerOpen(true)
  }

  const openEdit = (u: UserRow) => {
    setEditingId(u.id)
    setForm({ email: u.email ?? '', full_name: u.full_name ?? '', role: u.role, portfolio_ids: [] })
    setError(null)
    setInviteMode(false)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setError(null)
    if (inviteMode && !form.email.trim()) { setError('Email is required'); return }
    setSaving(true)
    try {
      if (inviteMode) {
        await inviteUser(form.email.trim(), form.full_name, form.role)
      } else if (editingId) {
        if (editingId === currentProfile?.id && form.role !== 'admin') {
          setError('You cannot remove your own admin role')
          setSaving(false)
          return
        }
        await updateUser(editingId, form.full_name, form.role)
      }
      setDrawerOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (userId: string) => {
    if (userId === currentProfile?.id) return
    await deactivateUser(userId)
  }

  const handleReactivate = async (userId: string) => {
    await reactivateUser(userId)
  }

  const roleBadgeColor = (role: UserRole) => {
    if (role === 'superadmin') return 'bg-[var(--ink)] text-white'
    if (role === 'admin') return 'bg-[var(--primary)] text-white'
    if (role === 'manager') return 'bg-[var(--accent)]/20 text-[var(--accent)]'
    return 'bg-[var(--bg-section)] text-[var(--muted)]'
  }

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Manage team access — assign roles and portfolio visibility"
        actions={
          isAdmin ? (
            <FormButton size="sm" onClick={openNew}>
              <Plus size={14} className="mr-1" />
              Invite User
            </FormButton>
          ) : undefined
        }
      />

      <div className="p-6">
        {!isAdmin && (
          <InfoBlock variant="warning" title="Admin access required">
            Only admins can manage users and roles.
          </InfoBlock>
        )}

        <div className="mb-6 grid grid-cols-3 gap-4">
          {ASSIGNABLE_ROLES.map((role) => (
            <div key={role} className="border border-[var(--border)] bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={14} className="text-[var(--muted)]" />
                <span className="font-medium text-sm text-[var(--ink)] capitalize">{ROLE_LABELS[role]}</span>
              </div>
              <p className="text-xs text-[var(--muted)]">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading…</div>
        ) : (
          <div className="border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--primary)] text-white text-xs">
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Email</th>
                  <th className="px-4 py-2.5 text-left font-medium">Role</th>
                  <th className="px-4 py-2.5 text-left font-medium">Portfolios</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium">Added</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id} className={`border-t border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                    <td className="px-4 py-3 font-medium">
                      {u.full_name ?? <span className="text-[var(--muted)] italic">No name</span>}
                      {u.id === currentProfile?.id && (
                        <span className="ml-2 text-xs text-[var(--success)]">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">{u.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium ${roleBadgeColor(u.role)}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      {u.portfolio_names.length > 0
                        ? u.portfolio_names.join(', ')
                        : u.role === 'admin' ? <span className="text-[var(--success)]">All portfolios</span> : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.is_active ? 'active' : 'inactive'} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      {u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(u)} className="text-[var(--muted)] hover:text-[var(--primary)] transition-colors">
                            <Pencil size={13} />
                          </button>
                          {u.id !== currentProfile?.id && (
                            u.is_active ? (
                              <FormButton size="sm" variant="ghost" onClick={() => handleDeactivate(u.id)}>
                                Deactivate
                              </FormButton>
                            ) : (
                              <FormButton size="sm" variant="ghost" onClick={() => handleReactivate(u.id)}>
                                Reactivate
                              </FormButton>
                            )
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={inviteMode ? 'Invite New User' : 'Edit User'}>
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {inviteMode && (
          <>
            <div className="flex items-center gap-2 mb-4 p-3 bg-[var(--bg-section)] border border-[var(--divider)] text-xs text-[var(--muted)]">
              <Mail size={13} />
              An invitation email will be sent to this address via Supabase Auth.
            </div>
            <FormField label="Email Address" required>
              <FormInput
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="name@stantonmanagement.com"
              />
            </FormField>
          </>
        )}

        <FormField label="Full Name">
          <FormInput
            value={form.full_name}
            onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
            placeholder="First Last"
          />
        </FormField>

        <FormField label="Role" required>
          <FormSelect value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as UserRole }))}>
            <option value="admin">Admin — full access</option>
            <option value="manager">Manager — operations + approvals</option>
            <option value="bookkeeper">Bookkeeper — ADP + reconciliation</option>
          </FormSelect>
          <p className="text-xs text-[var(--muted)] mt-1">{ROLE_DESCRIPTIONS[form.role]}</p>
        </FormField>

        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--ink)] uppercase tracking-wide mb-1.5">
            Portfolio Access
          </label>
          <p className="text-xs text-[var(--muted)] mb-2">
            {form.role === 'admin' ? 'Admins have access to all portfolios.' : 'Select which portfolios this user can see. Leave blank for all.'}
          </p>
          {form.role !== 'admin' && (
            <div className="space-y-1 max-h-40 overflow-y-auto border border-[var(--border)] p-2">
              {portfolios.map(p => (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                  <input
                    type="checkbox"
                    checked={form.portfolio_ids.includes(p.id)}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      portfolio_ids: e.target.checked
                        ? [...prev.portfolio_ids, p.id]
                        : prev.portfolio_ids.filter(id => id !== p.id),
                    }))}
                    className="w-3.5 h-3.5 rounded-none"
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleSave} loading={saving} fullWidth>
            {inviteMode ? 'Send Invitation' : 'Save Changes'}
          </FormButton>
          <FormButton variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</FormButton>
        </div>
      </Drawer>
    </div>
  )
}
