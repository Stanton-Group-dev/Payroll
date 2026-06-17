'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveMileageRateAsOf } from '@/lib/payroll/calculations'
import type {
  PayrollEmployee,
  PayrollMileageRate,
  PayrollMileageReimbursement,
  MileageStatus,
} from '@/lib/supabase/types'

/** One employee's mileage standing for the selected week. */
export interface MileageRow {
  employee: PayrollEmployee
  /** Summed Workyard miles from this week's active, unflagged time entries. */
  milesRaw: number
  /** Whether the employee is on the mileage roster (mileage_eligible). */
  eligible: boolean
  /** The saved review record, if one exists for this (week, employee). */
  record: PayrollMileageReimbursement | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Drives the weekly mileage review page. Merges three sources for a week:
 *   - the eligibility roster (payroll_employees.mileage_eligible)
 *   - raw miles summed from payroll_time_entries (each row carries its property)
 *   - any saved review records (payroll_mileage_reimbursements)
 * Employees who logged miles but are NOT on the roster are still surfaced (flagged),
 * so imported miles are never silently dropped.
 */
export function usePayrollMileage(weekId: string | undefined) {
  const [rows, setRows] = useState<MileageRow[]>([])
  const [rate, setRate] = useState<number>(0)
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!weekId) { setRows([]); return }
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const [weekRes, empRes, entRes, recRes, rateRes] = await Promise.all([
      supabase.from('payroll_weeks').select('week_start').eq('id', weekId).single(),
      supabase.from('payroll_employees').select('*').eq('is_active', true).order('name'),
      supabase
        .from('payroll_time_entries')
        .select('employee_id, miles')
        .eq('payroll_week_id', weekId)
        .eq('is_active', true)
        .eq('is_flagged', false),
      supabase.from('payroll_mileage_reimbursements').select('*').eq('payroll_week_id', weekId),
      supabase.from('payroll_mileage_rates').select('*').order('effective_date', { ascending: false }),
    ])

    if (empRes.error) { setError(empRes.error.message); setLoading(false); return }

    const wkStart: string | null = weekRes.data?.week_start ?? null
    setWeekStart(wkStart)
    const effRate = resolveMileageRateAsOf(
      (rateRes.data ?? []) as PayrollMileageRate[],
      wkStart ?? new Date().toISOString().split('T')[0]
    )
    setRate(effRate)

    // Sum raw miles per employee.
    const milesByEmp: Record<string, number> = {}
    for (const e of (entRes.data ?? []) as { employee_id: string; miles: number | null }[]) {
      milesByEmp[e.employee_id] = (milesByEmp[e.employee_id] ?? 0) + (Number(e.miles) || 0)
    }

    const recByEmp: Record<string, PayrollMileageReimbursement> = {}
    for (const r of (recRes.data ?? []) as PayrollMileageReimbursement[]) {
      recByEmp[r.employee_id] = r
    }

    const employees = (empRes.data ?? []) as PayrollEmployee[]
    const built: MileageRow[] = employees
      .map(emp => ({
        employee: emp,
        milesRaw: round2(milesByEmp[emp.id] ?? 0),
        eligible: !!emp.mileage_eligible,
        record: recByEmp[emp.id] ?? null,
      }))
      // Show on the roster if eligible, OR if they have miles, OR an existing record.
      .filter(r => r.eligible || r.milesRaw > 0 || r.record)

    setRows(built)
    setLoading(false)
  }, [weekId])

  useEffect(() => { load() }, [load])

  /**
   * Create or update an employee's review for the week. amount is derived from
   * approved miles × the week's effective rate. Snapshots the rate so later rate
   * changes don't retroactively alter approved runs.
   */
  const saveReview = useCallback(async (params: {
    employeeId: string
    milesRaw: number
    milesApproved: number
    status: MileageStatus
    notes?: string | null
  }) => {
    if (!weekId) throw new Error('No week selected')
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const amount = round2(params.milesApproved * rate)
    const reviewed = params.status !== 'pending'
    const { error: err } = await supabase
      .from('payroll_mileage_reimbursements')
      .upsert({
        payroll_week_id: weekId,
        employee_id: params.employeeId,
        miles_raw: round2(params.milesRaw),
        miles_approved: round2(params.milesApproved),
        rate_per_mile: rate,
        amount,
        status: params.status,
        notes: params.notes ?? null,
        reviewed_by: reviewed ? userId : null,
        reviewed_at: reviewed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
        created_by: userId,
      }, { onConflict: 'payroll_week_id,employee_id' })
    if (err) throw new Error(err.message)
    await load()
  }, [weekId, rate, load])

  return { rows, rate, weekStart, loading, error, refetch: load, saveReview }
}
