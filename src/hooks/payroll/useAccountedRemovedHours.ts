'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

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

    const { data: inactive } = await supabase
      .from('payroll_time_entries')
      .select('id, employee_id, regular_hours, ot_hours')
      .eq('payroll_week_id', weekId)
      .eq('is_active', false)
    if (!inactive || inactive.length === 0) { setByEmployee(new Map()); return }

    const ids = inactive.map(e => e.id)
    const { data: corr } = await supabase
      .from('payroll_timesheet_corrections')
      .select('time_entry_id')
      .in('time_entry_id', ids)
    const accounted = new Set((corr ?? []).map(c => c.time_entry_id))

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
