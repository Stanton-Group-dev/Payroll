#!/usr/bin/env node
/**
 * Westend (S0042–S0067) onboarding status + the vendor "clusters".
 * Read-only. For each Westend building: does its Workyard PROJECT exist, does its
 * per-building Material-Pickup COST CODE exist, and is that code attached to all the
 * vendor cluster projects (so the worker can tap it on a supply run)? Also lists the
 * cluster/vendor projects themselves. Emits JSON.
 *
 * Run: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-westend-status.mjs
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function getAll(path) {
  const out = []; let page = 1, last = 1
  do {
    const r = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page}`, { headers: H })
    if (!r.ok) { console.error(`${path} -> ${r.status}: ${(await r.text()).slice(0,160)}`); process.exit(1) }
    const j = await r.json(); out.push(...(j.data ?? [])); last = j.meta?.last_page ?? 1; page++
  } while (page <= last)
  return out
}

const VENDOR_KEYS = ['park hardware', 'home depot', 'lowe', 'bender', 'express kitchen', 'new england gypsum', 'all waste']
const isWestendS = s => { const n = +String(s).replace(/^S/i, ''); return n >= 42 && n <= 67 }

const projects = await getAll(`/orgs/${ORG}/projects?include=cost_codes`)
const codes = await getAll(`/orgs/${ORG}/cost_codes`)

// S-code -> project
const projBySCode = new Map()
for (const p of projects) {
  const m = String(p.name ?? '').match(/^(S\d+)/i)
  if (m) projBySCode.set(m[1].toUpperCase(), p)
}
// cluster/vendor projects
const clusters = projects.filter(p => {
  const n = String(p.name ?? '').toLowerCase()
  return VENDOR_KEYS.some(k => n.includes(k)) && !/^s\d+/i.test(n)
})
const clusterIds = new Set(clusters.map(c => c.id))
// Material-Pickup code by S-code
const matlBySCode = new Map()
for (const c of codes) if (/material pickup/i.test(c.name ?? '') && /^S\d+/i.test(String(c.code))) matlBySCode.set(String(c.code).toUpperCase(), c)
// which projects each cost-code id is attached to
const projsByCodeId = new Map()
for (const p of projects) for (const cid of (p.cost_code_ids ?? [])) { if (!projsByCodeId.has(cid)) projsByCodeId.set(cid, []); projsByCodeId.get(cid).push(p) }

console.log(`=== CLUSTERS (vendor projects supply runs attach to): ${clusters.length} ===`)
for (const c of clusters) console.log(`  ${String(c.id).padEnd(8)} ${c.name}  [geofences: ${(c.geofences ?? []).map(g => g.name).join(', ') || '—'}]`)

console.log(`\n=== WESTEND S0042–S0067 status ===`)
console.log('S-code'.padEnd(8), 'PROJECT'.padEnd(8), 'MATL CODE'.padEnd(10), 'CLUSTERS ATTACHED')
const rows = []
for (let i = 42; i <= 67; i++) {
  const s = `S${String(i).padStart(4, '0')}`
  const proj = projBySCode.get(s)
  const code = matlBySCode.get(s)
  const attachedClusters = code ? (projsByCodeId.get(code.id) ?? []).filter(p => clusterIds.has(p.id)) : []
  rows.push({ scode: s, hasProject: !!proj, projectId: proj?.id ?? null, projectName: proj?.name ?? null,
    hasMatlCode: !!code, matlCodeId: code?.id ?? null, clustersAttached: attachedClusters.length, clustersTotal: clusters.length })
  console.log(s.padEnd(8), (proj ? 'yes' : 'NO').padEnd(8), (code ? 'yes' : 'NO').padEnd(10), `${attachedClusters.length}/${clusters.length}`)
}
const noProj = rows.filter(r => !r.hasProject).length
const noCode = rows.filter(r => r.hasProject && !r.hasMatlCode).length
const partialAttach = rows.filter(r => r.hasMatlCode && r.clustersAttached < r.clustersTotal).length
console.log(`\nSummary: ${noProj}/26 missing project, ${noCode}/26 have project but no Material-Pickup code, ${partialAttach} codes not attached to all clusters.`)
console.log('\nJSON:'); console.log(JSON.stringify({ clusters: clusters.map(c => ({ id: c.id, name: c.name })), westend: rows }, null, 0))
