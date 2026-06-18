// Cost-code cleanup — STEP 2: create the 4 missing activity codes.
// Test DUMP first; only create the rest if it actually associates to projects
// (the picker is driven by project.cost_code_ids). Run: npx tsx scripts/create-new-codes.mts
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function createCode(code: string, name: string) {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name, code, include_all_projects: true }),
  })
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t) } catch {}
  return { ok: r.ok, status: r.status, j, t }
}
async function projectsHave(id: number): Promise<string[]> {
  const r = await fetch(`${BASE}/orgs/${ORG}/projects?limit=5&page=1&include=cost_codes`, { headers: H })
  const j: any = await r.json()
  return (j.data ?? []).map((p: any) => `${p.name}:${(p.cost_code_ids ?? []).includes(id)}`)
}

// Skip any that already exist (idempotent)
const existing: Set<string> = new Set()
{
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes?limit=100&page=1`, { headers: H })
  const j: any = await r.json()
  for (const c of j.data ?? []) existing.add(String(c.code))
}

const NEW = [
  { code: 'DUMP', name: 'Desborde' },
  { code: 'LAWN', name: 'Jardín' },
  { code: 'APPL', name: 'Aparato' },
  { code: 'MATL', name: 'Material' },
]

console.log('== CREATE DUMP (test association) ==')
let assocWorks = false
if (existing.has('DUMP')) {
  console.log('  DUMP already exists, skipping create')
} else {
  const res = await createCode('DUMP', 'Desborde')
  const id = res.j?.id ?? res.j?.data?.id
  console.log(`  DUMP -> ${res.ok ? `OK id=${id}` : `FAIL ${res.status} ${res.t.slice(0, 140)}`}`)
  if (id) {
    const have = await projectsHave(id)
    assocWorks = have.some(s => s.endsWith(':true'))
    console.log(`  associated to projects? ${assocWorks}  ${JSON.stringify(have)}`)
  }
}

if (assocWorks) {
  console.log('\n== association works — creating LAWN/APPL/MATL ==')
  for (const { code, name } of NEW.slice(1)) {
    if (existing.has(code)) { console.log(`  ${code} exists, skip`); continue }
    const res = await createCode(code, name)
    console.log(`  ${code.padEnd(5)} "${name}" -> ${res.ok ? `OK id=${res.j?.id}` : `FAIL ${res.status} ${res.t.slice(0, 120)}`}`)
  }
} else if (!existing.has('DUMP')) {
  console.log('\n== include_all_projects did NOT auto-associate — STOP. DUMP exists but is hidden; need project-side association. Not creating the rest. ==')
}
