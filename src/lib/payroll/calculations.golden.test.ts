import { describe, it, expect } from 'vitest'
import { calculatePayroll, getMgmtFeeRate } from './calculations'
import type {
  PayrollEmployee,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  Property,
} from '@/lib/supabase/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cents = (x: number) => Math.round(x * 100)

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const property: Property = {
  id: 'p1',
  appfolio_property_id: 'af_p1',
  code: 'S0001',
  name: 'Test',
  address: null,
  total_units: 10,
  portfolio_id: 'pf1',
  billing_llc: null,
  is_active: true,
  include_in_invoicing: true,
}

const mgmtFeeConfigs: PayrollManagementFeeConfig[] = [
  {
    id: 'cfg1',
    portfolio_id: 'pf1',
    rate_pct: 0.10,
    effective_date: '2026-06-01',
    created_at: '2026-06-01T00:00:00Z',
    created_by: null,
  },
  {
    id: 'cfg2',
    portfolio_id: null,
    rate_pct: 0.10,
    effective_date: '2026-06-01',
    created_at: '2026-06-01T00:00:00Z',
    created_by: null,
  },
]

const employee: PayrollEmployee = {
  id: 'e1',
  name: 'E One',
  workyard_id: null,
  monitask_id: null,
  type: 'hourly',
  pay_group: 'field',
  hourly_rate: 20,
  weekly_rate: null,
  trade: null,
  is_active: true,
  is_management: false,
  ot_allowed: true,
  pay_tax: true,
  wc: true,
  mileage_eligible: false,
  department: 'Maintenance',
  role: null,
  phone: null,
  email: null,
  employee_code: null,
  amount: null,
  phone_reimbursement: null,
  monthly_bonus: null,
  bonus: null,
  rent_adjustment: null,
  pay_classification: null,
  hired_on: null,
  comp_updated_on: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: null,
}

const timeEntry: PayrollTimeEntry = {
  id: 'te1',
  payroll_week_id: 'wk1',
  employee_id: 'e1',
  property_id: 'p1',
  entry_date: '2026-06-09',
  regular_hours: 40,
  ot_hours: 10,
  pto_hours: 0,
  miles: 0,
  source: 'manual',
  workyard_timecardid: null,
  is_flagged: false,
  flag_reason: null,
  is_active: true,
  pending_resolution: false,
  pending_note: null,
  pending_since: null,
  is_overhead_spread: false,
  cost_code: null,
  cost_code_name: null,
  spread_event_id: null,
  created_at: '2026-06-09T00:00:00Z',
  updated_at: '2026-06-09T00:00:00Z',
  created_by: null,
}

// The engine treats type='advance' as an advance (populates d.advances).
const advanceAdjustment: PayrollAdjustment = {
  id: 'adj1',
  payroll_week_id: 'wk1',
  employee_id: 'e1',
  type: 'advance',
  amount: 100,
  description: 'Pay advance',
  allocation_method: 'employee_pay',
  created_at: '2026-06-09T00:00:00Z',
  updated_at: '2026-06-09T00:00:00Z',
  created_by: null,
}

const WEEK_START = '2026-06-08'

// ---------------------------------------------------------------------------
// Golden week test
// ---------------------------------------------------------------------------
describe('calculatePayroll — golden week 2026-06-08', () => {
  const result = calculatePayroll(
    [employee],
    [timeEntry],
    [advanceAdjustment],
    mgmtFeeConfigs,
    [property],
    [],        // no mileage reimbursements
    {},        // no dept splits
    WEEK_START // weekStart
    // prefundIncludesMgmtFee defaults to true
  )

  it('employee_summaries[0]: hours and wages', () => {
    const e = result.employee_summaries[0]
    expect(e.regular_hours).toBe(40)
    expect(e.ot_hours).toBe(10)
    expect(e.regular_wages).toBe(800)
    expect(e.ot_wages).toBe(300)
    expect(e.gross_pay).toBe(1000)
  })

  it('employee_summaries[0]: tax and WC (OD-3: taxable base adds advances back)', () => {
    const e = result.employee_summaries[0]
    // taxable_base = gross_pay(1000) - phone(0) - mileage(0) - nontax(0) + advances(100) = 1100
    expect(cents(e.payroll_tax)).toBe(cents(88))   // 1100 * 0.08
    expect(cents(e.workers_comp)).toBe(cents(33))  // 1100 * 0.03
  })

  it('property_costs[0]: labor, mgmt_fee, and employer burden (tax + WC) billed to the property', () => {
    const p = result.property_costs[0]
    // labor: 40*20 + 10*20*1.5 = 800 + 300 = 1100
    expect(cents(p.labor_cost)).toBe(cents(1100))
    // mgmt_fee: (1100 + 0) * 0.10 = 110 — fee base is wages only, NOT the burden
    expect(cents(p.mgmt_fee)).toBe(cents(110))
    // no expense_reimbursement adjustments this week → nothing billed through
    expect(cents(p.expense_cost)).toBe(cents(0))
    // Employer burden follows the wages — all of e1's labor is on p1, so all the tax/WC
    // lands here: tax 88 (1100 * 0.08), WC 33 (1100 * 0.03).
    expect(cents(p.tax_cost)).toBe(cents(88))
    expect(cents(p.wc_cost)).toBe(cents(33))
    // total_cost folds in the burden: 1100 labor + 88 tax + 33 WC + 110 mgmt = 1331
    expect(cents(p.total_cost)).toBe(cents(1331))
  })

  it('Σ property total_cost = required_prefund + advances (full freight billed)', () => {
    // The customer is billed full labor + burden + fee; the $100 advance was paid early to
    // the employee and is recovered from them, NOT by under-billing the LLC. So billed
    // (1331) = prefund (1231) + advance (100).
    const billed = result.property_costs.reduce((s, p) => s + p.total_cost, 0)
    expect(cents(billed)).toBe(cents(1331))
    expect(cents(result.required_prefund)).toBe(cents(1231))
  })

  it('total_mgmt_fee is property-authoritative (OD-4)', () => {
    // property_costs.reduce(mgmt_fee) = 110
    expect(cents(result.total_mgmt_fee)).toBe(cents(110))
  })

  it('required_prefund includes mgmt fee by default (OD-5)', () => {
    // gross(1000) + tax(88) + wc(33) + mgmt_fee(110) = 1231
    expect(cents(result.required_prefund)).toBe(cents(1231))
  })

  it('required_prefund excludes mgmt fee when prefundIncludesMgmtFee=false', () => {
    const r2 = calculatePayroll(
      [employee],
      [timeEntry],
      [advanceAdjustment],
      mgmtFeeConfigs,
      [property],
      [],
      {},
      WEEK_START,
      false // prefundIncludesMgmtFee=false
    )
    // gross(1000) + tax(88) + wc(33) = 1121
    expect(cents(r2.required_prefund)).toBe(cents(1121))
  })
})

// ---------------------------------------------------------------------------
// Office Reno regression (2026-07-01): a salaried employee's WEEKLY salary can
// reach the engine in hourly_rate — payroll_employee_rates stores weekly rates
// for salaried staff, and callers pre-resolve rate history into hourly_rate via
// resolveRateAsOf. Their hours on a property must still bill $0 direct labor
// (weekly_rate already spreads portfolio-wide via Method B), and overhead-flagged
// salaried hours must not add a second cost to the spread pool.
// ---------------------------------------------------------------------------
describe('salaried hours never bill as direct property labor (Office Reno regression)', () => {
  const salaried: PayrollEmployee = {
    ...employee,
    id: 's1',
    name: 'S One',
    type: 'salaried',
    weekly_rate: 1100,
    hourly_rate: 1100, // weekly salary injected as "hourly" by rate-history resolution
    ot_allowed: false,
  }
  const salariedDirectEntry: PayrollTimeEntry = {
    ...timeEntry, id: 'te-s1', employee_id: 's1', regular_hours: 8, ot_hours: 0,
  }
  const salariedOverheadEntry: PayrollTimeEntry = {
    ...timeEntry, id: 'te-s2', employee_id: 's1', regular_hours: 2, ot_hours: 0,
    is_overhead_spread: true,
  }
  const hourlyEntry: PayrollTimeEntry = {
    ...timeEntry, id: 'te-h1', regular_hours: 10, ot_hours: 0,
  }
  const result = calculatePayroll(
    [employee, salaried],
    [hourlyEntry, salariedDirectEntry, salariedOverheadEntry],
    [],
    mgmtFeeConfigs,
    [property],
    [],
    {},
    WEEK_START
  )

  it('property labor_cost carries only hourly labor — salaried hours bill $0 direct', () => {
    // e1: 10h × $20 = 200. s1's 8h at the injected $1,100 "hourly" rate must NOT appear
    // (the bug billed 8 × 1100 = $8,800 of phantom labor).
    expect(cents(result.property_costs[0].labor_cost)).toBe(cents(200))
  })

  it('spread_cost carries the weekly_rate once — overhead-flagged salaried hours add nothing', () => {
    // Single property owns all units → full spread lands on it: exactly the $1,100
    // weekly salary, with no extra 2h × 1100 from the overhead-flagged entry.
    expect(cents(result.property_costs[0].spread_cost)).toBe(cents(1100))
  })

  it('salaried gross_pay stays weekly_rate', () => {
    const s = result.employee_summaries.find(e => e.employee_id === 's1')!
    expect(cents(s.gross_pay)).toBe(cents(1100))
  })

  it('billed total still equals required_prefund (no advances this week)', () => {
    const billed = result.property_costs.reduce((s, p) => s + p.total_cost, 0)
    expect(cents(billed)).toBe(cents(result.required_prefund))
  })
})

// ---------------------------------------------------------------------------
// Overhead-flag double-bill regression (2026-07-01): a timesheet reassign can land
// an overhead-flagged ("Office") entry on a real property with the flag still set.
// Such an entry must bill ONCE — direct to that property (property wins, per the
// Office On-Site rule) — never a second time through the unit-weighted spread pool.
// Week 06/22 shape: this double-billed the portfolio by the duplicated wages.
// ---------------------------------------------------------------------------
describe('overhead-flagged entry WITH a property bills once, direct (double-bill regression)', () => {
  const directEntry: PayrollTimeEntry = {
    ...timeEntry, id: 'te-d1', regular_hours: 10, ot_hours: 0,
  }
  // The bad shape: reassigned onto p1 but is_overhead_spread was left true.
  const reassignedOverheadEntry: PayrollTimeEntry = {
    ...timeEntry, id: 'te-o1', regular_hours: 5, ot_hours: 0,
    is_overhead_spread: true,
  }
  // A well-formed office entry: flagged, no property — spreads via the pool.
  const pureOverheadEntry: PayrollTimeEntry = {
    ...timeEntry, id: 'te-o2', property_id: null, regular_hours: 3, ot_hours: 0,
    is_overhead_spread: true,
  }
  const result = calculatePayroll(
    [employee],
    [directEntry, reassignedOverheadEntry, pureOverheadEntry],
    [],
    mgmtFeeConfigs,
    [property],
    [],
    {},
    WEEK_START
  )

  it('flagged entry with a property bills as direct labor, not into the pool', () => {
    // labor = 10h×$20 + 5h×$20 = 300. The bug also pooled the 5h ($100), so labor
    // stayed 300 but spread grew by a duplicate $100.
    expect(cents(result.property_costs[0].labor_cost)).toBe(cents(300))
  })

  it('spread_cost carries only the property-less office entry', () => {
    // Pool = 3h × $20 = 60 (single billable property absorbs all of it).
    expect(cents(result.property_costs[0].spread_cost)).toBe(cents(60))
  })

  it('employee is paid once for all hours', () => {
    // 18h × $20 = 360 — pay was never the bug; only the billing side duplicated.
    expect(cents(result.employee_summaries[0].gross_pay)).toBe(cents(360))
  })

  it('Σ property total_cost = required_prefund (portfolio not over-billed)', () => {
    // gross 360 + tax 28.80 + WC 10.80 + fee (300+60)×0.10 = 435.60 billed exactly.
    // Pre-fix this billed 545.60 against a 445.60 prefund — a $100 over-bill.
    const billed = result.property_costs.reduce((s, p) => s + p.total_cost, 0)
    expect(cents(billed)).toBe(cents(result.required_prefund))
    expect(cents(billed)).toBe(cents(435.60))
  })
})

// ---------------------------------------------------------------------------
// PRP-02 CF-7/CF-8 regression: recon/export consumer sees engine gross_pay,
// not the old loop that added advances instead of subtracting them.
// ---------------------------------------------------------------------------
describe('recon/export engine alignment — advance employee (PRP-02)', () => {
  it('engine gross_pay for advance employee is 1000 (advances subtracted, not added)', () => {
    // The old local loop in useADPReconciliation had a bug: it added adj.amount
    // unconditionally, which for a $100 advance would yield 1100 instead of 1000.
    // After the refactor, both recon and export delegate to calculatePayroll.
    // This assertion documents that the engine-derived gross equals 1000 — i.e.
    // recon == export == engine on a week that contains an advance.
    const result = calculatePayroll(
      [employee],
      [timeEntry],
      [advanceAdjustment],
      mgmtFeeConfigs,
      [property],
      [],
      {},
      WEEK_START,
    )
    const e = result.employee_summaries[0]
    // gross = regular_wages(800) + ot_wages(300) - advance(100) = 1000
    expect(e.gross_pay).toBe(1000)
    // Confirm advances are captured separately (not added to gross)
    expect(e.advances).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Expense bill-through: approved expense reimbursements are billed to the property
// at cost (pass-through, NOT in the management-fee base — like mileage).
// ---------------------------------------------------------------------------
describe('calculatePayroll — expense bill-through', () => {
  const directExpense: PayrollAdjustment = {
    id: 'adjE1',
    payroll_week_id: 'wk1',
    employee_id: 'e1',
    type: 'expense_reimbursement',
    amount: 50,
    description: 'Materials reimbursement',
    allocation_method: 'direct',
    property_id: 'p1',
    created_at: '2026-06-09T00:00:00Z',
    updated_at: '2026-06-09T00:00:00Z',
    created_by: null,
  }
  // Unit-weighted (spread across all billable properties). Only p1 is billable, so it
  // absorbs the whole amount.
  const spreadExpense: PayrollAdjustment = {
    id: 'adjE2',
    payroll_week_id: 'wk1',
    employee_id: 'e1',
    type: 'expense_reimbursement',
    amount: 30,
    description: 'Tools reimbursement',
    allocation_method: 'unit_weighted',
    property_id: null,
    created_at: '2026-06-09T00:00:00Z',
    updated_at: '2026-06-09T00:00:00Z',
    created_by: null,
  }

  const result = calculatePayroll(
    [employee],
    [timeEntry],
    [directExpense, spreadExpense],
    mgmtFeeConfigs,
    [property],
    [],
    {},
    WEEK_START,
  )

  it('expense_cost = direct ($50) + unit-weighted spread ($30) = $80', () => {
    expect(cents(result.property_costs[0].expense_cost)).toBe(cents(80))
  })

  it('mgmt_fee is unchanged — expenses are pass-through, not in the fee base', () => {
    // (labor 1100 + spread 0) * 0.10 = 110, regardless of the $80 expense.
    expect(cents(result.property_costs[0].mgmt_fee)).toBe(cents(110))
  })

  it('total_cost folds in expense + burden: 1100 labor + 80 expense + 88 tax + 33 WC + 110 mgmt = 1411', () => {
    const p = result.property_costs[0]
    // taxable base = gross 1180 − 80 nontax expense reimbursement = 1100 → tax 88, WC 33
    expect(cents(p.tax_cost)).toBe(cents(88))
    expect(cents(p.wc_cost)).toBe(cents(33))
    expect(cents(p.total_cost)).toBe(cents(1411))
  })

  it('employee is reimbursed: the $80 lands in gross_pay (other_adjustments)', () => {
    // gross = 800 + 300 + 80 = 1180
    expect(cents(result.employee_summaries[0].gross_pay)).toBe(cents(1180))
  })
})

// ---------------------------------------------------------------------------
// getMgmtFeeRate asOf unit test (C-5)
// ---------------------------------------------------------------------------
describe('getMgmtFeeRate — asOf effective-date filtering', () => {
  const configs: PayrollManagementFeeConfig[] = [
    {
      id: 'c1',
      portfolio_id: 'pf1',
      rate_pct: 0.10,
      effective_date: '2026-01-01',
      created_at: '2026-01-01T00:00:00Z',
      created_by: null,
    },
    {
      id: 'c2',
      portfolio_id: 'pf1',
      rate_pct: 0.15,
      effective_date: '2026-12-01',
      created_at: '2026-12-01T00:00:00Z',
      created_by: null,
    },
  ]

  it('asOf 2026-06-08 returns 0.10 (Dec config not yet effective)', () => {
    expect(getMgmtFeeRate('pf1', configs, '2026-06-08')).toBe(0.10)
  })

  it('asOf 2027-01-01 returns 0.15 (Dec config now effective)', () => {
    expect(getMgmtFeeRate('pf1', configs, '2027-01-01')).toBe(0.15)
  })
})
