'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollAdjustment } from '@/lib/supabase/types'
import { PHONE_REIMBURSEMENT_AMOUNT } from '@/lib/payroll/config'

export function usePayrollAdjustments(weekId: string | null) {
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!weekId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_adjustments')
      .select('*, employee:payroll_employees(id, name)')
      .eq('payroll_week_id', weekId)
      .eq('is_active', true)
      .order('created_at')
    if (err) setError(err.message)
    else setAdjustments(data ?? [])
    setLoading(false)
  }, [weekId])

  useEffect(() => { fetch() }, [fetch])

  const addAdjustment = useCallback(async (adj: Omit<PayrollAdjustment, 'id' | 'created_at' | 'updated_at' | 'employee' | 'created_by'>) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const { error: err } = await supabase.from('payroll_adjustments').insert({ ...adj, created_by: userId })
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  const deleteAdjustment = useCallback(async (id: string) => {
    const supabase = createClient()
    const { error: err } = await supabase.from('payroll_adjustments').update({ is_active: false }).eq('id', id)
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  const seedPhoneReimbursements = useCallback(async (employeeIds: string[]) => {
    if (!weekId) return
    const supabase = createClient()
    // Phone reimbursement is only for people who actually worked this week: anyone with
    // zero hours doesn't get it. Salaried employees (paid by weekly_rate, may log no
    // time entries) stay eligible regardless of logged hours.
    const [{ data: entryRows }, { data: empRows }] = await Promise.all([
      supabase
        .from('payroll_time_entries')
        .select('employee_id, regular_hours, ot_hours, pto_hours')
        .eq('payroll_week_id', weekId)
        .eq('is_active', true),
      supabase.from('payroll_employees').select('id, type').in('id', employeeIds),
    ])
    const hoursByEmp = new Map<string, number>()
    for (const r of entryRows ?? []) {
      hoursByEmp.set(
        r.employee_id,
        (hoursByEmp.get(r.employee_id) ?? 0) + (r.regular_hours ?? 0) + (r.ot_hours ?? 0) + (r.pto_hours ?? 0),
      )
    }
    const salaried = new Set((empRows ?? []).filter(e => e.type === 'salaried').map(e => e.id))
    const eligible = employeeIds.filter(id => (hoursByEmp.get(id) ?? 0) > 0 || salaried.has(id))

    const existing = adjustments.filter(a => a.type === 'phone').map(a => a.employee_id)
    const toAdd = eligible.filter(id => !existing.includes(id))
    if (toAdd.length === 0) return
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    // Phone reimbursement amount is a business setting (payroll_global_config); fall back to
    // the historical default when unset so existing behavior is unchanged.
    const { data: cfg } = await supabase
      .from('payroll_global_config')
      .select('phone_reimbursement_amount')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const phoneAmount = cfg?.phone_reimbursement_amount ?? PHONE_REIMBURSEMENT_AMOUNT
    const rows = toAdd.map(employee_id => ({
      payroll_week_id: weekId,
      employee_id,
      type: 'phone' as const,
      amount: phoneAmount,
      description: 'Weekly phone reimbursement',
      allocation_method: 'unit_weighted' as const,
      created_by: userId,
    }))
    const { error: err } = await supabase.from('payroll_adjustments').insert(rows)
    if (err) throw new Error(err.message)
    await fetch()
  }, [weekId, adjustments, fetch])

  return { adjustments, loading, error, refetch: fetch, addAdjustment, deleteAdjustment, seedPhoneReimbursements }
}
