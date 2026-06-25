'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Building2, EyeOff, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/payroll/useAuth'
import { PageHeader, InfoBlock, SectionDivider } from '@/components/form'

interface Row {
  id: string
  code: string | null
  name: string | null
  owner_llc: string | null
  total_units: number | null
  is_active: boolean
  is_suppressed: boolean
  suppressed_reason: string | null
}

/** Accessible on/off switch styled with the app's design tokens. */
function Toggle({
  on, disabled, onChange, label,
}: { on: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-[var(--error)]' : 'bg-[var(--border)]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export default function SuppressionPage() {
  const { isManager, profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showOnlyHidden, setShowOnlyHidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Deliberately UNFILTERED: this is the one screen where the junk, the inactive, and the
    // already-hidden rows must all be visible — that's how you find the one to say "no thanks".
    const { data, error: err } = await supabase
      .from('payroll_property')
      .select('id:property_id, code, name, owner_llc, total_units, is_active, is_suppressed, suppressed_reason')
      .order('code')
    if (err) { setError(err.message); setLoading(false); return }
    setRows((data ?? []) as unknown as Row[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const setSuppressed = useCallback(async (id: string, next: boolean) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, is_suppressed: next } : r)))
    const supabase = createClient()
    const patch = next
      ? { is_suppressed: true, suppressed_at: new Date().toISOString(), suppressed_by: profile?.id ?? null }
      : { is_suppressed: false, suppressed_reason: null, suppressed_at: null, suppressed_by: null }
    const { error: err } = await supabase.from('payroll_property').update(patch).eq('property_id', id)
    if (err) {
      setError(err.message)
      setRows(prev => prev.map(r => (r.id === id ? { ...r, is_suppressed: !next } : r)))
    }
  }, [profile?.id])

  const saveReason = useCallback(async (id: string, reason: string) => {
    const supabase = createClient()
    const value = reason.trim() || null
    setRows(prev => prev.map(r => (r.id === id ? { ...r, suppressed_reason: value } : r)))
    const { error: err } = await supabase
      .from('payroll_property').update({ suppressed_reason: value }).eq('property_id', id)
    if (err) setError(err.message)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (showOnlyHidden && !r.is_suppressed) return false
      if (!q) return true
      return (
        (r.code ?? '').toLowerCase().includes(q) ||
        (r.name ?? '').toLowerCase().includes(q) ||
        (r.owner_llc ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, search, showOnlyHidden])

  const hiddenCount = useMemo(() => rows.filter(r => r.is_suppressed).length, [rows])

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div>
      <PageHeader
        title="Hidden Items"
        subtitle="Hide junk or ex-customer properties everywhere in the app — pickers, review, invoices, totals, and analytics"
      />

      <div className="p-6 space-y-6">
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {!isManager && (
          <InfoBlock variant="warning" title="Manager access required">
            Only managers and admins can hide items. The switches below are read-only for your role.
          </InfoBlock>
        )}

        <InfoBlock variant="default" title="What hiding does">
          AppFolio won&apos;t let you delete a mistakenly-created property, and buildings for customers
          you no longer serve linger forever. Flip a property to <strong>Hidden</strong> and it is dropped
          from <strong>every</strong> payroll surface — pickers, the weekly review, invoice generation,
          all totals, analytics, and the command bar — as if it never existed. Employees are still paid
          for any hours logged against it; the cost simply isn&apos;t billed to anyone. The switch lives in
          the payroll-owned <code>payroll_property</code> record, so it survives AppFolio re-imports.
          <br />
          <span className="text-xs text-[var(--muted)]">
            Note: invoices already generated for a past week keep their original line items — re-generate
            that week to drop a newly-hidden property from it.
          </span>
        </InfoBlock>

        {/* Summary */}
        <div className="grid grid-cols-2 border border-[var(--border)] divide-x divide-[var(--divider)] bg-white max-w-md">
          {[
            { label: 'Properties in DB', value: String(rows.length) },
            { label: 'Hidden', value: String(hiddenCount) },
          ].map(kpi => (
            <div key={kpi.label} className="px-5 py-4">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">{kpi.label}</p>
              <p className="font-serif text-2xl text-[var(--primary)]">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search code, name, or owner LLC…"
              className="w-full border border-[var(--border)] bg-white pl-9 pr-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyHidden}
              onChange={e => setShowOnlyHidden(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Show only hidden
          </label>
        </div>

        <SectionDivider label={`Properties (${filtered.length})`} />

        <div className="border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--divider)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-3 py-2 font-medium text-right">Owner LLC</th>
                <th className="px-3 py-2 font-medium text-right">Units</th>
                <th className="px-3 py-2 font-medium text-right">Status</th>
                <th className="px-4 py-2 font-medium text-right">Hide</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[var(--muted)]">No matching properties.</td></tr>
              ) : filtered.map((r, i) => (
                <tr
                  key={r.id}
                  className={`border-b border-[var(--divider)] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'} ${r.is_suppressed ? 'opacity-70' : ''}`}
                >
                  <td className="px-4 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <Building2 size={12} className="text-[var(--muted)] shrink-0" />
                      <span className="font-mono text-xs text-[var(--muted)]">{r.code || '—'}</span>
                      <span className={r.is_suppressed ? 'text-[var(--muted)] line-through' : 'text-[var(--ink)]'}>
                        {r.name || '(no name)'}
                      </span>
                      {!r.is_active && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] border border-[var(--border)] px-1">inactive</span>
                      )}
                    </div>
                    {r.is_suppressed && (
                      <input
                        type="text"
                        defaultValue={r.suppressed_reason ?? ''}
                        onBlur={e => { if ((e.target.value.trim() || null) !== (r.suppressed_reason ?? null)) saveReason(r.id, e.target.value) }}
                        disabled={!isManager}
                        placeholder="Reason (optional) — e.g. duplicate, no longer a customer"
                        className="mt-1.5 ml-5 w-[min(28rem,90%)] border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-50"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-[var(--muted)] whitespace-nowrap align-top">{r.owner_llc ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-[var(--muted)] align-top">{r.total_units ?? 0}</td>
                  <td className="px-3 py-2 text-right text-xs whitespace-nowrap align-top">
                    {r.is_suppressed
                      ? <span className="inline-flex items-center gap-1 text-[var(--error)]"><EyeOff size={11} /> Hidden</span>
                      : <span className="text-[var(--success)]">Visible</span>}
                  </td>
                  <td className="px-4 py-2 text-right align-top">
                    <Toggle
                      on={r.is_suppressed}
                      disabled={!isManager}
                      onChange={next => setSuppressed(r.id, next)}
                      label={`Hide property ${r.code ?? r.name ?? r.id}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
