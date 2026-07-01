'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/supabase/fetchAll'

/**
 * Per-employee hours that were deactivated for the week BUT have a logged correction
 * record (a deliberate, accountable removal — e.g. docking "excessive time at home").
 *
 * Used by the short-vs-Workyard reconciliation: recorded_effective = active + these,
 * so an intentional dock/reallocation doesn't read as a silent loss, while time that
 * was never captured (import drop) or deleted with no reason still flags. See the
 * Timesheet Adjustments page and [[workyard-import-identity-index]].
 */
export function useAccountedRemovedHours(weekId: string | null) {
  const [byEmployee, setByEmployee] = useState<Map<string, number>>(new Map())

  const fetchRemoved = useCallback(async () => {
    if (!weekId) { setByEmployee(new Map()); return }
    const supabase = createClient()

    const { data: inactive } = await fetchAllRows((from, to) => supabase
      .from('payroll_time_entries')
      .select('id, employee_id, regular_hours, ot_hours')
      .eq('payroll_week_id', weekId)
      .eq('is_active', false)
      .order('id')
      .range(from, to))
    if (!inactive || inactive.length === 0) { setByEmployee(new Map()); return }

    // Chunk the id filter — hundreds of ids in one .in() overruns the URL, and
    // the correction rows themselves can exceed the 1,000-row select cap.
    const ids = inactive.map(e => e.id)
    const accounted = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: corr } = await fetchAllRows((from, to) => supabase
        .from('payroll_timesheet_corrections')
        .select('time_entry_id')
        .in('time_entry_id', ids.slice(i, i + 200))
        .order('id')
        .range(from, to))
      for (const c of corr ?? []) accounted.add(c.time_entry_id)
    }

    const m = new Map<string, number>()
    for (const e of inactive) {
      if (!accounted.has(e.id)) continue // unlogged delete → leave it flaggable
      m.set(e.employee_id, (m.get(e.employee_id) ?? 0) + (e.regular_hours ?? 0) + (e.ot_hours ?? 0))
    }
    setByEmployee(m)
  }, [weekId])

  useEffect(() => { fetchRemoved() }, [fetchRemoved])

  return { accountedRemovedByEmployee: byEmployee, refetch: fetchRemoved }
}
