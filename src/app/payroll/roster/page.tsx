'use client'

import { useMemo, useState } from 'react'
import { Plus, History, Clock } from 'lucide-react'
import { usePayrollEmployees, useEmployeeAudit } from '@/hooks/payroll/usePayrollEmployees'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect, StatusBadge,
  Drawer, SectionDivider, InfoBlock,
} from '@/components/form'
import type { PayrollEmployee, PayrollEmployeeAudit } from '@/lib/supabase/types'
import { format } from 'date-fns'

const DEPARTMENTS = [
  '01 - Corporate',
  '02 - Construction',
  '03 - Leasing',
  '04 - Property Management',
  '05 - Accounting',
  '06 - Maintenance',
]

const PAY_CLASSIFICATIONS = ['1099 reimbursement', 'W-2', 'Remote']

type FieldKind = 'text' | 'money' | 'date' | 'select' | 'bool'
interface FieldDef {
  key: keyof PayrollEmployee
  label: string
  kind: FieldKind
  options?: string[]
  section: 'Identity' | 'Classification' | 'Compensation' | 'Dates'
}

// Single source of truth for the edit form + audit labels (field key matches the DB column,
// which is exactly what the audit trigger records).
const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Employee Name', kind: 'text', section: 'Identity' },
  { key: 'department', label: 'Department', kind: 'select', options: DEPARTMENTS, section: 'Identity' },
  { key: 'role', label: 'Role', kind: 'text', section: 'Identity' },
  { key: 'employee_code', label: 'Code + ID', kind: 'text', section: 'Identity' },
  { key: 'phone', label: 'Phone Number', kind: 'text', section: 'Identity' },
  { key: 'email', label: 'E-mail', kind: 'text', section: 'Identity' },
  { key: 'type', label: 'Pay Type', kind: 'select', options: ['hourly', 'salaried', 'contractor'], section: 'Classification' },
  { key: 'pay_group', label: 'Pay Group', kind: 'select', options: ['field', 'remote'], section: 'Classification' },
  { key: 'pay_classification', label: 'Type (1099 / W-2 / Remote)', kind: 'select', options: PAY_CLASSIFICATIONS, section: 'Classification' },
  { key: 'hourly_rate', label: 'Rate ($/hr)', kind: 'money', section: 'Compensation' },
  { key: 'amount', label: 'Amount ($)', kind: 'money', section: 'Compensation' },
  { key: 'phone_reimbursement', label: 'Phone Reimb ($)', kind: 'money', section: 'Compensation' },
  { key: 'monthly_bonus', label: 'Monthly Bonus ($)', kind: 'money', section: 'Compensation' },
  { key: 'bonus', label: 'Bonus ($)', kind: 'money', section: 'Compensation' },
  { key: 'rent_adjustment', label: 'Rent Adjustment ($)', kind: 'money', section: 'Compensation' },
  { key: 'hired_on', label: 'Hired On', kind: 'date', section: 'Dates' },
  { key: 'comp_updated_on', label: 'Comp Updated On', kind: 'date', section: 'Dates' },
]

const SECTIONS: FieldDef['section'][] = ['Identity', 'Classification', 'Compensation', 'Dates']

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELDS.map(f => [f.key, f.label]).concat([['is_active', 'Active'], ['is_management', 'Management']]),
)

const money = (v: unknown) =>
  v == null || v === '' ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtWhen = (iso: string) => {
  try { return format(new Date(iso), 'MMM d, yyyy h:mm a') } catch { return iso }
}
const fmtDay = (iso: string) => {
  try { return format(new Date(iso), 'MMM d, yyyy') } catch { return iso }
}

export default function RosterPage() {
  const { employees, loading, refetch, upsertEmployee } = usePayrollEmployees(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<PayrollEmployee>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const { audit, lastByField, refetch: refetchAudit } = useEmployeeAudit(editing.id ?? null)

  // Sort people by employee code within each group; rows without a code sort last
  // (then by name), and codes compare numerically so "9" precedes "10".
  const byCode = (a: PayrollEmployee, b: PayrollEmployee) => {
    const ca = a.employee_code?.trim(), cb = b.employee_code?.trim()
    if (!ca && !cb) return a.name.localeCompare(b.name)
    if (!ca) return 1
    if (!cb) return -1
    return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' })
  }

  const byDept = useMemo(() => {
    const groups = new Map<string, PayrollEmployee[]>()
    for (const dept of DEPARTMENTS) groups.set(dept, [])
    const other: PayrollEmployee[] = []
    for (const e of employees) {
      if (e.department && groups.has(e.department)) groups.get(e.department)!.push(e)
      else if (e.department) { if (!groups.has(e.department)) groups.set(e.department, []); groups.get(e.department)!.push(e) }
      else other.push(e)
    }
    if (other.length) groups.set('Unassigned', other)
    for (const rows of groups.values()) rows.sort(byCode)
    return groups
  }, [employees])

  const openNew = () => {
    setEditing({ type: 'hourly', pay_group: 'field', is_active: true, is_management: false })
    setShowHistory(false)
    setError(null)
    setDrawerOpen(true)
  }
  const openEdit = (emp: PayrollEmployee) => {
    setEditing({ ...emp })
    setShowHistory(false)
    setError(null)
    setDrawerOpen(true)
  }

  const setField = (key: keyof PayrollEmployee, raw: string | boolean) => {
    setEditing(p => ({ ...p, [key]: raw }))
  }

  const handleSave = async () => {
    if (!editing.name?.trim()) { setError('Employee name is required'); return }
    if (!editing.type) { setError('Pay type is required'); return }
    setSaving(true)
    setError(null)
    try {
      // Normalise blanks: empty strings -> null so the audit diff is clean and numeric/date columns
      // don't choke on ''. Money fields come in as strings from the inputs.
      const moneyKeys = new Set(FIELDS.filter(f => f.kind === 'money').map(f => f.key))
      const toSave: Record<string, unknown> = { ...editing }
      for (const f of FIELDS) {
        const v = toSave[f.key]
        if (v === '' || v === undefined) { toSave[f.key] = null; continue }
        if (moneyKeys.has(f.key) && v != null) {
          const n = parseFloat(String(v))
          toSave[f.key] = Number.isFinite(n) ? n : null
        }
      }
      await upsertEmployee(toSave as Partial<PayrollEmployee>)
      await refetch()
      await refetchAudit()
      setDrawerOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const renderInput = (f: FieldDef) => {
    const val = editing[f.key]
    if (f.kind === 'select') {
      return (
        <FormSelect value={(val as string) ?? ''} onChange={e => setField(f.key, e.target.value)}>
          <option value="">—</option>
          {f.options!.map(o => <option key={o} value={o} className="capitalize">{o}</option>)}
        </FormSelect>
      )
    }
    if (f.kind === 'date') {
      return <FormInput type="date" value={(val as string) ?? ''} onChange={e => setField(f.key, e.target.value)} />
    }
    if (f.kind === 'money') {
      return <FormInput type="number" step="0.01" min="0" value={(val as number | string) ?? ''} onChange={e => setField(f.key, e.target.value)} />
    }
    return <FormInput value={(val as string) ?? ''} onChange={e => setField(f.key, e.target.value)} />
  }

  const fieldStamp = (key: string) => {
    const a = lastByField[key]
    if (!a) return null
    return (
      <span className="flex items-center gap-1 text-[10px] text-[var(--muted)] mt-0.5">
        <Clock size={9} />
        edited {fmtWhen(a.changed_at)}{a.changed_by_email ? ` · ${a.changed_by_email}` : ''}
      </span>
    )
  }

  const activeCount = employees.filter(e => e.is_active).length

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Roster"
        subtitle={`${employees.length} people · ${activeCount} active — the master comp sheet (source of truth)`}
        actions={
          <FormButton size="sm" onClick={openNew}>
            <Plus size={14} className="mr-1" />
            Add Person
          </FormButton>
        }
      />

      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="text-sm text-[var(--muted)] py-8">Loading roster…</div>
        ) : (
          Array.from(byDept.entries()).map(([dept, rows]) =>
            rows.length === 0 ? null : (
              <div key={dept} className="mb-7">
                <div className="flex items-baseline gap-2 mb-2">
                  <h2 className="font-serif text-base text-[var(--primary)]">{dept}</h2>
                  <span className="text-xs text-[var(--muted)]">{rows.length}</span>
                </div>
                <div className="border border-[var(--border)] overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--primary)] text-white text-left">
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">Code</th>
                        <th className="px-3 py-2 font-medium">Phone</th>
                        <th className="px-3 py-2 font-medium">E-mail</th>
                        <th className="px-3 py-2 font-medium text-right">Rate</th>
                        <th className="px-3 py-2 font-medium text-right">Amount</th>
                        <th className="px-3 py-2 font-medium text-right">Ph. Reimb</th>
                        <th className="px-3 py-2 font-medium text-right">Mo. Bonus</th>
                        <th className="px-3 py-2 font-medium">Hired</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e, i) => (
                        <tr
                          key={e.id}
                          onClick={() => openEdit(e)}
                          className={`border-b border-[var(--divider)] cursor-pointer hover:bg-[var(--primary)]/5 ${i % 2 ? 'bg-[var(--bg-section)]' : ''}`}
                        >
                          <td className="px-3 py-1.5 font-medium text-[var(--ink)] whitespace-nowrap">{e.name}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{e.role ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{e.employee_code ?? '—'}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{e.phone ?? '—'}</td>
                          <td className="px-3 py-1.5">{e.email ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{e.hourly_rate != null ? `${money(e.hourly_rate)}/hr` : '—'}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(e.amount)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(e.phone_reimbursement)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(e.monthly_bonus)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{e.hired_on ? fmtDay(e.hired_on) : '—'}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{e.pay_classification ?? '—'}</td>
                          <td className="px-3 py-1.5"><StatusBadge status={e.is_active ? 'active' : 'inactive'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          )
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing.id ? 'Edit Person' : 'Add Person'} width={560}>
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {SECTIONS.map(section => (
          <div key={section}>
            <SectionDivider label={section} />
            {section === 'Compensation' && (
              <p className="text-xs text-[var(--muted)] mb-3">
                Use <strong>Rate</strong> for hourly pay and <strong>Amount</strong> for a flat/period figure — mirrors the comp sheet.
              </p>
            )}
            {FIELDS.filter(f => f.section === section).map(f => (
              <FormField key={f.key as string} label={f.label} required={f.key === 'name' || f.key === 'type'}>
                {renderInput(f)}
                {fieldStamp(f.key as string)}
              </FormField>
            ))}
          </div>
        ))}

        <SectionDivider label="Flags" />
        <div className="grid grid-cols-2 gap-3 mb-2">
          {([['is_active', 'Active'], ['is_management', 'Management']] as [keyof PayrollEmployee, string][]).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-[var(--ink)] cursor-pointer">
              <input
                type="checkbox"
                checked={!!editing[key]}
                onChange={e => setField(key, e.target.checked)}
                className="rounded-none w-4 h-4"
              />
              {label}
            </label>
          ))}
        </div>
        <div className="mb-4">
          {fieldStamp('is_active')}
          {fieldStamp('is_management')}
        </div>

        {/* Audit trail */}
        {editing.id && (
          <>
            <button
              type="button"
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors text-left text-sm"
            >
              <History size={13} className="text-[var(--muted)]" />
              <span className="font-medium">Change History</span>
              <span className="text-xs text-[var(--muted)]">{audit.length} change{audit.length === 1 ? '' : 's'}</span>
            </button>
            {showHistory && (
              <div className="border border-t-0 border-[var(--border)] max-h-72 overflow-auto">
                {audit.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-[var(--muted)]">No changes recorded yet.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg-section)] text-[var(--muted)] text-left sticky top-0">
                        <th className="px-2 py-1.5 font-medium">Field</th>
                        <th className="px-2 py-1.5 font-medium">Change</th>
                        <th className="px-2 py-1.5 font-medium">When</th>
                        <th className="px-2 py-1.5 font-medium">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((a: PayrollEmployeeAudit) => (
                        <tr key={a.id} className="border-b border-[var(--divider)] align-top">
                          <td className="px-2 py-1.5 whitespace-nowrap">{FIELD_LABELS[a.field] ?? a.field}</td>
                          <td className="px-2 py-1.5">
                            {a.operation === 'insert'
                              ? <span className="text-[var(--success)]">set to {a.new_value ?? '—'}</span>
                              : <span><span className="text-[var(--muted)] line-through">{a.old_value ?? '—'}</span> → {a.new_value ?? '—'}</span>}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-[var(--muted)]">{fmtWhen(a.changed_at)}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-[var(--muted)]">{a.changed_by_email ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 mt-5 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleSave} loading={saving} fullWidth>
            {editing.id ? 'Save Changes' : 'Add Person'}
          </FormButton>
          <FormButton variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</FormButton>
        </div>
      </Drawer>
    </div>
  )
}
