import { describe, it, expect } from 'vitest'
import { buildStatementHtml } from './statementHtmlExport'
import type { BuiltInvoice, MgmtAllocation } from '@/hooks/payroll/useInvoiceBuild'
import type { EmployeePaySummary } from './calculations'

const prop = (over: Partial<BuiltInvoice['props'][number]>): BuiltInvoice['props'][number] => ({
  property_id: 'p1',
  property_code: 'S0001',
  property_name: 'S0001 - 12 Main St',
  address: '12 Main St, Hartford, CT 06106',
  labor_cost: 0,
  spread_cost: 0,
  mileage_cost: 0,
  expense_cost: 0,
  tax_cost: 0,
  wc_cost: 0,
  mgmt_fee: 0,
  total_cost: 0,
  llc: 'SREP Southend LLC',
  breakdown: [],
  ...over,
})

const inv = (over: Partial<BuiltInvoice>): BuiltInvoice => ({
  llc: 'SREP Southend LLC',
  props: [],
  amount: 0,
  mgmt: 0,
  total: 0,
  mgmt_allocation: 0,
  ...over,
})

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

const llcRows: BuiltInvoice[] = [
  inv({
    llc: 'SREP Southend LLC', total: 3337.36, mgmt_allocation: 223.14,
    props: [prop({ labor_cost: 3000, tax_cost: 200, wc_cost: 75, mgmt_fee: 62.36, total_cost: 3337.36, breakdown: [{ act: 'Maintenance', hours: 40, labor: 3000 }] })],
  }),
  inv({ llc: 'SREP Westend LLC', total: 4363.81, mgmt_allocation: 635.93, props: [] }),
]

// Self-consistent fixture: the two LLCs' shares sum to mgmt.total, mirroring the
// real invariant that Σ inv.mgmt_allocation === mgmtAllocation.total.
const mgmtAllocation: MgmtAllocation = {
  total: 859.07,
  totalUnits: 226,
  rows: [
    { llc: 'SREP Southend LLC', units: 59, amount: 223.14 },
    { llc: 'SREP Westend LLC', units: 167, amount: 635.93 },
  ],
  source: inv({
    llc: 'Stanton Management LLC', amount: 781.00, mgmt: 78.07, total: 859.07,
    props: [prop({ property_code: 'Office Reno', property_name: 'Office Reno', address: null, labor_cost: 781.00, mgmt_fee: 78.07, total_cost: 859.07, llc: 'Stanton Management LLC', breakdown: [{ act: 'General Labor', hours: 30, labor: 781.00 }] })],
  }),
}

const build = () => buildStatementHtml({
  week: { week_start: '2026-06-22', week_end: '2026-06-28', status: 'payroll_approved' },
  llcRows,
  mgmtAllocation,
  employeeSummaries: [
    emp({ employee_id: 'e1', employee_name: 'Maria <Lopez>', regular_hours: 40, regular_wages: 1000, gross_pay: 1000 }),
    emp({ employee_id: 'e2', employee_name: 'Remote Rick', regular_hours: 40, regular_wages: 900, gross_pay: 900, phone_reimbursement: 8 }),
  ],
  remoteEmployeeIds: ['e2'],
})

describe('buildStatementHtml', () => {
  it('is a standalone offline document with data embedded as JSON', () => {
    const html = build()
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('id="statement-data"')
    expect(html).not.toMatch(/src="http|href="http/)
    const json = html.match(/<script type="application\/json" id="statement-data">([\s\S]*?)<\/script>/)![1]
    const data = JSON.parse(json)
    expect(data.llcs).toHaveLength(2)
    expect(data.mgmt.total).toBe(859.07)
    expect(data.mgmt.source.props[0].code).toBe('Office Reno')
  })

  it('Total Payroll equals LLC own-costs plus the Stanton Management allocation', () => {
    const html = build()
    const data = JSON.parse(html.match(/id="statement-data">([\s\S]*?)<\/script>/)![1])
    // grand = Σ (own + allocation) = Σ own + mgmt.total
    const sumDue = data.llcs.reduce((s: number, l: { due: number }) => s + l.due, 0)
    expect(data.grand).toBeCloseTo(sumDue, 2)
    const sumOwn = data.llcs.reduce((s: number, l: { own: number }) => s + l.own, 0)
    expect(data.grand).toBeCloseTo(sumOwn + data.mgmt.total, 2)
  })

  it('excludes remote employees from the hourly summary but keeps their reimbursements', () => {
    const html = build()
    const data = JSON.parse(html.match(/id="statement-data">([\s\S]*?)<\/script>/)![1])
    expect(data.hourly.map((h: { employee_name: string }) => h.employee_name)).toEqual(['Maria <Lopez>'])
    expect(data.reimb.map((r: { employee_name: string }) => r.employee_name)).toEqual(['Remote Rick'])
    expect(data.reimb[0].is_remote).toBe(true)
  })

  it('escapes "<" so names cannot break out of the embedded data script', () => {
    const html = build()
    expect(html).not.toContain('<Lopez>')
    expect(html).toContain('\\u003cLopez>')
  })
})
