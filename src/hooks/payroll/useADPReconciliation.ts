'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/supabase/fetchAll'
import { calculatePayroll, resolveRateAsOf } from '@/lib/payroll/calculations'
import {
  curatedToProperty,
  CURATED_PROPERTY_COLUMNS,
  type CuratedPropertyRow,
} from '@/lib/payroll/properties'
import type { PayrollWeek, PayrollADPReconciliation } from '@/lib/supabase/types'

export interface SystemEmployeeRow {
  name: string
  gross: number
}

export interface ReconRow {
  employee_name: string
  system_gross: number
  adp_gross: number
  variance: number
}

export function useADPReconciliation(weekId: string) {
  const [week, setWeek] = useState<PayrollWeek | null>(null)
  const [reconciliation, setReconciliation] = useState<PayrollADPReconciliation | null>(null)
  const [existingRows, setExistingRows] = useState<ReconRow[]>([])
  const [systemEmployees, setSystemEmployees] = useState<SystemEmployeeRow[]>([])
  const [systemTotal, setSystemTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [weekRes, reconRes, empRes, entRes, adjRes, feeRes, propRes, ratesRes, mileageRes] = await Promise.all([
      supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
      supabase.from('payroll_adp_reconciliation').select('*').eq('payroll_week_id', weekId).maybeSingle(),
      supabase.from('payroll_employees').select('*').eq('is_active', true),
      // is_active — deactivated (removed/split-away) entries must not count toward
      // system gross; fetchAllRows — a week can exceed the 1,000-row select cap.
      fetchAllRows((from, to) => supabase.from('payroll_time_entries').select('*').eq('payroll_week_id', weekId).eq('is_flagged', false).eq('is_active', true).order('id').range(from, to)),
      supabase.from('payroll_adjustments').select('*').eq('payroll_week_id', weekId).eq('is_active', true),
      supabase.from('payroll_management_fee_config').select('*').order('effective_date', { ascending: false }),
      supabase.from('payroll_property').select(CURATED_PROPERTY_COLUMNS).eq('is_active', true),
      supabase.from('payroll_employee_rates').select('*'),
      supabase.from('payroll_mileage_reimbursements').select('*').eq('payroll_week_id', weekId),
    ])
    if (weekRes.error) { setError(weekRes.error.message); setLoading(false); return }
    setWeek(weekRes.data)

    const recon = reconRes.data ?? null
    setReconciliation(recon)

    if (recon) {
      const { data: reconRowData } = await supabase
        .from('payroll_adp_recon_rows')
        .select('*')
        .eq('reconciliation_id', recon.id)
        .order('employee_name')
      setExistingRows((reconRowData ?? []).map((r: { employee_name: string; system_gross: number; adp_gross: number }) => ({
        employee_name: r.employee_name,
        system_gross: Number(r.system_gross),
        adp_gross: Number(r.adp_gross),
        variance: Number(r.system_gross) - Number(r.adp_gross),
      })))
    } else {
      setExistingRows([])
    }

    const weekStart = weekRes.data.week_start as string
    const employeeRates = ratesRes.data ?? []

    // Pre-resolve effective-dated rates for each employee, exactly as the review hook does.
    const employees = (empRes.data ?? []).map(e => ({
      ...e,
      hourly_rate: resolveRateAsOf(e.id, weekStart, employeeRates, e.hourly_rate ?? 0),
    }))

    const properties = (propRes.data ?? []).map(r => curatedToProperty(r as unknown as CuratedPropertyRow))

    // Delegate gross computation to the single engine — no local loop.
    const result = calculatePayroll(
      employees,
      entRes.data ?? [],
      adjRes.data ?? [],
      feeRes.data ?? [],
      properties,
      mileageRes.data ?? [],
      {},        // no dept splits needed for gross
      weekStart,
    )

    const sysEmps: SystemEmployeeRow[] = result.employee_summaries
      .filter(s => s.gross_pay > 0)
      .map(s => ({ name: s.employee_name, gross: s.gross_pay }))
      .sort((a, b) => a.name.localeCompare(b.name))

    setSystemEmployees(sysEmps)
    setSystemTotal(Math.round(sysEmps.reduce((s, e) => s + e.gross, 0) * 100) / 100)
    setLoading(false)
  }, [weekId])

  useEffect(() => { load() }, [load])

  const saveUpload = useCallback(async (previewRows: ReconRow[], adpGrandTotal: number, notes: string) => {
    const supabase = createClient()
    const variance = Math.round((systemTotal - adpGrandTotal) * 100) / 100

    let reconId: string
    if (reconciliation) {
      const { error: updErr } = await supabase.from('payroll_adp_reconciliation').update({
        system_gross_total: systemTotal,
        adp_gross_total: Math.round(adpGrandTotal * 100) / 100,
        variance,
        resolved: Math.abs(variance) < 0.01,
        notes,
      }).eq('id', reconciliation.id)
      if (updErr) throw updErr
      reconId = reconciliation.id
      const { error: delErr } = await supabase.from('payroll_adp_recon_rows').delete().eq('reconciliation_id', reconId)
      if (delErr) throw delErr
    } else {
      const { data: ins, error: insErr } = await supabase.from('payroll_adp_reconciliation').insert({
        payroll_week_id: weekId,
        system_gross_total: systemTotal,
        adp_gross_total: Math.round(adpGrandTotal * 100) / 100,
        variance,
        resolved: Math.abs(variance) < 0.01,
        notes,
      }).select().single()
      if (insErr) throw insErr
      reconId = ins!.id
    }

    const { error: rowsErr } = await supabase.from('payroll_adp_recon_rows').insert(
      previewRows.map(r => ({
        reconciliation_id: reconId,
        employee_name: r.employee_name,
        system_gross: r.system_gross,
        adp_gross: r.adp_gross,
      }))
    )
    if (rowsErr) throw rowsErr
    await load()
  }, [weekId, systemTotal, reconciliation, load])

  const saveManual = useCallback(async (adpTotal: number, notes: string) => {
    const supabase = createClient()
    const variance = Math.round((systemTotal - adpTotal) * 100) / 100
    if (reconciliation) {
      const { error: updErr } = await supabase.from('payroll_adp_reconciliation').update({
        adp_gross_total: adpTotal, system_gross_total: systemTotal, variance, notes, resolved: Math.abs(variance) < 0.01,
      }).eq('id', reconciliation.id)
      if (updErr) throw updErr
    } else {
      const { error: insErr } = await supabase.from('payroll_adp_reconciliation').insert({
        payroll_week_id: weekId, system_gross_total: systemTotal, adp_gross_total: adpTotal, variance,
        resolved: Math.abs(variance) < 0.01, notes,
      })
      if (insErr) throw insErr
    }
    await load()
  }, [weekId, systemTotal, reconciliation, load])

  const markResolved = useCallback(async () => {
    if (!reconciliation) return
    const supabase = createClient()
    const { error: resolveErr } = await supabase.from('payroll_adp_reconciliation').update({ resolved: true }).eq('id', reconciliation.id)
    if (resolveErr) throw resolveErr
    setReconciliation(prev => prev ? { ...prev, resolved: true } : prev)
  }, [reconciliation])

  return {
    week, reconciliation, existingRows, systemEmployees, systemTotal,
    loading, error,
    saveUpload, saveManual, markResolved, refetch: load,
  }
}
