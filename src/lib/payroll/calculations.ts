import type {
  PayrollEmployee,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  PayrollEmployeeRate,
  Property,
} from '@/lib/supabase/types'
import { PAYROLL_TAX_RATE, WORKERS_COMP_RATE } from '@/lib/payroll/config'

/**
 * Given an employee's rate history and a week start date, return the rate
 * that was effective as of that date (most recent rate with effective_date ≤ weekStart).
 * Falls back to the live hourly_rate if no history applies.
 */
export function resolveRateAsOf(
  employeeId: string,
  weekStart: string,
  allRates: PayrollEmployeeRate[],
  fallbackRate: number
): number {
  const applicable = allRates
    .filter(r => r.employee_id === employeeId && r.effective_date <= weekStart)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
  return applicable.length > 0 ? Number(applicable[0].rate) : fallbackRate
}

export interface EmployeePaySummary {
  employee_id: string
  employee_name: string
  regular_hours: number
  ot_hours: number
  pto_hours: number
  regular_wages: number
  ot_wages: number
  phone_reimbursement: number
  other_adjustments: number
  advances: number
  gross_pay: number
  payroll_tax: number
  workers_comp: number
  management_fee: number
  total_billable: number
}

export interface PropertyCostSummary {
  property_id: string
  property_code: string
  property_name: string
  total_units: number
  labor_cost: number
  spread_cost: number
  mgmt_fee: number
  total_cost: number
  cost_per_unit: number
}

export interface PayrollCalculationResult {
  employee_summaries: EmployeePaySummary[]
  property_costs: PropertyCostSummary[]
  total_gross_pay: number
  total_payroll_tax: number
  total_workers_comp: number
  total_mgmt_fee: number
  required_prefund: number
}


export function getMgmtFeeRate(
  portfolioId: string | null,
  configs: PayrollManagementFeeConfig[]
): number {
  const effectiveConfigs = configs.filter(
    c => new Date(c.effective_date) <= new Date()
  )
  effectiveConfigs.sort((a, b) =>
    new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime()
  )
  // Portfolio-specific override wins
  const specific = effectiveConfigs.find(c => c.portfolio_id === portfolioId)
  if (specific) return specific.rate_pct
  // Fall back to global (portfolio_id = null)
  const global = effectiveConfigs.find(c => c.portfolio_id === null)
  return global?.rate_pct ?? 0.10
}

/**
 * Overtime pay multiplier by worker classification.
 *  - hourly (W2): time-and-a-half (1.5×) per FLSA.
 *  - contractor (1099): no OT premium — OT hours paid at straight rate.
 *  - salaried: exempt — no hourly OT (their pay comes from weekly_rate).
 */
export function otMultiplier(type: string): number {
  if (type === 'hourly') return 1.5
  if (type === 'contractor') return 1.0
  return 0 // salaried: exempt
}

export function calculatePayroll(
  employees: PayrollEmployee[],
  entries: PayrollTimeEntry[],
  adjustments: PayrollAdjustment[],
  mgmtFeeConfigs: PayrollManagementFeeConfig[],
  properties: Property[]
): PayrollCalculationResult {
  const employeeMap = Object.fromEntries(employees.map(e => [e.id, e]))
  const propertyMap = Object.fromEntries(properties.map(p => [p.id, p]))

  const totalPortfolioUnits = properties.reduce((sum, p) => sum + (p.total_units ?? 0), 0)

  // Per-employee aggregation
  const empData: Record<string, {
    regular_hours: number
    ot_hours: number
    pto_hours: number
    regular_wages: number
    ot_wages: number
    phone_reimbursement: number
    other_adjustments: number
    advances: number
  }> = {}

  for (const emp of employees) {
    empData[emp.id] = {
      regular_hours: 0, ot_hours: 0, pto_hours: 0,
      regular_wages: 0, ot_wages: 0,
      phone_reimbursement: 0, other_adjustments: 0, advances: 0,
    }
  }

  // Process time entries
  for (const entry of entries) {
    if (!empData[entry.employee_id]) continue
    const emp = employeeMap[entry.employee_id]
    if (!emp) continue
    const rate = emp.hourly_rate ?? 0
    empData[entry.employee_id].regular_hours += entry.regular_hours ?? 0
    empData[entry.employee_id].ot_hours += entry.ot_hours ?? 0
    empData[entry.employee_id].pto_hours += entry.pto_hours ?? 0
    empData[entry.employee_id].regular_wages += (entry.regular_hours ?? 0) * rate
    empData[entry.employee_id].ot_wages += (entry.ot_hours ?? 0) * rate * otMultiplier(emp.type)
  }

  // Salaried employees: use weekly_rate directly
  for (const emp of employees) {
    if (emp.type === 'salaried' && emp.weekly_rate) {
      if (!empData[emp.id]) empData[emp.id] = {
        regular_hours: 0, ot_hours: 0, pto_hours: 0,
        regular_wages: 0, ot_wages: 0,
        phone_reimbursement: 0, other_adjustments: 0, advances: 0,
      }
      empData[emp.id].regular_wages = emp.weekly_rate
    }
  }

  // Process adjustments
  for (const adj of adjustments) {
    if (!empData[adj.employee_id]) continue
    if (adj.type === 'phone') {
      empData[adj.employee_id].phone_reimbursement += adj.amount
    } else if (adj.type === 'advance' || adj.type === 'deduction_other') {
      empData[adj.employee_id].advances += Math.abs(adj.amount)
    } else {
      empData[adj.employee_id].other_adjustments += adj.amount
    }
  }

  // Build employee summaries
  const employee_summaries: EmployeePaySummary[] = []
  for (const emp of employees) {
    const d = empData[emp.id]
    if (!d) continue
    const gross_pay = d.regular_wages + d.ot_wages + d.phone_reimbursement + d.other_adjustments - d.advances
    const payroll_tax = emp.pay_tax ? gross_pay * PAYROLL_TAX_RATE : 0
    const workers_comp = emp.wc ? gross_pay * WORKERS_COMP_RATE : 0
    const feeRate = getMgmtFeeRate(null, mgmtFeeConfigs)
    const management_fee = gross_pay * feeRate
    employee_summaries.push({
      employee_id: emp.id,
      employee_name: emp.name,
      regular_hours: d.regular_hours,
      ot_hours: d.ot_hours,
      pto_hours: d.pto_hours,
      regular_wages: round2(d.regular_wages),
      ot_wages: round2(d.ot_wages),
      phone_reimbursement: round2(d.phone_reimbursement),
      other_adjustments: round2(d.other_adjustments),
      advances: round2(d.advances),
      gross_pay: round2(gross_pay),
      payroll_tax: round2(payroll_tax),
      workers_comp: round2(workers_comp),
      management_fee: round2(management_fee),
      total_billable: round2(gross_pay + payroll_tax + workers_comp + management_fee),
    })
  }

  // Method A: Direct labor by property
  const propLaborCost: Record<string, number> = {}
  for (const entry of entries) {
    if (!entry.property_id) continue
    const emp = employeeMap[entry.employee_id]
    if (!emp) continue
    const rate = emp.hourly_rate ?? 0
    // OT premium flows into the property's labor cost too (it bears the actual wage).
    const cost = (entry.regular_hours ?? 0) * rate + (entry.ot_hours ?? 0) * rate * otMultiplier(emp.type)
    propLaborCost[entry.property_id] = (propLaborCost[entry.property_id] ?? 0) + cost
  }

  // Method B: Unit-weighted spread (phone + tool adjustments)
  const spreadTotal = adjustments
    .filter(a => a.type === 'phone' || a.type === 'tool')
    .reduce((sum, a) => sum + a.amount, 0)

  const propSpreadCost: Record<string, number> = {}
  for (const prop of properties) {
    if (!totalPortfolioUnits) continue
    propSpreadCost[prop.id] = (prop.total_units ?? 0) / totalPortfolioUnits * spreadTotal
  }

  // Build property cost summaries
  const property_costs: PropertyCostSummary[] = []
  for (const prop of properties) {
    const labor = propLaborCost[prop.id] ?? 0
    const spread = propSpreadCost[prop.id] ?? 0
    const feeRate = getMgmtFeeRate(prop.portfolio_id, mgmtFeeConfigs)
    const mgmt_fee = (labor + spread) * feeRate
    const total_cost = labor + spread + mgmt_fee
    property_costs.push({
      property_id: prop.id,
      property_code: prop.code,
      property_name: prop.name,
      total_units: prop.total_units ?? 0,
      labor_cost: round2(labor),
      spread_cost: round2(spread),
      mgmt_fee: round2(mgmt_fee),
      total_cost: round2(total_cost),
      cost_per_unit: prop.total_units ? round2(total_cost / prop.total_units) : 0,
    })
  }

  const total_gross_pay = employee_summaries.reduce((s, e) => s + e.gross_pay, 0)
  const total_payroll_tax = employee_summaries.reduce((s, e) => s + e.payroll_tax, 0)
  const total_workers_comp = employee_summaries.reduce((s, e) => s + e.workers_comp, 0)
  const total_mgmt_fee = employee_summaries.reduce((s, e) => s + e.management_fee, 0)
  const required_prefund = round2(total_gross_pay + total_payroll_tax + total_workers_comp)

  return {
    employee_summaries,
    property_costs,
    total_gross_pay: round2(total_gross_pay),
    total_payroll_tax: round2(total_payroll_tax),
    total_workers_comp: round2(total_workers_comp),
    total_mgmt_fee: round2(total_mgmt_fee),
    required_prefund,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

/* ------------------------------------------------------------------ */
/* Week-over-week comparison                                           */
/* ------------------------------------------------------------------ */

export interface Delta {
  current: number
  prior: number
  delta: number
  /** Percent change vs prior; null when prior is 0 (undefined growth). */
  pct: number | null
}

export interface ComparisonRow {
  key: string
  label: string
  current: number
  prior: number
  delta: number
  pct: number | null
  /** 'new' = on current payroll but not prior; 'dropped' = prior but not current. */
  status: 'new' | 'dropped' | 'changed' | 'same'
}

export interface PayrollComparison {
  currentLabel: string
  priorLabel: string
  totals: {
    gross_pay: Delta
    payroll_tax: Delta
    workers_comp: Delta
    mgmt_fee: Delta
    required_prefund: Delta
    total_hours: Delta
  }
  byEmployee: ComparisonRow[]
  byProperty: ComparisonRow[]
  /** Plain-language highlights, suitable for an agent to read back. */
  notable: string[]
}

function delta(current: number, prior: number): Delta {
  const d = round2(current - prior)
  return {
    current: round2(current),
    prior: round2(prior),
    delta: d,
    pct: prior !== 0 ? round2((d / Math.abs(prior)) * 100) : null,
  }
}

function rowStatus(current: number, prior: number): ComparisonRow['status'] {
  if (prior === 0 && current !== 0) return 'new'
  if (current === 0 && prior !== 0) return 'dropped'
  if (round2(current) !== round2(prior)) return 'changed'
  return 'same'
}

function totalHours(r: PayrollCalculationResult): number {
  return r.employee_summaries.reduce(
    (s, e) => s + e.regular_hours + e.ot_hours + e.pto_hours,
    0
  )
}

/**
 * Diff a freshly-run payroll result against the prior week's. Pure: callers run
 * calculatePayroll() for each week and pass the two results. Produces total,
 * per-employee, and per-property deltas plus human-readable highlights.
 */
export function comparePayroll(
  current: PayrollCalculationResult,
  prior: PayrollCalculationResult,
  labels: { current: string; prior: string }
): PayrollComparison {
  // Per-employee gross, keyed by id across both weeks.
  const empCur = new Map(current.employee_summaries.map((e) => [e.employee_id, e]))
  const empPri = new Map(prior.employee_summaries.map((e) => [e.employee_id, e]))
  const empKeys = new Set([...empCur.keys(), ...empPri.keys()])
  const byEmployee: ComparisonRow[] = [...empKeys]
    .map((id) => {
      const c = empCur.get(id)
      const p = empPri.get(id)
      const cur = c?.gross_pay ?? 0
      const pri = p?.gross_pay ?? 0
      return {
        key: id,
        label: c?.employee_name ?? p?.employee_name ?? id,
        current: round2(cur),
        prior: round2(pri),
        delta: round2(cur - pri),
        pct: pri !== 0 ? round2(((cur - pri) / Math.abs(pri)) * 100) : null,
        status: rowStatus(cur, pri),
      }
    })
    .filter((r) => r.current !== 0 || r.prior !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  // Per-property total cost, keyed by id across both weeks.
  const propCur = new Map(current.property_costs.map((p) => [p.property_id, p]))
  const propPri = new Map(prior.property_costs.map((p) => [p.property_id, p]))
  const propKeys = new Set([...propCur.keys(), ...propPri.keys()])
  const byProperty: ComparisonRow[] = [...propKeys]
    .map((id) => {
      const c = propCur.get(id)
      const p = propPri.get(id)
      const cur = c?.total_cost ?? 0
      const pri = p?.total_cost ?? 0
      return {
        key: id,
        label: c ? `${c.property_code} ${c.property_name}` : p ? `${p.property_code} ${p.property_name}` : id,
        current: round2(cur),
        prior: round2(pri),
        delta: round2(cur - pri),
        pct: pri !== 0 ? round2(((cur - pri) / Math.abs(pri)) * 100) : null,
        status: rowStatus(cur, pri),
      }
    })
    .filter((r) => r.current !== 0 || r.prior !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const totals = {
    gross_pay: delta(current.total_gross_pay, prior.total_gross_pay),
    payroll_tax: delta(current.total_payroll_tax, prior.total_payroll_tax),
    workers_comp: delta(current.total_workers_comp, prior.total_workers_comp),
    mgmt_fee: delta(current.total_mgmt_fee, prior.total_mgmt_fee),
    required_prefund: delta(current.required_prefund, prior.required_prefund),
    total_hours: delta(totalHours(current), totalHours(prior)),
  }

  const notable: string[] = []
  const g = totals.gross_pay
  const dir = g.delta > 0 ? 'up' : g.delta < 0 ? 'down' : 'flat'
  if (dir === 'flat') {
    notable.push(`Gross pay unchanged at ${formatCurrency(g.current)}.`)
  } else {
    notable.push(
      `Gross pay ${dir} ${formatCurrency(Math.abs(g.delta))}${g.pct !== null ? ` (${g.pct > 0 ? '+' : ''}${g.pct}%)` : ''} — ${formatCurrency(g.prior)} → ${formatCurrency(g.current)}.`
    )
  }
  const added = byEmployee.filter((r) => r.status === 'new')
  const dropped = byEmployee.filter((r) => r.status === 'dropped')
  if (added.length) notable.push(`New on payroll: ${added.map((r) => r.label).join(', ')}.`)
  if (dropped.length) notable.push(`Not paid this week (were last week): ${dropped.map((r) => r.label).join(', ')}.`)
  const biggest = byEmployee.find((r) => r.status === 'changed')
  if (biggest) {
    notable.push(
      `Largest swing: ${biggest.label} ${biggest.delta > 0 ? '+' : ''}${formatCurrency(biggest.delta)}.`
    )
  }

  return {
    currentLabel: labels.current,
    priorLabel: labels.prior,
    totals,
    byEmployee,
    byProperty,
    notable,
  }
}
