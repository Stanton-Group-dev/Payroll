// Cost-code cleanup — STEP 2 (revised): POST-create 404s on this token, so the
// 3 missing activity codes are made by REPURPOSING existing dead codes via PUT.
// This preserves their project associations (picker) AND their history (same
// job_code_id), which is ideal for DUMP (keeps historical overflow cards tagged).
// MATL is NOT done here — it needs broad re-association (project-side), deferred.
// Run: npx tsx scripts/repurpose-to-new-codes.mts
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function put(id: number, body: Record<string, unknown>) {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) })
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t) } catch {}
  return { ok: r.ok, status: r.status, j, t }
}

// id -> new {code, name}. Repurpose dead/legacy codes that are already in the picker.
const REPURPOSE: Array<{ id: number; was: string; code: string; name: string }> = [
  { id: 112377, was: '"" Garbage Cleanup (Dumpster overflow)', code: 'DUMP', name: 'Desborde' },
  { id: 112379, was: '"" Appliances (Repair)', code: 'APPL', name: 'Aparato' },
  { id: 70600, was: '04 Landscape Maint.', code: 'LAWN', name: 'Jardín' },
]

console.log('== REPURPOSE via PUT ==')
for (const r of REPURPOSE) {
  const res = await put(r.id, { name: r.name, code: r.code, include_all_projects: false })
  console.log(`  ${r.was}\n    -> ${r.code} "${r.name}"  ${res.ok ? 'OK' : `FAIL ${res.status} ${res.t.slice(0, 120)}`}`)
}

// Verify names + that DUMP (112377) is still associated to projects (picker intact)
const lr = await fetch(`${BASE}/orgs/${ORG}/cost_codes?limit=100&page=1`, { headers: H })
const lj: any = await lr.json()
console.log('\n== VERIFY ==')
for (const c of (lj.data ?? []).filter((c: any) => [112377, 112379, 70600].includes(c.id)))
  console.log(`  ${String(c.code).padEnd(6)} ${c.name}`)

const pr = await fetch(`${BASE}/orgs/${ORG}/projects?limit=4&page=1&include=cost_codes`, { headers: H })
const pj: any = await pr.json()
console.log('\n  DUMP (112377) in project pickers?',
  JSON.stringify((pj.data ?? []).map((p: any) => `${p.name}:${(p.cost_code_ids ?? []).includes(112377)}`)))
