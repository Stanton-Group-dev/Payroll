// Verifies the core payroll engine (calculatePayroll + getMgmtFeeRate).
// Every expected number below is computed BY HAND in the comment above the
// assertion, so a failure means the engine drifted from the documented intent.
// Run: npx tsx scripts/verify-calculations.mts
import { calculatePayroll, getMgmtFeeRate } from '../src/lib/payroll/calculations.ts'
import { PAYROLL_TAX_RATE, WORKERS_COMP_RATE } from '../src/lib/payroll/config.ts'
import type {
  PayrollEmployee,
  PayrollTimeEntry,
  PayrollAdjustment,
  PayrollManagementFeeConfig,
  Property,
} from '../src/lib/supabase/types.ts'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) failures++
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  →  ${extra}`}`)
}
function near(a: number, b: number) {
  return Math.abs(a - b) < 0.005
}

// --- factories: fill only the fields the engine reads, default the rest ---
function emp(p: Partial<PayrollEmployee> & { id: string; name: string }): PayrollEmployee {
  return {
    workyard_id: null, type: 'hourly', hourly_rate: null, weekly_rate: null,
    trade: null, is_active: true, ot_allowed: true, pay_tax: false, wc: false,
    created_at: '', updated_at: '', created_by: null, ...p,
  } as PayrollEmployee
}
function entry(p: Partial<PayrollTimeEntry> & { employee_id: string }): PayrollTimeEntry {
  return {
    id: 'te', payroll_week_id: 'w', property_id: null, entry_date: '2026-05-17',
    regular_hours: 0, ot_hours: 0, pto_hours: 0, source: 'workyard',
    workyard_timecardid: null, is_flagged: false, flag_reason: null, is_active: true,
    pending_resolution: false, pending_note: null, pending_since: null,
    spread_event_id: null, created_at: '', updated_at: '', created_by: null, ...p,
  } as PayrollTimeEntry
}
function adj(p: Partial<PayrollAdjustment> & { employee_id: string; type: PayrollAdjustment['type']; amount: number }): PayrollAdjustment {
  return {
    id: 'a', payroll_week_id: 'w', description: '', allocation_method: 'employee_pay',
    prior_week_id: null, created_at: '', updated_at: '', created_by: null, ...p,
  } as PayrollAdjustment
}
function prop(p: Partial<Property> & { id: string; code: string }): Property {
  return {
    appfolio_property_id: '', name: p.code, address: null, total_units: 0,
    portfolio_id: null, billing_llc: null, is_active: true, ...p,
  } as Property
}
const NO_FEES: PayrollManagementFeeConfig[] = []   // → default rate 0.10
function feeCfg(p: Partial<PayrollManagementFeeConfig> & { rate_pct: number; effective_date: string }): PayrollManagementFeeConfig {
  return { id: 'f', portfolio_id: null, created_at: '', created_by: null, ...p } as PayrollManagementFeeConfig
}

const get = (r: ReturnType<typeof calculatePayroll>, id: string) =>
  r.employee_summaries.find((e) => e.employee_id === id)!

console.log('\n== 1. Basic hourly: 40h @ $25 ==')
{
  // regular_wages = 40*25 = 1000; gross = 1000
  // tax = 1000*0.08 = 80; wc = 1000*0.03 = 30; mgmt = 1000*0.10 = 100
  // total_billable = 1000+80+30+100 = 1210
  const r = calculatePayroll(
    [emp({ id: 'A', name: 'Al', hourly_rate: 25, pay_tax: true, wc: true })],
    [entry({ employee_id: 'A', regular_hours: 40 })],
    [], NO_FEES, []
  )
  const a = get(r, 'A')
  check('regular_wages 1000', a.regular_wages === 1000, `${a.regular_wages}`)
  check('gross_pay 1000', a.gross_pay === 1000, `${a.gross_pay}`)
  check('payroll_tax 80', a.payroll_tax === 80, `${a.payroll_tax}`)
  check('workers_comp 30', a.workers_comp === 30, `${a.workers_comp}`)
  check('management_fee 100', a.management_fee === 100, `${a.management_fee}`)
  check('total_billable 1210', a.total_billable === 1210, `${a.total_billable}`)
  check('required_prefund 1110 (gross+tax+wc, NO mgmt fee)', r.required_prefund === 1110, `${r.required_prefund}`)
}

console.log('\n== 2. OVERTIME by worker class: W2 hourly 1.5x, contractor 1.0x ==')
{
  // HOURLY W2: 40 reg + 10 OT @ $20
  //   regular = 800; ot = 10 * 20 * 1.5 = 300; gross = 1100
  const w2 = calculatePayroll(
    [emp({ id: 'B', name: 'Bo', type: 'hourly', hourly_rate: 20 })],
    [entry({ employee_id: 'B', regular_hours: 40, ot_hours: 10 })],
    [], NO_FEES, []
  )
  const b = get(w2, 'B')
  check('W2 regular_wages 800', b.regular_wages === 800, `${b.regular_wages}`)
  check('W2 ot_wages 300 = time-and-a-half (10*20*1.5)', b.ot_wages === 300, `${b.ot_wages}`)
  check('W2 gross 1100 (800+300)', b.gross_pay === 1100, `${b.gross_pay}`)

  // CONTRACTOR (1099): same hours, NO OT premium
  //   ot = 10 * 20 * 1.0 = 200; gross = 1000
  const c99 = calculatePayroll(
    [emp({ id: 'B', name: 'Bo', type: 'contractor', hourly_rate: 20 })],
    [entry({ employee_id: 'B', regular_hours: 40, ot_hours: 10 })],
    [], NO_FEES, []
  )
  // CONTRACTOR: not OT-eligible → OT hours fold into regular at straight time.
  const bc = get(c99, 'B')
  check('contractor ot_wages 0 (no separate OT)', bc.ot_wages === 0, `${bc.ot_wages}`)
  check('contractor ot_hours 0 (folded into regular)', bc.ot_hours === 0, `${bc.ot_hours}`)
  check('contractor regular_hours 50 (40+10 folded)', bc.regular_hours === 50, `${bc.regular_hours}`)
  check('contractor regular_wages 1000', bc.regular_wages === 1000, `${bc.regular_wages}`)
  check('contractor gross 1000 (unchanged)', bc.gross_pay === 1000, `${bc.gross_pay}`)

  // W2 hourly WITHOUT OT rights (ot_allowed=false): OT folds into regular at straight time.
  //   no premium, no OT column; regular = 50h * 20 = 1000; gross = 1000
  const noOt = calculatePayroll(
    [emp({ id: 'B', name: 'Bo', type: 'hourly', hourly_rate: 20, ot_allowed: false })],
    [entry({ employee_id: 'B', regular_hours: 40, ot_hours: 10 })],
    [], NO_FEES, []
  )
  const bn = get(noOt, 'B')
  check('no-OT-rights ot_wages 0 (no premium)', bn.ot_wages === 0, `${bn.ot_wages}`)
  check('no-OT-rights ot_hours 0 (folded into regular)', bn.ot_hours === 0, `${bn.ot_hours}`)
  check('no-OT-rights regular_hours 50', bn.regular_hours === 50, `${bn.regular_hours}`)
  check('no-OT-rights gross 1000 (not 1100)', bn.gross_pay === 1000, `${bn.gross_pay}`)
}

console.log('\n== 2b. Weekly OT enforced at 40h — imported reg/OT split is ignored ==')
{
  // Mis-split #1: entries say 37 reg + 6 OT, but worked = 43 → engine recomputes 40 reg + 3 OT.
  //   reg 40*20=800; ot 3*20*1.5=90; gross 890.
  const r = calculatePayroll(
    [emp({ id: 'W', name: 'Wk', type: 'hourly', hourly_rate: 20, ot_allowed: true })],
    [entry({ employee_id: 'W', regular_hours: 37, ot_hours: 6 })],
    [], NO_FEES, []
  )
  const w = get(r, 'W')
  check('reg recomputed to 40 (was 37)', w.regular_hours === 40, `${w.regular_hours}`)
  check('ot recomputed to 3 (43−40, was 6)', w.ot_hours === 3, `${w.ot_hours}`)
  check('gross 890 (800 + 90)', w.gross_pay === 890, `${w.gross_pay}`)

  // Mis-split #2: OT while UNDER 40 — 35 reg + 2 OT, worked 37 → 37 reg, 0 OT, no premium.
  const r2 = calculatePayroll(
    [emp({ id: 'U', name: 'Un', type: 'hourly', hourly_rate: 20, ot_allowed: true })],
    [entry({ employee_id: 'U', regular_hours: 35, ot_hours: 2 })],
    [], NO_FEES, []
  )
  const u = get(r2, 'U')
  check('under-40: OT zeroed (was 2)', u.ot_hours === 0, `${u.ot_hours}`)
  check('under-40: reg = 37 worked', u.regular_hours === 37, `${u.regular_hours}`)
  check('under-40: gross 740 (37*20, no premium)', u.gross_pay === 740, `${u.gross_pay}`)

  // Split across rows still totals correctly: 39.16 reg + 1.61 OT = 40.77 worked → 40 reg + 0.77 OT.
  const r3 = calculatePayroll(
    [emp({ id: 'J', name: 'Jo', type: 'hourly', hourly_rate: 19.5, ot_allowed: true })],
    [entry({ employee_id: 'J', regular_hours: 39.16, ot_hours: 1.61 })],
    [], NO_FEES, []
  )
  const j = get(r3, 'J')
  check('40.77 worked → reg 40', j.regular_hours === 40, `${j.regular_hours}`)
  check('40.77 worked → ot 0.77', near(j.ot_hours, 0.77), `${j.ot_hours}`)
}

console.log('\n== 3. Adjustments: phone adds, advance/deduction SUBTRACT ==')
{
  // hourly_rate 0, no hours. Adjustments only.
  //  phone   +8  → phone_reimbursement = 8
  //  tool    +50 → other_adjustments  (adds)
  //  expense +30 → other_adjustments  (adds)  => other = 80
  //  advance  100 → advances += |100| = 100  (subtracts)
  //  deduction_other -25 → advances += |−25| = 25  => advances = 125
  // gross = 0 + 0 + 8 + 80 − 125 = −37  (gross CAN go negative)
  const r = calculatePayroll(
    [emp({ id: 'C', name: 'Cy', hourly_rate: 0 })],
    [],
    [
      adj({ employee_id: 'C', type: 'phone', amount: 8 }),
      adj({ employee_id: 'C', type: 'tool', amount: 50 }),
      adj({ employee_id: 'C', type: 'expense_reimbursement', amount: 30 }),
      adj({ employee_id: 'C', type: 'advance', amount: 100 }),
      adj({ employee_id: 'C', type: 'deduction_other', amount: -25 }),
    ],
    NO_FEES, []
  )
  const c = get(r, 'C')
  check('phone_reimbursement 8', c.phone_reimbursement === 8, `${c.phone_reimbursement}`)
  check('other_adjustments 80 (tool+expense)', c.other_adjustments === 80, `${c.other_adjustments}`)
  check('advances 125 (advance + |deduction|)', c.advances === 125, `${c.advances}`)
  check('gross −37 (advances subtract; gross can be negative)', c.gross_pay === -37, `${c.gross_pay}`)
}

console.log('\n== 4. Salaried: weekly_rate, ignores hours ==')
{
  // type salaried, weekly_rate 1500, has a 40h entry — entry hours ignored for wages
  const r = calculatePayroll(
    [emp({ id: 'D', name: 'Di', type: 'salaried', weekly_rate: 1500, hourly_rate: 99 })],
    [entry({ employee_id: 'D', regular_hours: 40 })],
    [], NO_FEES, []
  )
  const d = get(r, 'D')
  check('regular_wages 1500 (weekly_rate, NOT 40*99)', d.regular_wages === 1500, `${d.regular_wages}`)
  check('gross 1500', d.gross_pay === 1500, `${d.gross_pay}`)
}

console.log('\n== 4b. Salaried is exempt: OT hours pay nothing ==')
{
  // salaried weekly_rate 1500, entry with 5 OT hrs.
  // otMultiplier(salaried)=0 → ot_wages = 5*20*0 = 0; regular overwritten to 1500.
  // gross = 1500 (no OT leak — the prior straight-rate leak is fixed).
  const r = calculatePayroll(
    [emp({ id: 'E', name: 'Ed', type: 'salaried', weekly_rate: 1500, hourly_rate: 20 })],
    [entry({ employee_id: 'E', regular_hours: 40, ot_hours: 5 })],
    [], NO_FEES, []
  )
  const e = get(r, 'E')
  check('salaried regular_wages 1500', e.regular_wages === 1500, `${e.regular_wages}`)
  check('salaried ot_wages 0 (exempt — no OT leak)', e.ot_wages === 0, `${e.ot_wages}`)
  check('salaried gross 1500', e.gross_pay === 1500, `${e.gross_pay}`)
}

console.log('\n== 5. pay_tax / wc flags off → no burden ==')
{
  // 10h @ $30 = 300 gross; flags false → tax 0, wc 0
  const r = calculatePayroll(
    [emp({ id: 'F', name: 'Fi', hourly_rate: 30, pay_tax: false, wc: false })],
    [entry({ employee_id: 'F', regular_hours: 10 })],
    [], NO_FEES, []
  )
  const f = get(r, 'F')
  check('gross 300', f.gross_pay === 300, `${f.gross_pay}`)
  check('payroll_tax 0 (pay_tax=false)', f.payroll_tax === 0, `${f.payroll_tax}`)
  check('workers_comp 0 (wc=false)', f.workers_comp === 0, `${f.workers_comp}`)
}

console.log('\n== 6. Multi-entry aggregation + run totals ==')
{
  // A: two entries 16h + 24h @ $25 → 40h → 1000 gross; pay_tax+wc on
  // F: 10h @ $30 → 300 gross; no tax/wc
  // totals: gross 1300; tax = 1000*0.08 = 80; wc = 1000*0.03 = 30
  // required_prefund = 1300+80+30 = 1410
  const r = calculatePayroll(
    [
      emp({ id: 'A', name: 'Al', hourly_rate: 25, pay_tax: true, wc: true }),
      emp({ id: 'F', name: 'Fi', hourly_rate: 30 }),
    ],
    [
      entry({ employee_id: 'A', regular_hours: 16 }),
      entry({ employee_id: 'A', regular_hours: 24 }),
      entry({ employee_id: 'F', regular_hours: 10 }),
    ],
    [], NO_FEES, []
  )
  check('A aggregated to 40h', get(r, 'A').regular_hours === 40)
  check('total_gross_pay 1300', r.total_gross_pay === 1300, `${r.total_gross_pay}`)
  check('total_payroll_tax 80', r.total_payroll_tax === 80, `${r.total_payroll_tax}`)
  check('total_workers_comp 30', r.total_workers_comp === 30, `${r.total_workers_comp}`)
  check('required_prefund 1410', r.required_prefund === 1410, `${r.required_prefund}`)
}

console.log('\n== 7. Property labor, unit-weighted spread, property mgmt fee ==')
{
  // P1 10 units, P2 30 units → 40 total
  // A is W2 hourly @ $25, entry 40 reg + 4 OT on P1
  //   labor P1 = 40*25 + 4*25*1.5 = 1000 + 150 = 1150  (OT premium in labor)
  // spread = phone(8) + tool(32) = 40
  //   spread P1 = 10/40*40 = 10 ; spread P2 = 30/40*40 = 30
  // mgmt 0.10: P1 = (1150+10)*.1 = 116 ; P2 = (0+30)*.1 = 3
  // P1 total = 1276, cost/unit 127.6 ; P2 total = 33, cost/unit 1.1
  const P1 = prop({ id: 'P1', code: 'P1', total_units: 10 })
  const P2 = prop({ id: 'P2', code: 'P2', total_units: 30 })
  const r = calculatePayroll(
    [emp({ id: 'A', name: 'Al', type: 'hourly', hourly_rate: 25 }), emp({ id: 'X', name: 'Xi', hourly_rate: 0 })],
    [entry({ employee_id: 'A', regular_hours: 40, ot_hours: 4, property_id: 'P1' })],
    [
      adj({ employee_id: 'X', type: 'phone', amount: 8 }),
      adj({ employee_id: 'X', type: 'tool', amount: 32 }),
    ],
    NO_FEES, [P1, P2]
  )
  const p1 = r.property_costs.find((p) => p.property_id === 'P1')!
  const p2 = r.property_costs.find((p) => p.property_id === 'P2')!
  check('P1 labor 1150 (OT premium in labor: 1000 + 4*25*1.5)', p1.labor_cost === 1150, `${p1.labor_cost}`)
  check('P1 spread 10', near(p1.spread_cost, 10), `${p1.spread_cost}`)
  check('P2 spread 30', near(p2.spread_cost, 30), `${p2.spread_cost}`)
  check('P1 mgmt_fee 116', near(p1.mgmt_fee, 116), `${p1.mgmt_fee}`)
  check('P1 total_cost 1276', near(p1.total_cost, 1276), `${p1.total_cost}`)
  check('P1 cost_per_unit 127.6', near(p1.cost_per_unit, 127.6), `${p1.cost_per_unit}`)
  check('P2 total_cost 33', near(p2.total_cost, 33), `${p2.total_cost}`)
}

console.log('\n== 8. getMgmtFeeRate: override / global / default ==')
{
  const cfgs = [
    feeCfg({ rate_pct: 0.12, effective_date: '2025-01-01', portfolio_id: null }),
    feeCfg({ rate_pct: 0.15, effective_date: '2025-01-01', portfolio_id: 'PF-X' }),
    feeCfg({ rate_pct: 0.99, effective_date: '2999-01-01', portfolio_id: null }), // future → ignored
  ]
  check('portfolio override 0.15', getMgmtFeeRate('PF-X', cfgs) === 0.15, `${getMgmtFeeRate('PF-X', cfgs)}`)
  check('unknown portfolio → global 0.12', getMgmtFeeRate('PF-Y', cfgs) === 0.12, `${getMgmtFeeRate('PF-Y', cfgs)}`)
  check('null portfolio → global 0.12', getMgmtFeeRate(null, cfgs) === 0.12, `${getMgmtFeeRate(null, cfgs)}`)
  check('future effective_date ignored (not 0.99)', getMgmtFeeRate(null, cfgs) !== 0.99)
  check('no config → default 0.10', getMgmtFeeRate(null, NO_FEES) === 0.10, `${getMgmtFeeRate(null, NO_FEES)}`)
}

console.log('\n== 9. Rounding to the cent ==')
{
  // 7h @ $14.285 = 99.995 → round half-up → 100.00
  const r = calculatePayroll(
    [emp({ id: 'G', name: 'Gi', hourly_rate: 14.285 })],
    [entry({ employee_id: 'G', regular_hours: 7 })],
    [], NO_FEES, []
  )
  check('99.995 → 100.00 (round half up)', get(r, 'G').gross_pay === 100, `${get(r, 'G').gross_pay}`)
}

console.log('\n== 9b. Overhead-spread labor (e.g. "Office"): PAID, billed by unit-spread ==')
{
  // O is W2 hourly @ $20. Two entries:
  //   - 30 reg on P1 (direct labor)              → paid 30*20 = 600, billed direct to P1
  //   - 10 reg + 2 OT, is_overhead_spread, no property (the "Office" rows)
  //       paid  = 10*20 + 2*20*1.5 = 200 + 60 = 260  (worker IS paid — not dropped)
  //       spread basis = same 260, split P1:P2 by units 10:30 → P1 65, P2 195
  // P1 10 units, P2 30 units → 40 total.
  //   P1 labor = 600 (direct only; the office row is NOT direct-billed)
  //   P1 spread = 10/40*260 = 65 ; P2 spread = 30/40*260 = 195
  // gross O = 600 + 260 = 860 (all hours paid)
  const P1 = prop({ id: 'P1', code: 'P1', total_units: 10 })
  const P2 = prop({ id: 'P2', code: 'P2', total_units: 30 })
  const r = calculatePayroll(
    [emp({ id: 'O', name: 'Of', type: 'hourly', hourly_rate: 20 })],
    [
      entry({ employee_id: 'O', regular_hours: 30, property_id: 'P1' }),
      entry({ employee_id: 'O', regular_hours: 10, ot_hours: 2, property_id: null, is_overhead_spread: true }),
    ],
    [], NO_FEES, [P1, P2]
  )
  const o = get(r, 'O')
  check('overhead hours PAID (gross 860, not dropped to 600)', o.gross_pay === 860, `${o.gross_pay}`)
  check('regular_hours include office reg (40)', o.regular_hours === 40, `${o.regular_hours}`)
  check('ot_hours include office OT (2)', o.ot_hours === 2, `${o.ot_hours}`)
  const p1 = r.property_costs.find((p) => p.property_id === 'P1')!
  const p2 = r.property_costs.find((p) => p.property_id === 'P2')!
  check('P1 labor 600 (office NOT direct-billed)', p1.labor_cost === 600, `${p1.labor_cost}`)
  check('P1 spread 65 (10/40 of 260)', near(p1.spread_cost, 65), `${p1.spread_cost}`)
  check('P2 spread 195 (30/40 of 260)', near(p2.spread_cost, 195), `${p2.spread_cost}`)
}

console.log('\n== 9c. Administrative (spread) broken down by department ==')
{
  // Salaried S @ $150/wk, split 50% Acquisitions / 50% Maintenance.
  // No hourly direct labor, no overhead/adjustments → spread pool = 150 (all salaried).
  // P1 10 units, P2 30 units → 40 total.
  //   P1 spread = 10/40*150 = 37.50 ; P2 spread = 30/40*150 = 112.50
  // Each property's spread splits by the same 50/50 mix:
  //   P1: Acquisitions 18.75, Maintenance 18.75
  //   P2: Acquisitions 56.25, Maintenance 56.25
  const P1 = prop({ id: 'P1', code: 'P1', total_units: 10 })
  const P2 = prop({ id: 'P2', code: 'P2', total_units: 30 })
  const r = calculatePayroll(
    [emp({ id: 'S', name: 'Sa', type: 'salaried', weekly_rate: 150 })],
    [], [], NO_FEES, [P1, P2], [],
    { S: [{ department: 'Acquisitions', pct: 0.5 }, { department: 'Maintenance', pct: 0.5 }] },
  )
  const p1 = r.property_costs.find((p) => p.property_id === 'P1')!
  const p2 = r.property_costs.find((p) => p.property_id === 'P2')!
  const acq1 = p1.spread_by_dept.find((d) => d.department === 'Acquisitions')!
  const mnt1 = p1.spread_by_dept.find((d) => d.department === 'Maintenance')!
  check('P1 spread 37.50', near(p1.spread_cost, 37.5), `${p1.spread_cost}`)
  check('P1 Acquisitions 18.75', near(acq1.amount, 18.75), `${acq1.amount}`)
  check('P1 Maintenance 18.75', near(mnt1.amount, 18.75), `${mnt1.amount}`)
  check('P1 sub-lines sum to spread', near(p1.spread_by_dept.reduce((s, d) => s + d.amount, 0), p1.spread_cost))
  const acq2 = p2.spread_by_dept.find((d) => d.department === 'Acquisitions')!
  check('P2 Acquisitions 56.25', near(acq2.amount, 56.25), `${acq2.amount}`)
  check('no Other bucket (fully split)', !p2.spread_by_dept.some((d) => d.department === 'Other'))
}

console.log('\n== 9d. Unsplit salaried + overhead fall into Other ==')
{
  // Salaried S @ $100/wk with NO split, plus overhead labor O: 10 reg @ $20 = 200.
  // spread pool = 100 (salaried) + 200 (overhead) = 300, all → 'Other'.
  // Single property P1 bears the whole 300.
  const P1 = prop({ id: 'P1', code: 'P1', total_units: 10 })
  const r = calculatePayroll(
    [
      emp({ id: 'S', name: 'Sa', type: 'salaried', weekly_rate: 100 }),
      emp({ id: 'O', name: 'Of', type: 'hourly', hourly_rate: 20 }),
    ],
    [entry({ employee_id: 'O', regular_hours: 10, property_id: null, is_overhead_spread: true })],
    [], NO_FEES, [P1], [],
    {}, // no splits supplied
  )
  const p1 = r.property_costs.find((p) => p.property_id === 'P1')!
  check('P1 spread 300', near(p1.spread_cost, 300), `${p1.spread_cost}`)
  check('one bucket, all Other', p1.spread_by_dept.length === 1 && p1.spread_by_dept[0].department === 'Other')
  check('Other amount 300', near(p1.spread_by_dept[0].amount, 300), `${p1.spread_by_dept[0]?.amount}`)
}

console.log('\n== 10. config constants are what the math assumes ==')
{
  check('PAYROLL_TAX_RATE = 0.08', PAYROLL_TAX_RATE === 0.08, `${PAYROLL_TAX_RATE}`)
  check('WORKERS_COMP_RATE = 0.03', WORKERS_COMP_RATE === 0.03, `${WORKERS_COMP_RATE}`)
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
