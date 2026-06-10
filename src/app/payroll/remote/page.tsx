'use client'

import { useState, useEffect, useCallback } from 'react'
import { Laptop, Plus, Settings2, Activity, AlertTriangle } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { useAuth } from '@/hooks/payroll/useAuth'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/payroll/calculations'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect, FormTextarea,
  InfoBlock, Drawer,
} from '@/components/form'
import type { PayrollEmployee, RemoteBonusConfig, RemoteBonusBasis } from '@/lib/supabase/types'
import { format } from 'date-fns'

const BASIS_LABELS: Record<RemoteBonusBasis, string> = {
  manual: 'Manual (analyst decides each run)',
  per_week: 'Fixed per week',
  per_hour: 'Per hour worked',
  pct_of_pay: '% of pay',
}

async function execOperation(operation: string, input: unknown): Promise<void> {
  const res = await fetch('/api/payroll/operations/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? `Request failed (${res.status})`)
  }
}

export default function RemotePayrollPage() {
  const { isAnalyst, loading: authLoading } = useAuth()
  const { weeks } = usePayrollWeeks()
  const { employees } = usePayrollEmployees(false)

  const remoteWeeks = weeks.filter(w => w.pay_group === 'remote')
  const remoteEmployees = employees.filter(e => e.pay_group === 'remote')

  const [selectedWeekId, setSelectedWeekId] = useState('')
  const [configs, setConfigs] = useState<Record<string, RemoteBonusConfig>>({})
  const [bonusByEmployee, setBonusByEmployee] = useState<Record<string, number>>({})
  const [submittedByEmployee, setSubmittedByEmployee] = useState<Record<string, number>>({})
  const [activityByEmployee, setActivityByEmployee] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Flag a worker when submitted hours exceed tracked activity by more than this.
  const OVERPAY_THRESHOLD = 0.15

  // Drawer state (shared by both config + payout forms)
  const [mode, setMode] = useState<'config' | 'payout' | null>(null)
  const [target, setTarget] = useState<PayrollEmployee | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ structureNote: '', basis: 'manual' as RemoteBonusBasis, targetAmount: '', amount: '', description: '' })

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Active bonus config per remote worker.
    const { data: cfg } = await supabase
      .from('remote_bonus_config')
      .select('*')
      .eq('is_active', true)
    const cfgMap: Record<string, RemoteBonusConfig> = {}
    for (const c of (cfg ?? []) as RemoteBonusConfig[]) cfgMap[c.employee_id] = c
    setConfigs(cfgMap)

    // Bonus payouts, submitted hours, and Monitask activity on the selected run.
    if (selectedWeekId) {
      const [adjRes, subRes, actRes] = await Promise.all([
        supabase.from('payroll_adjustments')
          .select('employee_id, amount, type, is_active')
          .eq('payroll_week_id', selectedWeekId).eq('type', 'bonus'),
        supabase.from('payroll_time_entries')
          .select('employee_id, regular_hours, is_active')
          .eq('payroll_week_id', selectedWeekId).eq('source', 'remote_submitted'),
        supabase.from('monitask_activity')
          .select('employee_id, active_hours')
          .eq('payroll_week_id', selectedWeekId),
      ])
      const sums: Record<string, number> = {}
      for (const a of (adjRes.data ?? []) as { employee_id: string; amount: number; is_active?: boolean }[]) {
        if (a.is_active === false) continue
        sums[a.employee_id] = (sums[a.employee_id] ?? 0) + Number(a.amount)
      }
      setBonusByEmployee(sums)

      const sub: Record<string, number> = {}
      for (const e of (subRes.data ?? []) as { employee_id: string; regular_hours: number; is_active?: boolean }[]) {
        if (e.is_active === false) continue
        sub[e.employee_id] = (sub[e.employee_id] ?? 0) + Number(e.regular_hours)
      }
      setSubmittedByEmployee(sub)

      const act: Record<string, number> = {}
      for (const m of (actRes.data ?? []) as { employee_id: string; active_hours: number }[]) {
        act[m.employee_id] = (act[m.employee_id] ?? 0) + Number(m.active_hours)
      }
      setActivityByEmployee(act)
    } else {
      setBonusByEmployee({})
      setSubmittedByEmployee({})
      setActivityByEmployee({})
    }
    setLoading(false)
  }, [selectedWeekId])

  const getPortalLink = async (emp: PayrollEmployee) => {
    setError(null)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/portal/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: emp.id }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Could not create portal link'); return }
      const url = `${window.location.origin}${json.path}`
      try { await navigator.clipboard.writeText(url) } catch { /* clipboard optional */ }
      setSyncMsg(`Portal link for ${emp.name} copied: ${url}`)
    } catch {
      setError('Network error creating portal link')
    }
  }

  const syncMonitask = async () => {
    if (!selectedWeekId) return
    setSyncing(true)
    setSyncMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/monitask/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekId: selectedWeekId }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Monitask sync failed'); return }
      setSyncMsg(`Pulled ${json.imported} activity row(s)${json.unmatched ? `, ${json.unmatched} unmatched` : ''}.`)
      await refresh()
    } catch {
      setError('Network error during Monitask sync')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => { refresh() }, [refresh])

  const openConfig = (emp: PayrollEmployee) => {
    const existing = configs[emp.id]
    setTarget(emp)
    setMode('config')
    setError(null)
    setForm({
      structureNote: existing?.structure_note ?? '',
      basis: existing?.basis ?? 'manual',
      targetAmount: existing?.target_amount != null ? String(existing.target_amount) : '',
      amount: '',
      description: '',
    })
  }

  const openPayout = (emp: PayrollEmployee) => {
    setTarget(emp)
    setMode('payout')
    setError(null)
    setForm(f => ({ ...f, amount: '', description: '' }))
  }

  const handleSave = async () => {
    if (!target) return
    setSaving(true)
    setError(null)
    try {
      if (mode === 'config') {
        if (!form.structureNote.trim()) throw new Error('A structure note is required')
        await execOperation('remote_bonus.set_config', {
          employeeId: target.id,
          structureNote: form.structureNote.trim(),
          basis: form.basis,
          targetAmount: form.targetAmount ? Number(form.targetAmount) : undefined,
        })
      } else if (mode === 'payout') {
        if (!selectedWeekId) throw new Error('Select a remote run first')
        const amount = Number(form.amount)
        if (!(amount > 0)) throw new Error('Enter a bonus amount greater than 0')
        if (!form.description.trim()) throw new Error('A description is required')
        await execOperation('remote_bonus.add', {
          employeeId: target.id,
          weekId: selectedWeekId,
          amount,
          description: form.description.trim(),
        })
      }
      setMode(null)
      setTarget(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!authLoading && !isAnalyst) {
    return (
      <div>
        <PageHeader title="Remote Payroll" subtitle="Bonuses and activity review for remote workers" />
        <div className="p-6">
          <InfoBlock variant="warning" title="Analyst access required">
            The remote payroll workspace is available to payroll analysts and admins.
          </InfoBlock>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Remote Payroll"
        subtitle="Manage the remote run — bonus structures and per-run bonus payouts"
      />

      <div className="p-6 max-w-5xl">
        <div className="mb-6 flex items-end gap-3">
          <div className="max-w-xs flex-1">
            <FormField label="Remote Payroll Run">
              <FormSelect value={selectedWeekId} onChange={e => setSelectedWeekId(e.target.value)}>
                <option value="">— Select a remote run —</option>
                {remoteWeeks.map(w => (
                  <option key={w.id} value={w.id}>
                    Week of {format(new Date(w.week_start + 'T00:00:00'), 'MMM d, yyyy')} ({w.status})
                  </option>
                ))}
              </FormSelect>
            </FormField>
          </div>
          {remoteWeeks.length === 0 && (
            <p className="text-xs text-[var(--warning)] mb-2">
              No remote runs yet — create one from the dashboard (pick pay group “Remote”).
            </p>
          )}
        </div>

        {error && <div className="mb-4"><InfoBlock variant="error">{error}</InfoBlock></div>}
        {syncMsg && <div className="mb-4 cursor-pointer" onClick={() => setSyncMsg(null)}><InfoBlock variant="success">{syncMsg}</InfoBlock></div>}

        {remoteEmployees.length === 0 ? (
          <InfoBlock title="No remote workers">
            Mark employees as “Remote” on the Employees &amp; Rates page to manage them here.
          </InfoBlock>
        ) : (
          <div className="border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--primary)] text-white text-xs">
                  <th className="px-4 py-2.5 text-left font-medium">Worker</th>
                  <th className="px-4 py-2.5 text-left font-medium">Monitask ID</th>
                  <th className="px-4 py-2.5 text-left font-medium">Bonus Structure</th>
                  <th className="px-4 py-2.5 text-right font-medium">Bonus This Run</th>
                  <th className="px-4 py-2.5 w-44" />
                </tr>
              </thead>
              <tbody>
                {remoteEmployees.map((emp, i) => {
                  const cfg = configs[emp.id]
                  const paid = bonusByEmployee[emp.id] ?? 0
                  return (
                    <tr key={emp.id} className={`border-t border-[var(--divider)] ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                      <td className="px-4 py-3 font-medium">{emp.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{emp.monitask_id ?? '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {cfg ? (
                          <div>
                            <span className="text-[var(--ink)]">{BASIS_LABELS[cfg.basis]}</span>
                            {cfg.target_amount != null && <span className="text-[var(--muted)]"> · {formatCurrency(cfg.target_amount)}</span>}
                            <div className="text-[var(--muted)] truncate max-w-xs">{cfg.structure_note}</div>
                          </div>
                        ) : (
                          <span className="text-[var(--muted)] italic">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {paid > 0 ? formatCurrency(paid) : <span className="text-[var(--muted)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <FormButton size="sm" variant="ghost" onClick={() => getPortalLink(emp)}>
                            <Laptop size={12} className="mr-1" /> Link
                          </FormButton>
                          <FormButton size="sm" variant="ghost" onClick={() => openConfig(emp)}>
                            <Settings2 size={12} className="mr-1" /> Structure
                          </FormButton>
                          <FormButton size="sm" onClick={() => openPayout(emp)} disabled={!selectedWeekId}>
                            <Plus size={12} className="mr-1" /> Bonus
                          </FormButton>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Overpay review — submitted (paid) hours vs Monitask activity (reference) */}
        {selectedWeekId && remoteEmployees.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-serif text-base text-[var(--primary)]">Activity Review</h3>
                <p className="text-xs text-[var(--muted)]">
                  Submitted hours are paid by default. Workers flagged below submitted more than {Math.round(OVERPAY_THRESHOLD * 100)}% above tracked activity — review before approving.
                </p>
              </div>
              <FormButton size="sm" variant="secondary" onClick={syncMonitask} loading={syncing}>
                <Activity size={13} className="mr-1" /> Pull Monitask Activity
              </FormButton>
            </div>

            <div className="border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left font-medium">Worker</th>
                    <th className="px-4 py-2 text-right font-medium">Submitted (paid)</th>
                    <th className="px-4 py-2 text-right font-medium">Monitask Activity</th>
                    <th className="px-4 py-2 text-right font-medium">Δ</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {remoteEmployees.map((emp, i) => {
                    const submitted = submittedByEmployee[emp.id] ?? 0
                    const active = activityByEmployee[emp.id] ?? 0
                    const hasActivity = active > 0
                    const delta = submitted - active
                    const over = hasActivity && submitted > active * (1 + OVERPAY_THRESHOLD)
                    return (
                      <tr key={emp.id} className={`border-b border-[var(--divider)] ${i % 2 === 0 ? '' : 'bg-[var(--bg-section)]'}`}>
                        <td className="px-4 py-2 font-medium">{emp.name}</td>
                        <td className="px-4 py-2 text-right">{submitted ? `${submitted.toFixed(2)}h` : '—'}</td>
                        <td className="px-4 py-2 text-right">{hasActivity ? `${active.toFixed(2)}h` : <span className="text-[var(--muted)]">no data</span>}</td>
                        <td className={`px-4 py-2 text-right ${over ? 'text-[var(--error)] font-medium' : 'text-[var(--muted)]'}`}>
                          {hasActivity ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}h` : '—'}
                        </td>
                        <td className="px-4 py-2">
                          {!hasActivity ? (
                            <span className="text-xs text-[var(--muted)]">—</span>
                          ) : over ? (
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--error)]">
                              <AlertTriangle size={12} /> Review — over activity
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--success)]">✓ Within range</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--muted)] mt-2">
              Capping paid hours to activity is a manual decision — adjust a worker’s submitted entries on the timesheet if needed. Activity is never deducted automatically.
            </p>
          </div>
        )}

        {loading && <p className="mt-3 text-xs text-[var(--muted)]">Loading…</p>}
      </div>

      <Drawer
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'config' ? `Bonus Structure — ${target?.name ?? ''}` : `Add Bonus — ${target?.name ?? ''}`}
      >
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {mode === 'config' && (
          <>
            <FormField label="Basis" required>
              <FormSelect value={form.basis} onChange={e => setForm(p => ({ ...p, basis: e.target.value as RemoteBonusBasis }))}>
                {(Object.keys(BASIS_LABELS) as RemoteBonusBasis[]).map(b => (
                  <option key={b} value={b}>{BASIS_LABELS[b]}</option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Target Amount ($)" helperText="Optional — the expected/target bonus under this structure">
              <FormInput type="number" step="0.01" min="0" value={form.targetAmount}
                onChange={e => setForm(p => ({ ...p, targetAmount: e.target.value }))} />
            </FormField>
            <FormField label="Structure Note" required helperText="Describe the agreed arrangement (the analyst reads this each run)">
              <FormTextarea value={form.structureNote} onChange={e => setForm(p => ({ ...p, structureNote: e.target.value }))} rows={4} />
            </FormField>
          </>
        )}

        {mode === 'payout' && (
          <>
            <div className="flex items-center gap-2 mb-4 p-3 bg-[var(--bg-section)] border border-[var(--divider)] text-xs text-[var(--muted)]">
              <Laptop size={13} />
              Adds a bonus to the selected remote run; it flows into the worker’s gross pay.
            </div>
            <FormField label="Amount ($)" required>
              <FormInput type="number" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </FormField>
            <FormField label="Description" required>
              <FormInput value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="e.g. Q2 productivity bonus" />
            </FormField>
          </>
        )}

        <div className="flex gap-2 pt-4 border-t border-[var(--divider)]">
          <FormButton onClick={handleSave} loading={saving} fullWidth>
            {mode === 'config' ? 'Save Structure' : 'Add Bonus'}
          </FormButton>
          <FormButton variant="ghost" onClick={() => setMode(null)}>Cancel</FormButton>
        </div>
      </Drawer>
    </div>
  )
}
