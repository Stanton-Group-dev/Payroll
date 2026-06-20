#!/usr/bin/env node
/**
 * Benign probe: does Workyard's API support CREATE for cost codes / projects?
 * Sends an INVALID (empty) body so nothing can be created — we only read the
 * status: 404 = endpoint doesn't exist (manual UI only); 400/422 = endpoint
 * EXISTS (validation error) → creation is automatable. Read-ish (no resource made).
 *
 * Run: MSYS_NO_PATHCONV=1 infisical run --projectId=… --env=prod --recursive -- node scripts/wy-probe-create.mjs
 */
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY
const ORG = process.env.WORKYARD_ORG_ID || '25316'
if (!KEY) { console.error('WORKYARD_API_KEY not set'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function probe(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  return `${method} ${path}  -> ${r.status}  ${t.slice(0, 160)}`
}

// Empty body => if the endpoint exists it returns a validation error (400/422),
// if not it returns 404. Either way nothing is created.
console.log(await probe('POST', `/orgs/${ORG}/cost_codes`, {}))
console.log(await probe('POST', `/orgs/${ORG}/projects`, {}))
// Sanity: a known-good GET, to prove auth/path style are right.
console.log(await probe('GET', `/orgs/${ORG}/cost_codes?limit=1`))
