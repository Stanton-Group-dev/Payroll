/**
 * One-off recovery: the unique index payroll_time_entries_workyard_identity_uniq
 * omitted cost_code, so paired Workyard cost-allocation legs (OFFICE + SHOWINGS) with
 * near-equal hours collided on import and the second leg was silently dropped
 * (see migration 20260623_04). The index is now fixed; this re-derives the week's
 * expected legs via the APP'S OWN fetchWorkyardTimecards (identical splitting), diffs
 * against what's stored, and emits INSERT … ON CONFLICT DO NOTHING for the dropped
 * legs — only for timecards untouched by manual corrections (touched cards are listed
 * for manual review so we never resurrect a moved leg and double-count).
 *
 * Read-only by default: prints the diff and writes scripts/recover-0615-inserts.sql.
 * It does NOT touch the DB — inserts are run separately after review.
 *
 *   npx tsx scripts/recover-0615-dropped-legs.mts
 *
 * Requires scripts/_db-context-0615.json (employees, S-properties, entries,
 * touched_timecards) produced from the DB, and Workyard creds in .env.local.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const WEEK_START = '2026-06-15'
const WEEK_ID = 'f326df99-27b2-49f7-b90a-cf18fc74d7b4'

// --- load .env.local creds into process.env BEFORE importing workyard-api ---
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
process.env.WORKYARD_MOCK = '0'

const r2 = (n: number) => Math.round(n * 100) / 100
const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const SPREAD = ['office']
const OVERHEAD = ['unallocated', 'stanton management', 'stanton management llc']
const sq = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`)

interface DbCtx {
  employees: { id: string; name: string; wy: string | null }[]
  properties: { id: string; code: string }[]
  touched_timecards: string[] | null
  entries: {
    id: string; emp: string; tc: string | null; prop: string | null; date: string
    reg: string; ot: string; pto: string; src: string; active: boolean
    cc: string | null; ccn: string | null
  }[]
}

const ctx: DbCtx = JSON.parse(readFileSync('scripts/_db-context-0615.json', 'utf8'))
const touched = new Set((ctx.touched_timecards ?? []).map(String))

const empByWy = new Map(ctx.employees.filter(e => e.wy).map(e => [e.wy!.toLowerCase(), e]))
const empByName = new Map(ctx.employees.map(e => [normalizeName(e.name), e]))
const empByFirst = new Map(ctx.employees.map(e => [normalizeName(e.name).split(' ')[0], e]))
const propByCode = new Map(ctx.properties.map(p => [p.code.toLowerCase(), p]))

// Group key at (timecard, property, cost-code) granularity — NOT exact hours.
// The collision dropped a leg with a DIFFERENT cost code (OFFICE vs SHOWINGS) at the
// same property, so a missing leg shows up as a (prop,cc) group with fewer stored rows
// than expected. Matching on exact 2-dp hours would mis-flag ~1-cent split drift on a
// surviving leg as a new "dropped" leg and double-insert it.
const grp = (emp: string, tc: string, prop: string | null, date: string, cc: string | null) =>
  [emp, tc, prop ?? '_', date, cc ?? ''].join('|')

// stored legs grouped (active, workyard-sourced only — the index scope)
const storedByGrp = new Map<string, { reg: number; ot: number }[]>()
const storedByTc = new Map<string, number>() // tc -> stored active reg+ot total
for (const e of ctx.entries) {
  if (!e.tc) continue
  if (e.active && (e.src === 'workyard' || e.src === 'workyard_api')) {
    const g = grp(e.emp, e.tc, e.prop, e.date, e.cc)
    if (!storedByGrp.has(g)) storedByGrp.set(g, [])
    storedByGrp.get(g)!.push({ reg: +e.reg, ot: +e.ot })
  }
  if (e.active) storedByTc.set(e.tc, (storedByTc.get(e.tc) ?? 0) + +e.reg + +e.ot)
}

async function main() {
  const { fetchWorkyardTimecards } = await import('../src/lib/payroll/workyard-api.ts')
  const { rows } = await fetchWorkyardTimecards(WEEK_START, false)

  // resolve each expected row the way the import's matchRows does
  type Leg = {
    emp: string; empName: string; tc: string; date: string; prop: string | null
    reg: number; ot: number; pto: number; cc: string; ccn: string
    spread: boolean; flagged: boolean; flag: string | null; scode: string
  }
  const expected: Leg[] = []
  const cardTotal = new Map<string, number>() // tc -> expected reg+ot total
  let unmatchedEmp = 0
  for (const row of rows) {
    const emp =
      (row.workyardId ? empByWy.get(row.workyardId.toLowerCase()) : undefined) ??
      (row.employeeName ? empByName.get(normalizeName(row.employeeName)) : undefined) ??
      (row.employeeName ? empByFirst.get(normalizeName(row.employeeName).split(' ')[0]) : undefined)
    if (!emp) { unmatchedEmp++; continue }
    const name = row.projectName ?? ''
    const spread = SPREAD.includes(name.trim().toLowerCase())
    const overhead = OVERHEAD.some(n => name.toLowerCase().includes(n))
    const prop = propByCode.get(name.toLowerCase())
    let flagged = false, flag: string | null = null
    if (spread) { /* ok */ }
    else if (overhead) { flagged = true; flag = `Overhead property: "${name}" — needs redistribution` }
    else if (!prop) { flagged = true; flag = `Property "${name}" not found in system` }
    const propId = spread ? null : prop?.id ?? null
    cardTotal.set(row.timecardId, (cardTotal.get(row.timecardId) ?? 0) + r2(row.regularHours) + r2(row.otHours))
    expected.push({
      emp: emp.id, empName: emp.name, tc: row.timecardId, date: row.entryDate, prop: propId,
      reg: r2(row.regularHours), ot: r2(row.otHours), pto: r2(row.ptoHours),
      cc: row.costCode || '', ccn: row.costCodeName || '', spread, flagged, flag, scode: name,
    })
  }

  // diff on CLEAN timecards only, grouped by (emp,tc,prop,cc): within each group, pair
  // every stored leg to its closest-hours expected leg (tolerating split drift); the
  // expected legs left unpaired are the genuinely dropped ones. Touched cards reported
  // separately and never auto-inserted.
  const expByGrp = new Map<string, Leg[]>()
  for (const leg of expected) {
    if (touched.has(leg.tc)) continue
    const g = grp(leg.emp, leg.tc, leg.prop, leg.date, leg.cc || null)
    if (!expByGrp.has(g)) expByGrp.set(g, [])
    expByGrp.get(g)!.push(leg)
  }
  const toInsert: Leg[] = []
  const touchedShortfall = new Map<string, number>()
  for (const [g, legs] of expByGrp) {
    const stored = (storedByGrp.get(g) ?? []).slice()
    const pool = legs.slice()
    for (const s of stored) {
      let bi = -1, best = Infinity
      for (let i = 0; i < pool.length; i++) {
        const d = Math.abs(pool[i].reg - s.reg) + Math.abs(pool[i].ot - s.ot)
        if (d < best) { best = d; bi = i }
      }
      if (bi >= 0) pool.splice(bi, 1) // this stored leg accounts for one expected leg
    }
    toInsert.push(...pool) // unpaired expected legs = dropped
  }
  for (const [tc, exp] of cardTotal) {
    if (!touched.has(tc)) continue
    const sh = r2(exp - (storedByTc.get(tc) ?? 0))
    if (sh > 0.01) touchedShortfall.set(tc, sh)
  }

  // ---- report ----
  const empName = new Map(ctx.employees.map(e => [e.id, e.name]))
  const byEmp = new Map<string, { rows: Leg[]; hrs: number }>()
  for (const l of toInsert) {
    const g = byEmp.get(l.emp) ?? { rows: [], hrs: 0 }
    g.rows.push(l); g.hrs += l.reg + l.ot; byEmp.set(l.emp, g)
  }
  console.log(`\n=== Recover dropped legs — week ${WEEK_START} ===`)
  console.log(`Workyard expected legs: ${expected.length} (unmatched employee: ${unmatchedEmp})`)
  console.log(`Clean-timecard legs to INSERT: ${toInsert.length}`)
  let totalHrs = 0
  for (const [emp, g] of [...byEmp.entries()].sort((a, b) => b[1].hrs - a[1].hrs)) {
    totalHrs += g.hrs
    console.log(`\n  ${empName.get(emp)}  +${r2(g.hrs)}h  (${g.rows.length} legs)`)
    for (const l of g.rows.sort((a, b) => a.date.localeCompare(b.date))) {
      console.log(`    ${l.date}  ${(l.scode || '(unalloc)').padEnd(10)} ${l.ccn.padEnd(20)} ` +
        `reg ${l.reg.toFixed(2)} ot ${l.ot.toFixed(2)}` +
        `${l.spread ? ' [spread]' : ''}${l.flagged ? ' [flagged]' : ''}`)
    }
  }
  console.log(`\nTOTAL hours recovered: ${r2(totalHrs)}`)
  if (touchedShortfall.size) {
    console.log(`\n⚠ Touched timecards with a shortfall (NOT auto-inserted — manual review):`)
    for (const [tc, sh] of touchedShortfall) console.log(`    card ${tc}: missing ~${sh}h`)
  }

  // ---- emit SQL (not executed here) ----
  const sql = [
    `-- Recovery inserts for week ${WEEK_START} (${toInsert.length} dropped legs).`,
    `-- Idempotent: ON CONFLICT DO NOTHING bounces off any already-present row.`,
    ...toInsert.map(l =>
      `insert into payroll_time_entries ` +
      `(payroll_week_id, employee_id, property_id, entry_date, regular_hours, ot_hours, pto_hours, ` +
      `miles, source, workyard_timecardid, is_flagged, flag_reason, is_overhead_spread, cost_code, cost_code_name) values (` +
      `'${WEEK_ID}', '${l.emp}', ${l.prop ? `'${l.prop}'` : 'null'}, '${l.date}', ` +
      `${l.reg}, ${l.ot}, ${l.pto}, 0, 'workyard_api', '${l.tc}', ${l.flagged}, ${sq(l.flag)}, ` +
      `${l.spread}, ${sq(l.cc || null)}, ${sq(l.ccn || null)}) on conflict do nothing;`),
  ].join('\n')
  writeFileSync('scripts/recover-0615-inserts.sql', sql + '\n')
  console.log(`\nWrote scripts/recover-0615-inserts.sql (${toInsert.length} statements) — not yet executed.`)
}

main().catch(e => { console.error(e); process.exit(1) })
