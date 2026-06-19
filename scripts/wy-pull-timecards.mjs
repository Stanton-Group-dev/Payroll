#!/usr/bin/env node
/**
 * Raw Workyard timecard inspector — answers ONE question:
 * when a guy is at a store/office geofence, did he select a cost code (job_code)
 * that identifies the building, and does the card carry an org_project_id?
 *
 * It prints, per time card: status, worker, the time summary, and EACH cost
 * allocation's org_project_id, geofence name, and job_code (id / name / code).
 * If allocations show a job_code but NO org_project_id, that is the smoking gun:
 * the employee tagged the building via cost code and our importer is dropping it
 * (workyard-api.ts filters out allocations where org_project_id === null).
 *
 * USAGE (the API key lives in Infisical, not .env.local, so run via infisical):
 *   infisical run -- node scripts/wy-pull-timecards.mjs 2026-06-08 2026-06-14
 *   infisical run -- node scripts/wy-pull-timecards.mjs 2026-06-08 2026-06-14 14519948 14574437
 *
 * Or if you have the key in your shell:
 *   WORKYARD_API_KEY=... WORKYARD_ORG_ID=25316 node scripts/wy-pull-timecards.mjs 2026-06-08 2026-06-14
 *
 * Args: <startDate YYYY-MM-DD> <endDate YYYY-MM-DD> [timecardId ...]
 * If timecard ids are given, only those are printed (others still fetched).
 */

const BASE_URL = 'https://api.workyard.com'
const API_KEY = process.env.WORKYARD_API_KEY
const ORG_ID = process.env.WORKYARD_ORG_ID || '25316'

if (!API_KEY) {
  console.error('ERROR: WORKYARD_API_KEY is not set. Run via:  infisical run -- node scripts/wy-pull-timecards.mjs ...')
  process.exit(1)
}

const [startDate, endDate, ...wantIdsRaw] = process.argv.slice(2)
if (!startDate || !endDate) {
  console.error('USAGE: node scripts/wy-pull-timecards.mjs <startYYYY-MM-DD> <endYYYY-MM-DD> [timecardId ...]')
  process.exit(1)
}
const wantIds = new Set(wantIdsRaw.map(String))

// Org timezone is America/New_York; for a rough window we use UTC midnights ±1 day
// of padding so we don't miss edge cards. Exactness isn't needed for inspection.
const startUnix = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000) - 86400
const endUnix = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000) + 86400

async function fetchPage(page) {
  // Workyard /time_cards expects BOTH bounds in one start_dt_unix param:
  // gte:<start>+lt:<end>. The separate start_dt_unix/end_dt_unix form 400s on the
  // current token (see DECISIONS_LOG §2 / DUMPSTER_ANALYSIS_PRD).
  const params = new URLSearchParams()
  params.set('start_dt_unix', `gte:${startUnix}+lt:${endUnix}`)
  params.set('include', 'cost_allocations,worker,breaks')
  params.set('limit', '100')
  params.set('page', String(page))
  const url = `${BASE_URL}/orgs/${ORG_ID}/time_cards?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Workyard ${res.status}: ${body.slice(0, 500)}`)
  }
  return res.json()
}

function secs(n) {
  return n == null ? 0 : (n / 3600).toFixed(2)
}

;(async () => {
  let page = 1
  let last = 1
  const cards = []
  do {
    const json = await fetchPage(page)
    cards.push(...(json.data ?? []))
    last = json.meta?.last_page ?? 1
    page++
  } while (page <= last)

  const shown = cards.filter(c => wantIds.size === 0 || wantIds.has(String(c.id)))
  console.log(`Fetched ${cards.length} cards for ${startDate}..${endDate}; showing ${shown.length}\n`)

  let projectlessWithCostCode = 0
  let costCodeCarriesScode = 0   // the real signal: building S-code lives in job_code.code
  const SCODE = /^S\d+/i
  for (const c of shown) {
    const sum = c.time_summary_v2 ?? {}
    console.log(`──────────────────────────────────────────────────────────`)
    console.log(`Card ${c.id}  status=${c.status}  worker=${c.worker?.display_name ?? c.employee_id}  date=${new Date(c.start_dt_unix * 1000).toISOString().slice(0, 10)}`)
    console.log(`  reg=${secs(sum.regular_secs)}h ot=${secs(sum.over_time_secs)}h dt=${secs(sum.double_time_secs)}h paidBreak=${secs(sum.paid_break_secs)}h unpaidBreak=${secs(sum.unpaid_break_secs)}h`)
    const allocs = c.cost_allocations ?? []
    if (allocs.length === 0) {
      console.log(`  (no cost_allocations at all)`)
    }
    for (const a of allocs) {
      const jc = a.job_code
      const hasProject = a.org_project_id != null
      const hasCostCode = jc != null
      const codeIsScode = SCODE.test(jc?.code ?? '')
      if (!hasProject && hasCostCode) projectlessWithCostCode++
      if (codeIsScode) costCodeCarriesScode++
      console.log(
        `  alloc: org_project_id=${a.org_project_id ?? 'NULL'}  ` +
        `geofence="${a.geofence?.name ?? ''}"  ` +
        `job_code=${jc ? `${jc.id}:"${jc.name}" (code ${jc.code})` : 'NULL'}  ` +
        `dur=${secs(a.duration_secs)}h` +
        (!hasProject && hasCostCode ? '   <-- PROJECT-LESS BUT HAS COST CODE (dropped by importer)' : ''),
      )
    }
  }
  console.log(`\n==========================================================`)
  console.log(`Allocations whose cost-code 'code' is a building S-code (e.g. S0020): ${costCodeCarriesScode}`)
  console.log(`Allocations project-less AND with a cost code: ${projectlessWithCostCode}`)
  console.log(costCodeCarriesScode > 0
    ? `=> CONFIRMED: employees ARE selecting the building via the cost code (job_code.code = the S-code).\n` +
      `   The importer resolves property only from the vendor PROJECT and ignores job_code.code, so these land\n` +
      `   "Property not found"/unallocated. FIX: when the project yields no S-code, use job_code.code if it matches /^S\\d+/.\n` +
      `   No cost_code->building mapping table needed — the code IS the S-code.`
    : `=> No building S-code seen in cost codes for this sample. Either employees didn't tag a building cost code,\n` +
      `   or the building lives elsewhere. Widen the date range / card set before concluding.`)
})().catch(e => { console.error(e); process.exit(1) })
