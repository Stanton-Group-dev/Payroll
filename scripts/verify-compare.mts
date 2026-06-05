// Verifies the week-over-week payroll comparison. Run: npx tsx scripts/verify-compare.mts
import {
  comparePayroll,
  type PayrollCalculationResult,
  type EmployeePaySummary,
  type PropertyCostSummary,
} from '../src/lib/payroll/calculations.ts'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) failures++
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${extra}`}`)
}

function emp(id: string, name: string, gross: number): EmployeePaySummary {
  return {
    employee_id: id, employee_name: name,
    regular_hours: 40, ot_hours: 0, pto_hours: 0,
    regular_wages: gross, ot_wages: 0, phone_reimbursement: 0,
    other_adjustments: 0, advances: 0, gross_pay: gross,
    payroll_tax: 0, workers_comp: 0, management_fee: 0, total_billable: gross,
  }
}
function prop(id: string, code: string, name: string, total: number): PropertyCostSummary {
  return {
    property_id: id, property_code: code, property_name: name, total_units: 10,
    labor_cost: total, spread_cost: 0, mgmt_fee: 0, total_cost: total, cost_per_unit: total / 10,
  }
}
function result(emps: EmployeePaySummary[], props: PropertyCostSummary[], gross: number): PayrollCalculationResult {
  return {
    employee_summaries: emps, property_costs: props,
    total_gross_pay: gross, total_payroll_tax: 0, total_workers_comp: 0,
    total_mgmt_fee: 0, required_prefund: gross,
  }
}

const prior = result(
  [emp('e1', 'Stan', 1000), emp('e2', 'Rene', 500)],
  [prop('p1', 'S1', 'Alpha', 800)],
  1500
)
const current = result(
  [emp('e1', 'Stan', 1200), emp('e3', 'New Guy', 600)],
  [prop('p1', 'S1', 'Alpha', 900), prop('p2', 'S2', 'Beta', 50)],
  1800
)

const cmp = comparePayroll(current, prior, { current: 'Week of 2026-05-31', prior: 'Week of 2026-05-24' })

// Totals
check('gross delta +300', cmp.totals.gross_pay.delta === 300, JSON.stringify(cmp.totals.gross_pay))
check('gross pct +20%', cmp.totals.gross_pay.pct === 20)
check('prefund delta +300', cmp.totals.required_prefund.delta === 300)

// Per-employee: sorted by |delta| desc → e3(600), e2(500), e1(200)
check('employee order e3,e2,e1', cmp.byEmployee.map((r) => r.key).join(',') === 'e3,e2,e1', cmp.byEmployee.map((r) => r.key).join(','))
const e3 = cmp.byEmployee.find((r) => r.key === 'e3')!
const e2 = cmp.byEmployee.find((r) => r.key === 'e2')!
const e1 = cmp.byEmployee.find((r) => r.key === 'e1')!
check('e3 is new', e3.status === 'new')
check('e3 pct null (prior 0)', e3.pct === null)
check('e2 is dropped (current 0, prior 500)', e2.status === 'dropped' && e2.current === 0 && e2.delta === -500)
check('e1 changed +200', e1.status === 'changed' && e1.delta === 200)

// Per-property: p1 changed +100, p2 new +50; sorted p1 then p2
check('property order p1,p2', cmp.byProperty.map((r) => r.key).join(',') === 'p1,p2')
check('p2 new', cmp.byProperty.find((r) => r.key === 'p2')!.status === 'new')

// Highlights
check('notable mentions New Guy', cmp.notable.some((n) => n.includes('New Guy')))
check('notable mentions Rene dropped', cmp.notable.some((n) => n.toLowerCase().includes('rene')))
check('notable mentions gross up', cmp.notable.some((n) => n.toLowerCase().includes('gross pay up')))

// No-prior edge: comparing against an all-zero result → everyone "new", pct null
const empty = result([], [], 0)
const vsEmpty = comparePayroll(current, empty, { current: 'Week of 2026-05-31', prior: 'no prior week' })
check('vs empty: gross pct null', vsEmpty.totals.gross_pay.pct === null)
check('vs empty: all employees new', vsEmpty.byEmployee.every((r) => r.status === 'new'))

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
