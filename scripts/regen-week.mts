// scripts/regen-week.mts
//
// One-off admin tool: recompute and re-store payroll_weekly_property_costs for a week,
// using the SAME engine + data path as the in-app review/approve flow — so the stored
// snapshot matches the live statement (now including employer payroll tax + WC, the
// suppressed-placeholder spread, and the consolidated owner LLCs).
//
//   Dry run (summary only, no writes):
//     infisical run --projectId=b974f539-54dc-4687-9afd-941d95d434c9 --env=prod -- \
//       npx tsx scripts/regen-week.mts <weekId>
//
//   Write (delete + reinsert the week's cost rows):
//     ... npx tsx scripts/regen-week.mts <weekId> --write
//
// Requires SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). For --write the week must be
// UNLOCKED first (status NOT in payroll_approved/invoiced/statement_sent), else the DB
// lock trigger rejects the write — unlock/relock is done out-of-band via the Supabase MCP.

import { createClient } from '@supabase/supabase-js'
import { calculatePayroll, resolveRateAsOf } from '../src/lib/payroll/calculations.ts'
import {
  curatedToProperty,
  CURATED_PROPERTY_COLUMNS,
  isNonBillableProperty,
  type CuratedPropertyRow,
} from '../src/lib/payroll/properties.ts'

const weekId = process.argv[2]
const doWrite = process.argv.includes('--write')
if (!weekId) {
  console.error('usage: regen-week <weekId> [--write]')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via infisical).')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })
const money = (n: number) => '$' + n.toFixed(2)

async function main() {
  // ---- Load all inputs, mirroring usePayrollWeekReview.load() exactly ----
  const [week, emp, ent, adj, fee, prop, mileage, holds, defSplits, ovSplits, rates, gc] =
    await Promise.all([
      sb.from('payroll_weeks').select('*').eq('id', weekId).single(),
      sb.from('payroll_employees').select('*').eq('is_active', true),
      sb.from('payroll_time_entries').select('*').eq('payroll_week_id', weekId).eq('is_flagged', false).eq('is_active', true),
      sb.from('payroll_adjustments').select('*').eq('payroll_week_id', weekId).eq('is_active', true),
      sb.from('payroll_management_fee_config').select('*').order('effective_date', { ascending: false }),
      sb.from('payroll_property').select(CURATED_PROPERTY_COLUMNS).eq('is_active', true),
      sb.from('payroll_mileage_reimbursements').select('*').eq('payroll_week_id', weekId),
      sb.from('payroll_employee_holds').select('employee_id, status').eq('payroll_week_id', weekId).in('status', ['held', 'waived']),
      sb.from('payroll_employee_dept_splits').select('employee_id, department, allocation_pct, effective_date'),
      sb.from('payroll_dept_split_overrides').select('employee_id, department, allocation_pct').eq('payroll_week_id', weekId).eq('is_active', true),
      sb.from('payroll_employee_rates').select('*'),
      sb.from('payroll_global_config').select('prefund_includes_mgmt_fee, payroll_tax_rate, workers_comp_rate, phone_reimbursement_amount, ot_threshold_hours').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
  for (const r of [week, emp, ent, adj, fee, prop, mileage, holds, defSplits, ovSplits, rates, gc]) {
    if (r.error) throw new Error(r.error.message)
  }

  const weekStart: string = week.data!.week_start
  const held = new Set((holds.data ?? []).filter(h => h.status === 'held').map(h => h.employee_id))
  const waived = new Set((holds.data ?? []).filter(h => h.status === 'waived').map(h => h.employee_id))

  const employees = (emp.data ?? []).filter(e => !held.has(e.id))
  const entries = (ent.data ?? []).filter(
    e => e.property_id != null || ((e.regular_hours ?? 0) + (e.ot_hours ?? 0)) <= 0 || !waived.has(e.employee_id),
  )
  const properties = (prop.data ?? []).map(r => curatedToProperty(r as unknown as CuratedPropertyRow))
  const propById = new Map(properties.map(p => [p.id, p]))

  // Resolve salaried dept splits (override wins; else latest default effective ≤ weekStart).
  const ovByEmp: Record<string, typeof ovSplits.data> = {}
  for (const o of (ovSplits.data ?? [])) (ovByEmp[o.employee_id] ??= []).push(o)
  const defByEmp: Record<string, typeof defSplits.data> = {}
  for (const d of (defSplits.data ?? [])) {
    if (weekStart && d.effective_date && d.effective_date > weekStart) continue
    ;(defByEmp[d.employee_id] ??= []).push(d)
  }
  const salariedDeptSplits: Record<string, { department: string; pct: number }[]> = {}
  for (const e of employees) {
    if (e.type !== 'salaried') continue
    const ov = ovByEmp[e.id]
    if (ov?.length) { salariedDeptSplits[e.id] = ov.map(o => ({ department: o.department, pct: Number(o.allocation_pct) })); continue }
    const def = defByEmp[e.id]
    if (def?.length) {
      const latest = def.reduce((m, d) => (d.effective_date && d.effective_date > m ? d.effective_date : m), '')
      salariedDeptSplits[e.id] = def.filter(d => (d.effective_date ?? '') === latest).map(d => ({ department: d.department, pct: Number(d.allocation_pct) }))
    }
  }

  const cfg = gc.data
  const rateSettings = cfg ? {
    payrollTaxRate: cfg.payroll_tax_rate ?? 0.08,
    workersCompRate: cfg.workers_comp_rate ?? 0.03,
    phoneAmount: cfg.phone_reimbursement_amount ?? 8,
    otThresholdHours: cfg.ot_threshold_hours ?? 40,
  } : undefined
  const prefundIncludesMgmtFee = cfg?.prefund_includes_mgmt_fee ?? true

  const employeesWithRates = employees.map(e => ({
    ...e,
    hourly_rate: resolveRateAsOf(e.id, weekStart, rates.data ?? [], e.hourly_rate ?? 0),
  }))

  const result = calculatePayroll(
    employeesWithRates, entries, adj.data ?? [], fee.data ?? [], properties,
    mileage.data ?? [], salariedDeptSplits, weekStart, prefundIncludesMgmtFee, rateSettings,
  )

  const costRows = result.property_costs.filter(pc => pc.total_cost > 0).map(pc => ({
    payroll_week_id: weekId,
    property_id: pc.property_id,
    labor_cost: pc.labor_cost,
    spread_cost: pc.spread_cost,
    expense_cost: pc.expense_cost,
    tax_cost: pc.tax_cost,
    wc_cost: pc.wc_cost,
    total_cost: pc.total_cost,
    cost_per_unit: pc.cost_per_unit,
  }))

  // ---- Verification summary ----
  const r2 = (n: number) => Math.round(n * 100) / 100
  const billable = result.property_costs.filter(pc => {
    const p = propById.get(pc.property_id)
    return pc.total_cost > 0 && p && !isNonBillableProperty(p) && p.include_in_invoicing !== false
  })
  const byLlc: Record<string, number> = {}
  for (const pc of billable) {
    const p = propById.get(pc.property_id)!
    const llc = p.billing_llc ?? `Unassigned — ${pc.property_code}`
    byLlc[llc] = (byLlc[llc] ?? 0) + pc.total_cost
  }
  console.log(`\nWeek ${weekStart} (${weekId})`)
  console.log(`  employees=${employees.length}  entries=${entries.length}  properties=${properties.length}`)
  console.log(`  total_gross_pay   = ${money(result.total_gross_pay)}`)
  console.log(`  total_payroll_tax = ${money(result.total_payroll_tax)}`)
  console.log(`  total_workers_comp= ${money(result.total_workers_comp)}`)
  console.log(`  total_mgmt_fee    = ${money(result.total_mgmt_fee)}`)
  console.log(`  required_prefund  = ${money(result.required_prefund)}`)
  console.log(`  Σ stored total_cost (all rows>0) = ${money(r2(costRows.reduce((s, c) => s + c.total_cost, 0)))} (${costRows.length} rows)`)
  console.log(`  Σ tax_cost = ${money(r2(costRows.reduce((s, c) => s + c.tax_cost, 0)))}   Σ wc_cost = ${money(r2(costRows.reduce((s, c) => s + c.wc_cost, 0)))}`)
  console.log(`  Σ BILLABLE total_cost (statement) = ${money(r2(billable.reduce((s, c) => s + c.total_cost, 0)))}`)
  console.log('\n  Statement by billing LLC:')
  for (const [llc, amt] of Object.entries(byLlc).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${money(r2(amt)).padStart(12)}  ${llc}`)
  }

  if (!doWrite) {
    console.log('\nDRY RUN — no changes written. Re-run with --write (week must be unlocked first).')
    return
  }

  // ---- Write: replace the week's cost rows (week must be unlocked) ----
  const del = await sb.from('payroll_weekly_property_costs').delete().eq('payroll_week_id', weekId)
  if (del.error) throw new Error(`delete failed (is the week unlocked?): ${del.error.message}`)
  const ins = await sb.from('payroll_weekly_property_costs').insert(costRows)
  if (ins.error) throw new Error(`insert failed: ${ins.error.message}`)
  console.log(`\nWROTE ${costRows.length} cost rows for week ${weekStart}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
