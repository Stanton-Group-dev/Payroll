'use client'

import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, MapPin, Tag, CheckCircle2, AlertCircle } from 'lucide-react'
import { useAuth } from '@/hooks/payroll/useAuth'
import { useProperties } from '@/hooks/payroll/useProperties'
import { FormButton, FormInput } from '@/components/form'
import type { DailyTimecardRow } from '@/lib/payroll/workyard-api'
import type { PropertyOption } from '@/hooks/payroll/useProperties'

// Re-export balanceSplitRows logic inline (same algorithm as InlineDrawer.tsx) so
// we don't import a 'use client' component's internals.
type SplitRow = { propertyId: string; hours: string; locked?: boolean }

function balanceSplitRows(rows: SplitRow[], total: number): SplitRow[] {
  const lockedSum = rows.reduce(
    (s, r) => (r.propertyId && r.locked && r.hours !== '' ? s + (parseFloat(r.hours) || 0) : s),
    0,
  )
  const autoCount = rows.filter(r => r.propertyId && !(r.locked && r.hours !== '')).length
  const remaining = Math.max(0, parseFloat((total - lockedSum).toFixed(2)))
  const share = autoCount > 0 ? Math.floor((remaining / autoCount) * 100) / 100 : 0
  let seen = 0
  let used = 0
  return rows.map(r => {
    if (!r.propertyId) return r.hours !== '' || r.locked ? { ...r, hours: '', locked: false } : r
    if (r.locked && r.hours !== '') return r
    seen++
    const h = seen === autoCount ? parseFloat((remaining - used).toFixed(2)) : share
    used = parseFloat((used + share).toFixed(2))
    return { ...r, hours: h > 0 ? String(h) : '', locked: false }
  })
}

// ── Property combobox (typeahead, mobile-first) ──────────────────────────────

interface PropertyComboboxProps {
  properties: PropertyOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}

function PropertyCombobox({ properties, value, onChange, placeholder = 'Search building…' }: PropertyComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selected = properties.find(p => p.id === value)
  const displayValue = selected ? `${selected.code} — ${selected.name}` : ''

  const filtered = query.length >= 1
    ? properties.filter(p =>
        p.code.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      )
    : properties.slice(0, 50)

  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : displayValue}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange('') }}
        onFocus={() => { setOpen(true); setQuery('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-[var(--border)] bg-white focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full top-full mt-0.5 border border-[var(--border)] bg-white shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(p.id); setOpen(false); setQuery('') }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--bg-section)] ${
                p.id === value ? 'bg-[var(--primary)]/5 font-medium' : ''
              }`}
            >
              <span className="font-mono text-xs text-[var(--muted)] w-16 shrink-0">{p.code}</span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shift card (one per Workyard time card) ───────────────────────────────────

interface SavedAllocation {
  property_id: string
  fraction: number
}

interface ShiftCardProps {
  row: DailyTimecardRow
  properties: PropertyOption[]
  saved: SavedAllocation[] | null
  onSave: (timecardId: string, legs: { propertyId: string; hours: number }[], entryDate: string) => Promise<void>
  onClear: (timecardId: string) => Promise<void>
}

function ShiftCard({ row, properties, saved, onSave, onClear }: ShiftCardProps) {
  const totalHours = row.regularHours + row.otHours
  const isUnallocated = !row.projectName

  const [expanded, setExpanded] = useState(false)
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { propertyId: '', hours: '' },
    { propertyId: '', hours: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // On mount or when saved changes: pre-fill split rows if there's a saved allocation.
  useEffect(() => {
    if (saved && saved.length > 0) {
      setSplitRows(
        saved.map(leg => ({
          propertyId: leg.property_id,
          hours: String(parseFloat((totalHours * leg.fraction).toFixed(2))),
          locked: true,
        }))
      )
      setExpanded(true)
    }
  }, [saved, totalHours])

  const totalSplit = splitRows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0)
  const remaining = parseFloat((totalHours - totalSplit).toFixed(2))
  const balanced = Math.abs(remaining) <= 0.01

  const setSplitProperty = (i: number, propertyId: string) =>
    setSplitRows(rows => balanceSplitRows(rows.map((r, j) => j === i ? { ...r, propertyId } : r), totalHours))

  const setSplitHours = (i: number, hours: string) =>
    setSplitRows(rows => balanceSplitRows(rows.map((r, j) => j === i ? { ...r, hours, locked: true } : r), totalHours))

  const addRow = () =>
    setSplitRows(rows => balanceSplitRows([...rows, { propertyId: '', hours: '' }], totalHours))

  const removeRow = (i: number) =>
    setSplitRows(rows => balanceSplitRows(rows.filter((_, j) => j !== i), totalHours))

  const splitEvenly = () =>
    setSplitRows(rows => balanceSplitRows(rows.map(r => ({ ...r, locked: false })), totalHours))

  const handleSave = async () => {
    setErr(null)
    const legs = splitRows.filter(r => r.propertyId && parseFloat(r.hours) > 0)
    if (legs.length === 0) { setErr('Select at least one building'); return }
    if (!balanced) { setErr(`Hours must sum to ${totalHours}h`); return }
    setSaving(true)
    try {
      await onSave(
        row.timecardId,
        legs.map(r => ({ propertyId: r.propertyId, hours: parseFloat(r.hours) })),
        row.entryDate
      )
      setExpanded(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    try {
      await onClear(row.timecardId)
      setSplitRows([{ propertyId: '', hours: '' }, { propertyId: '', hours: '' }])
      setExpanded(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Clear failed')
    } finally {
      setSaving(false)
    }
  }

  const isSaved = saved && saved.length > 0
  const propertyName = row.projectName
    ? (properties.find(p => p.code === row.projectName)?.name ?? row.projectName)
    : null

  return (
    <div className={`border rounded-lg overflow-hidden mb-3 ${
      isUnallocated && !isSaved
        ? 'border-[var(--warning)] bg-amber-50'
        : isSaved
        ? 'border-[var(--success)]/50 bg-green-50'
        : 'border-[var(--border)] bg-white'
    }`}>
      {/* Card header — tappable to expand */}
      <button
        type="button"
        className="w-full text-left px-4 py-3"
        onClick={() => isUnallocated && setExpanded(e => !e)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-[var(--ink)] truncate">{row.employeeName}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {totalHours}h · {row.entryDate}
              {row.otHours > 0 && <span className="ml-1 text-[var(--warning)]">({row.otHours}h OT)</span>}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {isUnallocated && !isSaved && (
              <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)] text-white rounded">
                UNALLOCATED
              </span>
            )}
            {isSaved && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--success)]">
                <CheckCircle2 size={11} />
                SAVED
              </span>
            )}
            {!isUnallocated && !isSaved && (
              <span className="text-xs text-[var(--muted)]">{propertyName ?? row.projectName}</span>
            )}
          </div>
        </div>

        {/* Hints for unallocated cards */}
        {isUnallocated && (row.geofenceName || row.firstCostCodeName) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {row.geofenceName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)] bg-[var(--bg-section)] px-2 py-0.5 rounded">
                <MapPin size={10} />
                {row.geofenceName}
              </span>
            )}
            {row.firstCostCodeName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)] bg-[var(--bg-section)] px-2 py-0.5 rounded">
                <Tag size={10} />
                {row.firstCostCodeName}
              </span>
            )}
          </div>
        )}

        {/* Saved allocation summary */}
        {isSaved && saved && (
          <div className="mt-2 space-y-0.5">
            {saved.map((leg, i) => {
              const prop = properties.find(p => p.id === leg.property_id)
              return (
                <p key={i} className="text-xs text-[var(--muted)]">
                  {prop ? `${prop.code} — ${prop.name}` : leg.property_id}
                  <span className="ml-1 font-medium text-[var(--ink)]">
                    {parseFloat((totalHours * leg.fraction).toFixed(2))}h
                  </span>
                </p>
              )
            })}
          </div>
        )}
      </button>

      {/* Expanded allocation form — only for unallocated shifts */}
      {isUnallocated && expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border)] bg-white">
          <p className="text-xs text-[var(--muted)] mt-3 mb-2">
            Assign {totalHours}h to building(s):
          </p>

          {err && (
            <p className="text-xs text-[var(--error)] mb-2 flex items-center gap-1">
              <AlertCircle size={12} />
              {err}
            </p>
          )}

          <div className="space-y-2">
            {splitRows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <PropertyCombobox
                    properties={properties}
                    value={r.propertyId}
                    onChange={id => setSplitProperty(i, id)}
                  />
                </div>
                <div className="w-20">
                  <FormInput
                    type="number"
                    step="0.25"
                    min="0"
                    value={r.hours}
                    placeholder="hrs"
                    onChange={e => setSplitHours(i, e.target.value)}
                  />
                </div>
                {splitRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-[var(--muted)] hover:text-[var(--error)] text-sm px-1 shrink-0"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={addRow} className="text-xs text-[var(--primary)] hover:underline">
              + Add building
            </button>
            {splitRows.length > 1 && (
              <button type="button" onClick={splitEvenly} className="text-xs text-[var(--muted)] hover:underline">
                Split evenly
              </button>
            )}
            <span className={`ml-auto text-xs font-medium ${balanced ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
              {balanced ? '✓ balanced' : remaining > 0 ? `${remaining}h left` : `${Math.abs(remaining)}h over`}
            </span>
          </div>

          <div className="flex gap-2 mt-3">
            <FormButton size="sm" onClick={handleSave} loading={saving} disabled={!balanced}>
              Save
            </FormButton>
            {isSaved && (
              <FormButton size="sm" variant="ghost" onClick={handleClear} loading={saving}>
                Clear
              </FormButton>
            )}
            <FormButton size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              Cancel
            </FormButton>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface FetchedAllocation {
  workyard_timecardid: string
  property_id: string
  fraction: number
  entry_date: string
}

export default function DailyPage() {
  const { loading: authLoading, isManager } = useAuth()
  const { properties, loading: propsLoading } = useProperties(true)

  const [rows, setRows] = useState<DailyTimecardRow[]>([])
  const [stats, setStats] = useState<{ total: number; unallocated: number; dates: string[] } | null>(null)
  const [savedAllocations, setSavedAllocations] = useState<FetchedAllocation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/workyard/daily-timecards')
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load'); return }
      setRows(json.rows ?? [])
      setStats(json.stats ?? null)

      // Load any existing saved allocations for the returned dates.
      if (json.stats?.dates?.length) {
        const allAllocs: FetchedAllocation[] = []
        for (const d of json.stats.dates) {
          const ar = await fetch(`/api/daily-allocations?date=${d}`)
          const aj = await ar.json()
          if (ar.ok && aj.allocations) allAllocs.push(...aj.allocations)
        }
        setSavedAllocations(allAllocs)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && isManager) load()
  }, [authLoading, isManager, load])

  const handleSave = useCallback(async (
    timecardId: string,
    legs: { propertyId: string; hours: number }[],
    entryDate: string
  ) => {
    const totalHours = legs.reduce((s, l) => s + l.hours, 0)
    const fractions = legs.map(l => parseFloat((l.hours / totalHours).toFixed(4)))
    // Ensure fractions sum to exactly 1.0 (fix rounding on last leg).
    const sumFrac = fractions.reduce((s, f) => s + f, 0)
    if (fractions.length > 0) fractions[fractions.length - 1] = parseFloat((fractions[fractions.length - 1] + (1.0 - sumFrac)).toFixed(4))

    const res = await fetch('/api/daily-allocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workyard_timecardid: timecardId,
        entry_date: entryDate,
        legs: legs.map((l, i) => ({ property_id: l.propertyId, fraction: fractions[i] })),
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Save failed')

    // Update local saved-allocations state.
    setSavedAllocations(prev => [
      ...prev.filter(a => a.workyard_timecardid !== timecardId),
      ...(json.saved ?? []),
    ])
  }, [])

  const handleClear = useCallback(async (timecardId: string) => {
    const res = await fetch(`/api/daily-allocations?timecardid=${encodeURIComponent(timecardId)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const json = await res.json()
      throw new Error(json.error ?? 'Clear failed')
    }
    setSavedAllocations(prev => prev.filter(a => a.workyard_timecardid !== timecardId))
  }, [])

  // Group saved allocations by timecardid.
  const savedByCard = savedAllocations.reduce<Record<string, SavedAllocation[]>>((acc, a) => {
    if (!acc[a.workyard_timecardid]) acc[a.workyard_timecardid] = []
    acc[a.workyard_timecardid].push({ property_id: a.property_id, fraction: a.fraction })
    return acc
  }, {})

  // Unallocated first, then allocated.
  const sorted = [...rows].sort((a, b) => {
    const aUnalloc = !a.projectName && !(savedByCard[a.timecardId]?.length)
    const bUnalloc = !b.projectName && !(savedByCard[b.timecardId]?.length)
    if (aUnalloc && !bUnalloc) return -1
    if (!aUnalloc && bUnalloc) return 1
    return a.employeeName.localeCompare(b.employeeName)
  })

  const unallocatedCount = rows.filter(r => !r.projectName && !(savedByCard[r.timecardId]?.length)).length

  if (authLoading || propsLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-[var(--muted)]">
        <RefreshCw size={14} className="animate-spin" />
        Loading…
      </div>
    )
  }

  if (!isManager) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--error)]">Access restricted to managers and above.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-serif text-xl text-[var(--primary)]">Daily Catch-up</h1>
          {stats?.dates && (
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {stats.dates.length === 1 ? stats.dates[0] : `${stats.dates[0]} – ${stats.dates[stats.dates.length - 1]}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-4 mb-4 px-3 py-2 bg-[var(--bg-section)] border border-[var(--border)] text-xs">
          <span><span className="font-medium text-[var(--ink)]">{stats.total}</span> shifts</span>
          {unallocatedCount > 0 ? (
            <span className="text-[var(--warning)] font-medium">{unallocatedCount} still unallocated</span>
          ) : (
            <span className="text-[var(--success)] font-medium flex items-center gap-1">
              <CheckCircle2 size={11} />
              All assigned
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-3 py-2 bg-[var(--error)]/5 border border-[var(--error)]/20 text-xs text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && !error && (
        <div className="text-center py-12 text-[var(--muted)]">
          <p className="text-sm">No time cards found for yesterday.</p>
          <p className="text-xs mt-1">Cards in &quot;still working&quot; status are excluded.</p>
        </div>
      )}

      {/* Shift list */}
      {sorted.map(row => (
        <ShiftCard
          key={`${row.timecardId}-${row.projectName}-${row.entryDate}`}
          row={row}
          properties={properties}
          saved={savedByCard[row.timecardId] ?? null}
          onSave={handleSave}
          onClear={handleClear}
        />
      ))}
    </div>
  )
}
