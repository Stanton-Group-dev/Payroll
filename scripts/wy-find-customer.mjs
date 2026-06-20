#!/usr/bin/env node
/** Find the Workyard org_customer_id for the Westend LLC (needed for POST /projects).
 * Read-only. Lists distinct customers + the S0049 project's customer.
 * Run: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-find-customer.mjs */
const BASE = 'https://api.workyard.com', KEY = process.env.WORKYARD_API_KEY, ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const projects = []; let page = 1, last = 1
do {
  const r = await fetch(`${BASE}/orgs/${ORG}/projects?limit=100&page=${page}`, { headers: H })
  const j = await r.json(); projects.push(...(j.data ?? [])); last = j.meta?.last_page ?? 1; page++
} while (page <= last)
const customers = new Map()
for (const p of projects) if (p.customer) customers.set(p.customer.id, p.customer.name)
console.log('Distinct customers (id | name):')
for (const [id, name] of [...customers].sort((a,b)=>String(a[1]).localeCompare(String(b[1])))) console.log(`  ${String(id).padEnd(8)} ${name}`)
const s0049 = projects.find(p => /^S0049/i.test(p.name ?? ''))
console.log(`\nS0049 project: id=${s0049?.id} name="${s0049?.name}" customer=${s0049?.customer?.id} "${s0049?.customer?.name}"`)
console.log('\nCustomers matching "west"/"srep":')
for (const [id, name] of customers) if (/west|srep/i.test(name)) console.log(`  ${id}  ${name}`)
