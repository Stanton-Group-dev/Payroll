'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollEmployee, PayrollEmployeeRate, PayrollEmployeeDeptSplit, PayrollEmployeeAudit } from '@/lib/supabase/types'

export function usePayrollEmployees(includeInactive = false) {
  const [employees, setEmployees] = useState<PayrollEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    let query = supabase.from('payroll_employees').select('*').order('name')
    if (!includeInactive) query = query.eq('is_active', true)
    const { data, error: err } = await query
    if (err) setError(err.message)
    else setEmployees(data ?? [])
    setLoading(false)
  }, [includeInactive])

  useEffect(() => { fetch() }, [fetch])

  const upsertEmployee = useCallback(async (emp: Partial<PayrollEmployee>): Promise<string> => {
    const supabase = createClient()
    if (emp.id) {
      // Fetch current record to detect rate changes
      const { data: current } = await supabase
        .from('payroll_employees')
        .select('hourly_rate, weekly_rate')
        .eq('id', emp.id)
        .single()

      const { error: err } = await supabase
        .from('payroll_employees')
        .update(emp)
        .eq('id', emp.id)
      if (err) throw new Error(err.message)

      // Auto-log rate change to history if hourly_rate or weekly_rate changed
      const newRate = emp.hourly_rate ?? emp.weekly_rate
      const oldRate = current?.hourly_rate ?? current?.weekly_rate
      if (newRate !== undefined && newRate !== null && newRate !== oldRate) {
        await supabase.from('payroll_employee_rates').insert({
          employee_id: emp.id,
          rate: newRate,
          effective_date: new Date().toISOString().split('T')[0],
        })
      }
      await fetch()
      return emp.id
    } else {
      const { data: inserted, error: err } = await supabase
        .from('payroll_employees')
        .insert(emp)
        .select()
        .single()
      if (err) throw new Error(err.message)
      // Log initial rate for new employees
      const initialRate = emp.hourly_rate ?? emp.weekly_rate
      if (inserted && initialRate) {
        await supabase.from('payroll_employee_rates').insert({
          employee_id: inserted.id,
          rate: initialRate,
          effective_date: new Date().toISOString().split('T')[0],
        })
      }
      await fetch()
      return inserted.id
    }
  }, [fetch])

  const addRate = useCallback(async (rate: Omit<PayrollEmployeeRate, 'id' | 'created_at' | 'created_by'>) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const { error: err } = await supabase.from('payroll_employee_rates').insert({ ...rate, created_by: userId })
    if (err) throw new Error(err.message)
  }, [])

  const upsertDeptSplits = useCallback(async (splits: Omit<PayrollEmployeeDeptSplit, 'id' | 'created_at'>[]) => {
    const supabase = createClient()
    for (const split of splits) {
      const { error: err } = await supabase.from('payroll_employee_dept_splits').insert(split)
      if (err) throw new Error(err.message)
    }
  }, [])

  return { employees, loading, error, refetch: fetch, upsertEmployee, addRate, upsertDeptSplits }
}

/** Full per-field audit history for one employee, plus a field -> most-recent-change lookup. */
export function useEmployeeAudit(employeeId: string | null) {
  const [audit, setAudit] = useState<PayrollEmployeeAudit[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!employeeId) { setAudit([]); return }
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('payroll_employee_audit')
      .select('*')
      .eq('employee_id', employeeId)
      .order('changed_at', { ascending: false })
    setAudit(data ?? [])
    setLoading(false)
  }, [employeeId])

  useEffect(() => { load() }, [load])

  // Most recent change per field (audit is already sorted newest-first).
  const lastByField: Record<string, PayrollEmployeeAudit> = {}
  for (const row of audit) {
    if (!lastByField[row.field]) lastByField[row.field] = row
  }

  return { audit, lastByField, loading, refetch: load }
}

export function useEmployeeRates(employeeId: string | null) {
  const [rates, setRates] = useState<PayrollEmployeeRate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!employeeId) return
    setLoading(true)
    const supabase = createClient()
    supabase
      .from('payroll_employee_rates')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_date', { ascending: false })
      .then(({ data }) => {
        setRates(data ?? [])
        setLoading(false)
      })
  }, [employeeId])

  return { rates, loading }
}

export function useEmployeeDeptSplits(employeeId: string | null) {
  const [splits, setSplits] = useState<PayrollEmployeeDeptSplit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!employeeId) return
    setLoading(true)
    const supabase = createClient()
    supabase
      .from('payroll_employee_dept_splits')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_date', { ascending: false })
      .then(({ data }) => {
        setSplits(data ?? [])
        setLoading(false)
      })
  }, [employeeId])

  return { splits, loading }
}
