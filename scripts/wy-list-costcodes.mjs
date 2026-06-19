#!/usr/bin/env node
/**
 * List all Workyard cost codes (id, code, name) so we can plan the bilingual rename
 * (DECISIONS_LOG §0.10). Read-only. Run via:
 *   MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-list-costcodes.mjs
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const all = []
let page = 1, last = 1
do {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes?limit=100&page=${page}`, { headers: H })
  if (!r.ok) { console.error(`Workyard ${r.status}: ${(await r.text()).slice(0,300)}`); process.exit(1) }
  const j = await r.json()
  all.push(...(j.data ?? []))
  last = j.meta?.last_page ?? 1
  page++
} while (page <= last)

// Sort: building S-code codes first (Material Pickup per building), then the rest.
const isScode = c => /^S\d+/i.test(String(c.code ?? ''))
all.sort((a, b) => (isScode(b) - isScode(a)) || String(a.code).localeCompare(String(b.code)))

console.log(`total cost codes: ${all.length}\n`)
console.log('CODE'.padEnd(10), 'NAME')
console.log('-'.repeat(60))
for (const c of all) console.log(String(c.code ?? '').padEnd(10), c.name ?? '')
console.log(`\nJSON:`)
console.log(JSON.stringify(all.map(c => ({ id: c.id, code: c.code, name: c.name })), null, 0))
