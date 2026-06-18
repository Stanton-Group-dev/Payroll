// (1) Map S-code -> building name from projects. (2) Find which S-codes have a
// "Material Pickup" cost code vs not (the gap). (3) PROBE whether the API can
// CREATE a cost code (documented POST 404'd) by trying a few variations on the
// first missing S-code. Run: npx tsx scripts/matl-gap-and-create-probe.mts
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function getAll(path: string): Promise<any[]> {
  const out: any[] = []; let page = 1
  while (true) {
    const r = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page}`, { headers: H })
    const j: any = await r.json()
    out.push(...(j.data ?? []))
    if (page >= (j.meta?.last_page ?? 1)) break
    page++
  }
  return out
}

// 1. projects -> S-code => {building, projectId}
const projects = await getAll(`/orgs/${ORG}/projects`)
const sMap = new Map<string, { building: string; pid: number }>()
for (const p of projects) {
  const m = String(p.name ?? '').match(/^(S\d+)\s*[-–]\s*(.+)$/)
  if (m) sMap.set(m[1], { building: m[2].trim(), pid: p.id })
}

// 2. existing material-pickup codes by S-code
const codes = await getAll(`/orgs/${ORG}/cost_codes`)
const haveMatl = new Set(codes.filter(c => /material pickup/i.test(c.name ?? '')).map(c => String(c.code)))

// 3. report gap across S0001..S0067
const missing: { s: string; building: string; pid: number }[] = []
console.log('S-code | has project? | has Material Pickup code? | building')
for (let i = 1; i <= 67; i++) {
  const s = `S${String(i).padStart(4, '0')}`
  const proj = sMap.get(s)
  const has = haveMatl.has(s)
  if (proj && !has) missing.push({ s, building: proj.building, pid: proj.pid })
  if (proj || has) console.log(`  ${s} | ${proj ? 'yes' : 'NO'} | ${has ? 'yes' : 'NO'} | ${proj?.building ?? ''}`)
}
console.log(`\nMISSING material-pickup codes (project exists, no code): ${missing.length}`)
for (const m of missing) console.log(`  ${m.s}  ${m.building}`)

// 4. CREATE probe on the first missing one — try variations; do NOT create the rest
if (missing.length) {
  const t = missing[0]
  const name = `${t.building} - Material Pickup`
  console.log(`\n== CREATE probe: ${t.s} "${name}" ==`)
  const variants: Array<[string, string, any]> = [
    ['POST /cost_codes {name,code,include_all_projects:false,project_ids}', 'POST', { name, code: t.s, include_all_projects: false, project_ids: [t.pid] }],
    ['POST /cost_codes {name,code} minimal', 'POST', { name, code: t.s }],
    ['POST /cost_codes {name,code,cost_code_group_id:null,project_ids}', 'POST', { name, code: t.s, cost_code_group_id: null, include_all_projects: false, project_ids: [t.pid] }],
  ]
  for (const [label, method, body] of variants) {
    const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes`, { method, headers: H, body: JSON.stringify(body) })
    const tx = await r.text(); let j: any = null; try { j = JSON.parse(tx) } catch {}
    console.log(`  ${label} -> ${r.status} ${r.ok ? `OK id=${j?.id}` : tx.slice(0, 160)}`)
    if (r.ok) { console.log(`  >> CREATE WORKS. Created ${t.s}. Stop probe.`); break }
  }
}
