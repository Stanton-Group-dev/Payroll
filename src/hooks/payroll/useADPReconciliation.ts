'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { otMultiplier } from '@/lib/payroll/calculations'
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
    const [weekRes, reconRes, empRes, entRes, adjRes] = await Promise.all([
      supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
      supabase.from('payroll_adp_reconciliation').select('*').eq('payroll_week_id', weekId).maybeSingle(),
      supabase.from('payroll_employees').select('id, name, hourly_rate, weekly_rate, type').eq('is_active', true),
      supabase.from('payroll_time_entries').select('*').eq('payroll_week_id', weekId).eq('is_flagged', false),
      supabase.from('payroll_adjustments').select('*').eq('payroll_week_id', weekId).eq('is_active', true),
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

    const empMap: Record<string, { name: string; hourly_rate: number; weekly_rate: number | null; type: string }> = {}
    for (const e of (empRes.data ?? [])) {
      empMap[e.id] = { name: e.name, hourly_rate: e.hourly_rate ?? 0, weekly_rate: e.weekly_rate ?? null, type: e.type ?? 'hourly' }
    }

    const empGross: Record<string, number> = {}
    for (const entry of (entRes.data ?? [])) {
      const emp = empMap[entry.employee_id]
      if (!emp) continue
      if (!empGross[entry.employee_id]) empGross[entry.employee_id] = 0
      if (emp.type === 'salaried' && emp.weekly_rate) {
        empGross[entry.employee_id] = emp.weekly_rate
      } else {
        empGross[entry.employee_id] += (entry.regular_hours ?? 0) * emp.hourly_rate + (entry.ot_hours ?? 0) * emp.hourly_rate * otMultiplier(emp.type)
      }
    }
    for (const adj of (adjRes.data ?? [])) {
      if (!empGross[adj.employee_id]) empGross[adj.employee_id] = 0
      empGross[adj.employee_id] += Number(adj.amount)
    }

    const sysEmps: SystemEmployeeRow[] = Object.entries(empGross)
      .filter(([, g]) => g > 0)
      .map(([id, g]) => ({ name: empMap[id]?.name ?? id, gross: Math.round(g * 100) / 100 }))
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
      await supabase.from('payroll_adp_reconciliation').update({
        system_gross_total: systemTotal,
        adp_gross_total: Math.round(adpGrandTotal * 100) / 100,
        variance,
        resolved: Math.abs(variance) < 0.01,
        notes,
      }).eq('id', reconciliation.id)
      reconId = reconciliation.id
      await supabase.from('payroll_adp_recon_rows').delete().eq('reconciliation_id', reconId)
    } else {
      const { data: ins } = await supabase.from('payroll_adp_reconciliation').insert({
        payroll_week_id: weekId,
        system_gross_total: systemTotal,
        adp_gross_total: Math.round(adpGrandTotal * 100) / 100,
        variance,
        resolved: Math.abs(variance) < 0.01,
        notes,
      }).select().single()
      reconId = ins!.id
    }

    await supabase.from('payroll_adp_recon_rows').insert(
      previewRows.map(r => ({
        reconciliation_id: reconId,
        employee_name: r.employee_name,
        system_gross: r.system_gross,
        adp_gross: r.adp_gross,
      }))
    )
    await load()
  }, [weekId, systemTotal, reconciliation, load])

  const saveManual = useCallback(async (adpTotal: number, notes: string) => {
    const supabase = createClient()
    const variance = Math.round((systemTotal - adpTotal) * 100) / 100
    if (reconciliation) {
      await supabase.from('payroll_adp_reconciliation').update({
        adp_gross_total: adpTotal, system_gross_total: systemTotal, variance, notes, resolved: Math.abs(variance) < 0.01,
      }).eq('id', reconciliation.id)
    } else {
      await supabase.from('payroll_adp_reconciliation').insert({
        payroll_week_id: weekId, system_gross_total: systemTotal, adp_gross_total: adpTotal, variance,
        resolved: Math.abs(variance) < 0.01, notes,
      })
    }
    await load()
  }, [weekId, systemTotal, reconciliation, load])

  const markResolved = useCallback(async () => {
    if (!reconciliation) return
    const supabase = createClient()
    await supabase.from('payroll_adp_reconciliation').update({ resolved: true }).eq('id', reconciliation.id)
    setReconciliation(prev => prev ? { ...prev, resolved: true } : prev)
  }, [reconciliation])

  return {
    week, reconciliation, existingRows, systemEmployees, systemTotal,
    loading, error,
    saveUpload, saveManual, markResolved, refetch: load,
  }
}
