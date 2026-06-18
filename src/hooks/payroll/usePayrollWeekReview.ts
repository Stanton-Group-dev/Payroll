'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  isNonBillableProperty,
  curatedToProperty,
  CURATED_PROPERTY_COLUMNS,
  type CuratedPropertyRow,
} from '@/lib/payroll/properties'
import type {
  PayrollWeek,
  PayrollEmployee,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  PayrollEmployeeRate,
  PayrollMileageReimbursement,
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
  const [excludedPropertyIds, setExcludedPropertyIds] = useState<Set<string>>(new Set())
  const [employeeRates, setEmployeeRates] = useState<PayrollEmployeeRate[]>([])
  const [mileageReimbursements, setMileageReimbursements] = useState<PayrollMileageReimbursement[]>([])
  const [heldEmployeeIds, setHeldEmployeeIds] = useState<Set<string>>(new Set())
  const [waivedEmployeeIds, setWaivedEmployeeIds] = useState<Set<string>>(new Set())
  // Dept splits drive the per-department breakdown of the Administrative (spread) line.
  type DeptSplitRow = { employee_id: string; department: string; allocation_pct: number; effective_date?: string }
  const [defaultDeptSplits, setDefaultDeptSplits] = useState<DeptSplitRow[]>([])
  const [deptSplitOverrides, setDeptSplitOverrides] = useState<DeptSplitRow[]>([])
  const [approved, setApproved] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [unresolvedCount, setUnresolvedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approvingTimesheet, setApprovingTimesheet] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [weekRes, empRes, entRes, adjRes, feeRes, propRes, portRes, approvalRes, ratesRes, mileageRes, holdsRes, splitRes, ovRes] = await Promise.all([
      supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
      supabase.from('payroll_employees').select('*').eq('is_active', true),
      supabase.from('payroll_time_entries').select('*').eq('payroll_week_id', weekId).eq('is_flagged', false).eq('is_active', true),
      supabase.from('payroll_adjustments').select('*').eq('payroll_week_id', weekId).eq('is_active', true),
      supabase.from('payroll_management_fee_config').select('*').order('effective_date', { ascending: false }),
      supabase.from('payroll_property').select(CURATED_PROPERTY_COLUMNS).eq('is_active', true),
      supabase.from('portfolios').select('id, include_in_invoicing'),
      supabase.from('payroll_approvals').select('*').eq('payroll_week_id', weekId).eq('stage', 'payroll'),
      supabase.from('payroll_employee_rates').select('*'),
      supabase.from('payroll_mileage_reimbursements').select('*').eq('payroll_week_id', weekId),
      supabase.from('payroll_employee_holds').select('employee_id, status').eq('payroll_week_id', weekId).in('status', ['held', 'waived']),
      supabase.from('payroll_employee_dept_splits').select('employee_id, department, allocation_pct, effective_date'),
      supabase.from('payroll_dept_split_overrides').select('employee_id, department, allocation_pct').eq('payroll_week_id', weekId).eq('is_active', true),
    ])
    if (weekRes.error) { setError(weekRes.error.message); setLoading(false); return }
    setWeek(weekRes.data)
    // Held employees are pulled from the run entirely — excluded here so the calc
    // drops both their pay and their property labor cost (you can't bill labor you
    // didn't pay). They reappear once their hold is released.
    const holdRows = holdsRes.data ?? []
    const held = new Set(holdRows.filter(h => h.status === 'held').map(h => h.employee_id))
    // Waived employees stay in the run (paid for allocated work) but their unallocated
    // (no-property) hours are written off. The waive deactivates those entries, so the
    // is_active filter above already drops them; this set is a backstop that keeps them
    // out of pay even if a Workyard re-sync reactivates an entry while the waive stands.
    const waived = new Set(holdRows.filter(h => h.status === 'waived').map(h => h.employee_id))
    setHeldEmployeeIds(held)
    setWaivedEmployeeIds(waived)
    setEmployees((empRes.data ?? []).filter(e => !held.has(e.id)))
    setEntries(
      (entRes.data ?? []).filter(
        e =>
          e.property_id != null ||
          ((e.regular_hours ?? 0) + (e.ot_hours ?? 0)) <= 0 ||
          !waived.has(e.employee_id),
      ),
    )
    setAdjustments(adjRes.data ?? [])
    setFeeConfigs(feeRes.data ?? [])
    const props = (propRes.data ?? []).map(r => curatedToProperty(r as unknown as CuratedPropertyRow))
    setProperties(props)
    // Properties excluded from invoicing: own flag off, or their portfolio's flag off.
    // (Absence of a flag means included — default true.) Used to mark/hide rows in the
    // Property Cost Summary so the review matches what will actually be billed.
    const excludedPortfolios = new Set(
      (portRes.data ?? []).filter(p => p.include_in_invoicing === false).map(p => p.id),
    )
    setExcludedPropertyIds(new Set(
      props
        .filter(p =>
          isNonBillableProperty(p) ||
          p.include_in_invoicing === false ||
          (p.portfolio_id != null && excludedPortfolios.has(p.portfolio_id)),
        )
        .map(p => p.id),
    ))
    setEmployeeRates(ratesRes.data ?? [])
    setMileageReimbursements(mileageRes.data ?? [])
    setDefaultDeptSplits((splitRes.data ?? []) as DeptSplitRow[])
    setDeptSplitOverrides((ovRes.data ?? []) as DeptSplitRow[])
    setApproved((approvalRes.data?.length ?? 0) > 0)
    // Count the two kinds of open work that block timesheet/payroll approval:
    // pending (parked) entries, and unallocated entries (no property assigned yet).
    const [pendingRes, unresolvedRes] = await Promise.all([
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
        .is('property_id', null)
        .eq('is_active', true)
        // Overhead-spread rows (e.g. "Office") have no property by design — they're
        // allocated by unit-spread, not unresolved — so they never block approval.
        .eq('is_overhead_spread', false),
    ])
    setPendingCount(pendingRes.count ?? 0)
    setUnresolvedCount(unresolvedRes.count ?? 0)
    setLoading(false)
  }, [weekId])

  useEffect(() => { load() }, [load])

  // Resolve each salaried employee's dept splits for this week: the week override
  // wins; otherwise the most recent default-split set effective on or before the week.
  // Fed to calculatePayroll to break the Administrative (spread) line out by department.
  const salariedDeptSplits = useMemo(() => {
    const map: Record<string, { department: string; pct: number }[]> = {}
    const weekStart = week?.week_start
    const ovByEmp: Record<string, DeptSplitRow[]> = {}
    for (const o of deptSplitOverrides) (ovByEmp[o.employee_id] ??= []).push(o)
    const defByEmp: Record<string, DeptSplitRow[]> = {}
    for (const d of defaultDeptSplits) {
      if (weekStart && d.effective_date && d.effective_date > weekStart) continue
      ;(defByEmp[d.employee_id] ??= []).push(d)
    }
    for (const emp of employees) {
      if (emp.type !== 'salaried') continue
      const ov = ovByEmp[emp.id]
      if (ov?.length) {
        map[emp.id] = ov.map(o => ({ department: o.department, pct: Number(o.allocation_pct) }))
        continue
      }
      const def = defByEmp[emp.id]
      if (def?.length) {
        const latest = def.reduce((m, d) => (d.effective_date && d.effective_date > m ? d.effective_date : m), '')
        map[emp.id] = def
          .filter(d => (d.effective_date ?? '') === latest)
          .map(d => ({ department: d.department, pct: Number(d.allocation_pct) }))
      }
    }
    return map
  }, [deptSplitOverrides, defaultDeptSplits, employees, week?.week_start])

  // Approve the timesheet: draft → corrections_complete. This is the gate the
  // review page waits on before payroll can be calculated. Re-checks blockers
  // against the DB so a week with open work can never be approved, even on stale
  // local state, and only advances a week that is still in draft.
  const approveTimesheet = useCallback(async () => {
    setApprovingTimesheet(true)
    try {
      const supabase = createClient()
      const [{ count: unresolved }, { count: pending }] = await Promise.all([
        supabase.from('payroll_time_entries').select('id', { count: 'exact', head: true })
          .eq('payroll_week_id', weekId).is('property_id', null).eq('is_active', true)
          .eq('is_overhead_spread', false),
        supabase.from('payroll_time_entries').select('id', { count: 'exact', head: true })
          .eq('payroll_week_id', weekId).eq('pending_resolution', true).eq('is_active', true),
      ])
      if ((unresolved ?? 0) > 0 || (pending ?? 0) > 0) {
        throw new Error(`Resolve all entries first — ${unresolved ?? 0} unallocated, ${pending ?? 0} pending.`)
      }
      const { error: updErr } = await supabase
        .from('payroll_weeks')
        .update({ status: 'corrections_complete' })
        .eq('id', weekId)
        .eq('status', 'draft')
      if (updErr) throw new Error(updErr.message)
      await load()
    } finally {
      setApprovingTimesheet(false)
    }
  }, [weekId, load])

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
    mileageReimbursements, excludedPropertyIds, heldEmployeeIds, waivedEmployeeIds,
    salariedDeptSplits,
    approved, pendingCount, unresolvedCount, loading, error, approving, approvingTimesheet,
    approvePayroll, approveTimesheet, refetch: load,
  }
}
