// One-off: aggregate the Workyard "project time by team member details" CSV export
// for week 6/7–6/14 per employee, so it can be diffed against DB stored totals.
// Run: npx tsx scripts/reconcile-hours-0607.mts "<csv path>"
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) { console.error('pass csv path'); process.exit(1) }

function splitCSV(line: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const text = readFileSync(path, 'utf8')
const lines = text.split(/\r?\n/).filter(l => l.trim())
const headers = splitCSV(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''))
const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase())

const iFirst = idx('First Name'), iLast = idx('Last Name')
const iProj = idx('Project Name'), iLoc = idx('Location'), iCust = idx('Customer Name')
const iReg = idx('Regular Hours'), iOt = idx('OT Hours'), iPto = idx('PTO Hours')
const iTotal = idx('Total Hours'), iTravel = idx('Travel Time'), iMiles = idx('Miles')

const num = (s: string) => { const n = parseFloat((s ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n }

const iStart = idx('Start Date')
interface Agg { reg: number; ot: number; pto: number; total: number; travel: number; miles: number; rows: number;
  unalloc: number; parkHw: number; homeDepot: number; allWaste: number; office: number; sat0613: number; jun14: number }
const byEmp = new Map<string, Agg>()
const projTotals = new Map<string, number>()

for (let i = 1; i < lines.length; i++) {
  const c = splitCSV(lines[i])
  if (c.every(x => !x.trim())) continue
  const name = `${(c[iFirst] ?? '').trim()} ${(c[iLast] ?? '').trim()}`.trim()
  if (!name) continue
  const proj = (c[iProj] ?? '').trim()
  const reg = num(c[iReg]), ot = num(c[iOt]), pto = num(c[iPto])
  const total = num(c[iTotal]), travel = num(c[iTravel]), miles = num(c[iMiles])
  const start = (c[iStart] ?? '')
  const isJun14 = start.includes('June 14') // export spans 6/7–6/14; 6/14 is NEXT payroll week
  const a = byEmp.get(name) ?? { reg: 0, ot: 0, pto: 0, total: 0, travel: 0, miles: 0, rows: 0, unalloc: 0, parkHw: 0, homeDepot: 0, allWaste: 0, office: 0, sat0613: 0, jun14: 0 }
  if (isJun14) { a.jun14 += total; byEmp.set(name, a); continue } // exclude from payroll-week totals
  a.reg += reg; a.ot += ot; a.pto += pto; a.total += total; a.travel += travel; a.miles += miles; a.rows++
  if (start.includes('June 13')) a.sat0613 += total
  const p = proj.toLowerCase()
  if (!proj || p === 'unallocated') a.unalloc += total
  if (p.includes('park hardware')) a.parkHw += total
  if (p.includes('home depot')) a.homeDepot += total
  if (p.includes('all waste')) a.allWaste += total
  if (p === 'office') a.office += total
  byEmp.set(name, a)
  projTotals.set(proj || '(blank)', (projTotals.get(proj || '(blank)') ?? 0) + total)
}

const r2 = (n: number) => Math.round(n * 100) / 100
console.log('\n=== Per-employee CSV source totals — PAYROLL WEEK 6/7–6/13 (6/14 excluded) ===')
console.log('name | WEEK_TOTAL | thru_6/12 | sat_6/13 | [6/14 next wk] | office | parkHw | homeDepot | allWaste | unalloc')
const names = [...byEmp.keys()].sort((a, b) => byEmp.get(b)!.total - byEmp.get(a)!.total)
let gReg = 0, gOt = 0, gPto = 0, gTot = 0, gTrav = 0
for (const n of names) {
  const a = byEmp.get(n)!
  gReg += a.reg; gOt += a.ot; gPto += a.pto; gTot += a.total; gTrav += a.travel
  console.log([n, `tot=${r2(a.total)}`, `reg=${r2(a.reg)}`, `ot=${r2(a.ot)}`, `office=${r2(a.office)}`,
    `6/14=${r2(a.jun14)}`, `parkHw=${r2(a.parkHw)}`, `homeDepot=${r2(a.homeDepot)}`, `allWaste=${r2(a.allWaste)}`].join(' | '))
}
console.log(`\nGRAND: reg ${r2(gReg)} ot ${r2(gOt)} pto ${r2(gPto)} TOTAL ${r2(gTot)} travel ${r2(gTrav)}`)

// --- Travel diagnostic: is travel baked into reg, or separate/additional? ---
console.log('\n=== Travel rows (travel>0.25), top 20 by travel ===')
console.log('start | end | proj | reg | ot | total | travel | travel>total?')
let travelGtTotal = 0, travelRows = 0
const travelDump: { start: string; end: string; proj: string; reg: number; ot: number; total: number; travel: number }[] = []
const iEnd = idx('End Date')
for (let i = 1; i < lines.length; i++) {
  const c = splitCSV(lines[i]); if (c.every(x => !x.trim())) continue
  const travel = num(c[iTravel]); if (travel <= 0) continue
  travelRows++
  const reg = num(c[iReg]), ot = num(c[iOt]), total = num(c[iTotal])
  if (travel > total + 0.001) travelGtTotal++
  travelDump.push({ start: (c[iStart] ?? '').trim(), end: (c[iEnd] ?? '').trim(), proj: (c[iProj] ?? '').trim(), reg, ot, total, travel })
}
for (const d of travelDump.sort((a, b) => b.travel - a.travel).slice(0, 20)) {
  console.log([d.start, d.end, d.proj, r2(d.reg), r2(d.ot), r2(d.total), r2(d.travel), d.travel > d.total ? 'YES' : ''].join(' | '))
}
console.log(`\ntravel rows: ${travelRows}; rows where travel > total(reg+ot+pto): ${travelGtTotal}`)
console.log('(travel never exceeds total ⇒ consistent with travel BAKED INTO reg; any travel>total ⇒ travel is additional)')

console.log('\n=== Hours by project name (top 30) ===')
for (const [p, h] of [...projTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`${r2(h).toString().padStart(8)}  ${p}`)
}
