'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { assertWeekWritable } from '@/lib/payroll/weekLock'

export interface DeptSplitOverride {
  id: string
  payroll_week_id: string
  employee_id: string
  department: string
  allocation_pct: number
  reason: string
  submitted_by: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
}

export function useDeptSplitOverrides(weekId: string | null) {
  const [overrides, setOverrides] = useState<DeptSplitOverride[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!weekId) { setOverrides([]); return }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_dept_split_overrides')
      .select('*')
      .eq('payroll_week_id', weekId)
      .eq('is_active', true)
      .order('employee_id')
    if (err) setError(err.message)
    setOverrides(data ?? [])
    setLoading(false)
  }, [weekId])

  useEffect(() => { fetch() }, [fetch])

  const saveOverrides = useCallback(async (
    employeeId: string,
    rows: { department: string; allocation_pct: number }[],
    reason: string
  ) => {
    if (!weekId) return
    const supabase = createClient()
    await assertWeekWritable(supabase, weekId)
    const userId = (await supabase.auth.getUser()).data.user?.id

    // Soft-delete existing overrides for this employee + week
    const { error: softDeleteErr } = await supabase
      .from('payroll_dept_split_overrides')
      .update({ is_active: false })
      .eq('payroll_week_id', weekId)
      .eq('employee_id', employeeId)
      .eq('is_active', true)
    if (softDeleteErr) throw new Error(softDeleteErr.message)

    // Insert new rows
    if (rows.length > 0) {
      const inserts = rows.map(r => ({
        payroll_week_id: weekId,
        employee_id: employeeId,
        department: r.department,
        allocation_pct: r.allocation_pct,
        reason,
        submitted_by: userId ?? null,
      }))
      const { error } = await supabase.from('payroll_dept_split_overrides').insert(inserts)
      if (error) throw new Error(error.message)
    }

    await fetch()
  }, [weekId, fetch])

  const deleteOverrides = useCallback(async (employeeId: string) => {
    if (!weekId) return
    const supabase = createClient()
    const { error: deleteErr } = await supabase
      .from('payroll_dept_split_overrides')
      .update({ is_active: false })
      .eq('payroll_week_id', weekId)
      .eq('employee_id', employeeId)
      .eq('is_active', true)
    if (deleteErr) throw new Error(deleteErr.message)
    await fetch()
  }, [weekId, fetch])

  return { overrides, loading, error, refetch: fetch, saveOverrides, deleteOverrides }
}
