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
import { calculatePayroll, resolveRateAsOf, SPREAD_OTHER_DEPT, type EmployeePaySummary } from '@/lib/payroll/calculations'
import { compareLlcOrder } from '@/lib/payroll/llcOrder'
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
  /** Unit count and per-unit cost, carried through from the engine's PropertyCostSummary
   *  (already present at runtime via the `...pc` spread) so the statement HTML export can
   *  show the same per-property detail the review page does. */
  total_units: number
  cost_per_unit: number
  labor_cost: number
  spread_cost: number
  mileage_cost: number
  expense_cost: number
  /** Employer payroll tax + workers' comp billed to this property, folded into the
   *  amount/total (no separate customer line). From the engine's PropertyCostSummary. */
  tax_cost: number
  wc_cost: number
  mgmt_fee: number
  total_cost: number
  llc: string
  /** Department breakdown of spread_cost (from PropertyCostSummary) — feeds the
   *  Administrative-by-department table in the statement HTML export. */
  spread_by_dept: { department: string; amount: number }[]
  breakdown: { act: string; hours: number; labor: number }[]
}

export interface BuiltInvoice {
  llc: string
  props: InvoicePropLine[]
  amount: number
  mgmt: number
  total: number
  /** This LLC's unit-share of the Stanton Management pass-through (0 when none).
   *  Billed on top of `total` — the LLC's amount due is `total + mgmt_allocation`. */
  mgmt_allocation: number
}

/** One LLC's share of the Stanton Management pass-through allocation. */
export interface MgmtAllocationRow {
  llc: string
  units: number
  amount: number
}

export interface MgmtAllocation {
  /** The full Stanton Management amount re-billed to the ownership LLCs. */
  total: number
  totalUnits: number
  rows: MgmtAllocationRow[]
  /** Stanton Management's own invoice (the costs being allocated) — pulled out of
   *  the payer list; kept here so the statement can show what made up the amount. */
  source: BuiltInvoice
}

const normLlc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
/** The management company itself — matches "Stanton Management" / "Stanton Management LLC",
 *  never the owner LLCs ("SREP …", "STANTON REP …"). */
const isMgmtLlc = (s: string | null | undefined) => normLlc(s).startsWith('stanton management')

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

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

  // Salaried dept splits (override → default), resolved once in the shared review hook.
  const salariedDeptSplits = review.salariedDeptSplits

  const { invoices, employeeSummaries, mgmtAllocation } = useMemo(() => {
    if (review.loading) {
      return {
        invoices: [] as BuiltInvoice[],
        employeeSummaries: [] as EmployeePaySummary[],
        mgmtAllocation: null as MgmtAllocation | null,
      }
    }
    // Use the pay rates that were in effect during THIS week (same as the review
    // page, ADP export, and reconciliation) — not each employee's current rate — so
    // the statement's labor and totals match the review exactly. Also pass weekStart,
    // the prefund flag, and the config-driven rate settings so every knob matches.
    const weekStart = review.week?.week_start
    const employeesForCalc = weekStart
      ? review.employees.map(emp => ({
          ...emp,
          hourly_rate: resolveRateAsOf(emp.id, weekStart, review.employeeRates, emp.hourly_rate ?? 0),
        }))
      : review.employees
    const calc = calculatePayroll(
      employeesForCalc, review.entries, review.adjustments,
      review.feeConfigs, review.properties, review.mileageReimbursements,
      salariedDeptSplits, weekStart, review.prefundIncludesMgmtFee, review.rateSettings,
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
        if (pc.spread_cost > 0) {
          // Break the Administrative (spread) line into per-department sub-lines when
          // the salaried pay was actually split across departments. If everything
          // landed in 'Other' (no splits configured), keep the original single line.
          const depts = pc.spread_by_dept.filter(d => Math.abs(d.amount) > 0.005)
          const hasRealSplit = depts.some(d => d.department !== SPREAD_OTHER_DEPT)
          if (hasRealSplit) {
            for (const d of depts) {
              breakdown.push({
                act: d.department === SPREAD_OTHER_DEPT
                  ? 'Administrative — Other'
                  : `Administrative — ${d.department}`,
                hours: 0,
                labor: d.amount,
              })
            }
          } else {
            breakdown.push({ act: 'Administrative & Supervisory Allocation', hours: 0, labor: pc.spread_cost })
          }
        }
        if (pc.mileage_cost > 0) breakdown.push({ act: 'Mileage', hours: 0, labor: pc.mileage_cost })
        if (pc.expense_cost > 0) breakdown.push({ act: 'Reimbursed Expenses', hours: 0, labor: pc.expense_cost })
        const prop = review.properties.find(p => p.id === pc.property_id)
        const llc = prop?.billing_llc
          || (prop?.portfolio_id ? ownerByPortfolio[prop.portfolio_id] : null)
          || `Unassigned — ${pc.property_code}`
        return { ...pc, address: fullAddrById[pc.property_id] || prop?.address || null, llc, breakdown }
      })

    const byLlc: Record<string, InvoicePropLine[]> = {}
    for (const pl of propLines) (byLlc[pl.llc] ??= []).push(pl)

    let invoices: BuiltInvoice[] = Object.entries(byLlc).map(([llc, props]) => ({
      llc,
      props: props.sort((a, b) => b.total_cost - a.total_cost),
      // Burden (tax + WC) is folded into the billable amount — no separate customer line.
      amount: props.reduce((s, p) => s + p.labor_cost + p.spread_cost + p.mileage_cost + p.expense_cost + p.tax_cost + p.wc_cost, 0),
      mgmt: props.reduce((s, p) => s + p.mgmt_fee, 0),
      total: props.reduce((s, p) => s + p.total_cost, 0),
      mgmt_allocation: 0,
    })).sort((a, b) => compareLlcOrder(a.llc, b.llc))

    // Stanton Management pass-through: the management company's own costs (e.g. Office
    // Reno) are never collected FROM Stanton Management — they are billed TO the
    // ownership LLCs proportionally by unit count (no units → no share). Its invoice
    // leaves the payer list; each share folds into that LLC's amount due. Display-layer
    // only: the engine math and stored week data are untouched, and the statement grand
    // total is conserved (the shares sum exactly to the amount removed).
    let mgmtAllocation: MgmtAllocation | null = null
    const mgmtInvoice = invoices.find(inv => isMgmtLlc(inv.llc))
    if (mgmtInvoice && mgmtInvoice.total > 0) {
      const unitsByLlc: Record<string, number> = {}
      for (const p of review.properties) {
        if (review.excludedPropertyIds.has(p.id)) continue
        const llc = p.billing_llc || (p.portfolio_id ? ownerByPortfolio[p.portfolio_id] : null)
        if (!llc || isMgmtLlc(llc)) continue
        unitsByLlc[llc] = (unitsByLlc[llc] ?? 0) + (p.total_units ?? 0)
      }
      const withUnits = Object.entries(unitsByLlc).filter(([, u]) => u > 0)
      const totalUnits = withUnits.reduce((s, [, u]) => s + u, 0)
      if (totalUnits > 0) {
        const allocRows = withUnits
          .map(([llc, units]) => ({ llc, units, amount: round2(mgmtInvoice.total * (units / totalUnits)) }))
          .sort((a, b) => compareLlcOrder(a.llc, b.llc))
        // Absorb the rounding residue into the largest share so the rows sum exactly.
        const diff = round2(mgmtInvoice.total - allocRows.reduce((s, r) => s + r.amount, 0))
        if (diff !== 0) {
          const biggest = allocRows.reduce((m, r) => (r.units > m.units ? r : m), allocRows[0])
          biggest.amount = round2(biggest.amount + diff)
        }
        invoices = invoices.filter(inv => inv !== mgmtInvoice)
        for (const r of allocRows) {
          const inv = invoices.find(i => i.llc === r.llc)
          if (inv) inv.mgmt_allocation = round2(inv.mgmt_allocation + r.amount)
          // An LLC can hold units yet have no billed work this week — it still owes
          // its share, so it gets an allocation-only invoice.
          else invoices.push({ llc: r.llc, props: [], amount: 0, mgmt: 0, total: 0, mgmt_allocation: r.amount })
        }
        invoices.sort((a, b) => compareLlcOrder(a.llc, b.llc))
        mgmtAllocation = { total: mgmtInvoice.total, totalUnits, rows: allocRows, source: mgmtInvoice }
      }
    }

    return { invoices, employeeSummaries: calc.employee_summaries, mgmtAllocation }
  }, [review.loading, review.employees, review.entries, review.adjustments, review.feeConfigs,
      review.properties, review.mileageReimbursements, review.excludedPropertyIds, rows, ownerByPortfolio, fullAddrById,
      salariedDeptSplits, review.week, review.employeeRates, review.prefundIncludesMgmtFee, review.rateSettings])

  // Remote employees run on a separate payroll (pay_group = 'remote') and are
  // excluded from the on-site hourly summary on the statement.
  const remoteEmployeeIds = useMemo(
    () => new Set(review.employees.filter(e => e.pay_group === 'remote').map(e => e.id)),
    [review.employees],
  )

  return {
    week: review.week,
    loading: review.loading,
    error: review.error,
    wyLoading,
    wyError,
    invoices,
    employeeSummaries,
    mgmtAllocation,
    remoteEmployeeIds,
  }
}
