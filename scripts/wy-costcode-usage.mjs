#!/usr/bin/env node
/**
 * Cost-code USAGE + ATTACHMENT, for planning a SAFE legacy retire (DECISIONS_LOG §9).
 * For every cost code: which projects it's attached to, and how much it was used
 * in the last N days. Lets us (a) see which "legacy" codes are dead vs active and
 * (b) ensure a canonical replacement is attached to the same projects before we
 * archive a duplicate — so the crew is never stranded with no code to tap.
 * Read-only. Emits JSON at the end for downstream analysis.
 *
 * Run: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-costcode-usage.mjs [days]
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const DAYS = Number(process.argv[2] || 35)

async function getAll(path, key = 'data') {
  const out = []; let page = 1, last = 1
  do {
    const sep = path.includes('?') ? '&' : '?'
    const r = await fetch(`${BASE}${path}${sep}limit=100&page=${page}`, { headers: H })
    if (!r.ok) { console.error(`${path} -> ${r.status}: ${(await r.text()).slice(0,200)}`); process.exit(1) }
    const j = await r.json(); out.push(...(j[key] ?? [])); last = j.meta?.last_page ?? 1; page++
  } while (page <= last)
  return out
}

// 1. cost codes
const codes = await getAll(`/orgs/${ORG}/cost_codes`)
const byId = new Map(codes.map(c => [c.id, { id: c.id, code: c.code ?? '', name: c.name ?? '', projects: [], uses: 0, secs: 0 }]))

// 2. attachment: project.cost_code_ids
const projects = await getAll(`/orgs/${ORG}/projects?include=cost_codes`)
for (const p of projects)
  for (const cid of (p.cost_code_ids ?? []))
    if (byId.has(cid)) byId.get(cid).projects.push(p.name)

// 3. usage: timecards over last DAYS, sum per job_code
const now = Math.floor(Date.now() / 1000)
const start = now - DAYS * 86400
let page = 1, lastP = 1
do {
  const qs = new URLSearchParams()
  qs.set('start_dt_unix', `gte:${start}+lt:${now}`)
  qs.set('include', 'cost_allocations')
  qs.set('limit', '100'); qs.set('page', String(page))
  const r = await fetch(`${BASE}/orgs/${ORG}/time_cards?${qs}`, { headers: H })
  if (!r.ok) { console.error(`time_cards -> ${r.status}: ${(await r.text()).slice(0,200)}`); process.exit(1) }
  const j = await r.json()
  for (const c of (j.data ?? []))
    for (const a of (c.cost_allocations ?? [])) {
      const id = a.job_code?.id ?? a.job_code_id
      if (id != null && byId.has(id)) { const e = byId.get(id); e.uses++; e.secs += a.duration_secs ?? 0 }
    }
  lastP = j.meta?.last_page ?? 1; page++
} while (page <= lastP)

const rows = [...byId.values()].map(e => ({ ...e, hours: Math.round(e.secs / 360) / 10, projects: e.projects.length, projectNames: e.projects }))
rows.sort((a, b) => b.hours - a.hours)

console.log(`Cost-code usage (last ${DAYS}d) + attachment — ${rows.length} codes\n`)
console.log('CODE'.padEnd(9), 'USES'.padEnd(6), 'HRS'.padEnd(8), 'PROJ'.padEnd(5), 'NAME')
console.log('-'.repeat(80))
for (const r of rows)
  console.log(String(r.code || '(none)').padEnd(9), String(r.uses).padEnd(6), String(r.hours).padEnd(8), String(r.projects).padEnd(5), r.name)
console.log('\nJSON:')
console.log(JSON.stringify(rows.map(r => ({ id: r.id, code: r.code, name: r.name, uses: r.uses, hours: r.hours, projects: r.projects })), null, 0))
