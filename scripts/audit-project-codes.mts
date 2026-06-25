// READ-ONLY audit: flag anomalies in project↔cost-code wiring so we can spot any
// accidental UI edits. Expectation:
//  - BUILDING projects (name starts "S#### ") carry the ~13 standard codes
//    (12 activities + their own S-code material code) — NOT the full 67.
//  - MATERIAL-SOURCE / vendor locations carry all 67 material codes.
// Anything off-pattern is printed. Run: npx tsx scripts/audit-project-codes.mts
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
async function getAll<T>(path: string): Promise<T[]> {
  const out: T[] = []; let page = 1
  while (true) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${BASE}${path}${sep}limit=100&page=${page}`, { headers: H })
    if (!res.ok) break
    const j: any = await res.json(); out.push(...(j.data ?? []))
    if (page >= (j.meta?.last_page ?? 1)) break; page++
  }
  return out
}
const costCodes = await getAll<any>(`/orgs/${ORG}/cost_codes`)
const byId = new Map(costCodes.map(c => [c.id, c]))
const materialIds = new Set(costCodes.filter(c => /^\s*S\d+/i.test(String(c.code ?? ''))).map(c => c.id))
const activityIds = new Set(costCodes.filter(c => !/^\s*S\d+/i.test(String(c.code ?? ''))).map(c => c.id))
const ownMatId = (sCode: string) => costCodes.find(c => String(c.code ?? '').toUpperCase() === sCode.toUpperCase())?.id

const projects = await getAll<any>(`/orgs/${ORG}/projects?include=cost_codes`)
// Known intended material-source locations (full 67 expected).
const VENDOR_IDS = new Set([399502, 411676, 413145, 413143, 413137, 677518, 677520, 677521, 677524, 677526, 413144])

console.log(`projects=${projects.length}  material codes=${materialIds.size}  activity codes=${activityIds.size}\n`)
const anomalies: string[] = []

for (const p of projects) {
  const ids: number[] = p.cost_code_ids ?? []
  const mat = ids.filter(id => materialIds.has(id)).length
  const act = ids.filter(id => activityIds.has(id)).length
  const sMatch = String(p.name).match(/^(S\d+)\b/i)
  const isBuilding = !!sMatch && !VENDOR_IDS.has(p.id)
  const isVendor = VENDOR_IDS.has(p.id)

  if (isVendor) {
    if (mat !== materialIds.size) anomalies.push(`VENDOR  ${p.id} ${p.name}: ${mat}/${materialIds.size} material (expected full)`)
  } else if (isBuilding) {
    const own = ownMatId(sMatch![1])
    const hasOwn = own != null && ids.includes(own)
    // A building should carry ONLY its own material code (mat===1) + activities, not the bulk set.
    if (mat > 2) anomalies.push(`BUILDING ${p.id} ${p.name}: carries ${mat} material codes (expected 1 — its own ${sMatch![1]})`)
    if (!hasOwn) anomalies.push(`BUILDING ${p.id} ${p.name}: MISSING its own material code ${sMatch![1]}`)
    if (act < 11) anomalies.push(`BUILDING ${p.id} ${p.name}: only ${act} activity codes (expected ~12)`)
  } else {
    // Non-S, non-known-vendor project — just note if it unexpectedly holds the bulk material set.
    if (mat > 5) anomalies.push(`OTHER   ${p.id} ${p.name}: holds ${mat} material codes — is this a material-source location? (not in known vendor set)`)
  }
}

if (anomalies.length === 0) console.log('✅ no anomalies — every project matches the expected pattern.')
else { console.log(`⚠️ ${anomalies.length} anomalies:\n`); for (const a of anomalies) console.log('  ' + a) }
