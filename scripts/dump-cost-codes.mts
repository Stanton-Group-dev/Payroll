// One-off: dump the authoritative Workyard cost-code list so we can rationalize it.
// Run: npx tsx scripts/dump-cost-codes.mts
import { readFileSync } from 'node:fs'

// --- load .env.local (KEY=VALUE, ignore comments/blank) ---
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}

const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: H })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { ok: res.ok, status: res.status, json, text }
}

console.log(`Org ${ORG}\n`)

// 1) Try the dedicated cost_codes endpoint
console.log('== GET /cost_codes ==')
let all: any[] = []
let page = 1
while (true) {
  const r = await get(`/orgs/${ORG}/cost_codes?limit=100&page=${page}`)
  if (!r.ok) { console.log(`  status ${r.status}: ${r.text.slice(0, 300)}`); break }
  const data = r.json?.data ?? []
  all.push(...data)
  const last = r.json?.meta?.last_page ?? 1
  if (page >= last) break
  page++
}

if (all.length) {
  console.log(`  ${all.length} cost codes\n`)
  console.log('  code | name | id | include_all_projects')
  for (const c of all.sort((a, b) => String(a.code).localeCompare(String(b.code)))) {
    console.log(`  ${JSON.stringify(c.code)} | ${JSON.stringify(c.name)} | ${c.id} | ${c.include_all_projects}`)
  }
}
