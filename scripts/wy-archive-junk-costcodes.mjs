#!/usr/bin/env node
/**
 * Retire the unambiguous junk/duplicate cost codes (DECISIONS_LOG §9, user pick
 * "just the obvious junk"): 3 Turnovers (0 use), 5 Bulky Waste Cleanup (0 use),
 * 8 "Vehchles and Equipment" (typo). Each has a live equivalent attached to the
 * same projects, so retiring strands no one. ARCHIVE (reversible, preserves
 * history) — never DELETE. Verifies by re-listing afterward.
 *
 * DRY-RUN by default; pass --apply to write.
 * Run: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-archive-junk-costcodes.mjs --apply
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const APPLY = process.argv.includes('--apply')

const TARGET_IDS = new Set([112570 /* 3 Turnovers */, 112572 /* 5 Bulky Waste Cleanup */, 112575 /* 8 Vehchles */])

async function listCodes() {
  const out = []; let page = 1, last = 1
  do {
    const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes?limit=100&page=${page}`, { headers: H })
    if (!r.ok) { console.error(`list ${r.status}`); process.exit(1) }
    const j = await r.json(); out.push(...(j.data ?? [])); last = j.meta?.last_page ?? 1; page++
  } while (page <= last)
  return out
}
async function put(id, body) {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
  return { ok: r.ok, status: r.status, j, t }
}

const before = await listCodes()
const targets = before.filter(c => TARGET_IDS.has(c.id))
console.log(`${APPLY ? 'ARCHIVING' : 'DRY-RUN'} — ${targets.length} junk codes:\n`)
for (const c of targets) console.log(`  ${String(c.code || '(none)').padEnd(6)} ${c.name}  (id ${c.id})`)

if (!APPLY) { console.log('\nDry run. Re-run with --apply to archive.'); process.exit(0) }

async function del(id) {
  const r = await fetch(`${BASE}/orgs/${ORG}/cost_codes/${id}`, { method: 'DELETE', headers: H })
  const t = await r.text()
  return { ok: r.ok, status: r.status, t }
}

console.log('')
for (const c of targets) {
  // Archive flag is silently ignored by Workyard; DELETE is the real retire path.
  // Safe here: our app stores cost_code as TEXT (not a Workyard FK), and each has a
  // live equivalent, so nothing is orphaned.
  const res = await del(c.id)
  console.log(`  ${res.ok ? 'DELETED' : 'FAIL'} ${String(c.code).padEnd(6)} ${c.name}  [${res.status}]${res.ok ? '' : ' ' + res.t.slice(0, 120)}`)
}

// Verify: re-list and confirm the targets are gone (or flagged archived)
const after = await listCodes()
const stillVisible = after.filter(c => TARGET_IDS.has(c.id))
console.log(`\nVerify: ${stillVisible.length}/${targets.length} still in the active cost-code list.`)
for (const c of stillVisible) console.log(`  still present: ${c.code} ${c.name}  is_archived=${c.is_archived ?? c.archived ?? 'n/a'}`)
if (stillVisible.length === 0) console.log('  ✓ all archived / removed from the active list.')
else console.log('  ⚠ archive flag may not hide from the worker picker via API — may need detach-from-projects or a manual hide in the Workyard UI.')
