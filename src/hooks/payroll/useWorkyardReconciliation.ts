'use client'

import { useState, useEffect, useCallback } from 'react'
import type { WorkyardRow } from '@/lib/payroll/csv-parser'

/**
 * Live reconciliation source: pulls the week's Workyard time-card totals so the
 * Timesheet Adjustments screen can flag when recorded hours fall SHORT of what
 * Workyard actually has — the guardrail the unique-index drop bug slipped past
 * (a short timesheet looked identical to a correct one). Keyed by Workyard team
 * member id (employee.workyard_id), summing regular+ot the same way the importer does.
 *
 * Mirrors the import's pull (approvedOnly=false) so the comparison is apples-to-apples
 * with what an import would bring in. Fails soft: if Workyard is unreachable or creds
 * are absent, `available` is false and no badges render (never blocks the page).
 */
export function useWorkyardReconciliation(weekStart: string | null) {
  const [hoursByWorkyardId, setHoursByWorkyardId] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTotals = useCallback(async () => {
    if (!weekStart) { setHoursByWorkyardId(new Map()); setAvailable(false); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workyard/timecards?weekStart=${weekStart}&approvedOnly=false`)
      const json = await res.json()
      if (!res.ok) {
        setAvailable(false)
        setError(json.error ?? 'Workyard unavailable')
        setHoursByWorkyardId(new Map())
        return
      }
      const { rows } = json as { rows: WorkyardRow[] }
      const map = new Map<string, number>()
      for (const r of rows) {
        const id = r.workyardId
        if (!id) continue
        map.set(id, (map.get(id) ?? 0) + (r.regularHours ?? 0) + (r.otHours ?? 0))
      }
      setHoursByWorkyardId(map)
      setAvailable(true)
    } catch (e) {
      setAvailable(false)
      setError(e instanceof Error ? e.message : 'Network error')
      setHoursByWorkyardId(new Map())
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { fetchTotals() }, [fetchTotals])

  return { hoursByWorkyardId, loading, available, error, refetch: fetchTotals }
}
