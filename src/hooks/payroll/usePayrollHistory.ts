'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { otMultiplier } from '@/lib/payroll/calculations'

export interface WeekHistoryData {
  invoices: Array<{ id: string; owner_llc: string; total_amount: number; status: string }>
  totalAmount: number
}

export interface EmployeePayRow {
  week_id: string
  week_start: string
  week_end: string
  regular_hours: number
  ot_hours: number
  pto_hours: number
  gross_pay: number
  adjustments: number
  advances: number
  net_pay: number
}

export function usePayrollWeekDetail(weekId: string) {
  const [data, setData] = useState<WeekHistoryData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: invoices } = await supabase
      .from('payroll_invoices')
      .select('*')
      .eq('payroll_week_id', weekId)
      .order('owner_llc')
    const totalAmount = (invoices ?? []).reduce((s: number, inv: { total_amount: number }) => s + Number(inv.total_amount), 0)
    setData({ invoices: invoices ?? [], totalAmount })
    setLoading(false)
  }, [weekId])

  return { data, loading, load }
}

export function useEmployeePayHistory() {
  const [rows, setRows] = useState<EmployeePayRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(async (
    employeeId: string,
    fromWeek: string,
    toWeek: string,
  ) => {
    if (!employeeId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()

    let weekQuery = supabase
      .from('payroll_weeks')
      .select('id, week_start, week_end')
      .in('status', ['payroll_approved', 'invoiced', 'statement_sent'])
      .order('week_start', { ascending: false })
    if (fromWeek) weekQuery = weekQuery.gte('week_start', fromWeek)
    if (toWeek) weekQuery = weekQuery.lte('week_start', toWeek)

    const { data: filteredWeeks, error: wErr } = await weekQuery
    if (wErr) { setError(wErr.message); setLoading(false); return }
    const weekIds = (filteredWeeks ?? []).map((w: { id: string }) => w.id)
    if (weekIds.length === 0) { setRows([]); setLoading(false); return }

    const [entRes, adjRes, empRes] = await Promise.all([
      supabase.from('payroll_time_entries')
        .select('payroll_week_id, regular_hours, ot_hours, pto_hours')
        .eq('employee_id', employeeId)
        .eq('is_flagged', false)
        .in('payroll_week_id', weekIds),
      supabase.from('payroll_adjustments')
        .select('payroll_week_id, type, amount')
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .in('payroll_week_id', weekIds),
      supabase.from('payroll_employees')
        .select('hourly_rate, weekly_rate, type, department, ot_allowed')
        .eq('id', employeeId)
        .single(),
    ])

    const emp = empRes.data
    const weekInfoMap: Record<string, { week_start: string; week_end: string }> = {}
    for (const w of (filteredWeeks ?? [])) weekInfoMap[w.id] = w

    const weekMap: Record<string, EmployeePayRow> = {}
    for (const wId of weekIds) {
      weekMap[wId] = {
        week_id: wId,
        week_start: weekInfoMap[wId]?.week_start ?? '',
        week_end: weekInfoMap[wId]?.week_end ?? '',
        regular_hours: 0, ot_hours: 0, pto_hours: 0,
        gross_pay: 0, adjustments: 0, advances: 0, net_pay: 0,
      }
    }

    for (const entry of (entRes.data ?? [])) {
      const row = weekMap[entry.payroll_week_id]
      if (!row) continue
      row.regular_hours += entry.regular_hours ?? 0
      row.ot_hours += entry.ot_hours ?? 0
      row.pto_hours += entry.pto_hours ?? 0
      const rate = emp?.hourly_rate ?? 0
      row.gross_pay += (entry.regular_hours ?? 0) * rate + (entry.ot_hours ?? 0) * rate * otMultiplier(emp?.type ?? 'hourly', emp?.department, emp?.ot_allowed ?? true)
    }

    if (emp?.type === 'salaried' && emp.weekly_rate) {
      for (const row of Object.values(weekMap)) {
        row.gross_pay = emp.weekly_rate
      }
    }

    for (const adj of (adjRes.data ?? [])) {
      const row = weekMap[adj.payroll_week_id]
      if (!row) continue
      if (adj.type === 'advance' || adj.type === 'deduction_other') {
        row.advances += Math.abs(adj.amount)
      } else {
        row.adjustments += adj.amount
        row.gross_pay += adj.amount
      }
    }

    const result = Object.values(weekMap)
      .map(row => ({
        ...row,
        gross_pay: Math.round(row.gross_pay * 100) / 100,
        net_pay: Math.round((row.gross_pay - row.advances) * 100) / 100,
      }))
      .filter(r => r.gross_pay > 0 || r.regular_hours > 0)
      .sort((a, b) => b.week_start.localeCompare(a.week_start))

    setRows(result)
    setLoading(false)
  }, [])

  return { rows, loading, error, search, clear: () => setRows([]) }
}
