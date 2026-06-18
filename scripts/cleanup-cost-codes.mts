// Cost-code cleanup — STEP 1: rename the 9 mnemonic keepers to short Spanish
// names (code carries EN, name = short ES word), + probe whether an old code can
// be ARCHIVED reversibly (the safe retire mechanism — preserves history).
// Rename = PUT /cost_codes/{id} {name, code, include_all_projects:false}
// (PATCH 404s; associations live project-side so PUT can't detach them.)
// Run: npx tsx scripts/cleanup-cost-codes.mts
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

// id -> { code, name } for the 9 keepers (OFFICE already renamed; included for idempotency)
const KEEPERS: Record<number, { code: string; name: string }> = {
  113373: { code: 'MAINT', name: 'Mantenimiento' },
  113374: { code: 'CONST', name: 'Obra' },
  113376: { code: 'OFFICE', name: 'Oficina' },
  113377: { code: 'PEST', name: 'Plagas' },
  113378: { code: 'SHOW', name: 'Muestra' },
  113379: { code: 'SNOW', name: 'Nieve' },
  113380: { code: 'TURN', name: 'Vacante' },
  113381: { code: 'VEH', name: 'Vehículo' },
  113382: { code: 'WASTE', name: 'Voluminoso' },
}

console.log('== RENAME keepers (PUT) ==')
for (const [id, { code, name }] of Object.entries(KEEPERS)) {
  const res = await put(Number(id), { name, code, include_all_projects: false })
  console.log(`  ${code.padEnd(7)} -> "${name}"  ${res.ok ? 'OK' : `FAIL ${res.status} ${res.t.slice(0, 120)}`}`)
}

// Verify via list
const lr = await fetch(`${BASE}/orgs/${ORG}/cost_codes?limit=100&page=1`, { headers: H })
const lj: any = await lr.json()
console.log('\n== VERIFY keepers ==')
for (const c of (lj.data ?? []).filter((c: any) => Object.keys(KEEPERS).includes(String(c.id))))
  console.log(`  ${String(c.code).padEnd(7)} ${c.name}`)

// Probe ARCHIVE on the typo dup `8` "Vehchles" (id 112575) — a real retire target.
console.log('\n== ARCHIVE probe on code 8 (112575) ==')
for (const body of [
  { is_archived: true, code: '8', name: 'Vehchles and Equipment' },
  { archived: true, code: '8', name: 'Vehchles and Equipment' },
]) {
  const res = await put(112575, body)
  console.log(`  PUT ${JSON.stringify(Object.keys(body))} -> ${res.status} ${res.ok ? JSON.stringify(res.j) : res.t.slice(0, 120)}`)
  if (res.ok) break
}
// Re-pull projects to see if 112575 dropped from a project's cost_code_ids (= archived/hidden)
const pr = await fetch(`${BASE}/orgs/${ORG}/projects?limit=3&page=1&include=cost_codes`, { headers: H })
const pj: any = await pr.json()
const still = (pj.data ?? []).map((p: any) => `${p.name}: ${(p.cost_code_ids ?? []).includes(112575)}`)
console.log('  112575 still in project cost_code_ids?', JSON.stringify(still))
