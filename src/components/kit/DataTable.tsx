'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronUp, ChevronDown, ChevronsUpDown, GripVertical, Settings2, Download } from 'lucide-react'

export type Density = 'compact' | 'comfortable' | 'spacious'

export interface Column<T = Record<string, unknown>> {
  key: string
  label: string
  width?: number
  minWidth?: number
  render?: (value: unknown, row: T, index: number) => React.ReactNode
  sortable?: boolean
}

interface DataTableProps<T extends Record<string, unknown>> {
  data: T[]
  columns: Column<T>[]
  loading?: boolean
  onRowClick?: (row: T) => void
  exportable?: boolean
  onExport?: () => void
  emptyMessage?: string
  className?: string
  tableId?: string
  selectedIds?: Set<string>
  rowKey?: keyof T
  /**
   * When true, the table flows with the page (no internal vertical scroll) and the
   * column header row sticks to the top of the nearest scrolling ancestor. Use this
   * when the table lives inside a page-level scroll region so the page header can
   * scroll away while the column headers pin to the top.
   */
  stickyHeader?: boolean
}

const densityPadding: Record<Density, string> = {
  compact: 'py-2',
  comfortable: 'py-3',
  spacious: 'py-4',
}

function SortableHeader({
  column,
  sortKey,
  sortDir,
  onSort,
  width,
  onResizeStart,
  sticky = false,
}: {
  column: Column
  sortKey: string | null
  sortDir: 'asc' | 'desc' | null
  onSort: (key: string) => void
  width: number
  onResizeStart: (e: React.MouseEvent, key: string) => void
  sticky?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width,
    minWidth: column.minWidth ?? 50,
    opacity: isDragging ? 0.5 : 1,
  }

  const isSorted = sortKey === column.key
  const SortIcon = isSorted ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`${sticky ? 'sticky top-0 z-20' : 'relative'} bg-[var(--surface-chrome)] text-[var(--ink)] text-left text-xs font-medium uppercase tracking-wider select-none group`}
    >
      <div className="flex items-center gap-1 px-3 py-3">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[var(--muted)] hover:text-[var(--ink)] shrink-0"
        >
          <GripVertical size={12} />
        </span>
        <button
          onClick={() => column.sortable !== false && onSort(column.key)}
          className={`flex items-center gap-1 flex-1 text-left ${column.sortable !== false ? 'hover:text-[var(--ink)]/70' : 'cursor-default'}`}
        >
          <span className="truncate">{column.label}</span>
          {column.sortable !== false && (
            <SortIcon size={11} className={isSorted ? 'text-[var(--accent)]' : 'text-[var(--muted)]'} />
          )}
        </button>
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={(e) => onResizeStart(e, column.key)}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] bg-transparent transition-colors"
      />
    </th>
  )
}

export default function DataTable<T extends Record<string, unknown>>({
  data,
  columns: initialColumns,
  loading = false,
  onRowClick,
  exportable = false,
  onExport,
  emptyMessage = 'No data',
  className = '',
  tableId = 'default',
  selectedIds,
  rowKey = 'id' as keyof T,
  stickyHeader = false,
}: DataTableProps<T>) {
  const storageKey = `payroll_table_${tableId}`

  const [density, setDensity] = useState<Density>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(`${storageKey}_density`) as Density) ?? 'compact'
    }
    return 'compact'
  })

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${storageKey}_order`)
      if (saved) return JSON.parse(saved)
    }
    return initialColumns.map((c) => c.key)
  })

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${storageKey}_widths`)
      if (saved) return JSON.parse(saved)
    }
    const defaults: Record<string, number> = {}
    initialColumns.forEach((c) => { defaults[c.key] = c.width ?? 150 })
    return defaults
  })

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)
  const [showColumnMenu, setShowColumnMenu] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${storageKey}_visible`)
      if (saved) return JSON.parse(saved)
    }
    return initialColumns.map((c) => c.key)
  })

  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const orderedColumns = useMemo(() => {
    const colMap = Object.fromEntries(initialColumns.map((c) => [c.key, c]))
    return columnOrder.filter((k) => visibleColumns.includes(k) && colMap[k]).map((k) => colMap[k])
  }, [columnOrder, visibleColumns, initialColumns])

  const sortedData = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortKey, sortDir])

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev !== key) { setSortDir('asc'); return key }
      setSortDir((d) => {
        if (d === 'asc') return 'desc'
        if (d === 'desc') { setSortKey(null); return null }
        return 'asc'
      })
      return key
    })
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setColumnOrder((order) => {
        const updated = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)))
        localStorage.setItem(`${storageKey}_order`, JSON.stringify(updated))
        return updated
      })
    }
  }, [storageKey])

  const handleResizeStart = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault()
    resizingRef.current = { key, startX: e.clientX, startWidth: columnWidths[key] ?? 150 }
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = ev.clientX - resizingRef.current.startX
      const newWidth = Math.max(50, Math.min(800, resizingRef.current.startWidth + delta))
      setColumnWidths((prev) => {
        const updated = { ...prev, [resizingRef.current!.key]: newWidth }
        localStorage.setItem(`${storageKey}_widths`, JSON.stringify(updated))
        return updated
      })
    }
    const onUp = () => {
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [columnWidths, storageKey])

  const handleDensity = (d: Density) => {
    setDensity(d)
    localStorage.setItem(`${storageKey}_density`, d)
  }

  const toggleColumn = (key: string) => {
    setVisibleColumns((prev) => {
      const updated = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      localStorage.setItem(`${storageKey}_visible`, JSON.stringify(updated))
      return updated
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const padding = densityPadding[density]

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--divider)] bg-[var(--bg-section)]">
        <div className="flex items-center gap-1">
          {(['compact', 'comfortable', 'spacious'] as Density[]).map((d) => (
            <button
              key={d}
              onClick={() => handleDensity(d)}
              className={`px-2.5 py-1 text-xs transition-colors ${
                density === d
                  ? 'bg-[var(--ink)] text-white'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--divider)]'
              }`}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{data.length} rows</span>
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--divider)] transition-colors"
            >
              <Settings2 size={12} />
              Columns
            </button>
            {showColumnMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] shadow-lg z-50 min-w-40 py-1">
                {initialColumns.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-section)] cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded-none"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          {exportable && (
            <button
              onClick={onExport}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--divider)] transition-colors"
            >
              <Download size={12} />
              Export
            </button>
          )}
        </div>
      </div>

      {/* Table — in stickyHeader mode the table flows with the page (no internal
          scroll container) so the sticky header pins to the page-level scroll region. */}
      <div className={stickyHeader ? '' : 'overflow-auto flex-1'}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="border-collapse text-sm" style={{ minWidth: '100%', tableLayout: 'fixed' }}>
            <thead>
              <SortableContext items={orderedColumns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
                <tr>
                  {orderedColumns.map((col) => (
                    <SortableHeader
                      key={col.key}
                      column={col as Column}
                      sortKey={sortKey}
                      sortDir={isSortDir(sortDir)}
                      onSort={handleSort}
                      width={columnWidths[col.key] ?? col.width ?? 150}
                      onResizeStart={handleResizeStart}
                      sticky={stickyHeader}
                    />
                  ))}
                </tr>
              </SortableContext>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={orderedColumns.length} className="px-4 py-8 text-center text-[var(--muted)] text-sm">
                    Loading…
                  </td>
                </tr>
              ) : sortedData.length === 0 ? (
                <tr>
                  <td colSpan={orderedColumns.length} className="px-4 py-8 text-center text-[var(--muted)] text-sm">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sortedData.map((row, idx) => {
                  const id = String(row[rowKey] ?? idx)
                  const isSelected = selectedIds?.has(id)
                  return (
                    <tr
                      key={id}
                      onClick={() => onRowClick?.(row)}
                      className={`border-b border-[var(--divider)] transition-colors ${
                        onRowClick ? 'cursor-pointer' : ''
                      } ${
                        isSelected
                          ? 'bg-[var(--primary)]/5 ring-1 ring-inset ring-[var(--primary)]/20'
                          : idx % 2 === 0
                          ? 'bg-white hover:bg-[var(--bg-section)]'
                          : 'bg-[var(--bg-section)] hover:bg-[var(--divider)]'
                      }`}
                    >
                      {orderedColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-3 ${padding} text-[var(--ink)] overflow-hidden`}
                          style={{ width: columnWidths[col.key] ?? col.width ?? 150 }}
                        >
                          <div className="truncate">
                            {col.render
                              ? col.render(row[col.key], row, idx)
                              : String(row[col.key] ?? '')}
                          </div>
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </DndContext>
      </div>
    </div>
  )
}

function isSortDir(d: 'asc' | 'desc' | null): 'asc' | 'desc' | null {
  return d
}
