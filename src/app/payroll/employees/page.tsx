'use client'

import { useState, useEffect } from 'react'
import { Plus, BarChart2, ChevronDown, ChevronUp, RefreshCw, Check, Link, X } from 'lucide-react'
import { usePayrollEmployees, useEmployeeRates, useEmployeeDeptSplits } from '@/hooks/payroll/usePayrollEmployees'
import { useWorkyardReliability } from '@/hooks/payroll/useWorkyardReliability'
import DataTable, { Column } from '@/components/kit/DataTable'
import { StickyTableLayout } from '@/components/kit/StickyTableLayout'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect, StatusBadge,
  Drawer, SectionDivider, InfoBlock, FormTextarea,
} from '@/components/form'
import type { PayrollEmployee } from '@/lib/supabase/types'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'

interface WYEmployeeBasic {
  employee_id: number
  display_name: string
  first_name: string
  last_name: string
  email: string | null
  status: string
  title: string | null
  hourly_rate: number | null
  pay_type: string | null
  phone: string | null
}

interface SyncRow {
  wyId: string
  wyName: string
  wyFirstName: string
  matchedEmployeeId: string
  autoMatched: boolean
  wyRate: number | null
  wyPayType: string | null
  wyPhone: string | null
}

const DEPARTMENTS = ['Acquisitions', 'Asset Management', 'Collections', 'Construction', 'Maintenance', 'Leasing', 'Administration']

const columns: Column<PayrollEmployee & Record<string, unknown>>[] = [
  { key: 'name', label: 'Name', width: 180 },
  { key: 'type', label: 'Type', width: 100, render: (v) => <span className="capitalize">{String(v)}</span> },
  {
    key: 'pay_group', label: 'Pay Group', width: 100,
    render: (v) => (
      <span className={`capitalize text-xs px-1.5 py-0.5 ${v === 'remote' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'text-[var(--muted)]'}`}>
        {String(v ?? 'field')}
      </span>
    ),
  },
  {
    key: 'hourly_rate', label: 'Rate', width: 100,
    render: (v, row) => {
      if (row.type === 'salaried') return row.weekly_rate ? `$${Number(row.weekly_rate).toFixed(2)}/wk` : '—'
      return v ? `$${Number(v).toFixed(2)}/hr` : '—'
    }
  },
  { key: 'trade', label: 'Trade', width: 120, render: (v) => String(v ?? '—') },
  {
    key: 'is_active', label: 'Status', width: 90,
    render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} />
  },
  {
    key: 'pay_tax', label: 'Tax', width: 60,
    render: (v) => <span className={v ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>{v ? '✓' : '—'}</span>
  },
  {
    key: 'wc', label: 'WC', width: 60,
    render: (v) => <span className={v ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>{v ? '✓' : '—'}</span>
  },
  {
    key: 'ot_allowed', label: 'OT', width: 60,
    render: (v) => <span className={v ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>{v ? '✓' : '—'}</span>
  },
  {
    key: 'mileage_eligible', label: 'Mileage', width: 70,
    render: (v) => <span className={v ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>{v ? '✓' : '—'}</span>
  },
  { key: 'workyard_id', label: 'Workyard ID', width: 130, render: (v) => <span className="font-mono text-xs">{String(v ?? '—')}</span> },
]

const emptyEmployee: Partial<PayrollEmployee> = {
  name: '', workyard_id: '', monitask_id: '', type: 'hourly', pay_group: 'field',
  hourly_rate: undefined, weekly_rate: undefined,
  trade: '', is_active: true,
  ot_allowed: false, pay_tax: false, wc: false, mileage_eligible: false,
}

interface DeptSplitRow { department: string; pct: string }

export default function EmployeesPage() {
  const { employees, loading, refetch, upsertEmployee, addRate, upsertDeptSplits } = usePayrollEmployees(true)
  const [showAll, setShowAll] = useState(false)
  const [showReliability, setShowReliability] = useState(false)
  const { rows: reliabilityRows, loading: relLoading } = useWorkyardReliability()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<PayrollEmployee>>(emptyEmployee)

  const [syncOpen, setSyncOpen] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncSaving, setSyncSaving] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncRows, setSyncRows] = useState<SyncRow[]>([])
  const [syncDone, setSyncDone] = useState(false)
  const [syncSummary, setSyncSummary] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newRate, setNewRate] = useState('')
  const [newRateDate, setNewRateDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [deptSplits, setDeptSplits] = useState<DeptSplitRow[]>([
    { department: '', pct: '' },
  ])

  const handleSyncFetch = async () => {
    setSyncLoading(true)
    setSyncError(null)
    setSyncRows([])
    setSyncDone(false)
    try {
      const res = await fetch('/api/workyard/employees')
      const json = await res.json()
      if (!res.ok) {
        setSyncError(json.error ?? 'Failed to fetch Workyard employees')
        return
      }
      const wyEmps: WYEmployeeBasic[] = json.employees
      const byWorkyardId = Object.fromEntries(
        employees.filter(e => e.workyard_id).map(e => [e.workyard_id!.toLowerCase(), e])
      )
      const byFullName = Object.fromEntries(employees.map(e => [e.name.toLowerCase(), e]))
      const byFirstName = Object.fromEntries(employees.map(e => [e.name.toLowerCase().split(' ')[0], e]))

      const rows: SyncRow[] = wyEmps.map(wy => {
        const wyIdStr = String(wy.employee_id)
        const alreadyLinked = byWorkyardId[wyIdStr.toLowerCase()]
        const byFull = byFullName[wy.display_name.toLowerCase()]
        const byFirst = byFirstName[wy.first_name.toLowerCase()]
        const matched = alreadyLinked ?? byFull ?? byFirst
        return {
          wyId: wyIdStr,
          wyName: wy.display_name,
          wyFirstName: wy.first_name,
          matchedEmployeeId: matched?.id ?? '',
          autoMatched: !!matched,
          wyRate: wy.hourly_rate ?? null,
          wyPayType: wy.pay_type ?? null,
          wyPhone: wy.phone ?? null,
        }
      })
      setSyncRows(rows)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSyncLoading(false)
    }
  }

  const handleSyncSave = async () => {
    setSyncSaving(true)
    setSyncError(null)
    setSyncSummary(null)
    try {
      const supabase = createClient()
      const today = new Date().toISOString().split('T')[0]
      const toUpdate = syncRows.filter(r => r.matchedEmployeeId)
      let ratesApplied = 0
      let phonesApplied = 0
      for (const row of toUpdate) {
        const current = employees.find(e => e.id === row.matchedEmployeeId)
        const rateChanged =
          row.wyRate != null && Number(current?.hourly_rate ?? NaN) !== row.wyRate
        const phoneChanged =
          !!row.wyPhone && (current?.phone ?? '') !== row.wyPhone
        const update: { workyard_id: string; hourly_rate?: number; phone?: string } = { workyard_id: row.wyId }
        if (rateChanged) update.hourly_rate = row.wyRate as number
        if (phoneChanged) update.phone = row.wyPhone as string

        const { error } = await supabase
          .from('payroll_employees')
          .update(update)
          .eq('id', row.matchedEmployeeId)
        if (error) throw new Error(error.message)
        if (phoneChanged) phonesApplied++

        // Record the rate in the effective-dated history so the change is auditable.
        if (rateChanged) {
          const { error: rateErr } = await supabase.from('payroll_employee_rates').insert({
            employee_id: row.matchedEmployeeId,
            rate: row.wyRate as number,
            effective_date: today,
          })
          if (rateErr) throw new Error(rateErr.message)
          ratesApplied++
        }
      }
      await refetch()
      setSyncDone(true)
      const pulled: string[] = []
      if (ratesApplied > 0) pulled.push(`${ratesApplied} pay rate${ratesApplied === 1 ? '' : 's'}`)
      if (phonesApplied > 0) pulled.push(`${phonesApplied} phone number${phonesApplied === 1 ? '' : 's'}`)
      setSyncSummary(
        `Linked ${toUpdate.length} employee${toUpdate.length === 1 ? '' : 's'}` +
          (pulled.length ? ` · pulled ${pulled.join(' and ')} from Workyard` : '')
      )
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSyncSaving(false)
    }
  }

  const { rates } = useEmployeeRates(editing.id ?? null)
  const { splits } = useEmployeeDeptSplits(editing.id ?? null)

  // Load the current (latest effective-dated) splits into the editable table so the
  // user edits real values in place rather than re-typing them from a read-only box.
  useEffect(() => {
    if (!drawerOpen) return
    // splits can briefly hold the previously-edited employee's rows until the refetch
    // resolves — ignore them unless they belong to the employee in the drawer.
    if (!editing.id || splits.length === 0 || splits[0].employee_id !== editing.id) {
      setDeptSplits([{ department: '', pct: '' }])
      return
    }
    const latestDate = splits[0].effective_date
    const current = splits.filter(s => s.effective_date === latestDate)
    setDeptSplits(
      current.map(s => ({
        department: s.department,
        pct: String(+(s.allocation_pct * 100).toFixed(2)),
      }))
    )
  }, [editing.id, splits, drawerOpen])

  const displayed = showAll ? employees : employees.filter(e => e.is_active)

  const openNew = () => {
    setEditing({ ...emptyEmployee })
    setDeptSplits([{ department: '', pct: '' }])
    setDrawerOpen(true)
    setError(null)
  }

  const openEdit = (emp: PayrollEmployee) => {
    setEditing({ ...emp })
    setDeptSplits([{ department: '', pct: '' }])
    setDrawerOpen(true)
    setError(null)
  }

  const handleSave = async () => {
    if (!editing.name?.trim()) { setError('Name is required'); return }
    if (!editing.type) { setError('Type is required'); return }

    const filledSplits = deptSplits.filter(r => r.department && r.pct)
    if (editing.type === 'salaried' && filledSplits.length > 0) {
      const total = filledSplits.reduce((s, r) => s + parseFloat(r.pct || '0'), 0)
      if (Math.abs(total - 100) > 0.01) {
        setError(`Dept splits must sum to 100% — current total: ${total.toFixed(0)}%`)
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      // Empty external ids must be NULL, not '' — both columns are uniquely indexed.
      const toSave: Partial<PayrollEmployee> = {
        ...editing,
        workyard_id: editing.workyard_id?.trim() ? editing.workyard_id.trim() : null,
        monitask_id: editing.monitask_id?.trim() ? editing.monitask_id.trim() : null,
        pay_group: editing.pay_group ?? 'field',
      }
      const savedId = await upsertEmployee(toSave)
      if (newRate && savedId) {
        await addRate({
          employee_id: savedId,
          rate: parseFloat(newRate),
          effective_date: newRateDate,
        })
      }
      if (editing.type === 'salaried' && filledSplits.length > 0) {
        const today = new Date().toISOString().split('T')[0]
        await upsertDeptSplits(
          filledSplits.map(r => ({
            employee_id: savedId,
            department: r.department,
            allocation_pct: parseFloat(r.pct) / 100,
            effective_date: today,
            created_by: null,
          }))
        )
      }
      setDrawerOpen(false)
      await refetch()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const tableData = displayed as unknown as (PayrollEmployee & Record<string, unknown>)[]

  const splitTotal = deptSplits.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
  const splitBalanced = Math.abs(splitTotal - 100) < 0.01

  return (
    <StickyTableLayout>
      <PageHeader
        title="Employees & Rates"
        subtitle={`${employees.filter(e => e.is_active).length} active employees`}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
                className="rounded-none"
              />
              Show inactive
            </label>
            <FormButton size="sm" variant="secondary" onClick={() => { setSyncOpen(v => !v); setSyncRows([]); setSyncError(null); setSyncDone(false) }}>
              <Link size={14} className="mr-1" />
              Sync Workyard IDs
            </FormButton>
            <FormButton size="sm" onClick={openNew}>
              <Plus size={14} className="mr-1" />
              Add Employee
            </FormButton>
          </div>
        }
      />

      {/* Workyard ID Sync Panel */}
      {syncOpen && (
        <div className="border-b border-[var(--border)] bg-[var(--bg-section)] px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif text-base text-[var(--primary)]">Sync Workyard IDs &amp; Rates</h3>
            <p className="text-xs text-[var(--muted)]">Match payroll employees to their Workyard accounts and pull their pay rates and phone numbers</p>
          </div>

          {syncError && (
            <div className="mb-3 p-2 bg-[var(--error)]/10 border border-[var(--error)]/30 text-xs text-[var(--error)]">{syncError}</div>
          )}

          {syncDone && (
            <div className="mb-3 p-2 bg-[var(--success)]/10 border border-[var(--success)]/30 text-xs text-[var(--success)] flex items-center gap-2">
              <Check size={12} /> {syncSummary ?? 'Workyard IDs saved successfully.'}
            </div>
          )}

          {syncRows.length === 0 ? (
            <FormButton onClick={handleSyncFetch} loading={syncLoading} size="sm">
              <RefreshCw size={13} className="mr-1" />
              {syncLoading ? 'Fetching…' : 'Fetch Workyard Employees'}
            </FormButton>
          ) : (
            <>
              <div className="border border-[var(--border)] overflow-auto max-h-72 mb-3">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--primary)] text-white sticky top-0">
                      <th className="px-3 py-2 text-left font-medium">Workyard Employee</th>
                      <th className="px-3 py-2 text-left font-medium">Workyard ID</th>
                      <th className="px-3 py-2 text-right font-medium">Rate</th>
                      <th className="px-3 py-2 text-left font-medium">Phone</th>
                      <th className="px-3 py-2 text-left font-medium">Match to Payroll Employee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncRows.map((row, i) => (
                      <tr key={row.wyId} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? '' : 'bg-[var(--bg-section)]'}`}>
                        <td className="px-3 py-1.5">
                          <span className={row.autoMatched ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>
                            {row.autoMatched ? '✓ ' : ''}
                          </span>
                          {row.wyName}
                        </td>
                        <td className="px-3 py-1.5 font-mono">{row.wyId}</td>
                        <td className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                          {row.wyRate != null ? (
                            <>
                              ${row.wyRate.toFixed(2)}/hr
                              {row.wyPayType && row.wyPayType !== 'hourly' && (
                                <span className="ml-1 text-[10px] uppercase text-[var(--warning)]">{row.wyPayType}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {row.wyPhone ?? <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={row.matchedEmployeeId}
                            onChange={e => setSyncRows(prev => prev.map((r, j) => j === i ? { ...r, matchedEmployeeId: e.target.value, autoMatched: false } : r))}
                            className="text-xs border border-[var(--border)] bg-[var(--bg)] px-2 py-1 w-full max-w-[180px]"
                          >
                            <option value="">— skip —</option>
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.id}>{emp.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <FormButton onClick={handleSyncSave} loading={syncSaving} size="sm">
                  Save {syncRows.filter(r => r.matchedEmployeeId).length} Matches
                </FormButton>
                <FormButton variant="ghost" size="sm" onClick={() => { setSyncRows([]); setSyncDone(false); setSyncError(null) }}>
                  Reset
                </FormButton>
              </div>
            </>
          )}
        </div>
      )}

      <DataTable
        data={tableData}
        columns={columns}
        loading={loading}
        tableId="employees"
        onRowClick={(row) => openEdit(row as unknown as PayrollEmployee)}
        emptyMessage="No employees found"
        exportable
        stickyHeader
      />

      {/* Workyard Reliability Section */}
      <div className="border-t border-[var(--border)]">
        <button
          type="button"
          onClick={() => setShowReliability(v => !v)}
          className="w-full flex items-center gap-2 px-6 py-3 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors text-left"
        >
          <BarChart2 size={14} className="text-[var(--muted)]" />
          <span className="font-medium text-sm text-[var(--ink)]">Workyard Reliability</span>
          <span className="text-xs text-[var(--muted)] ml-1">— % of hours sourced from Workyard vs. manually entered</span>
          {showReliability ? <ChevronUp size={13} className="ml-auto text-[var(--muted)]" /> : <ChevronDown size={13} className="ml-auto text-[var(--muted)]" />}
        </button>

        {showReliability && (
          <div className="overflow-auto">
            {relLoading ? (
              <div className="px-6 py-4 text-sm text-[var(--muted)]">Loading…</div>
            ) : reliabilityRows.length === 0 ? (
              <div className="px-6 py-4 text-sm text-[var(--muted)]">No time entry data available yet.</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left font-medium">Employee</th>
                    <th className="px-4 py-2 text-right font-medium">Total Entries</th>
                    <th className="px-4 py-2 text-right font-medium">Workyard</th>
                    <th className="px-4 py-2 text-right font-medium">Manual</th>
                    <th className="px-4 py-2 text-right font-medium">Workyard %</th>
                    <th className="px-4 py-2 text-right font-medium">Avg Unalloc/Wk</th>
                    <th className="px-4 py-2 text-right font-medium">Wks w/ Unalloc</th>
                  </tr>
                </thead>
                <tbody>
                  {reliabilityRows.map((row, i) => (
                    <tr key={row.employee_id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? '' : 'bg-[var(--bg-section)]'}`}>
                      <td className="px-4 py-2 font-medium">{row.employee_name}</td>
                      <td className="px-4 py-2 text-right">{row.total_entries}</td>
                      <td className="px-4 py-2 text-right text-[var(--success)]">{row.workyard_entries}</td>
                      <td className="px-4 py-2 text-right text-[var(--warning)]">{row.manual_entries}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-[var(--border)] rounded-none overflow-hidden">
                            <div
                              className={`h-full ${row.workyard_pct >= 70 ? 'bg-[var(--success)]' : row.workyard_pct >= 40 ? 'bg-[var(--warning)]' : 'bg-[var(--error)]'}`}
                              style={{ width: `${row.workyard_pct}%` }}
                            />
                          </div>
                          <span className={`font-medium text-xs ${
                            row.workyard_pct >= 70 ? 'text-[var(--success)]' :
                            row.workyard_pct >= 40 ? 'text-[var(--warning)]' : 'text-[var(--error)]'
                          }`}>{row.workyard_pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">{row.avg_unallocated_per_week}h</td>
                      <td className="px-4 py-2 text-right">{row.weeks_with_unallocated}/{row.total_weeks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing.id ? 'Edit Employee' : 'New Employee'} width={520}>
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        <SectionDivider label="Identity" />
        <FormField label="Full Name" required>
          <FormInput value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} />
        </FormField>
        <FormField label="Workyard Team Member ID" helperText="Used to match Workyard CSV imports">
          <FormInput
            value={editing.workyard_id ?? ''}
            onChange={e => setEditing(p => ({ ...p, workyard_id: e.target.value }))}
            className="font-mono"
          />
        </FormField>
        <FormField label="Type" required>
          <FormSelect
            value={editing.type ?? 'hourly'}
            onChange={e => setEditing(p => ({ ...p, type: e.target.value as PayrollEmployee['type'] }))}
          >
            <option value="hourly">Hourly</option>
            <option value="salaried">Salaried</option>
            <option value="contractor">Contractor</option>
          </FormSelect>
        </FormField>
        <FormField label="Pay Group" required helperText="Remote workers are paid on a separate run (self-submitted hours + Monitask)">
          <FormSelect
            value={editing.pay_group ?? 'field'}
            onChange={e => setEditing(p => ({ ...p, pay_group: e.target.value as PayrollEmployee['pay_group'] }))}
          >
            <option value="field">Field (Workyard)</option>
            <option value="remote">Remote (Monitask)</option>
          </FormSelect>
        </FormField>
        {editing.pay_group === 'remote' && (
          <FormField label="Monitask User ID" helperText="Used to match Monitask activity to this worker">
            <FormInput
              value={editing.monitask_id ?? ''}
              onChange={e => setEditing(p => ({ ...p, monitask_id: e.target.value }))}
              className="font-mono"
            />
          </FormField>
        )}

        {editing.type !== 'salaried' ? (
          <FormField label="Hourly Rate ($)">
            <FormInput
              type="number" step="0.01" min="0"
              value={editing.hourly_rate ?? ''}
              onChange={e => setEditing(p => ({ ...p, hourly_rate: parseFloat(e.target.value) || undefined }))}
            />
          </FormField>
        ) : (
          <FormField label="Weekly Rate ($)">
            <FormInput
              type="number" step="0.01" min="0"
              value={editing.weekly_rate ?? ''}
              onChange={e => setEditing(p => ({ ...p, weekly_rate: parseFloat(e.target.value) || undefined }))}
            />
          </FormField>
        )}

        <FormField label="Trade / Department">
          <FormInput value={editing.trade ?? ''} onChange={e => setEditing(p => ({ ...p, trade: e.target.value }))} />
        </FormField>

        <SectionDivider label="Flags" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          {([
            ['is_active', 'Active'],
            ['ot_allowed', 'OT Allowed'],
            ['pay_tax', 'Payroll Tax (8%)'],
            ['wc', "Workers' Comp (3%)"],
            ['mileage_eligible', 'Mileage Eligible'],
          ] as [keyof PayrollEmployee, string][]).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-sm text-[var(--ink)] cursor-pointer">
              <input
                type="checkbox"
                checked={!!(editing[field])}
                onChange={e => setEditing(p => ({ ...p, [field]: e.target.checked }))}
                className="rounded-none w-4 h-4"
              />
              {label}
            </label>
          ))}
        </div>

        {/* Rate history */}
        {editing.id && (
          <>
            <SectionDivider label="Rate History" />
            {rates.length === 0 ? (
              <p className="text-xs text-[var(--muted)] mb-3">No rate history yet.</p>
            ) : (
              <table className="w-full text-xs mb-3">
                <thead>
                  <tr className="bg-[var(--bg-section)]">
                    <th className="px-2 py-1.5 text-left text-[var(--muted)] font-medium">Rate</th>
                    <th className="px-2 py-1.5 text-left text-[var(--muted)] font-medium">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map(r => (
                    <tr key={r.id} className="border-b border-[var(--divider)]">
                      <td className="px-2 py-1.5">${Number(r.rate).toFixed(2)}</td>
                      <td className="px-2 py-1.5">{r.effective_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <FormInput type="number" step="0.01" placeholder="New rate" value={newRate} onChange={e => setNewRate(e.target.value)} />
              </div>
              <FormInput type="date" value={newRateDate} onChange={e => setNewRateDate(e.target.value)} className="w-36" />
            </div>
          </>
        )}

        {/* Dept splits for salaried */}
        {editing.type === 'salaried' && (
          <>
            <SectionDivider label="Default Dept Splits" />
            <p className="text-xs text-[var(--muted)] mb-2">
              How this person&apos;s salary is allocated across departments. Edit the values in place — they must sum to 100%.
            </p>
            <div className="border border-[var(--border)] mb-2">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-section)] text-[var(--muted)] text-xs">
                    <th className="px-3 py-2 text-left font-medium">Department</th>
                    <th className="px-3 py-2 text-right font-medium w-24">%</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {deptSplits.map((row, i) => (
                    <tr key={i} className="border-t border-[var(--divider)]">
                      <td className="px-2 py-1">
                        <FormSelect
                          value={row.department}
                          onChange={e => {
                            const updated = [...deptSplits]
                            updated[i] = { ...updated[i], department: e.target.value }
                            setDeptSplits(updated)
                          }}
                          className="w-full"
                        >
                          <option value="">— Select department —</option>
                          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </FormSelect>
                      </td>
                      <td className="px-2 py-1">
                        <FormInput
                          type="number" min="0" max="100" step="1"
                          placeholder="%"
                          value={row.pct}
                          onChange={e => {
                            const updated = [...deptSplits]
                            updated[i] = { ...updated[i], pct: e.target.value }
                            setDeptSplits(updated)
                          }}
                          className="w-full text-right"
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => setDeptSplits(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : [{ department: '', pct: '' }])}
                          className="text-[var(--muted)] hover:text-[var(--error)]"
                          title="Remove department"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--divider)] text-xs font-medium">
                    <td className="px-3 py-2 text-right text-[var(--muted)]">Total</td>
                    <td className={`px-3 py-2 text-right ${splitBalanced ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                      {+splitTotal.toFixed(2)}%
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setDeptSplits(p => [...p, { department: '', pct: '' }])}
              className="text-xs text-[var(--primary)] hover:underline mb-4"
            >
              + Add department
            </button>
          </>
        )}

        <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleSave} loading={saving} fullWidth>
            {editing.id ? 'Save Changes' : 'Add Employee'}
          </FormButton>
          <FormButton variant="ghost" onClick={() => setDrawerOpen(false)}>
            Cancel
          </FormButton>
        </div>
      </Drawer>
    </StickyTableLayout>
  )
}
