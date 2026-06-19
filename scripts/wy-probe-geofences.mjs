#!/usr/bin/env node
/** Can geofences be created via API (needed because POST /projects requires geofence_ids)?
 * And do Westend building geofences already exist (so projects could reuse them)?
 * Read-ish: empty-body POST creates nothing (validation/404). Run via infisical. */
const BASE = 'https://api.workyard.com', KEY = process.env.WORKYARD_API_KEY, ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

// 1. Does POST /geofences exist? (empty body -> 404 = no endpoint; 400/422 = exists)
const r = await fetch(`${BASE}/orgs/${ORG}/geofences`, { method: 'POST', headers: H, body: JSON.stringify({}) })
console.log(`POST /geofences (empty) -> ${r.status}  ${(await r.text()).slice(0, 200)}`)

// 2. List geofences; flag any matching Westend addresses.
const KEYS = ['whitney', 'sisson', 'warrenton', 'oxford', 'kibbe', 'evergreen', 'beacon', 'broad']
const all = []; let page = 1, last = 1
do {
  const g = await fetch(`${BASE}/orgs/${ORG}/geofences?limit=100&page=${page}`, { headers: H })
  const j = await g.json(); all.push(...(j.data ?? [])); last = j.meta?.last_page ?? 1; page++
} while (page <= last)
const westend = all.filter(g => KEYS.some(k => String(g.name ?? '').toLowerCase().includes(k)))
console.log(`\nTotal geofences: ${all.length}. Matching Westend addresses: ${westend.length}`)
for (const g of westend) console.log(`  ${String(g.id).padEnd(8)} ${g.name}`)
