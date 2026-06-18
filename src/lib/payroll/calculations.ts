import type {
  PayrollEmployee,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  PayrollEmployeeRate,
  PayrollMileageRate,
  PayrollMileageReimbursement,
  Property,
} from '@/lib/supabase/types'
import { PAYROLL_TAX_RATE, WORKERS_COMP_RATE, DEFAULT_MILEAGE_RATE } from '@/lib/payroll/config'

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

/**
 * Resolve the mileage reimbursement rate (USD per mile) effective as of a date —
 * most recent payroll_mileage_rates row with effective_date ≤ asOf. Falls back to
 * DEFAULT_MILEAGE_RATE when no row applies.
 */
export function resolveMileageRateAsOf(
  rates: PayrollMileageRate[],
  asOf: string
): number {
  const applicable = rates
    .filter(r => r.effective_date <= asOf)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date))
  return applicable.length > 0 ? Number(applicable[0].rate_per_mile) : DEFAULT_MILEAGE_RATE
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
  mileage_reimbursement: number
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
  portfolio_id: string | null
  total_units: number
  labor_cost: number
  spread_cost: number
  mileage_cost: number
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
 *  - salaried: exempt — no hourly OT (their pay comes from weekly_rate).
 *  - contractor (1099): no OT premium — OT hours paid at straight rate.
 *  - construction (any hourly worker in the Construction dept): not eligible for
 *    the OT premium — OT hours paid at straight rate (1.0×).
 *  - hourly (W2), all other departments: time-and-a-half (1.5×) per FLSA.
 */
export function otMultiplier(type: string, department?: string | null, otAllowed: boolean = true): number {
  if (type === 'salaried') return 0     // exempt — no hourly OT
  if (type === 'contractor') return 1.0 // 1099 — no OT premium
  if (department && department.toLowerCase().includes('construction')) return 1.0 // construction: not OT-eligible
  if (!otAllowed) return 1.0            // roster flag: OT not authorized → straight time, no premium
  return 1.5                            // W2 hourly — FLSA time-and-a-half
}

export function calculatePayroll(
  employees: PayrollEmployee[],
  entries: PayrollTimeEntry[],
  adjustments: PayrollAdjustment[],
  mgmtFeeConfigs: PayrollManagementFeeConfig[],
  properties: Property[],
  mileageReimbursements: PayrollMileageReimbursement[] = []
): PayrollCalculationResult {
  const employeeMap = Object.fromEntries(employees.map(e => [e.id, e]))
  const propertyMap = Object.fromEntries(properties.map(p => [p.id, p]))

  // Approved mileage reimbursement dollars per employee (pending/denied are ignored).
  const approvedMileage: Record<string, number> = {}
  for (const m of mileageReimbursements) {
    if (m.status !== 'approved') continue
    approvedMileage[m.employee_id] = (approvedMileage[m.employee_id] ?? 0) + Number(m.amount)
  }

  // Per-employee aggregation
  const empData: Record<string, {
    regular_hours: number
    ot_hours: number
    pto_hours: number
    regular_wages: number
    ot_wages: number
    phone_reimbursement: number
    mileage_reimbursement: number
    other_adjustments: number
    /** Reimbursement dollars sitting inside other_adjustments (tool, expense_reimbursement) —
     *  tracked so they can be removed from the payroll-tax / workers'-comp base. */
    nontax_reimbursement: number
    advances: number
  }> = {}

  for (const emp of employees) {
    empData[emp.id] = {
      regular_hours: 0, ot_hours: 0, pto_hours: 0,
      regular_wages: 0, ot_wages: 0,
      phone_reimbursement: 0, mileage_reimbursement: 0, other_adjustments: 0, nontax_reimbursement: 0, advances: 0,
    }
  }

  // Process time entries
  for (const entry of entries) {
    if (!empData[entry.employee_id]) continue
    const emp = employeeMap[entry.employee_id]
    if (!emp) continue
    const rate = emp.hourly_rate ?? 0
    const reg = entry.regular_hours ?? 0
    const ot = entry.ot_hours ?? 0
    const d = empData[entry.employee_id]
    d.pto_hours += entry.pto_hours ?? 0
    // Only true OT-eligible employees (W2 hourly, OT-authorized, non-construction)
    // keep a separate OT column and the 1.5× premium. For everyone else — contractors,
    // construction, salaried, and anyone without OT rights (ot_allowed=false) — the
    // "OT" hours are paid at straight time and folded into regular hours, so the OT
    // column reads zero for people who don't get overtime.
    if (otMultiplier(emp.type, emp.department, emp.ot_allowed) === 1.5) {
      d.regular_hours += reg
      d.ot_hours += ot
      d.regular_wages += reg * rate
      d.ot_wages += ot * rate * 1.5
    } else {
      d.regular_hours += reg + ot
      d.regular_wages += (reg + ot) * rate
    }
  }

  // Salaried employees: use weekly_rate directly
  for (const emp of employees) {
    if (emp.type === 'salaried' && emp.weekly_rate) {
      if (!empData[emp.id]) empData[emp.id] = {
        regular_hours: 0, ot_hours: 0, pto_hours: 0,
        regular_wages: 0, ot_wages: 0,
        phone_reimbursement: 0, mileage_reimbursement: 0, other_adjustments: 0, nontax_reimbursement: 0, advances: 0,
      }
      empData[emp.id].regular_wages = emp.weekly_rate
    }
  }

  // Enforce weekly overtime at the 40-hour threshold for OT-eligible employees.
  // The imported reg/OT split (from Workyard, or hand-keyed manual entries) is NOT
  // trustworthy — manual rows can carry OT while worked hours are under 40, or push
  // regular over 40. So for anyone who actually earns the 1.5× premium, recompute from
  // their weekly worked total: the first 40 worked hours are regular, the rest are OT.
  // (PTO is separate and never counts toward the 40.) Non-OT-eligible workers —
  // contractors, construction, salaried, ot_allowed=false — already had their hours
  // folded into regular at straight time above and are left untouched.
  for (const emp of employees) {
    const d = empData[emp.id]
    if (!d) continue
    if (otMultiplier(emp.type, emp.department, emp.ot_allowed) !== 1.5) continue
    const worked = d.regular_hours + d.ot_hours
    const ot = Math.max(0, worked - 40)
    const reg = worked - ot
    const rate = emp.hourly_rate ?? 0
    d.regular_hours = reg
    d.ot_hours = ot
    d.regular_wages = reg * rate
    d.ot_wages = ot * rate * 1.5
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
      // tool and expense reimbursements are reimbursements, not wages — track them so
      // they're removed from the tax/WC base below. (bonus stays taxable.)
      if (adj.type === 'tool' || adj.type === 'expense_reimbursement') {
        empData[adj.employee_id].nontax_reimbursement += adj.amount
      }
    }
  }

  // Apply approved mileage reimbursement to each employee.
  for (const [empId, amt] of Object.entries(approvedMileage)) {
    if (empData[empId]) empData[empId].mileage_reimbursement += amt
  }

  // Build employee summaries
  const employee_summaries: EmployeePaySummary[] = []
  for (const emp of employees) {
    const d = empData[emp.id]
    if (!d) continue
    const gross_pay = d.regular_wages + d.ot_wages + d.phone_reimbursement + d.mileage_reimbursement + d.other_adjustments - d.advances
    // Reimbursements are not wages — no employer payroll tax or workers' comp is charged
    // on them (phone, mileage, tool, expense_reimbursement). They're still paid to the
    // employee (in gross, and thus in the pre-fund total); they're just removed from the
    // tax/WC base. Bonuses remain taxable wages.
    const taxable_base = gross_pay - d.phone_reimbursement - d.mileage_reimbursement - d.nontax_reimbursement
    const payroll_tax = emp.pay_tax ? taxable_base * PAYROLL_TAX_RATE : 0
    const workers_comp = emp.wc ? taxable_base * WORKERS_COMP_RATE : 0
    const feeRate = getMgmtFeeRate(null, mgmtFeeConfigs)
    // Mileage is a direct pass-through cost billed to the property at cost — the
    // management fee (general overhead) does NOT apply to it, so it's excluded from
    // the fee base. (Phone/tools remain in the base; they're general spread, not direct.)
    const management_fee = (gross_pay - d.mileage_reimbursement) * feeRate
    employee_summaries.push({
      employee_id: emp.id,
      employee_name: emp.name,
      regular_hours: round2(d.regular_hours),
      ot_hours: round2(d.ot_hours),
      pto_hours: round2(d.pto_hours),
      regular_wages: round2(d.regular_wages),
      ot_wages: round2(d.ot_wages),
      phone_reimbursement: round2(d.phone_reimbursement),
      mileage_reimbursement: round2(d.mileage_reimbursement),
      other_adjustments: round2(d.other_adjustments),
      advances: round2(d.advances),
      gross_pay: round2(gross_pay),
      payroll_tax: round2(payroll_tax),
      workers_comp: round2(workers_comp),
      management_fee: round2(management_fee),
      total_billable: round2(gross_pay + payroll_tax + workers_comp + management_fee),
    })
  }

  // Method A: Direct labor by property. Also capture each employee's per-property
  // labor hours — the fallback weight for mileage when miles weren't logged per row.
  const propLaborCost: Record<string, number> = {}
  const empHoursByProp: Record<string, Record<string, number>> = {}
  for (const entry of entries) {
    if (!entry.property_id) continue
    const emp = employeeMap[entry.employee_id]
    if (!emp) continue
    const rate = emp.hourly_rate ?? 0
    // OT premium flows into the property's labor cost too (it bears the actual wage).
    const cost = (entry.regular_hours ?? 0) * rate + (entry.ot_hours ?? 0) * rate * otMultiplier(emp.type, emp.department, emp.ot_allowed)
    propLaborCost[entry.property_id] = (propLaborCost[entry.property_id] ?? 0) + cost
    const hours = (entry.regular_hours ?? 0) + (entry.ot_hours ?? 0)
    if (hours > 0) {
      ;(empHoursByProp[entry.employee_id] ??= {})[entry.property_id] =
        (empHoursByProp[entry.employee_id][entry.property_id] ?? 0) + hours
    }
  }

  // Method B: Unit-weighted spread across the whole portfolio.
  //  - phone + tool reimbursements (general, not tied to one property)
  //  - salaried employees' wages: a salaried worker's pay isn't earned at any single
  //    property, so it's billed across ALL properties proportional to unit count
  //    (a 167-unit portfolio bears more than a 6-unit building). Hourly labor still
  //    bills direct via Method A; salaried have no hourly_rate so they'd otherwise
  //    be paid-but-unbilled.
  const adjustmentSpread = adjustments
    .filter(a => a.type === 'phone' || a.type === 'tool')
    .reduce((sum, a) => sum + a.amount, 0)
  const salariedSpread = employees
    .filter(e => e.type === 'salaried' && e.weekly_rate)
    .reduce((sum, e) => sum + Number(e.weekly_rate), 0)
  // Overhead-spread labor (e.g. "Office"): real hourly wages with no single billable
  // property. They're already PAID in the per-employee loop above; here their cost is
  // billed like salaried — spread across billable properties by unit count. Use the same
  // wage basis as direct labor (OT premium per the employee's classification).
  const overheadSpread = entries
    .filter(e => e.is_overhead_spread)
    .reduce((sum, e) => {
      const emp = employeeMap[e.employee_id]
      if (!emp) return sum
      const rate = emp.hourly_rate ?? 0
      return sum + (e.regular_hours ?? 0) * rate + (e.ot_hours ?? 0) * rate * otMultiplier(emp.type, emp.department, emp.ot_allowed)
    }, 0)
  const spreadTotal = adjustmentSpread + salariedSpread + overheadSpread

  // Spread only across BILLABLE properties — never onto non-billable / admin / test /
  // stale rows (include_in_invoicing = false), so the full salaried cost lands on real
  // LLCs and nothing leaks onto "Stanton Management" placeholders.
  const billableUnits = properties
    .filter(p => p.include_in_invoicing !== false)
    .reduce((sum, p) => sum + (p.total_units ?? 0), 0)
  const propSpreadCost: Record<string, number> = {}
  for (const prop of properties) {
    if (!billableUnits || prop.include_in_invoicing === false) continue
    propSpreadCost[prop.id] = (prop.total_units ?? 0) / billableUnits * spreadTotal
  }

  // Method C: Direct mileage by property. Each employee's approved reimbursement is
  // allocated across the properties they touched that week, weighted two ways in
  // priority order:
  //   1. Per-property MILES logged on their time entries — the precise signal. When
  //      present, miles on entries without a property (or with no logged miles)
  //      leave that portion paid-but-unbilled, by design.
  //   2. Fallback — per-property LABOR HOURS. Workyard often exports mileage as one
  //      weekly lump (entry.miles = 0 on every row), so the precise signal is absent.
  //      Rather than leave the whole reimbursement paid-but-unbilled, spread it across
  //      the properties the employee actually billed labor to that week, proportional
  //      to hours worked — "where they drove" approximated by "where they worked".
  const empMilesByProp: Record<string, Record<string, number>> = {}
  const empTotalMiles: Record<string, number> = {}
  for (const entry of entries) {
    const miles = entry.miles ?? 0
    if (miles <= 0) continue
    empTotalMiles[entry.employee_id] = (empTotalMiles[entry.employee_id] ?? 0) + miles
    if (entry.property_id) {
      ;(empMilesByProp[entry.employee_id] ??= {})[entry.property_id] =
        (empMilesByProp[entry.employee_id][entry.property_id] ?? 0) + miles
    }
  }

  const propMileageCost: Record<string, number> = {}
  for (const [empId, amt] of Object.entries(approvedMileage)) {
    // Prefer per-property miles; fall back to per-property labor hours.
    const milesByProp = empMilesByProp[empId]
    const hasMiles = milesByProp && Object.keys(milesByProp).length > 0 && (empTotalMiles[empId] ?? 0) > 0
    const weights = hasMiles ? milesByProp : empHoursByProp[empId]
    if (!weights) continue // paid but unbilled — no property miles or labor to allocate against
    const totalWeight = hasMiles
      ? (empTotalMiles[empId] ?? 0)                                  // includes no-property miles (their share leaks, by design)
      : Object.values(weights).reduce((s, w) => s + w, 0)           // labor hours sum across this employee's properties
    if (totalWeight <= 0) continue
    for (const [propId, w] of Object.entries(weights)) {
      propMileageCost[propId] = (propMileageCost[propId] ?? 0) + amt * (w / totalWeight)
    }
  }

  // Build property cost summaries
  const property_costs: PropertyCostSummary[] = []
  for (const prop of properties) {
    const labor = propLaborCost[prop.id] ?? 0
    const spread = propSpreadCost[prop.id] ?? 0
    const mileage = propMileageCost[prop.id] ?? 0
    const feeRate = getMgmtFeeRate(prop.portfolio_id, mgmtFeeConfigs)
    // Mileage is pass-through: billed to the property at cost, NOT in the fee base.
    const mgmt_fee = (labor + spread) * feeRate
    const total_cost = labor + spread + mileage + mgmt_fee
    property_costs.push({
      property_id: prop.id,
      property_code: prop.code,
      property_name: prop.name,
      portfolio_id: prop.portfolio_id,
      total_units: prop.total_units ?? 0,
      labor_cost: round2(labor),
      spread_cost: round2(spread),
      mileage_cost: round2(mileage),
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

/**
 * A cost row that also carries a per-unit cost, for week-over-week comparison at
 * the portfolio (and, when nested, building) level. `units` is the stable
 * denominator — the portfolio's full active-unit count — used for both weeks'
 * per-unit figures, so the per-unit delta reflects cost change, not unit drift.
 */
export interface CostCompareRow {
  key: string
  label: string
  /** Total cost this week / prior week. */
  current: number
  prior: number
  delta: number
  pct: number | null
  status: ComparisonRow['status']
  units: number
  perUnitCurrent: number
  perUnitPrior: number
  perUnitDelta: number
  perUnitPct: number | null
  /** Building-level rows under a portfolio (only properties with cost in either week). */
  children?: CostCompareRow[]
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
  /** Per-portfolio total-cost & cost-per-unit deltas, each expandable to its buildings.
   *  Empty unless the portfolio roster is supplied to comparePayroll(). */
  byPortfolio: CostCompareRow[]
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
/** Build one portfolio/building cost row, deriving the per-unit figures from `units`. */
function costCompareRow(
  key: string,
  label: string,
  cur: number,
  pri: number,
  units: number,
  children?: CostCompareRow[]
): CostCompareRow {
  const puCur = units > 0 ? cur / units : 0
  const puPri = units > 0 ? pri / units : 0
  return {
    key,
    label,
    current: round2(cur),
    prior: round2(pri),
    delta: round2(cur - pri),
    pct: pri !== 0 ? round2(((cur - pri) / Math.abs(pri)) * 100) : null,
    status: rowStatus(cur, pri),
    units,
    perUnitCurrent: round2(puCur),
    perUnitPrior: round2(puPri),
    perUnitDelta: round2(puCur - puPri),
    perUnitPct: puPri !== 0 ? round2(((puCur - puPri) / Math.abs(puPri)) * 100) : null,
    children,
  }
}

const UNASSIGNED_PORTFOLIO = '__unassigned__'

/**
 * Roll the per-property costs up to the portfolio level for both weeks. The
 * denominator for cost-per-unit is the portfolio's full active-unit count (every
 * active property is present in property_costs, even at zero cost), so it's stable
 * week to week. Buildings with no cost in either week are dropped from the expand
 * list but still count toward the portfolio's unit total.
 */
function buildPortfolioComparison(
  current: PayrollCalculationResult,
  prior: PayrollCalculationResult,
  portfolios: { id: string; name: string }[]
): CostCompareRow[] {
  const nameOf = new Map(portfolios.map((p) => [p.id, p.name]))
  const propCur = new Map(current.property_costs.map((p) => [p.property_id, p]))
  const propPri = new Map(prior.property_costs.map((p) => [p.property_id, p]))
  const allPropIds = new Set([...propCur.keys(), ...propPri.keys()])

  // Group property ids by portfolio, accumulating the portfolio's full unit count.
  const groups = new Map<string, { units: number; propIds: string[] }>()
  for (const id of allPropIds) {
    const meta = propCur.get(id) ?? propPri.get(id)!
    const pid = meta.portfolio_id ?? UNASSIGNED_PORTFOLIO
    const units = propCur.get(id)?.total_units ?? propPri.get(id)?.total_units ?? 0
    const g = groups.get(pid) ?? { units: 0, propIds: [] }
    g.units += units
    g.propIds.push(id)
    groups.set(pid, g)
  }

  const rows: CostCompareRow[] = []
  for (const [pid, g] of groups) {
    let curTotal = 0
    let priTotal = 0
    const children: CostCompareRow[] = []
    for (const id of g.propIds) {
      const c = propCur.get(id)
      const p = propPri.get(id)
      const cur = c?.total_cost ?? 0
      const pri = p?.total_cost ?? 0
      curTotal += cur
      priTotal += pri
      if (cur === 0 && pri === 0) continue // active but idle both weeks — counts for units, not shown
      const meta = c ?? p!
      const units = c?.total_units ?? p?.total_units ?? 0
      children.push(costCompareRow(id, `${meta.property_code} ${meta.property_name}`, cur, pri, units))
    }
    if (curTotal === 0 && priTotal === 0) continue
    children.sort((a, b) => b.current - a.current || b.prior - a.prior)
    const label = pid === UNASSIGNED_PORTFOLIO ? 'Unassigned (no portfolio)' : nameOf.get(pid) ?? pid
    rows.push(costCompareRow(pid, label, curTotal, priTotal, g.units, children))
  }
  return rows.sort((a, b) => b.current - a.current || b.prior - a.prior)
}

export function comparePayroll(
  current: PayrollCalculationResult,
  prior: PayrollCalculationResult,
  labels: { current: string; prior: string },
  portfolios: { id: string; name: string }[] = []
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

  const byPortfolio = buildPortfolioComparison(current, prior, portfolios)

  return {
    currentLabel: labels.current,
    priorLabel: labels.prior,
    totals,
    byEmployee,
    byProperty,
    byPortfolio,
    notable,
  }
}
