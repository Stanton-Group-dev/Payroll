#!/usr/bin/env node
/**
 * Probe Workyard for any mechanism that could drive PER-WORKER LANGUAGE dropdowns:
 *  - cost-code GROUPS (cost_code_group_id) — do they exist / are they listable?
 *  - EMPLOYEE groups + per-employee language/locale fields
 *  - how cost-code visibility is scoped (project attachment? per group? per employee?)
 *  - org-level language/locale settings
 * Read-only. Dumps raw first-objects so we can see ALL fields (not just the ones we map).
 *
 * Run: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-probe-groups.mjs
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch {}
  return { ok: r.ok, status: r.status, j, t }
}
const show = (label, res, pick) => {
  console.log(`\n=== ${label}  [${res.status}] ===`)
  if (!res.ok) { console.log('  ', res.t.slice(0, 200)); return }
  const body = pick ? pick(res.j) : res.j
  console.log(JSON.stringify(body, null, 2).slice(0, 1600))
}

// 1. Org settings — any language/locale/feature flags?
show('GET /orgs/{org}', await get(`/orgs/${ORG}`))

// 2. Cost-code groups — do they exist as a listable resource?
for (const p of [`/orgs/${ORG}/cost_code_groups`, `/orgs/${ORG}/cost_codes/groups`, `/orgs/${ORG}/cost_code_groups?limit=100`]) {
  const r = await get(p)
  console.log(`\n=== GROUPS probe ${p}  [${r.status}] ===`)
  console.log(r.ok ? JSON.stringify(r.j, null, 2).slice(0, 1200) : '  ' + r.t.slice(0, 160))
}

// 3. A raw cost-code object — does it carry a group id / translations / locale?
show('GET /cost_codes (raw first object)', await get(`/orgs/${ORG}/cost_codes?limit=2`), j => (j.data ?? [])[0])

// 4. Employees with groups — per-employee language/locale? group membership?
show('GET /employees.v2?include=employee_groups (first object, all fields)',
  await get(`/orgs/${ORG}/employees.v2?include=employee_groups&limit=3`), j => (j.data ?? [])[0])

// 5. Distinct employee groups that exist
show('employee_groups seen across first 100 employees',
  await get(`/orgs/${ORG}/employees.v2?include=employee_groups&limit=100`),
  j => {
    const groups = new Map()
    for (const e of (j.data ?? [])) for (const g of (e.employee_groups ?? e.groups ?? [])) groups.set(g.id ?? g.name, g.name ?? g)
    return { count: groups.size, groups: [...groups.values()] }
  })

// 6. Project with cost codes — is visibility purely project-attachment?
show('GET /projects?include=cost_codes,managers (first object)',
  await get(`/orgs/${ORG}/projects?limit=2&include=cost_codes,managers`), j => (j.data ?? [])[0])
