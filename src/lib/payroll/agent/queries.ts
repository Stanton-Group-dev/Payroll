/**
 * Read-only reporting helpers for the natural-language console.
 *
 * These never mutate. They answer questions like "how much was Rolando paid
 * over the last 5 weeks", "how many hours did we knock off", and "was he at
 * 23 Squire". Pay figures are computed through the SAME canonical
 * calculatePayroll() math used by the week-review screen (rate-as-of-date,
 * salaried handling, adjustments, advances) so reported numbers are trustworthy
 * — the agent only narrates the numbers these functions return.
 */
import type { OperationContext } from '@/lib/payroll/operations/core'
import {
  calculatePayroll,
  resolveRateAsOf,
  comparePayroll,
  type PayrollCalculationResult,
  type PayrollComparison,
} from '@/lib/payroll/calculations'
import { parseRelativeDate, resolveWeekForDate } from '@/lib/payroll/resolve/dates'
import { fetchAllRows } from '@/lib/supabase/fetchAll'
import { curatedToProperty, CURATED_PROPERTY_COLUMNS, type CuratedPropertyRow } from '@/lib/payroll/properties'
import type {
  PayrollEmployee,
  PayrollEmployeeRate,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  Property,
} from '@/lib/supabase/types'

export interface ReportWeek {
  id: string
  week_start: string
  week_end: string
  status: string
}

/**
 * Resolve a span of payroll weeks. Provide `lastNWeeks` (most recent N weeks up
 * to today) OR an explicit `fromDate`/`toDate` ISO range. Returns weeks oldest→newest.
 */
export async function resolveWeeks(
  ctx: OperationContext,
  opts: { lastNWeeks?: number; fromDate?: string; toDate?: string }
): Promise<ReportWeek[]> {
  const sel = 'id, week_start, week_end, status'
  if (opts.lastNWeeks && opts.lastNWeeks > 0) {
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await ctx.supabase
      .from('payroll_weeks')
      .select(sel)
      .lte('week_start', today)
      .order('week_start', { ascending: false })
      .limit(Math.min(opts.lastNWeeks, 26))
    if (error) throw new Error(`Failed to load weeks: ${error.message}`)
    return ((data ?? []) as ReportWeek[]).slice().reverse()
  }

  let q = ctx.supabase.from('payroll_weeks').select(sel).order('week_start', { ascending: true })
  if (opts.fromDate) q = q.gte('week_end', opts.fromDate)
  if (opts.toDate) q = q.lte('week_start', opts.toDate)
  const { data, error } = await q.limit(26)
  if (error) throw new Error(`Failed to load weeks: ${error.message}`)
  return (data ?? []) as ReportWeek[]
}

export interface PayWeekRow {
  week_start: string
  week_end: string
  status: string
  regular_hours: number
  ot_hours: number
  pto_hours: number
  gross_pay: number
  regular_wages: number
  ot_wages: number
  phone_reimbursement: number
  other_adjustments: number
  advances: number
}

export interface PayReport {
  employee: { id: string; name: string } | null
  weeks: PayWeekRow[]
  total_gross_pay: number
  total_regular_hours: number
  total_ot_hours: number
  total_pto_hours: number
}

/**
 * Gross pay over a set of weeks. If `employeeId` is given, returns a per-week
 * breakdown for that person; otherwise returns per-week totals across all
 * active employees. Weeks must come from resolveWeeks().
 */
export async function queryPay(
  ctx: OperationContext,
  opts: { employeeId?: string; weeks: ReportWeek[] }
): Promise<PayReport> {
  const { employeeId, weeks } = opts
  if (weeks.length === 0) {
    return {
      employee: null,
      weeks: [],
      total_gross_pay: 0,
      total_regular_hours: 0,
      total_ot_hours: 0,
      total_pto_hours: 0,
    }
  }

  // Load the employee roster once (scoped to one person when asked).
  let empQ = ctx.supabase
    .from('payroll_employees')
    .select('id, name, type, hourly_rate, weekly_rate, pay_tax, wc')
  if (employeeId) empQ = empQ.eq('id', employeeId)
  else empQ = empQ.eq('is_active', true)
  const { data: empData, error: empErr } = await empQ
  if (empErr) throw new Error(`Failed to load employees: ${empErr.message}`)
  const employees = (empData ?? []) as PayrollEmployee[]
  if (employees.length === 0) throw new Error('No matching employee found.')
  const empIds = employees.map((e) => e.id)

  // Rate history + mgmt-fee configs, loaded once and reused per week.
  const { data: rateData } = await ctx.supabase
    .from('payroll_employee_rates')
    .select('id, employee_id, rate, effective_date')
    .in('employee_id', empIds)
  const rates = (rateData ?? []) as PayrollEmployeeRate[]

  const { data: feeData } = await ctx.supabase
    .from('payroll_management_fee_config')
    .select('id, rate_pct, portfolio_id, effective_date')
  const feeConfigs = (feeData ?? []) as PayrollManagementFeeConfig[]

  const weekRows: PayWeekRow[] = []

  for (const week of weeks) {
    const [{ data: entryData }, { data: adjData }] = await Promise.all([
      // A week's entries exceed the 1,000-row select cap (spread legs) — drain in
      // pages so the engine sees the whole week.
      fetchAllRows((from, to) => ctx.supabase
        .from('payroll_time_entries')
        .select('id, employee_id, property_id, entry_date, regular_hours, ot_hours, pto_hours, is_overhead_spread')
        .eq('payroll_week_id', week.id)
        .eq('is_active', true)
        .in('employee_id', empIds)
        .order('id')
        .range(from, to)),
      ctx.supabase
        .from('payroll_adjustments')
        .select('id, employee_id, type, amount')
        .eq('payroll_week_id', week.id)
        .in('employee_id', empIds),
    ])

    const entries = (entryData ?? []) as PayrollTimeEntry[]
    const adjustments = (adjData ?? []) as PayrollAdjustment[]

    // Override each employee's live hourly_rate with the rate effective for this
    // week, so historical pay reflects the rate actually in force at the time.
    const employeesForWeek = employees.map((e) => ({
      ...e,
      hourly_rate: resolveRateAsOf(e.id, week.week_start, rates, e.hourly_rate ?? 0),
    }))

    // properties = [] → we only want employee_summaries, not property cost rollups.
    const result = calculatePayroll(employeesForWeek, entries, adjustments, feeConfigs, [])
    const summaries = result.employee_summaries

    const agg = summaries.reduce(
      (acc, s) => {
        acc.regular_hours += s.regular_hours
        acc.ot_hours += s.ot_hours
        acc.pto_hours += s.pto_hours
        acc.gross_pay += s.gross_pay
        acc.regular_wages += s.regular_wages
        acc.ot_wages += s.ot_wages
        acc.phone_reimbursement += s.phone_reimbursement
        acc.other_adjustments += s.other_adjustments
        acc.advances += s.advances
        return acc
      },
      {
        regular_hours: 0, ot_hours: 0, pto_hours: 0, gross_pay: 0,
        regular_wages: 0, ot_wages: 0, phone_reimbursement: 0,
        other_adjustments: 0, advances: 0,
      }
    )

    weekRows.push({
      week_start: week.week_start,
      week_end: week.week_end,
      status: week.status,
      ...round(agg),
    })
  }

  const totals = weekRows.reduce(
    (acc, w) => {
      acc.gross += w.gross_pay
      acc.reg += w.regular_hours
      acc.ot += w.ot_hours
      acc.pto += w.pto_hours
      return acc
    },
    { gross: 0, reg: 0, ot: 0, pto: 0 }
  )

  return {
    employee: employeeId ? { id: employees[0].id, name: employees[0].name } : null,
    weeks: weekRows,
    total_gross_pay: round2(totals.gross),
    total_regular_hours: round2(totals.reg),
    total_ot_hours: round2(totals.ot),
    total_pto_hours: round2(totals.pto),
  }
}

export interface TimeEntryRow {
  entry_date: string
  regular_hours: number
  ot_hours: number
  pto_hours: number
  total_hours: number
  property: { id: string; code: string; name: string } | null
  source: string
  is_active: boolean
  is_flagged: boolean
}

export interface TimeEntryReport {
  status: 'active' | 'removed' | 'all'
  entries: TimeEntryRow[]
  total_hours: number
  count: number
}

/**
 * List time entries for a person / property / date window. `status` selects
 * active rows (default), removed/soft-deleted rows ("how many hours did we knock
 * off"), or all. A property filter answers "was he at 23 Squire". Caller passes
 * already-resolved ids and ISO dates.
 */
export async function queryTimeEntries(
  ctx: OperationContext,
  opts: {
    employeeId?: string
    propertyId?: string
    fromDate?: string
    toDate?: string
    status?: 'active' | 'removed' | 'all'
  }
): Promise<TimeEntryReport> {
  const status = opts.status ?? 'active'
  // Drain past the 1,000-row select cap so count/total_hours cover every matching
  // row; only the narrated entry list below is capped.
  const { data, error } = await fetchAllRows((from, to) => {
    let q = ctx.supabase
      .from('payroll_time_entries')
      .select('entry_date, regular_hours, ot_hours, pto_hours, property_id, source, is_active, is_flagged')
      .order('entry_date')
      .order('id')
      .range(from, to)

    if (status === 'active') q = q.eq('is_active', true)
    else if (status === 'removed') q = q.eq('is_active', false)
    if (opts.employeeId) q = q.eq('employee_id', opts.employeeId)
    if (opts.propertyId) q = q.eq('property_id', opts.propertyId)
    if (opts.fromDate) q = q.gte('entry_date', opts.fromDate)
    if (opts.toDate) q = q.lte('entry_date', opts.toDate)
    return q
  })
  if (error) throw new Error(`Failed to load time entries: ${error.message}`)
  const rows = (data ?? []) as PayrollTimeEntry[]

  // Resolve property code/name for the ids present (no FK-embedding assumptions).
  const propIds = Array.from(new Set(rows.map((r) => r.property_id).filter(Boolean))) as string[]
  const propMap: Record<string, { id: string; code: string; name: string }> = {}
  if (propIds.length > 0) {
    const { data: props } = await ctx.supabase
      .from('properties')
      .select('id, code, name')
      .in('id', propIds)
    for (const p of (props ?? []) as { id: string; code: string; name: string }[]) {
      propMap[p.id] = p
    }
  }

  let totalHours = 0
  const entries: TimeEntryRow[] = rows.map((r) => {
    const total = (r.regular_hours ?? 0) + (r.ot_hours ?? 0) + (r.pto_hours ?? 0)
    totalHours += total
    return {
      entry_date: r.entry_date,
      regular_hours: r.regular_hours ?? 0,
      ot_hours: r.ot_hours ?? 0,
      pto_hours: r.pto_hours ?? 0,
      total_hours: round2(total),
      property: r.property_id ? propMap[r.property_id] ?? null : null,
      source: r.source,
      is_active: r.is_active,
      is_flagged: r.is_flagged,
    }
  })

  // count/total_hours reflect every matching row; the listing itself stays capped
  // so a wide date window can't flood the agent's context.
  return { status, entries: entries.slice(0, 500), total_hours: round2(totalHours), count: entries.length }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round<T extends Record<string, number>>(obj: T): T {
  const out = {} as T
  for (const k of Object.keys(obj) as (keyof T)[]) out[k] = round2(obj[k]) as T[keyof T]
  return out
}

/* ------------------------------------------------------------------ */
/* Run payroll for a week and compare it to the prior week            */
/* ------------------------------------------------------------------ */

const EMPTY_RESULT: PayrollCalculationResult = {
  employee_summaries: [],
  property_costs: [],
  total_gross_pay: 0,
  total_payroll_tax: 0,
  total_workers_comp: 0,
  total_mgmt_fee: 0,
  required_prefund: 0,
}

/** Run the canonical payroll engine for one week (excludes flagged/inactive entries, like the review screen). */
async function runWeekResult(
  ctx: OperationContext,
  week: ReportWeek,
  employees: PayrollEmployee[],
  rates: PayrollEmployeeRate[],
  feeConfigs: PayrollManagementFeeConfig[],
  properties: Property[]
): Promise<PayrollCalculationResult> {
  const [{ data: entryData }, { data: adjData }] = await Promise.all([
    // A week's entries exceed the 1,000-row select cap (spread legs) — drain in pages.
    fetchAllRows((from, to) => ctx.supabase
      .from('payroll_time_entries')
      .select('id, employee_id, property_id, entry_date, regular_hours, ot_hours, pto_hours, is_flagged, is_active, is_overhead_spread')
      .eq('payroll_week_id', week.id)
      .eq('is_active', true)
      .eq('is_flagged', false)
      .order('id')
      .range(from, to)),
    ctx.supabase
      .from('payroll_adjustments')
      .select('id, employee_id, type, amount')
      .eq('payroll_week_id', week.id),
  ])
  const entries = (entryData ?? []) as PayrollTimeEntry[]
  const adjustments = (adjData ?? []) as PayrollAdjustment[]
  // Use the rate that was in force for this week so historical pay is accurate.
  const employeesForWeek = employees.map((e) => ({
    ...e,
    hourly_rate: resolveRateAsOf(e.id, week.week_start, rates, e.hourly_rate ?? 0),
  }))
  return calculatePayroll(employeesForWeek, entries, adjustments, feeConfigs, properties)
}

export interface PayrollComparisonReport extends PayrollComparison {
  hasPrior: boolean
}

/**
 * Run payroll for a target week (by id or by a date inside it) and compare it to
 * the immediately-preceding payroll week. Uses the same engine as the review
 * screen, so the figures match an actual payroll run.
 */
export async function queryPayrollComparison(
  ctx: OperationContext,
  opts: { weekId?: string; date?: string }
): Promise<PayrollComparisonReport> {
  const sel = 'id, week_start, week_end, status'

  // Resolve the target week from an id or a date phrase.
  let target: ReportWeek | null = null
  if (opts.weekId) {
    const { data } = await ctx.supabase.from('payroll_weeks').select(sel).eq('id', opts.weekId).maybeSingle()
    target = (data as ReportWeek | null) ?? null
  } else if (opts.date) {
    const parsed = parseRelativeDate(opts.date)
    if (!parsed) throw new Error(`Could not parse the date "${opts.date}".`)
    const wk = await resolveWeekForDate(ctx, parsed.iso)
    if (wk) target = { id: wk.id, week_start: wk.week_start, week_end: wk.week_end, status: wk.status }
  }
  if (!target) throw new Error('No payroll week matched. Specify a week or a date inside one.')

  // Prior week = the most recent week starting before the target.
  const { data: priorData } = await ctx.supabase
    .from('payroll_weeks')
    .select(sel)
    .lt('week_start', target.week_start)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  const prior = (priorData as ReportWeek | null) ?? null

  // Shared reference data, loaded once for both weeks.
  const [{ data: empData }, { data: rateData }, { data: feeData }, { data: propData }, { data: portData }] = await Promise.all([
    ctx.supabase.from('payroll_employees').select('id, name, type, hourly_rate, weekly_rate, pay_tax, wc').eq('is_active', true),
    ctx.supabase.from('payroll_employee_rates').select('id, employee_id, rate, effective_date'),
    ctx.supabase.from('payroll_management_fee_config').select('id, rate_pct, portfolio_id, effective_date'),
    ctx.supabase.from('payroll_property').select(CURATED_PROPERTY_COLUMNS).eq('is_active', true),
    ctx.supabase.from('portfolios').select('id, name'),
  ])
  const employees = (empData ?? []) as PayrollEmployee[]
  const rates = (rateData ?? []) as PayrollEmployeeRate[]
  const feeConfigs = (feeData ?? []) as PayrollManagementFeeConfig[]
  const properties = (propData ?? []).map(r => curatedToProperty(r as unknown as CuratedPropertyRow)) as Property[]
  const portfolios = (portData ?? []) as { id: string; name: string }[]

  const currentResult = await runWeekResult(ctx, target, employees, rates, feeConfigs, properties)
  const priorResult = prior
    ? await runWeekResult(ctx, prior, employees, rates, feeConfigs, properties)
    : EMPTY_RESULT

  const comparison = comparePayroll(currentResult, priorResult, {
    current: `Week of ${target.week_start}`,
    prior: prior ? `Week of ${prior.week_start}` : 'no prior week',
  }, portfolios)
  if (!prior) comparison.notable.unshift('No prior payroll week exists — nothing to compare against.')
  return { ...comparison, hasPrior: !!prior }
}
