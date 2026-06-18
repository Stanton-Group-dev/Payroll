'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import type { PayrollTimeEntry, PayrollEmployee, Property } from '@/lib/supabase/types'
import type { PropertyOption } from '@/hooks/payroll/useProperties'
import type { PortfolioWithProperties } from '@/hooks/payroll/usePortfolios'
import { FormSelect, FormTextarea, FormInput, FormButton } from '@/components/form'
import type { SelectedCell } from './WeekGrid'

type DrawerTab = 'assign' | 'split' | 'spread' | 'pending' | 'edit'
type SpreadMode = 'portfolio' | 'all'

// A row in the Split form. `locked` means the user typed a specific value for
// this row, so auto-balancing leaves it alone and divides the remainder among
// the other (unlocked) rows.
type SplitRow = { propertyId: string; hours: string; locked?: boolean }

// Distribute `total` hours evenly across every row that has a property, while
// preserving rows the user has locked to a specific value. The last unlocked
// row absorbs any rounding remainder so the rows always sum to `total`. Rows
// without a property are cleared so stale hours don't linger after deselect.
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

const REASON_OPTIONS = [
  'Manager dispatch',
  'Clock-in error',
  'Workyard not opened',
  'Supply run',
  'Portfolio spread',
  'Other',
]

const SOURCE_LABELS: Record<string, string> = {
  workyard: 'Workyard',
  workyard_api: 'Workyard API',
  workyard_corrected: 'Workyard (corrected)',
  manual_manager: 'Manual — manager',
  manual_spread: 'Manual — spread',
  manual: 'Manual (legacy)',
}

// ── Property combobox (typeahead) ────────────────────────────────────────────────

interface PropertyComboboxProps {
  properties: PropertyOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}

function PropertyCombobox({ properties, value, onChange, placeholder = '— Search property —' }: PropertyComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = properties.find(p => p.id === value)
  const displayValue = selected ? `${selected.code} — ${selected.name}` : ''

  const filtered = query.length >= 1
    ? properties.filter(p =>
        p.code.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      )
    : properties.slice(0, 60)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={open ? query : displayValue}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange('') }}
        onFocus={() => { setOpen(true); setQuery('') }}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm border border-[var(--border)] bg-white focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full top-full mt-0.5 border border-[var(--border)] bg-white shadow-lg max-h-52 overflow-y-auto">
          {filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(p.id); setOpen(false); setQuery('') }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-section)] ${
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

// ── Multi-portfolio spread picker ──────────────────────────────────────────────

interface MultiPortfolioSpreadPickerProps {
  portfolios: PortfolioWithProperties[]
  allProperties: PropertyOption[]
  selectedPropertyIds: string[]
  onPropertyIdsChange: (ids: string[]) => void
  totalHours: number
}

export function MultiPortfolioSpreadPicker({
  portfolios, allProperties, selectedPropertyIds, onPropertyIdsChange, totalHours,
}: MultiPortfolioSpreadPickerProps) {
  const [mode, setMode] = useState<SpreadMode>('portfolio')
  const [expandedPortfolios, setExpandedPortfolios] = useState<Set<string>>(new Set())
  const [includeWestend, setIncludeWestend] = useState(false)

  // Westend properties (billed to SREP Westend LLC) are opt-in: excluded from the
  // pickers unless the user explicitly toggles them on.
  const westendIds = useMemo(
    () => new Set(allProperties.filter(p => p.isWestend).map(p => p.id)),
    [allProperties]
  )
  const hasWestend = westendIds.size > 0

  const visibleAllProperties = includeWestend
    ? allProperties
    : allProperties.filter(p => !westendIds.has(p.id))

  const visiblePortfolios = useMemo(() => {
    if (includeWestend) return portfolios
    return portfolios
      .map(pf => ({ ...pf, properties: pf.properties.filter(p => !westendIds.has(p.id)) }))
      .filter(pf => pf.properties.length > 0)
  }, [portfolios, includeWestend, westendIds])

  const toggleIncludeWestend = (next: boolean) => {
    setIncludeWestend(next)
    // Drop any Westend selections when opting back out so they aren't silently spread.
    if (!next) onPropertyIdsChange(selectedPropertyIds.filter(id => !westendIds.has(id)))
  }

  const perProp = selectedPropertyIds.length > 0
    ? (totalHours / selectedPropertyIds.length).toFixed(2) : '—'

  const toggleProperty = (propId: string) =>
    onPropertyIdsChange(
      selectedPropertyIds.includes(propId)
        ? selectedPropertyIds.filter(x => x !== propId)
        : [...selectedPropertyIds, propId]
    )

  const togglePortfolioAll = (portfolio: PortfolioWithProperties) => {
    const pIds = portfolio.properties.map(p => p.id)
    const allSelected = pIds.every(id => selectedPropertyIds.includes(id))
    if (allSelected) {
      onPropertyIdsChange(selectedPropertyIds.filter(id => !pIds.includes(id)))
    } else {
      onPropertyIdsChange(Array.from(new Set([...selectedPropertyIds, ...pIds])))
    }
  }

  const toggleExpand = (id: string) =>
    setExpandedPortfolios(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const selectAll = () => {
    if (mode === 'portfolio') {
      onPropertyIdsChange(Array.from(new Set(visiblePortfolios.flatMap(p => p.properties.map(pr => pr.id)))))
    } else {
      onPropertyIdsChange(visibleAllProperties.map(p => p.id))
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex border border-[var(--border)]">
          {(['portfolio', 'all'] as SpreadMode[]).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs transition-colors duration-200 ${m !== 'portfolio' ? 'border-l border-[var(--border)]' : ''}
                ${mode === m ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted)] hover:bg-[var(--bg-section)]'}`}>
              {m === 'portfolio' ? 'By Portfolio' : 'All Properties'}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--muted)] flex-1">
          {selectedPropertyIds.length > 0
            ? <><span className="font-medium text-[var(--ink)]">{selectedPropertyIds.length}</span> props · <span className="font-medium text-[var(--primary)]">{perProp}h</span> each</>
            : 'No properties selected'}
        </span>
        <button type="button" onClick={selectAll} className="text-xs text-[var(--primary)] hover:underline">All</button>
        <button type="button" onClick={() => onPropertyIdsChange([])} className="text-xs text-[var(--muted)] hover:underline">None</button>
      </div>

      {hasWestend && (
        <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={includeWestend}
            onChange={e => toggleIncludeWestend(e.target.checked)}
            className="accent-[var(--primary)] shrink-0" />
          <span>Include Westend properties <span className="text-[var(--muted)]">(SREP Westend LLC — excluded by default)</span></span>
        </label>
      )}

      {mode === 'portfolio' && (
        <div className="max-h-52 overflow-y-auto border border-[var(--border)] divide-y divide-[var(--divider)]">
          {visiblePortfolios.length === 0 && (
            <p className="px-3 py-3 text-xs text-[var(--muted)]">No portfolios available.</p>
          )}
          {visiblePortfolios.map(portfolio => {
            const pIds = portfolio.properties.map(p => p.id)
            const selectedCount = pIds.filter(id => selectedPropertyIds.includes(id)).length
            const allChecked = pIds.length > 0 && selectedCount === pIds.length
            const isExpanded = expandedPortfolios.has(portfolio.id)
            return (
              <div key={portfolio.id}>
                <div className={`flex items-center gap-2 px-3 py-2 ${allChecked ? 'bg-[var(--primary)]/5' : ''}`}>
                  <input type="checkbox" checked={allChecked}
                    ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allChecked }}
                    onChange={() => togglePortfolioAll(portfolio)}
                    className="accent-[var(--primary)] shrink-0" />
                  <span className="flex-1 text-sm font-medium text-[var(--ink)] truncate">{portfolio.name}</span>
                  <span className="text-xs text-[var(--muted)] shrink-0">{selectedCount}/{portfolio.properties.length}</span>
                  <button type="button" onClick={() => toggleExpand(portfolio.id)}
                    className="text-xs text-[var(--muted)] hover:text-[var(--ink)] px-1 shrink-0">
                    {isExpanded ? '▲' : '▼'}
                  </button>
                </div>
                {isExpanded && (
                  <div className="bg-[var(--bg-section)] border-t border-[var(--divider)]">
                    {portfolio.properties.map(p => {
                      const checked = selectedPropertyIds.includes(p.id)
                      return (
                        <label key={p.id}
                          className={`flex items-center gap-2 px-5 py-1.5 cursor-pointer transition-colors hover:bg-white ${checked ? 'bg-white' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleProperty(p.id)}
                            className="accent-[var(--primary)] shrink-0" />
                          <span className="font-mono text-xs text-[var(--muted)] w-12 shrink-0">{p.code}</span>
                          <span className="flex-1 truncate text-xs">{p.name}</span>
                          {checked && <span className="ml-auto text-xs font-medium text-[var(--primary)] shrink-0">{perProp}h</span>}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mode === 'all' && (
        <div className="max-h-52 overflow-y-auto border border-[var(--border)] divide-y divide-[var(--divider)]">
          {visibleAllProperties.map(p => {
            const checked = selectedPropertyIds.includes(p.id)
            return (
              <label key={p.id}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-[var(--bg-section)] ${checked ? 'bg-[var(--primary)]/5' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleProperty(p.id)}
                  className="accent-[var(--primary)] shrink-0" />
                <span className="font-mono text-xs text-[var(--muted)] w-12 shrink-0">{p.code}</span>
                <span className="flex-1 truncate text-xs">{p.name}</span>
                {checked && <span className="ml-auto text-xs font-medium text-[var(--primary)] shrink-0">{perProp}h</span>}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main InlineDrawer ──────────────────────────────────────────────────────────

interface InlineDrawerProps {
  cell: SelectedCell
  properties: PropertyOption[]
  portfolios: PortfolioWithProperties[]
  allProperties: PropertyOption[]
  isLocked: boolean
  onClose: () => void
  reassign: (entryId: string, splits: { propertyId: string; hours: number }[], reason: string) => Promise<void>
  spread: (params: {
    employeeId: string; date: string; totalHours: number
    propertyIds: string[]; portfolioId?: string; reason: string; sourceEntryId?: string
  }) => Promise<void>
  removeEntry: (entryId: string, reason: string) => Promise<void>
  setPending: (entryId: string, note: string) => Promise<void>
  resolvePending: (entryId: string) => Promise<void>
  onDone: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function InlineDrawer({
  cell, properties, portfolios, allProperties, isLocked,
  onClose, reassign, spread, removeEntry, setPending, resolvePending, onDone, onDirtyChange,
}: InlineDrawerProps) {
  const isUnallocated = cell.rowPropertyId === null
  const primaryEntry = cell.entries[0]
  // NOTE: all hooks must run before any early return (rules-of-hooks). Initializers
  // are null-safe so the hook order stays stable even when there is no entry; the
  // `!primaryEntry` guard happens after every hook below.
  const isPending = primaryEntry?.pending_resolution ?? false

  const [activeTab, setActiveTab] = useState<DrawerTab>(
    !isUnallocated ? 'edit' : isPending ? 'pending' : 'assign'
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Assign form
  const [assignProp, setAssignProp] = useState('')
  const [assignReason, setAssignReason] = useState('')

  // Edit reassign form
  const [editProp, setEditProp] = useState('')
  const [editReason, setEditReason] = useState('')

  // Split form
  const [splitRows, setSplitRows] = useState<SplitRow[]>([{ propertyId: '', hours: '' }, { propertyId: '', hours: '' }])
  const [splitReason, setSplitReason] = useState('')
  const [splitUnit, setSplitUnit] = useState<'hrs' | 'pct'>('hrs')

  // Spread form — amount defaults to the full unallocated block (all hours)
  const [spreadPropertyIds, setSpreadPropertyIds] = useState<string[]>([])
  const [spreadReason, setSpreadReason] = useState('')
  const [spreadAmount, setSpreadAmount] = useState<string>(
    primaryEntry ? String(primaryEntry.regular_hours + primaryEntry.ot_hours) : ''
  )

  // Reset the spread amount to the full block whenever a different cell is opened.
  useEffect(() => {
    if (primaryEntry) setSpreadAmount(String(primaryEntry.regular_hours + primaryEntry.ot_hours))
  }, [primaryEntry?.id])

  // Pending form
  const [pendingNote, setPendingNote] = useState(primaryEntry?.pending_note ?? '')

  // Remove form
  const [removeReason, setRemoveReason] = useState('')

  // Whether the user has any in-progress input that would be lost on close.
  // Reported up so the page can prompt before switching to another cell.
  const pendingNoteBaseline = primaryEntry?.pending_note ?? ''
  const spreadAmountBaseline = primaryEntry
    ? String(primaryEntry.regular_hours + primaryEntry.ot_hours)
    : ''
  const isDirty =
    assignProp !== '' ||
    assignReason !== '' ||
    editProp !== '' ||
    editReason !== '' ||
    splitReason.trim() !== '' ||
    splitRows.length !== 2 ||
    splitRows.some(r => r.propertyId !== '' || r.hours !== '') ||
    spreadPropertyIds.length > 0 ||
    spreadReason.trim() !== '' ||
    spreadAmount !== spreadAmountBaseline ||
    pendingNote !== pendingNoteBaseline ||
    removeReason.trim() !== ''

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // Safe to bail now that every hook has been called unconditionally.
  if (!primaryEntry) return null

  const entryHours = primaryEntry.regular_hours + primaryEntry.ot_hours
  const entryDate = format(parseISO(primaryEntry.entry_date), 'EEE, MMM d')
  const splitTotal = splitRows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0)
  const splitRemaining = parseFloat((entryHours - splitTotal).toFixed(2))

  // Split handlers — picking properties auto-distributes hours evenly; typing a
  // value locks that row and rebalances the rest. `Split evenly` clears locks.
  const pctToHours = (pct: string) =>
    pct === '' ? '' : String(parseFloat((entryHours * (parseFloat(pct) || 0) / 100).toFixed(2)))
  const hoursToPct = (h: string) =>
    h === '' || entryHours === 0 ? '' : String(Math.round((parseFloat(h) / entryHours) * 100))
  const setSplitProperty = (i: number, propertyId: string) =>
    setSplitRows(rows => balanceSplitRows(rows.map((r, j) => j === i ? { ...r, propertyId } : r), entryHours))
  const setSplitHours = (i: number, hours: string) =>
    setSplitRows(rows => balanceSplitRows(rows.map((r, j) => j === i ? { ...r, hours, locked: true } : r), entryHours))
  const addSplitRow = () =>
    setSplitRows(rows => balanceSplitRows([...rows, { propertyId: '', hours: '' }], entryHours))
  const removeSplitRow = (i: number) =>
    setSplitRows(rows => balanceSplitRows(rows.filter((_, j) => j !== i), entryHours))
  const splitEvenly = () =>
    setSplitRows(rows => balanceSplitRows(rows.map(r => ({ ...r, locked: false })), entryHours))
  const spreadHours = parseFloat(spreadAmount) || 0
  const spreadRemaining = parseFloat((entryHours - spreadHours).toFixed(2))

  const tabs: { id: DrawerTab; label: string }[] = isUnallocated
    ? [
        { id: 'assign', label: 'Quick Assign' },
        { id: 'split', label: 'Split' },
        { id: 'spread', label: 'Spread' },
        ...(isLocked ? [] : [{ id: 'pending' as DrawerTab, label: isPending ? 'Pending ●' : 'Mark Pending' }]),
      ]
    : [{ id: 'edit', label: 'Edit' }]

  const getSpreadPortfolioId = (): string | undefined => {
    const matchingPortfolios = portfolios.filter(port =>
      port.properties.some(p => spreadPropertyIds.includes(p.id))
    )
    return matchingPortfolios.length === 1 ? matchingPortfolios[0].id : undefined
  }

  const save = async () => {
    setErr(null)
    setSaving(true)
    try {
      if (activeTab === 'assign') {
        if (!assignProp) throw new Error('Select a property')
        if (!assignReason) throw new Error('Select a reason')
        await reassign(primaryEntry.id, [{ propertyId: assignProp, hours: entryHours }], assignReason)
        onDone()
      } else if (activeTab === 'split') {
        if (!splitReason.trim()) throw new Error('Reason required')
        if (Math.abs(splitRemaining) > 0.01)
          throw new Error(`Hours must sum to ${entryHours} (${splitRemaining > 0 ? splitRemaining + 'h remaining' : Math.abs(splitRemaining) + 'h over'})`)
        const targets = splitRows
          .filter(r => r.propertyId && parseFloat(r.hours) > 0)
          .map(r => ({ propertyId: r.propertyId, hours: parseFloat(r.hours) }))
        if (targets.length < 2) throw new Error('At least 2 split targets required')
        await reassign(primaryEntry.id, targets, splitReason)
        onDone()
      } else if (activeTab === 'spread') {
        if (spreadPropertyIds.length === 0) throw new Error('Select at least one property')
        if (spreadHours <= 0) throw new Error('Enter hours to spread (> 0)')
        if (spreadHours > entryHours + 0.01) throw new Error(`Cannot spread more than ${entryHours}h available`)
        if (!spreadReason.trim()) throw new Error('Reason required')
        await spread({
          employeeId: primaryEntry.employee_id,
          date: primaryEntry.entry_date,
          totalHours: spreadHours,
          propertyIds: spreadPropertyIds,
          portfolioId: getSpreadPortfolioId(),
          reason: spreadReason,
          sourceEntryId: primaryEntry.id,
        })
        onDone()
      } else if (activeTab === 'pending') {
        await setPending(primaryEntry.id, pendingNote)
        onDone()
      } else if (activeTab === 'edit') {
        if (!removeReason.trim()) throw new Error('Removal reason required')
        await removeEntry(primaryEntry.id, removeReason)
        onDone()
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setSaving(false)
    }
  }

  const prop = primaryEntry.property as unknown as Property | null
  const employee = primaryEntry.employee as unknown as PayrollEmployee | null

  return (
    <div className="border-t-2 border-[var(--primary)]/20 bg-white shadow-inner">
      {/* Drawer header bar */}
      <div className="flex items-center border-b border-[var(--border)]">
        <div className="px-4 py-2.5 text-xs border-r border-[var(--divider)] shrink-0">
          <span className="font-medium text-[var(--ink)]">{employee?.name ?? '—'}</span>
          <span className="mx-1.5 text-[var(--muted)]">·</span>
          <span className="text-[var(--muted)]">{entryDate}</span>
          <span className="mx-1.5 text-[var(--muted)]">·</span>
          <span className="font-medium text-[var(--ink)]">{entryHours}h</span>
          {cell.entries.length > 1 && (
            <span className="ml-1.5 text-[var(--muted)]">({cell.entries.length} entries)</span>
          )}
        </div>
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} type="button"
              onClick={() => { setActiveTab(t.id); setErr(null) }}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-200 border-b-2 -mb-px
                ${activeTab === t.id
                  ? 'border-[var(--primary)] text-[var(--primary)] bg-white'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-section)]'}`}>
              {t.label}
            </button>
          ))}
          {isPending && !isLocked && (
            <button type="button"
              onClick={async () => { setSaving(true); try { await resolvePending(primaryEntry.id); onDone() } finally { setSaving(false) } }}
              className="ml-auto px-4 py-2 text-xs text-[var(--success)] hover:underline font-medium">
              ✓ Mark resolved
            </button>
          )}
        </div>
        <button type="button" onClick={onClose}
          className="px-4 py-2.5 text-[var(--muted)] hover:text-[var(--ink)] text-xs shrink-0 border-l border-[var(--divider)]">
          ✕ Close
        </button>
      </div>

      <div className="p-4 max-w-2xl">
        {err && (
          <p className="text-xs text-[var(--error)] font-medium mb-3 px-3 py-2 bg-[var(--error)]/5 border border-[var(--error)]/20">
            {err}
          </p>
        )}

        {/* ── Quick Assign ── */}
        {activeTab === 'assign' && (
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-52">
              <PropertyCombobox
                properties={properties}
                value={assignProp}
                onChange={setAssignProp}
              />
            </div>
            <div className="w-48">
              <FormSelect value={assignReason} onChange={e => setAssignReason(e.target.value)}>
                <option value="">— Reason —</option>
                {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </FormSelect>
            </div>
            <FormButton size="sm" onClick={save} loading={saving}
              disabled={!assignProp || !assignReason}>
              Assign {entryHours}h →
            </FormButton>
          </div>
        )}

        {/* ── Split ── */}
        {activeTab === 'split' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted)]">Distribute {entryHours}h across properties</span>
              <div className="flex items-center gap-2">
                <div className="flex rounded border border-[var(--border)] overflow-hidden text-[10px]">
                  {(['hrs', 'pct'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setSplitUnit(u)}
                      className={`px-2 py-0.5 transition-colors ${splitUnit === u ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted)] hover:bg-[var(--bg-section)]'}`}>
                      {u === 'hrs' ? 'Hours' : '%'}
                    </button>
                  ))}
                </div>
                <span className={`text-xs font-medium ${Math.abs(splitRemaining) < 0.01 ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                  {Math.abs(splitRemaining) < 0.01
                    ? '✓ balanced'
                    : splitRemaining > 0 ? `${splitRemaining}h remaining` : `${Math.abs(splitRemaining)}h over`}
                </span>
              </div>
            </div>
            {splitRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <FormSelect value={row.propertyId}
                    onChange={e => setSplitProperty(i, e.target.value)}>
                    <option value="">— Property —</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </FormSelect>
                </div>
                <div className="w-24 flex items-center gap-1">
                  <FormInput type="number" step={splitUnit === 'hrs' ? '0.25' : '1'} min="0"
                    value={splitUnit === 'hrs' ? row.hours : hoursToPct(row.hours)}
                    placeholder={splitUnit === 'hrs' ? 'hrs' : '%'}
                    onChange={e => setSplitHours(i, splitUnit === 'hrs' ? e.target.value : pctToHours(e.target.value))} />
                  <span className="text-[10px] text-[var(--muted)] shrink-0 w-2">{splitUnit === 'hrs' ? 'h' : '%'}</span>
                </div>
                {splitRows.length > 2 && (
                  <button type="button" onClick={() => removeSplitRow(i)}
                    className="text-[var(--muted)] hover:text-[var(--error)] text-sm px-1 shrink-0">✕</button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button type="button" onClick={addSplitRow}
                className="text-xs text-[var(--primary)] hover:underline">+ Add row</button>
              <button type="button" onClick={splitEvenly}
                className="text-xs text-[var(--muted)] hover:text-[var(--ink)] hover:underline">Split evenly</button>
            </div>
            <FormTextarea value={splitReason} onChange={e => setSplitReason(e.target.value)}
              placeholder="Reason (required)" rows={2} />
            <div className="flex gap-2">
              <FormButton size="sm" onClick={save} loading={saving}>Apply Split</FormButton>
              <FormButton size="sm" variant="ghost" onClick={onClose}>Cancel</FormButton>
            </div>
          </div>
        )}

        {/* ── Spread ── */}
        {activeTab === 'spread' && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--muted)] shrink-0">
                <span>Spread</span>
                <div className="w-20">
                  <FormInput type="number" step="0.25" min="0" max={entryHours}
                    value={spreadAmount} onChange={e => setSpreadAmount(e.target.value)} />
                </div>
                <span>of {entryHours}h evenly across selected properties</span>
              </label>
              {Math.abs(spreadRemaining) > 0.01 && spreadHours > 0 && spreadHours <= entryHours && (
                <span className="text-xs text-[var(--warning)]">{spreadRemaining}h will stay unallocated</span>
              )}
              {spreadHours > entryHours + 0.01 && (
                <span className="text-xs text-[var(--error)]">exceeds {entryHours}h available</span>
              )}
            </div>
            <MultiPortfolioSpreadPicker
              portfolios={portfolios}
              allProperties={allProperties}
              selectedPropertyIds={spreadPropertyIds}
              onPropertyIdsChange={setSpreadPropertyIds}
              totalHours={spreadHours}
            />
            <FormTextarea value={spreadReason} onChange={e => setSpreadReason(e.target.value)}
              placeholder="Reason (required)" rows={2} />
            <div className="flex gap-2">
              <FormButton size="sm" onClick={save} loading={saving}
                disabled={spreadPropertyIds.length === 0 || spreadHours <= 0 || spreadHours > entryHours + 0.01}>
                Create {spreadPropertyIds.length > 0 ? spreadPropertyIds.length : '—'} entries
              </FormButton>
              <FormButton size="sm" variant="ghost" onClick={onClose}>Cancel</FormButton>
            </div>
          </div>
        )}

        {/* ── Mark Pending ── */}
        {activeTab === 'pending' && (
          <div className="space-y-2 max-w-md">
            <p className="text-xs text-[var(--muted)]">
              {isPending
                ? 'This block is pending investigation. Update the note or resolve it.'
                : "Mark as pending investigation. Won't block other work but will block payroll approval."}
            </p>
            <FormTextarea value={pendingNote} onChange={e => setPendingNote(e.target.value)}
              placeholder="Note (optional) — e.g. 'Calling Angel to confirm location'" rows={2} />
            <div className="flex gap-2">
              <FormButton size="sm" onClick={save} loading={saving}>
                {isPending ? 'Update Note' : 'Mark Pending'}
              </FormButton>
              <FormButton size="sm" variant="ghost" onClick={onClose}>Cancel</FormButton>
            </div>
          </div>
        )}

        {/* ── Edit ── */}
        {activeTab === 'edit' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--muted)]">
              <span><span className="font-medium text-[var(--ink)]">Property:</span> {prop ? `${prop.code} — ${prop.name}` : '—'}</span>
              <span><span className="font-medium text-[var(--ink)]">Hours:</span> {entryHours}h</span>
              <span><span className="font-medium text-[var(--ink)]">Source:</span> {SOURCE_LABELS[primaryEntry.source] ?? primaryEntry.source}</span>
              {cell.entries.length > 1 && (
                <span className="text-[var(--muted)]">+{cell.entries.length - 1} more entries on this day</span>
              )}
            </div>
            {!isLocked && (
              <>
                <div className="space-y-2 pt-1 border-t border-[var(--divider)]">
                  <p className="text-xs font-medium text-[var(--ink)]">Reassign to different property</p>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-52">
                      <PropertyCombobox
                        properties={properties}
                        value={editProp}
                        onChange={setEditProp}
                        placeholder="— New property —"
                      />
                    </div>
                    <div className="w-48">
                      <FormSelect value={editReason} onChange={e => setEditReason(e.target.value)}>
                        <option value="">— Reason —</option>
                        {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </FormSelect>
                    </div>
                    <FormButton size="sm"
                      onClick={async () => {
                        if (!editProp) { setErr('Select a property'); return }
                        if (!editReason) { setErr('Select a reason'); return }
                        setErr(null); setSaving(true)
                        try {
                          await reassign(primaryEntry.id, [{ propertyId: editProp, hours: entryHours }], editReason)
                          onDone()
                        } catch (e: unknown) {
                          setErr(e instanceof Error ? e.message : 'Reassign failed')
                        } finally { setSaving(false) }
                      }}
                      loading={saving}
                      disabled={!editProp || !editReason}>
                      Reassign {entryHours}h →
                    </FormButton>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-[var(--divider)]">
                  <p className="text-xs text-[var(--error)]">Remove this entry — it will be deactivated. Cannot be undone without a manual re-add.</p>
                  <FormTextarea value={removeReason} onChange={e => setRemoveReason(e.target.value)}
                    placeholder="Reason required — e.g. 'Duplicate entry'" rows={2} />
                  <div className="flex gap-2">
                    <FormButton size="sm" variant="danger" onClick={save} loading={saving}
                      disabled={!removeReason.trim()}>
                      Confirm Remove
                    </FormButton>
                    <FormButton size="sm" variant="ghost" onClick={onClose}>Cancel</FormButton>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
