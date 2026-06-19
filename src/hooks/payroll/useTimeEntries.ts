'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollTimeEntry, PayrollTimesheetCorrection } from '@/lib/supabase/types'

export function useTimeEntries(weekId: string | null) {
  const [entries, setEntries] = useState<PayrollTimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!weekId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_time_entries')
      .select(`
        *,
        employee:payroll_employees(id, name, workyard_id, type, hourly_rate, weekly_rate),
        property:properties(id, code, name, total_units, portfolio_id)
      `)
      .eq('payroll_week_id', weekId)
      .eq('is_active', true)
      .order('entry_date')
    if (err) setError(err.message)
    else setEntries(data ?? [])
    setLoading(false)
  }, [weekId])

  useEffect(() => { fetch() }, [fetch])

  const flaggedEntries = entries.filter(e => e.is_flagged)
  const unflaggedEntries = entries.filter(e => !e.is_flagged)

  return { entries, flaggedEntries, unflaggedEntries, loading, error, refetch: fetch }
}

export function useTimesheetCorrections(weekId: string | null) {
  const [corrections, setCorrections] = useState<PayrollTimesheetCorrection[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!weekId) return
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('payroll_timesheet_corrections')
      .select(`
        *,
        time_entry:payroll_time_entries(
          id, entry_date, regular_hours, ot_hours, employee_id,
          employee:payroll_employees(name),
          from_property:properties!payroll_time_entries_property_id_fkey(code, name)
        ),
        to_property:properties!payroll_timesheet_corrections_to_property_id_fkey(code, name)
      `)
      .order('corrected_at', { ascending: false })
    setCorrections(data ?? [])
    setLoading(false)
  }, [weekId])

  useEffect(() => { fetch() }, [fetch])

  const applyCorrection = useCallback(async (
    entryId: string,
    toPropertyId: string,
    hours: number,
    reason: string,
    fromPropertyId?: string
  ) => {
    const supabase = createClient()
    const { error: insertErr } = await supabase.from('payroll_timesheet_corrections').insert({
      time_entry_id: entryId,
      from_property_id: fromPropertyId ?? null,
      to_property_id: toPropertyId,
      hours,
      reason,
      corrected_by: (await supabase.auth.getUser()).data.user?.id,
      corrected_at: new Date().toISOString(),
    })
    if (insertErr) throw insertErr
    const { error: updateErr } = await supabase
      .from('payroll_time_entries')
      .update({ is_flagged: false, property_id: toPropertyId })
      .eq('id', entryId)
    if (updateErr) throw updateErr
    await fetch()
  }, [fetch])

  return { corrections, loading, applyCorrection, refetch: fetch }
}
