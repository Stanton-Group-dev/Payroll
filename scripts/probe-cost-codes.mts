// Probe what the Workyard cost_codes API supports, using a throwaway code.
// Create -> rename (PATCH/PUT) -> delete, reporting each status. Run: npx tsx scripts/probe-cost-codes.mts
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json: any = null; try { json = JSON.parse(text) } catch {}
  console.log(`  ${method} ${path} -> ${res.status}${res.ok ? '' : '  ' + text.slice(0, 200)}`)
  return { ok: res.ok, status: res.status, json }
}

console.log('== CREATE throwaway ==')
const created = await call('POST', `/orgs/${ORG}/cost_codes`, {
  name: 'ZZ_PROBE_DELETE_ME', code: 'ZZTEST', include_all_projects: false,
})
const id = created.json?.id ?? created.json?.data?.id
console.log(`  created id = ${id}`)

if (id) {
  console.log('== RENAME (PATCH) ==')
  await call('PATCH', `/orgs/${ORG}/cost_codes/${id}`, { name: 'ZZ_PROBE_RENAMED' })
  console.log('== RENAME (PUT) ==')
  await call('PUT', `/orgs/${ORG}/cost_codes/${id}`, { name: 'ZZ_PROBE_RENAMED2', code: 'ZZTEST' })
  console.log('== DELETE ==')
  await call('DELETE', `/orgs/${ORG}/cost_codes/${id}`)
  console.log('== verify gone (GET list, search ZZTEST) ==')
  const list = await call('GET', `/orgs/${ORG}/cost_codes?limit=100&page=1`)
  const still = (list.json?.data ?? []).find((c: any) => c.code === 'ZZTEST')
  console.log(`  still present after delete? ${still ? 'YES (id ' + still.id + ') — clean up manually' : 'no, gone'}`)
}
