'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/supabase/fetchAll'

export interface WorkyardReliabilityRow {
  employee_id: string
  employee_name: string
  total_entries: number
  workyard_entries: number
  manual_entries: number
  workyard_pct: number
  avg_unallocated_per_week: number
  weeks_with_unallocated: number
  total_weeks: number
}

export function useWorkyardReliability(employeeId?: string) {
  const [rows, setRows] = useState<WorkyardReliabilityRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    // Fetch all active time entries with employee info. This spans every week, so
    // it blew past the 1,000-row select cap long ago — drain in pages or the
    // reliability stats are computed on an arbitrary first page.
    const { data, error: err } = await fetchAllRows((from, to) => {
      let query = supabase
        .from('payroll_time_entries')
        .select(`
          id, employee_id, source, property_id, payroll_week_id,
          regular_hours, ot_hours,
          employee:payroll_employees(id, name)
        `)
        .eq('is_active', true)
        .order('id')
        .range(from, to)
      if (employeeId) query = query.eq('employee_id', employeeId)
      return query
    })
    if (err) { setError(err.message); setLoading(false); return }

    const entries = data ?? []

    // Aggregate per employee
    const map = new Map<string, {
      name: string
      total: number
      workyard: number
      manual: number
      weeks: Set<string>
      weeksWithUnallocated: Set<string>
      unallocatedHours: number
    }>()

    for (const e of entries) {
      const empId = e.employee_id
      const empName = (e.employee as unknown as { name: string } | null)?.name ?? 'Unknown'
      if (!map.has(empId)) {
        map.set(empId, { name: empName, total: 0, workyard: 0, manual: 0, weeks: new Set(), weeksWithUnallocated: new Set(), unallocatedHours: 0 })
      }
      const agg = map.get(empId)!
      agg.total++
      agg.weeks.add(e.payroll_week_id)

      const src = e.source as string
      if (src === 'workyard' || src === 'workyard_api' || src === 'workyard_corrected') {
        agg.workyard++
      } else {
        agg.manual++
      }

      if (!e.property_id) {
        agg.weeksWithUnallocated.add(e.payroll_week_id)
        agg.unallocatedHours += (e.regular_hours ?? 0) + (e.ot_hours ?? 0)
      }
    }

    const result: WorkyardReliabilityRow[] = Array.from(map.entries()).map(([empId, agg]) => ({
      employee_id: empId,
      employee_name: agg.name,
      total_entries: agg.total,
      workyard_entries: agg.workyard,
      manual_entries: agg.manual,
      workyard_pct: agg.total > 0 ? Math.round((agg.workyard / agg.total) * 100) : 0,
      avg_unallocated_per_week: agg.weeks.size > 0 ? parseFloat((agg.unallocatedHours / agg.weeks.size).toFixed(1)) : 0,
      weeks_with_unallocated: agg.weeksWithUnallocated.size,
      total_weeks: agg.weeks.size,
    }))

    // Sort by workyard_pct ascending (least reliable first)
    result.sort((a, b) => a.workyard_pct - b.workyard_pct)
    setRows(result)
    setLoading(false)
  }, [employeeId])

  useEffect(() => { fetch() }, [fetch])

  return { rows, loading, error, refetch: fetch }
}
