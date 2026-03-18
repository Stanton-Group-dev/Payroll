'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  PayrollWeek,
  PayrollEmployee,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  PayrollEmployeeRate,
  Property,
} from '@/lib/supabase/types'
import type { PayrollCalculationResult } from '@/lib/payroll/calculations'

export function usePayrollWeekReview(weekId: string) {
  const [week, setWeek] = useState<PayrollWeek | null>(null)
  const [employees, setEmployees] = useState<PayrollEmployee[]>([])
  const [entries, setEntries] = useState<PayrollTimeEntry[]>([])
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([])
  const [feeConfigs, setFeeConfigs] = useState<PayrollManagementFeeConfig[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [employeeRates, setEmployeeRates] = useState<PayrollEmployeeRate[]>([])
  const [approved, setApproved] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [flaggedCount, setFlaggedCount] = useState(0)
  const [deptSplitsComplete, setDeptSplitsComplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [weekRes, empRes, entRes, adjRes, feeRes, propRes, approvalRes, ratesRes] = await Promise.all([
      supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
      supabase.from('payroll_employees').select('*').eq('is_active', true),
      supabase.from('payroll_time_entries').select('*').eq('payroll_week_id', weekId).eq('is_flagged', false).eq('is_active', true),
      supabase.from('payroll_adjustments').select('*').eq('payroll_week_id', weekId).eq('is_active', true),
      supabase.from('payroll_management_fee_config').select('*').order('effective_date', { ascending: false }),
      supabase.from('properties').select('id, appfolio_property_id, code, name, total_units, portfolio_id, address, billing_llc, is_active').eq('is_active', true),
      supabase.from('payroll_approvals').select('*').eq('payroll_week_id', weekId).eq('stage', 'payroll'),
      supabase.from('payroll_employee_rates').select('*'),
    ])
    if (weekRes.error) { setError(weekRes.error.message); setLoading(false); return }
    setWeek(weekRes.data)
    setEmployees(empRes.data ?? [])
    setEntries(entRes.data ?? [])
    setAdjustments(adjRes.data ?? [])
    setFeeConfigs(feeRes.data ?? [])
    setProperties(propRes.data ?? [])
    setEmployeeRates(ratesRes.data ?? [])
    setApproved((approvalRes.data?.length ?? 0) > 0)
    // Count pending + flagged entries that block approval
    const [pendingRes, flaggedRes] = await Promise.all([
      supabase
        .from('payroll_time_entries')
        .select('id', { count: 'exact', head: true })
        .eq('payroll_week_id', weekId)
        .eq('pending_resolution', true)
        .eq('is_active', true),
      supabase
        .from('payroll_time_entries')
        .select('id', { count: 'exact', head: true })
        .eq('payroll_week_id', weekId)
        .eq('is_flagged', true)
        .eq('is_active', true),
    ])
    setPendingCount(pendingRes.count ?? 0)
    setFlaggedCount(flaggedRes.count ?? 0)

    // Check dept splits: all active salaried employees must have a default split or a week override
    const salariedEmployees = (empRes.data ?? []).filter(e => e.type === 'salaried')
    if (salariedEmployees.length === 0) {
      setDeptSplitsComplete(true)
    } else {
      const salariedIds = salariedEmployees.map(e => e.id)
      const [defaultSplitsRes, overridesRes] = await Promise.all([
        supabase
          .from('payroll_employee_dept_splits')
          .select('employee_id')
          .in('employee_id', salariedIds),
        supabase
          .from('payroll_dept_split_overrides')
          .select('employee_id')
          .eq('payroll_week_id', weekId)
          .in('employee_id', salariedIds),
      ])
      const coveredIds = new Set([
        ...(defaultSplitsRes.data ?? []).map(r => r.employee_id),
        ...(overridesRes.data ?? []).map(r => r.employee_id),
      ])
      setDeptSplitsComplete(salariedIds.every(id => coveredIds.has(id)))
    }
    setLoading(false)
  }, [weekId])

  useEffect(() => { load() }, [load])

  const approvePayroll = useCallback(async (result: PayrollCalculationResult) => {
    if (pendingCount > 0) throw new Error(`${pendingCount} entries are still pending — resolve or discard before approving.`)
    setApproving(true)
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id

    const costRows = result.property_costs
      .filter(pc => pc.total_cost > 0)
      .map(pc => ({
        payroll_week_id: weekId,
        property_id: pc.property_id,
        labor_cost: pc.labor_cost,
        spread_cost: pc.spread_cost,
        total_cost: pc.total_cost,
        cost_per_unit: pc.cost_per_unit,
      }))
    if (costRows.length > 0) {
      await supabase.from('payroll_weekly_property_costs').upsert(costRows)
    }

    await supabase.from('payroll_approvals').insert({
      payroll_week_id: weekId,
      stage: 'payroll',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    await supabase.from('payroll_weeks').update({ status: 'payroll_approved' }).eq('id', weekId)
    setApproved(true)
    setApproving(false)
  }, [weekId, pendingCount])

  return {
    week, employees, entries, adjustments, feeConfigs, properties, employeeRates,
    approved, pendingCount, flaggedCount, deptSplitsComplete, loading, error, approving,
    approvePayroll, refetch: load,
  }
}
