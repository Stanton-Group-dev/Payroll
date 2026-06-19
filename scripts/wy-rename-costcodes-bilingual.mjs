#!/usr/bin/env node
/**
 * Rename Workyard cost codes to BILINGUAL names per DECISIONS_LOG §0.10:
 *   <building/prefix> - <English> / <Spanish>     (Material Pickup, per building)
 *   <English> / <Spanish>                          (activity keepers)
 * The `code` field is never touched (it's the machine key: S-code or EN mnemonic).
 *
 * DRY-RUN by default — prints current -> proposed and writes nothing.
 * Pass --apply to actually PUT the renames.
 *
 * Run:
 *   MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-rename-costcodes-bilingual.mjs
 *   …same… -- node scripts/wy-rename-costcodes-bilingual.mjs --apply
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const APPLY = process.argv.includes('--apply')

// Short bilingual suffix for the per-building Material Pickup codes (EN / ES).
const MATL_SUFFIX = 'Materials / Materiales'

// Short bilingual names for the activity keepers, keyed by their (machine) code.
const KEEPERS = {
  APPL:   'Appliance / Aparato',
  CONST:  'Construction / Obra',
  DUMP:   'Dumpster / Desborde',
  LAWN:   'Landscape / Jardín',
  MAINT:  'Maint / Manten',
  OFFICE: 'Office / Oficina',
  PEST:   'Pest / Plagas',
  SHOW:   'Showings / Muestra',
  SNOW:   'Snow / Nieve',
  TURN:   'Turnover / Vacante',
  VEH:    'Vehicles / Vehículo',
  WASTE:  'Bulky / Voluminoso',
}

function proposedName(c) {
  const code = String(c.code ?? '')
  const name = String(c.name ?? '')
  if (/^S\d+/i.test(code) && /material/i.test(name)) {
    // Keep the building prefix; short bilingual activity (idempotent on the new suffix).
    const building = name.replace(/\s*-\s*material.*$/i, '').trim()
    const proposed = `${building} - ${MATL_SUFFIX}`
    return name === proposed ? null : proposed
  }
  if (KEEPERS[code]) return name === KEEPERS[code] ? null : KEEPERS[code]
  return null // legacy numeric / empty-code entries: left for a separate cleanup decision
}

async function put(id, name, code) {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes/${id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name, code, include_all_projects: false }),
  })
  const t = await r.text()
  return { ok: r.ok, status: r.status, t }
}

const all = []
let page = 1, last = 1
do {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes?limit=100&page=${page}`, { headers: H })
  if (!r.ok) { console.error(`list ${r.status}: ${(await r.text()).slice(0,300)}`); process.exit(1) }
  const j = await r.json(); all.push(...(j.data ?? [])); last = j.meta?.last_page ?? 1; page++
} while (page <= last)

const changes = all.map(c => ({ c, to: proposedName(c) })).filter(x => x.to)
const skipped = all.filter(c => !proposedName(c))

console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} — ${changes.length} renames, ${skipped.length} untouched\n`)
console.log('CODE'.padEnd(9), 'CURRENT'.padEnd(38), '->  PROPOSED')
console.log('-'.repeat(100))
for (const { c, to } of changes)
  console.log(String(c.code ?? '').padEnd(9), String(c.name ?? '').padEnd(38), '->  ' + to)

if (!APPLY) {
  console.log(`\n(Legacy / not renamed — review separately:)`)
  for (const c of skipped) console.log('  ', String(c.code ?? '(empty)').padEnd(9), c.name)
  console.log(`\nDry run only. Re-run with --apply to write these ${changes.length} renames.`)
} else {
  console.log('')
  let ok = 0, fail = 0
  for (const { c, to } of changes) {
    const res = await put(c.id, to, c.code)
    if (res.ok) { ok++; console.log(`  OK   ${String(c.code).padEnd(9)} ${to}`) }
    else { fail++; console.log(`  FAIL ${String(c.code).padEnd(9)} ${res.status} ${res.t.slice(0,120)}`) }
  }
  console.log(`\nDone: ${ok} renamed, ${fail} failed.`)
}
