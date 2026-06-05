'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CircleDollarSign, AlertTriangle, CheckCircle2, DownloadCloud, Link2Off } from 'lucide-react'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { PageHeader, InfoBlock, FormButton } from '@/components/form'
import { formatCurrency } from '@/lib/payroll/calculations'

interface WYEmployee {
  employee_id: number
  display_name: string
  hourly_rate: number | null
  pay_type: string | null
}

type Status = 'in_sync' | 'update_available' | 'can_pull' | 'wy_no_rate' | 'wy_missing' | 'no_link'

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  in_sync: { label: 'In sync', cls: 'bg-[var(--success)]/10 text-[var(--success)]' },
  update_available: { label: 'Workyard differs', cls: 'bg-[var(--accent)]/15 text-[var(--accent)]' },
  can_pull: { label: 'Rate available to pull', cls: 'bg-[var(--primary)]/10 text-[var(--primary)]' },
  wy_no_rate: { label: 'No rate in Workyard', cls: 'bg-[var(--warning)]/15 text-[var(--warning)]' },
  wy_missing: { label: 'Not found in Workyard', cls: 'bg-[var(--warning)]/15 text-[var(--warning)]' },
  no_link: { label: 'No Workyard link', cls: 'bg-[var(--muted)]/15 text-[var(--muted)]' },
}

export default function RateCoveragePage() {
  const { employees, loading } = usePayrollEmployees(false)
  const [wyEmployees, setWyEmployees] = useState<WYEmployee[] | null>(null)
  const [wyError, setWyError] = useState<string | null>(null)
  const [wyLoading, setWyLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      setWyLoading(true)
      setWyError(null)
      try {
        const res = await fetch('/api/workyard/employees')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to load Workyard employees')
        if (active) setWyEmployees(data.employees as WYEmployee[])
      } catch (e) {
        if (active) setWyError(e instanceof Error ? e.message : 'Failed to load Workyard employees')
      } finally {
        if (active) setWyLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const rows = useMemo(() => {
    const wyById = new Map<string, WYEmployee>()
    for (const w of wyEmployees ?? []) wyById.set(String(w.employee_id), w)

    return employees.map((emp) => {
      const dbRate = emp.hourly_rate ?? emp.weekly_rate ?? null
      const hasRate = dbRate != null
      const wy = emp.workyard_id ? wyById.get(emp.workyard_id) : undefined

      let status: Status
      if (!emp.workyard_id) status = 'no_link'
      else if (!wy) status = 'wy_missing'
      else if (wy.hourly_rate == null) status = 'wy_no_rate'
      else if (!hasRate) status = 'can_pull'
      else if (Number(dbRate) !== Number(wy.hourly_rate)) status = 'update_available'
      else status = 'in_sync'

      return {
        id: emp.id,
        name: emp.name,
        type: emp.type,
        dbRate,
        hasRate,
        wyRate: wy?.hourly_rate ?? null,
        wyPayType: wy?.pay_type ?? null,
        status,
      }
    })
  }, [employees, wyEmployees])

  const stats = useMemo(() => {
    const total = rows.length
    const missing = rows.filter((r) => !r.hasRate)
    const pullable = missing.filter((r) => r.status === 'can_pull')
    const manual = missing.filter((r) => r.status !== 'can_pull')
    const updates = rows.filter((r) => r.status === 'update_available')
    return { total, withRate: total - missing.length, missing, pullable, manual, updates }
  }, [rows])

  const busy = loading || wyLoading

  return (
    <div>
      <PageHeader
        title="Pay Rate Coverage"
        subtitle="Which employees have a pay rate — and which can be pulled from Workyard"
        actions={
          <Link href="/payroll/employees">
            <FormButton size="sm">
              <DownloadCloud size={14} className="mr-1" />
              Sync rates from Workyard
            </FormButton>
          </Link>
        }
      />

      <div className="p-6 space-y-6">
        {wyError && (
          <InfoBlock variant="warning" title="Couldn't reach Workyard">
            {wyError} — current pay rates are still shown from the payroll database.
          </InfoBlock>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-[var(--border)] bg-white p-4">
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide">Active employees</div>
            <div className="text-2xl font-serif text-[var(--primary)] mt-1">{busy ? '—' : stats.total}</div>
          </div>
          <div className="border border-[var(--border)] bg-white p-4">
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide flex items-center gap-1">
              <CheckCircle2 size={12} className="text-[var(--success)]" /> Have a rate
            </div>
            <div className="text-2xl font-serif text-[var(--success)] mt-1">{busy ? '—' : stats.withRate}</div>
          </div>
          <div className="border-2 border-[var(--error)] bg-white p-4">
            <div className="text-xs text-[var(--error)] uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle size={12} /> Missing a rate
            </div>
            <div className="text-2xl font-serif text-[var(--error)] mt-1">{busy ? '—' : stats.missing.length}</div>
            <div className="text-xs text-[var(--muted)] mt-1">
              {busy ? '' : `${stats.pullable.length} pullable · ${stats.manual.length} need manual`}
            </div>
          </div>
          <div className="border border-[var(--border)] bg-white p-4">
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide flex items-center gap-1">
              <DownloadCloud size={12} className="text-[var(--primary)]" /> Workyard updates
            </div>
            <div className="text-2xl font-serif text-[var(--primary)] mt-1">{busy ? '—' : stats.updates.length}</div>
            <div className="text-xs text-[var(--muted)] mt-1">rate changed vs stored</div>
          </div>
        </div>

        {/* Callout for the gap */}
        {!busy && stats.missing.length > 0 && (
          <InfoBlock variant="error" title={`${stats.missing.length} employee${stats.missing.length === 1 ? '' : 's'} have no pay rate`}>
            Payroll gross pay will be $0 for these until a rate is set.
            {stats.pullable.length > 0 && (
              <> {stats.pullable.length} can be pulled now from Workyard — use{' '}
                <Link href="/payroll/employees" className="underline text-[var(--primary)]">Sync rates from Workyard</Link>.</>
            )}
            {stats.manual.length > 0 && (
              <> {stats.manual.length} have no Workyard rate and must be entered manually
                ({stats.manual.map((r) => r.name).join(', ')}).</>
            )}
          </InfoBlock>
        )}
        {!busy && stats.missing.length === 0 && (
          <InfoBlock variant="success" title="Every active employee has a pay rate">
            Payroll will calculate gross pay for all active employees.
          </InfoBlock>
        )}

        {/* Table */}
        <div className="border border-[var(--border)] overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[var(--primary)] text-white text-xs">
                <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Current Rate</th>
                <th className="px-4 py-2.5 text-right font-medium">Workyard Rate</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">No active employees.</td></tr>
              ) : (
                rows
                  .slice()
                  .sort((a, b) => Number(a.hasRate) - Number(b.hasRate)) // missing first
                  .map((r, i) => {
                    const meta = STATUS_META[r.status]
                    return (
                      <tr key={r.id} className={`border-t border-[var(--divider)] ${!r.hasRate ? 'bg-[var(--error)]/5' : i % 2 ? 'bg-[var(--bg-section)]' : 'bg-white'}`}>
                        <td className="px-4 py-2.5 font-medium">
                          {r.status === 'no_link' && <Link2Off size={12} className="inline mr-1 text-[var(--muted)]" />}
                          {r.name}
                        </td>
                        <td className="px-4 py-2.5 capitalize text-[var(--muted)]">{r.type}</td>
                        <td className="px-4 py-2.5 text-right">
                          {r.dbRate != null
                            ? `${formatCurrency(Number(r.dbRate))}${r.type === 'salaried' ? '/wk' : '/hr'}`
                            : <span className="text-[var(--error)] font-medium">none</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {r.wyRate != null ? (
                            <>
                              {formatCurrency(r.wyRate)}/hr
                              {r.wyPayType && r.wyPayType !== 'hourly' && (
                                <span className="ml-1 text-[10px] uppercase text-[var(--warning)]">{r.wyPayType}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                        </td>
                      </tr>
                    )
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
