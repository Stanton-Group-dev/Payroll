import { describe, it, expect } from 'vitest'
import { buildReviewHtml } from './reviewHtmlExport'
import type { EmployeePaySummary, PayrollCalculationResult, PropertyCostSummary } from './calculations'

const emp = (over: Partial<EmployeePaySummary>): EmployeePaySummary => ({
  employee_id: 'e1',
  employee_name: 'Test Person',
  regular_hours: 0,
  ot_hours: 0,
  pto_hours: 0,
  regular_wages: 0,
  ot_wages: 0,
  phone_reimbursement: 0,
  mileage_reimbursement: 0,
  other_adjustments: 0,
  advances: 0,
  gross_pay: 0,
  payroll_tax: 0,
  workers_comp: 0,
  management_fee: 0,
  total_billable: 0,
  ...over,
})

const result: PayrollCalculationResult = {
  employee_summaries: [
    emp({
      employee_id: 'e1', employee_name: 'Maria <Lopez>', regular_hours: 40, ot_hours: 2,
      regular_wages: 800, ot_wages: 60, phone_reimbursement: 8, advances: 100,
      gross_pay: 768, payroll_tax: 69.44, workers_comp: 26.04, management_fee: 86.8, total_billable: 950.28,
    }),
    emp({ employee_id: 'e2', employee_name: 'Zero Row' }),
  ],
  property_costs: [],
  total_gross_pay: 768,
  total_payroll_tax: 69.44,
  total_workers_comp: 26.04,
  total_mgmt_fee: 86.8,
  required_prefund: 950.28,
}

const includedCosts: PropertyCostSummary[] = [{
  property_id: 'p1',
  property_code: 'S0001',
  property_name: '12 Main St',
  portfolio_id: null,
  total_units: 10,
  labor_cost: 500,
  spread_cost: 100,
  mileage_cost: 0,
  expense_cost: 0,
  tax_cost: 48,
  wc_cost: 18,
  mgmt_fee: 60,
  total_cost: 726,
  cost_per_unit: 72.6,
  spread_by_dept: [
    { department: 'Maintenance', amount: 60 },
    { department: 'Other', amount: 40 },
  ],
}]

const build = () => buildReviewHtml({
  week: { week_start: '2026-06-22', week_end: '2026-06-28', status: 'payroll_approved' },
  result,
  includedCosts,
  excludedCostCount: 2,
  prefundIncludesMgmtFee: true,
})

describe('buildReviewHtml', () => {
  it('produces a standalone document with the data embedded as JSON', () => {
    const html = build()
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('id="payroll-data"')
    // no external assets — the file must open offline without auth
    expect(html).not.toMatch(/src="http|href="http/)
    const json = html.match(/<script type="application\/json" id="payroll-data">([\s\S]*?)<\/script>/)![1]
    const data = JSON.parse(json)
    expect(data.week.start).toBe('2026-06-22')
    expect(data.prefund).toBe(950.28)
    expect(data.properties[0].property_name).toBe('12 Main St')
    expect(data.spreadByDept).toEqual([
      { department: 'Maintenance', amount: 60 },
      { department: 'Other', amount: 40 },
    ])
    expect(data.excludedCostCount).toBe(2)
  })

  it('drops zero-pay employees, mirroring the review page', () => {
    const html = build()
    expect(html).toContain('Maria')
    expect(html).not.toContain('Zero Row')
  })

  it('escapes "<" in embedded data so names cannot break out of the script tag', () => {
    const html = build()
    expect(html).not.toContain('<Lopez>')
    expect(html).toContain('\\u003cLopez>')
  })
})
