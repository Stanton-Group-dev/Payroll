#!/usr/bin/env node
/**
 * ONE-MOVE building onboarding for the Workyard side (DECISIONS_LOG 0.11/0.15).
 * Given a building (S-code + name), ensure its Workyard PROJECT exists (create via
 * POST /projects, or rename if mis-named), then print the manual COST-CODE step
 * (Workyard's API can't create cost codes — 404). The import fix then resolves
 * supply-run hours to the building automatically.
 *
 * Usage:
 *   …node wy-onboard-buildings.mjs                 # DRY-RUN over the Westend batch
 *   …node wy-onboard-buildings.mjs --only S0042    # one building (test)
 *   …node wy-onboard-buildings.mjs --apply         # create/rename the projects
 *   …node wy-onboard-buildings.mjs --scode S0068 --name "12 Foo St" --customer 317292 --apply   # a new acquisition
 *
 * Run via: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-onboard-buildings.mjs …
 */
const BASE = 'https://api.workyard.com', KEY = process.env.WORKYARD_API_KEY, ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const APPLY = process.argv.includes('--apply')
const ONLY = arg('--only')

const WESTEND_CUSTOMER = 317292 // SREP Westend LLC
// Vendor "clusters" the per-building Material-Pickup cost code must attach to (name shown for the UI).
const CLUSTERS = [
  'Park Hardware', 'Home Depot - West Hartford', 'Home Depot - Bloomfield', 'Home Depot-Glastonbury',
  'Lowes - Bloomfield', 'Bender Plumbing Supply - Hartford', 'Express Kitchens-Hardware store',
  'New England Gypsum-Material pickup', 'All Waste- Garbage dumping', 'All Waste (Dumpyard)',
]
// Westend buildings (from the DB properties table). customer defaults to Westend LLC.
const WESTEND = [
  ['S0042', '150 S Whitney'], ['S0043', '154 S Whitney'], ['S0044', '155 S Whitney'], ['S0045', '159 S Whitney'],
  ['S0046', '163 S Whitney'], ['S0047', '178 S Whitney'], ['S0048', '240 S Whitney'], ['S0049', '242-244 S Whitney'],
  ['S0050', '247 S Whitney'], ['S0051', '246 S Whitney'], ['S0052', '250-252 S Whitney'], ['S0053', '251 S Whitney'],
  ['S0054', '254 S Whitney'], ['S0055', '224 S Whitney'], ['S0056', '226 S Whitney'], ['S0057', '63 Evergreen'],
  ['S0058', '159 Sisson'], ['S0059', '163-165 Sisson'], ['S0060', '167-169 Sisson'], ['S0061', '9-11 Warrenton'],
  ['S0062', '149 Sisson'], ['S0063', '28 Kibbe'], ['S0064', '1802-1804 Broad'], ['S0065', '28 Beacon'],
  ['S0066', '39-41 Oxford'], ['S0067', '47 Oxford'],
]
// Existing Workyard geofence per building (grouped by street; reused — net-new geofences
// need an ext_address_id so they're manual). Geofence only drives clock-in suggestion,
// not billing resolution (which keys on the project S-code).
const GEOFENCE_MAP = {
  S0042: 578898, S0043: 578898, S0044: 578899, S0045: 578899, S0046: 578899, S0047: 578900,
  S0048: 578901, S0049: 578901, S0050: 578902, S0051: 578902, S0052: 578901, S0053: 578902,
  S0054: 578901, S0055: 578903, S0056: 578903, S0057: 578904, S0058: 578908, S0059: 578908,
  S0060: 578908, S0061: 578908, S0062: 578907, S0063: 578905, S0064: 578906, S0065: 552869,
  S0066: 578909, S0067: 578910,
}

// Build the work-list: a single acquisition (--scode/--name) or the Westend batch.
let targets
if (arg('--scode')) targets = [[arg('--scode').toUpperCase(), arg('--name') ?? '']]
else targets = WESTEND
if (ONLY) targets = targets.filter(([s]) => s === ONLY.toUpperCase())
const CUSTOMER = Number(arg('--customer') ?? WESTEND_CUSTOMER)

async function getAllProjects() {
  const out = []; let page = 1, last = 1
  do {
    const r = await fetch(`${BASE}/orgs/${ORG}/projects?limit=100&page=${page}`, { headers: H })
    const j = await r.json(); out.push(...(j.data ?? [])); last = j.meta?.last_page ?? 1; page++
  } while (page <= last)
  return out
}
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
  return { ok: r.ok, status: r.status, j, t }
}
async function put(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'PUT', headers: H, body: JSON.stringify(body) })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
  return { ok: r.ok, status: r.status, j, t }
}

const projects = await getAllProjects()
const bySCode = new Map()
for (const p of projects) { const m = String(p.name ?? '').match(/^(S\d+)/i); if (m) bySCode.set(m[1].toUpperCase(), p) }

console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} — ${targets.length} building(s), customer ${CUSTOMER}\n`)
const checklist = []
for (const [scode, building] of targets) {
  const wantName = `${scode} - ${building}`
  const gid = GEOFENCE_MAP[scode] ?? (arg('--geofence') ? Number(arg('--geofence')) : null)
  const existing = bySCode.get(scode)
  let action, projectId = existing?.id ?? null
  if (existing && existing.name === wantName) action = `OK (exists: "${existing.name}")`
  else if (existing) action = `RENAME "${existing.name}" -> "${wantName}" [geofence ${gid}]`
  else action = `CREATE "${wantName}" [geofence ${gid}]`

  if (APPLY && !gid && !(existing && existing.name === wantName)) {
    action = `SKIP — no geofence mapped (pass --geofence <id>)`
  } else if (APPLY && action.startsWith('CREATE')) {
    const res = await post(`/orgs/${ORG}/projects`, { name: wantName, org_customer_id: CUSTOMER, geofence_ids: [gid] })
    action = res.ok ? `CREATED id=${res.j?.id}` : `FAIL ${res.status} ${res.t.slice(0, 140)}`
    projectId = res.j?.id ?? null
  } else if (APPLY && action.startsWith('RENAME')) {
    const res = await put(`/orgs/${ORG}/projects/${existing.id}`, { name: wantName, org_customer_id: CUSTOMER, geofence_ids: [gid] })
    action = res.ok ? `RENAMED -> "${wantName}"` : `FAIL ${res.status} ${res.t.slice(0, 140)}`
  }
  console.log(`  ${scode.padEnd(7)} ${action}`)
  checklist.push({ scode, codeName: `${building} - Materials / Materiales`, project: wantName })
}

console.log(`\n=== MANUAL COST-CODE CHECKLIST (Workyard API can't create cost codes — UI) ===`)
console.log(`For each, create a cost code:  code = <S-code>,  name = "<building> - Materials / Materiales",`)
console.log(`attach to its own project + these ${CLUSTERS.length} vendor clusters: ${CLUSTERS.join('; ')}\n`)
for (const c of checklist) console.log(`  code ${c.scode}   name "${c.codeName}"   (+ project "${c.project}")`)
