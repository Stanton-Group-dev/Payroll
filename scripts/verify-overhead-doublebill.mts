// scripts/verify-overhead-doublebill.mts
//
// Read-only check for the overhead-flag double-bill fix (DECISIONS_LOG §0.23): runs the
// local engine against a live week's inputs (same loader as regen-week.mts /
// usePayrollWeekReview) and verifies
//   Σ property total_cost = required_prefund + Σ advances
// Also lists the offending entries (is_overhead_spread=true AND property_id set) with the
// wage cost each would have double-billed, and diffs the stored cost rows vs the recompute.
// Writes nothing.
//
//   infisical run --projectId=b974f539-54dc-4687-9afd-941d95d434c9 --env=prod --recursive -- \
//     npx tsx scripts/verify-overhead-doublebill.mts <weekId>
//
// (2026-07-01: the Infisical prod env injected a SUPABASE_SERVICE_ROLE_KEY the Main DB
// rejects — "owned by another project" — and no NEXT_PUBLIC_SUPABASE_URL at all. Until those
// entries are fixed, supply the documented URL inline and a valid service key locally.)

import { createClient } from '@supabase/supabase-js'
import { calculatePayroll, resolveRateAsOf, otMultiplier } from '../src/lib/payroll/calculations.ts'
import {
  curatedToProperty,
  CURATED_PROPERTY_COLUMNS,
  isNonBillableProperty,
  type CuratedPropertyRow,
} from '../src/lib/payroll/properties.ts'

const weekId = process.argv[2]
if (!weekId) { console.error('usage: verify-overhead-doublebill <weekId>'); process.exit(1) }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via infisical).'); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })
const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const [week, emp, ent, adj, fee, prop, mileage, holds, defSplits, ovSplits, rates, gc, stored] =
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
      sb.from('payroll_weekly_property_costs').select('*').eq('payroll_week_id', weekId),
    ])
  for (const r of [week, emp, ent, adj, fee, prop, mileage, holds, defSplits, ovSplits, rates, gc, stored]) {
    if (r.error) throw new Error(r.error.message)
  }

  const weekStart: string = week.data!.week_start
  console.log(`\nWeek ${weekStart} (${weekId}) — status: ${week.data!.status}`)

  const held = new Set((holds.data ?? []).filter(h => h.status === 'held').map(h => h.employee_id))
  const waived = new Set((holds.data ?? []).filter(h => h.status === 'waived').map(h => h.employee_id))
  const employees = (emp.data ?? []).filter(e => !held.has(e.id))
  const entries = (ent.data ?? []).filter(
    e => e.property_id != null || ((e.regular_hours ?? 0) + (e.ot_hours ?? 0)) <= 0 || !waived.has(e.employee_id),
  )
  const properties = (prop.data ?? []).map(r => curatedToProperty(r as unknown as CuratedPropertyRow))
  const propById = new Map(properties.map(p => [p.id, p]))
  const empById = new Map(employees.map(e => [e.id, e]))

  const ovByEmp: Record<string, NonNullable<typeof ovSplits.data>> = {}
  for (const o of (ovSplits.data ?? [])) (ovByEmp[o.employee_id] ??= []).push(o)
  const defByEmp: Record<string, NonNullable<typeof defSplits.data>> = {}
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
  const rateById = new Map(employeesWithRates.map(e => [e.id, e]))

  // ---- The offending rows: flagged for the spread pool but carrying a property ----
  const offenders = entries.filter(e => e.is_overhead_spread && e.property_id)
  let duplicated = 0
  console.log(`\nOverhead-flagged entries WITH a property_id: ${offenders.length}`)
  for (const e of offenders) {
    const emp2 = rateById.get(e.employee_id)
    const rate = emp2 ? (emp2.type === 'salaried' ? 0 : (emp2.hourly_rate ?? 0)) : 0
    const cost = (e.regular_hours ?? 0) * rate +
      (e.ot_hours ?? 0) * rate * (emp2 ? otMultiplier(emp2.type, emp2.department, emp2.ot_allowed) : 1)
    duplicated += cost
    console.log(`  ${e.entry_date}  ${empById.get(e.employee_id)?.name ?? e.employee_id}  ` +
      `${propById.get(e.property_id!)?.code ?? e.property_id}  ` +
      `${(e.regular_hours ?? 0) + (e.ot_hours ?? 0)}h  wage cost ${money(r2(cost))}  (source=${e.source})`)
  }
  console.log(`  → wage cost these rows would have DOUBLE-billed pre-fix: ${money(r2(duplicated))}`)

  // ---- Fixed engine on live inputs ----
  const result = calculatePayroll(
    employeesWithRates, entries, adj.data ?? [], fee.data ?? [], properties,
    mileage.data ?? [], salariedDeptSplits, weekStart, prefundIncludesMgmtFee, rateSettings,
  )
  const billedAll = r2(result.property_costs.reduce((s, p) => s + p.total_cost, 0))
  const advances = r2(result.employee_summaries.reduce((s, e) => s + e.advances, 0))
  const target = r2(result.required_prefund + advances)
  console.log(`\nFIXED engine on live inputs:`)
  console.log(`  Σ property total_cost = ${money(billedAll)}`)
  console.log(`  required_prefund      = ${money(result.required_prefund)}`)
  console.log(`  Σ advances            = ${money(advances)}`)
  console.log(`  prefund + advances    = ${money(target)}`)
  console.log(`  INVARIANT Σ total_cost − (prefund + advances) = ${money(r2(billedAll - target))}`)

  const billable = result.property_costs.filter(pc => {
    const p = propById.get(pc.property_id)
    return pc.total_cost > 0 && p && !isNonBillableProperty(p) && p.include_in_invoicing !== false
  })
  console.log(`  Σ BILLABLE total_cost (statement) = ${money(r2(billable.reduce((s, c) => s + c.total_cost, 0)))}`)

  // ---- Stored snapshot vs recompute ----
  const storedRows = stored.data ?? []
  const storedTotal = r2(storedRows.reduce((s, c) => s + Number(c.total_cost ?? 0), 0))
  const storedSpread = r2(storedRows.reduce((s, c) => s + Number(c.spread_cost ?? 0), 0))
  const newSpread = r2(result.property_costs.reduce((s, p) => s + p.spread_cost, 0))
  console.log(`\nStored payroll_weekly_property_costs (${storedRows.length} rows):`)
  console.log(`  Σ stored total_cost  = ${money(storedTotal)}   (recompute: ${money(billedAll)}, Δ ${money(r2(storedTotal - billedAll))})`)
  console.log(`  Σ stored spread_cost = ${money(storedSpread)}  (recompute: ${money(newSpread)}, Δ ${money(r2(storedSpread - newSpread))})`)
  console.log(`  Stored-vs-(prefund+advances) gap = ${money(r2(storedTotal - target))}`)
}

main().catch(e => { console.error(e); process.exit(1) })
