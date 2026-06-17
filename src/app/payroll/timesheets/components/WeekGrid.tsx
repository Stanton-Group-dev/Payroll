import { useMemo } from 'react'
import { format, parseISO, addDays } from 'date-fns'
import type { PayrollTimeEntry } from '@/lib/supabase/types'

export interface SelectedCell {
  rowPropertyId: string | null
  dayIndex: number
  entries: PayrollTimeEntry[]
}

interface WeekGridProps {
  entries: PayrollTimeEntry[]
  weekStart: string
  selectedCell: SelectedCell | null
  onCellClick: (cell: SelectedCell) => void
  drawerRowPropertyId: string | null | undefined
  renderDrawer: () => React.ReactNode
}

type CellState = 'empty' | 'normal' | 'adjusted' | 'pending' | 'unallocated'

function getCellState(entries: PayrollTimeEntry[]): CellState {
  if (entries.length === 0) return 'empty'
  if (entries.some(e => e.pending_resolution)) return 'pending'
  if (entries.some(e => !e.property_id)) return 'unallocated'
  const sources = entries.map(e => e.source)
  if (sources.some(s => s === 'workyard_corrected' || s === 'manual_manager' || s === 'manual_spread')) return 'adjusted'
  return 'normal'
}

export function WeekGrid({ entries, weekStart, selectedCell, onCellClick, drawerRowPropertyId, renderDrawer }: WeekGridProps) {
  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(parseISO(weekStart), i)),
    [weekStart]
  )

  const { unallocatedRows, propertyRows, dayTotals, weekTotal } = useMemo(() => {
    // Build a map: propertyId -> dayIndex -> entries[]
    const byPropDay = new Map<string | null, Map<number, PayrollTimeEntry[]>>()

    for (const entry of entries) {
      const entryDate = parseISO(entry.entry_date)
      const dayIdx = days.findIndex(d => format(d, 'yyyy-MM-dd') === format(entryDate, 'yyyy-MM-dd'))
      if (dayIdx === -1) continue

      const propKey = entry.property_id ?? null
      if (!byPropDay.has(propKey)) byPropDay.set(propKey, new Map())
      const dayMap = byPropDay.get(propKey)!
      if (!dayMap.has(dayIdx)) dayMap.set(dayIdx, [])
      dayMap.get(dayIdx)!.push(entry)
    }

    // Build unallocated rows (one row per unique unallocated block — grouped by day)
    const unallocDayMap = byPropDay.get(null) ?? new Map<number, PayrollTimeEntry[]>()
    const unallocCells = days.map((_, i) => {
      const cellEntries = unallocDayMap.get(i) ?? []
      return {
        entries: cellEntries,
        hours: cellEntries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0),
        state: getCellState(cellEntries) as CellState,
      }
    })
    const unallocTotal = unallocCells.reduce((s, c) => s + c.hours, 0)

    // Build property rows
    const propertyMap = new Map<string, { code: string; name: string; dayMap: Map<number, PayrollTimeEntry[]> }>()
    Array.from(byPropDay.entries()).forEach(([propId, dMap]) => {
      if (propId === null) return
      // Get property info from first entry
      const firstEntry = Array.from(dMap.values()).flat()[0]
      const prop = firstEntry?.property as { code: string; name: string } | null
      if (!propertyMap.has(propId)) {
        propertyMap.set(propId, { code: prop?.code ?? propId.slice(0, 6), name: prop?.name ?? 'Unknown', dayMap: dMap })
      }
    })

    const propertyRows = Array.from(propertyMap.entries())
      .sort((a, b) => a[1].code.localeCompare(b[1].code))
      .map(([propId, info]) => {
        const cells = days.map((_, i) => {
          const cellEntries = info.dayMap.get(i) ?? []
          return {
            entries: cellEntries,
            hours: cellEntries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0),
            state: getCellState(cellEntries) as CellState,
          }
        })
        const rowTotal = cells.reduce((s, c) => s + c.hours, 0)
        return { propertyId: propId, code: info.code, name: info.name, cells, rowTotal }
      })

    const dayTotals = days.map((_, i) => {
      const dayEntries = entries.filter(e => {
        const d = parseISO(e.entry_date)
        return format(d, 'yyyy-MM-dd') === format(days[i], 'yyyy-MM-dd')
      })
      return dayEntries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)
    })

    const weekTotal = entries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0)

    return {
      unallocatedRows: unallocTotal > 0 ? [{ cells: unallocCells, rowTotal: unallocTotal }] : [],
      propertyRows,
      dayTotals,
      weekTotal,
    }
  }, [entries, days])

  const isCellSelected = (propId: string | null, dayIdx: number) =>
    selectedCell?.rowPropertyId === propId && selectedCell?.dayIndex === dayIdx

  const cellClass = (state: CellState, isSelected: boolean, propId: string | null) => {
    const cursor = state === 'empty' ? 'cursor-default' : 'cursor-pointer'
    const base = `px-2 py-1.5 text-right text-sm border-r border-[var(--divider)] ${cursor} transition-colors relative`
    if (isSelected) return `${base} bg-[var(--primary)]/10`
    if (state === 'unallocated' || propId === null) return `${base} bg-amber-50 hover:bg-amber-100`
    if (state === 'pending') return `${base} bg-blue-50 hover:bg-blue-100`
    if (state === 'adjusted') return `${base} hover:bg-[var(--primary)]/5 border-l-2 border-l-[var(--accent)]`
    if (state === 'empty') return `${base} text-[var(--muted)]/40 hover:bg-[var(--bg-section)]`
    return `${base} hover:bg-[var(--primary)]/5`
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-3 py-2 text-left font-medium text-[var(--muted)] text-xs w-40 bg-[var(--bg-section)]">Property</th>
            {days.map((d, i) => (
              <th key={i} className="px-2 py-2 text-right font-medium text-[var(--muted)] text-xs bg-[var(--bg-section)] min-w-[72px]">
                <span className="block">{format(d, 'EEE')}</span>
                <span className="block font-normal">{format(d, 'M/d')}</span>
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium text-[var(--muted)] text-xs bg-[var(--bg-section)]">Total</th>
          </tr>
        </thead>
        <tbody>
          {/* Unallocated rows */}
          {unallocatedRows.map((row, rowIdx) => (
            <>
              <tr key={`unalloc-${rowIdx}`} className="border-b border-[var(--border)] bg-amber-50">
                <td className="px-3 py-2 font-medium text-xs text-[var(--warning)] border-r border-[var(--border)]">
                  <span className="uppercase tracking-wide">Unallocated</span>
                </td>
                {row.cells.map((cell, dayIdx) => (
                  <td
                    key={dayIdx}
                    onClick={() => cell.entries.length > 0 && onCellClick({ rowPropertyId: null, dayIndex: dayIdx, entries: cell.entries })}
                    className={cellClass(cell.state, isCellSelected(null, dayIdx), null)}
                  >
                    {cell.hours > 0 ? <span className="font-medium">{cell.hours % 1 === 0 ? cell.hours : cell.hours.toFixed(2)}</span> : null}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-medium text-xs text-[var(--warning)] bg-amber-50">
                  {row.rowTotal > 0 ? row.rowTotal.toFixed(row.rowTotal % 1 === 0 ? 0 : 2) : '—'}
                </td>
              </tr>
              {drawerRowPropertyId === null && unallocatedRows.length > 0 && (
                <tr key="drawer-unalloc">
                  <td colSpan={9} className="p-0 border-b border-[var(--border)]">
                    {renderDrawer()}
                  </td>
                </tr>
              )}
            </>
          ))}

          {/* Property rows */}
          {propertyRows.map(row => (
            <>
              <tr key={row.propertyId} className="border-b border-[var(--divider)] hover:bg-[var(--bg-section)]/50">
                <td className="px-3 py-2 border-r border-[var(--border)]">
                  <span className="font-mono text-xs text-[var(--muted)]">{row.code}</span>
                  <span className="ml-2 text-xs text-[var(--ink)] truncate">{row.name}</span>
                </td>
                {row.cells.map((cell, dayIdx) => (
                  <td
                    key={dayIdx}
                    onClick={() => cell.entries.length > 0 && onCellClick({ rowPropertyId: row.propertyId, dayIndex: dayIdx, entries: cell.entries })}
                    className={cellClass(cell.state, isCellSelected(row.propertyId, dayIdx), row.propertyId)}
                  >
                    {cell.hours > 0
                      ? <span className={cell.state === 'adjusted' ? 'text-[var(--accent)]' : ''}>{cell.hours % 1 === 0 ? cell.hours : cell.hours.toFixed(2)}</span>
                      : null
                    }
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right text-xs text-[var(--muted)] font-medium">
                  {row.rowTotal > 0 ? row.rowTotal.toFixed(row.rowTotal % 1 === 0 ? 0 : 2) : '—'}
                </td>
              </tr>
              {drawerRowPropertyId !== undefined && drawerRowPropertyId === row.propertyId && (
                <tr key={`drawer-${row.propertyId}`}>
                  <td colSpan={9} className="p-0 border-b border-[var(--border)]">
                    {renderDrawer()}
                  </td>
                </tr>
              )}
            </>
          ))}

          {/* Totals row */}
          <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-section)]">
            <td className="px-3 py-2 text-xs font-medium text-[var(--muted)]">Daily Total</td>
            {dayTotals.map((total, i) => (
              <td key={i} className="px-2 py-2 text-right text-xs font-medium text-[var(--ink)] border-r border-[var(--divider)]">
                {total > 0 ? total.toFixed(total % 1 === 0 ? 0 : 2) : '—'}
              </td>
            ))}
            <td className="px-3 py-2 text-right text-sm font-semibold text-[var(--primary)]">
              {weekTotal.toFixed(weekTotal % 1 === 0 ? 0 : 2)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
