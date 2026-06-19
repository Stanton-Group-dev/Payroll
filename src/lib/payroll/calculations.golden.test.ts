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

  it('property_costs[0]: labor_cost and mgmt_fee', () => {
    const p = result.property_costs[0]
    // labor: 40*20 + 10*20*1.5 = 800 + 300 = 1100
    expect(cents(p.labor_cost)).toBe(cents(1100))
    // mgmt_fee: (1100 + 0) * 0.10 = 110
    expect(cents(p.mgmt_fee)).toBe(cents(110))
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
