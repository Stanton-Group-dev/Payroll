'use client'

/**
 * Shared builder for the itemized invoice output (preview + statement).
 * Single source of truth for the billing math so the preview and the printable
 * statement can never diverge. Works on a DRAFT week — reuses the review-stage
 * data + payroll engine (no approval/generation needed), splits each property's
 * labor across cost codes by Workyard hours, labels in English, groups by LLC.
 */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePayrollWeekReview } from './usePayrollWeekReview'
import { calculatePayroll, type EmployeePaySummary } from '@/lib/payroll/calculations'
import type { WorkyardRow } from '@/lib/payroll/csv-parser'

/** Map a (Spanish / old / pickup) cost-code name to a clean English activity for the customer. */
export function activityOf(name: string): string {
  const n = (name ?? '').toLowerCase().trim()
  if (!n) return 'Unallocated'
  if (n.includes('material pickup')) return 'Material Pickup'
  if (n.includes('desborde') || n.includes('dumpster overflow')) return 'Dumpster Overflow'
  if (n.includes('voluminoso') || n.includes('bulky') || n.includes('bulkywaste')) return 'Bulky Waste'
  if (n.includes('mantenimiento') || n.includes('maintenance') || n.includes('work order')) return 'Maintenance'
  if (n.includes('obra') || n.includes('construction')) return 'Construction & Repairs'
  if (n.includes('vacante') || n.includes('turnover')) return 'Turnover'
  if (n.includes('jard') || n.includes('landscape') || n.includes('lawn')) return 'Landscaping'
  if (n.includes('plagas') || n.includes('pest')) return 'Pest Control'
  if (n.includes('nieve') || n.includes('snow')) return 'Snow & Ice'
  if (n.includes('aparato') || n.includes('appliance')) return 'Appliance Repair'
  if (n.includes('muestra') || n.includes('showing')) return 'Showings'
  if (n.includes('veh')) return 'Vehicles & Equipment'
  if (n.includes('oficina') || n.includes('office')) return 'Resident Coordination'
  return name
}

export interface InvoicePropLine {
  property_id: string
  property_code: string
  property_name: string
  address: string | null
  labor_cost: number
  spread_cost: number
  mileage_cost: number
  mgmt_fee: number
  total_cost: number
  llc: string
  breakdown: { act: string; hours: number; labor: number }[]
}

export interface BuiltInvoice {
  llc: string
  props: InvoicePropLine[]
  amount: number
  mgmt: number
  total: number
}

export function useInvoiceBuild(weekId: string) {
  const review = usePayrollWeekReview(weekId)

  const [rows, setRows] = useState<WorkyardRow[]>([])
  const [wyLoading, setWyLoading] = useState(true)
  const [wyError, setWyError] = useState<string | null>(null)
  const [ownerByPortfolio, setOwnerByPortfolio] = useState<Record<string, string | null>>({})
  const [fullAddrById, setFullAddrById] = useState<Record<string, string>>({})

  useEffect(() => {
    const supabase = createClient()
    supabase.from('portfolios').select('id, owner_llc').then(({ data }) => {
      setOwnerByPortfolio(Object.fromEntries((data ?? []).map(p => [p.id, p.owner_llc])))
    })
    supabase.from('properties').select('id, address, city, state, zip_code').then(({ data }) => {
      const m: Record<string, string> = {}
      for (const p of (data ?? []) as Array<{ id: string; address: string | null; city: string | null; state: string | null; zip_code: string | null }>) {
        const zip = p.zip_code ? String(p.zip_code).padStart(5, '0') : ''
        const cityLine = [p.city, p.state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '')
        m[p.id] = [p.address, cityLine].map(s => (s ?? '').trim()).filter(Boolean).join(', ')
      }
      setFullAddrById(m)
    })
  }, [])

  const weekStart = review.week?.week_start
  useEffect(() => {
    if (!weekStart) return
    setWyLoading(true)
    setWyError(null)
    fetch(`/api/workyard/timecards?weekStart=${weekStart}`)
      .then(r => r.json())
      .then(d => { if (d.error) setWyError(d.error); else setRows(d.rows ?? []) })
      .catch(e => setWyError(e instanceof Error ? e.message : String(e)))
      .finally(() => setWyLoading(false))
  }, [weekStart])

  const { invoices, employeeSummaries } = useMemo(() => {
    if (review.loading) return { invoices: [] as BuiltInvoice[], employeeSummaries: [] as EmployeePaySummary[] }
    const calc = calculatePayroll(
      review.employees, review.entries, review.adjustments,
      review.feeConfigs, review.properties, review.mileageReimbursements,
    )

    // Cost-code hours per property CODE (Workyard projectName carries the S-code).
    const hoursByCode: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const code = r.projectName
      if (!code) continue
      const act = activityOf(r.costCode)
      ;(hoursByCode[code] ??= {})[act] = (hoursByCode[code]?.[act] ?? 0) + (r.regularHours ?? 0) + (r.otHours ?? 0)
    }

    const propLines: InvoicePropLine[] = calc.property_costs
      .filter(pc => pc.total_cost > 0 && !review.excludedPropertyIds.has(pc.property_id))
      .map(pc => {
        const acts = hoursByCode[pc.property_code] ?? {}
        const totalH = Object.values(acts).reduce((s, h) => s + h, 0)
        const breakdown = totalH > 0
          ? Object.entries(acts).sort((a, b) => b[1] - a[1])
              .map(([act, hours]) => ({ act, hours, labor: pc.labor_cost * (hours / totalH) }))
          : pc.labor_cost > 0
            ? [{ act: 'General Labor', hours: 0, labor: pc.labor_cost }]
            : []
        if (pc.spread_cost > 0) breakdown.push({ act: 'Administrative & Supervisory Allocation', hours: 0, labor: pc.spread_cost })
        if (pc.mileage_cost > 0) breakdown.push({ act: 'Mileage', hours: 0, labor: pc.mileage_cost })
        const prop = review.properties.find(p => p.id === pc.property_id)
        const llc = prop?.billing_llc
          || (prop?.portfolio_id ? ownerByPortfolio[prop.portfolio_id] : null)
          || `Unassigned — ${pc.property_code}`
        return { ...pc, address: fullAddrById[pc.property_id] || prop?.address || null, llc, breakdown }
      })

    const byLlc: Record<string, InvoicePropLine[]> = {}
    for (const pl of propLines) (byLlc[pl.llc] ??= []).push(pl)

    const invoices: BuiltInvoice[] = Object.entries(byLlc).map(([llc, props]) => ({
      llc,
      props: props.sort((a, b) => b.total_cost - a.total_cost),
      amount: props.reduce((s, p) => s + p.labor_cost + p.spread_cost + p.mileage_cost, 0),
      mgmt: props.reduce((s, p) => s + p.mgmt_fee, 0),
      total: props.reduce((s, p) => s + p.total_cost, 0),
    })).sort((a, b) => b.total - a.total)

    return { invoices, employeeSummaries: calc.employee_summaries }
  }, [review.loading, review.employees, review.entries, review.adjustments, review.feeConfigs,
      review.properties, review.mileageReimbursements, review.excludedPropertyIds, rows, ownerByPortfolio, fullAddrById])

  return {
    week: review.week,
    loading: review.loading,
    error: review.error,
    wyLoading,
    wyError,
    invoices,
    employeeSummaries,
  }
}
