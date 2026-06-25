// Provision a NEW supplier / material-source location (Home Depot, Lowes, a
// dump yard, a plumbing supply house, …) with the full set of per-building
// "Material Pickup" cost codes, so a worker buying/dumping there can single-tap
// which property it's for. The import then recovers the S-code and bills the
// right LLC. Same proven lever everywhere: project.cost_code_ids = current ∪ all
// material codes (idempotent; keeps the project's own activity codes).
//
// USAGE:
//   npx tsx scripts/provision-supplier.mts                 # list vendor-ish projects + coverage (no writes)
//   npx tsx scripts/provision-supplier.mts "Home Depot - Avon"   # provision by name substring
//   npx tsx scripts/provision-supplier.mts 413143               # provision by project id
//
// Prereq: the supplier must already exist as a Workyard PROJECT with a geofence
// (create it in the Workyard UI first — the API can't create projects/geofences).
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
  const t = await res.text(); let j: any = null; try { j = JSON.parse(t) } catch {}
  return { ok: res.ok, status: res.status, j, t }
}
async function getAll<T>(path: string): Promise<T[]> {
  const out: T[] = []; let page = 1
  while (true) {
    const sep = path.includes('?') ? '&' : '?'
    const r = await call('GET', `${path}${sep}limit=100&page=${page}`)
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${r.t.slice(0, 160)}`)
    out.push(...(r.j?.data ?? []))
    if (page >= (r.j?.meta?.last_page ?? 1)) break; page++
  }
  return out
}

const costCodes = await getAll<any>(`/orgs/${ORG}/cost_codes`)
const materialIds = costCodes.filter(c => /^\s*S\d+/i.test(String(c.code ?? ''))).map(c => c.id)
const matSet = new Set(materialIds)
const projects = await getAll<any>(`/orgs/${ORG}/projects?include=cost_codes`)
const matCount = (p: any) => (p.cost_code_ids ?? []).filter((id: number) => matSet.has(id)).length

const arg = process.argv.slice(2).join(' ').trim()

// No arg → show vendor-ish projects and their material coverage, then exit (read-only).
if (!arg) {
  const VENDOR = /home\s*depot|lowe|depot|hardware|gypsum|waste|express\s*kitchens|material|pickup|supply|office|paint|sherwin|ferguson|plumbing|bender/i
  console.log(`Material set = ${materialIds.length} codes. Vendor-ish projects (mat / total):\n`)
  for (const p of projects.filter(p => VENDOR.test(p.name) && !/^S\d+\s/.test(p.name)).sort((a, b) => a.name.localeCompare(b.name)))
    console.log(`  ${String(matCount(p)).padStart(3)}/${materialIds.length}  id=${String(p.id).padEnd(7)} ${p.name}`)
  console.log(`\nRe-run with a name substring or id to provision one, e.g.:`)
  console.log(`  npx tsx scripts/provision-supplier.mts "Home Depot - Avon"`)
  process.exit(0)
}

// Resolve the target project by id or unique name substring.
const byId = /^\d+$/.test(arg) ? projects.find(p => p.id === Number(arg)) : null
const byName = byId ? [] : projects.filter(p => p.name.toLowerCase().includes(arg.toLowerCase()))
const target = byId ?? (byName.length === 1 ? byName[0] : null)
if (!target) {
  if (byName.length > 1) {
    console.log(`Ambiguous "${arg}" — matches ${byName.length} projects; be more specific or use the id:`)
    for (const p of byName) console.log(`  id=${p.id} ${p.name}`)
  } else {
    console.log(`No project matches "${arg}". Run with no args to list candidates. (Create the project + geofence in the Workyard UI first.)`)
  }
  process.exit(1)
}

if (/^S\d+\s/.test(target.name))
  console.log(`⚠️  "${target.name}" looks like a BUILDING (S-code), not a supplier. Buildings normally carry only their own material code. Continuing anyway — Ctrl-C to abort.\n`)

const cur: number[] = target.cost_code_ids ?? []
const next = Array.from(new Set([...cur, ...materialIds])).sort((a, b) => a - b)
const adding = next.length - cur.length
console.log(`${target.name} (id ${target.id}): ${matCount(target)}/${materialIds.length} material now; adding ${adding} → ${next.length} total`)
if (adding === 0) { console.log('Already fully stocked — nothing to do.'); process.exit(0) }

const res = await call('PATCH', `/orgs/${ORG}/projects/${target.id}`, { cost_code_ids: next })
console.log(`PATCH ${res.status} ${res.ok ? 'OK' : res.t.slice(0, 200)}`)
if (!res.ok) process.exit(1)

const after = (await getAll<any>(`/orgs/${ORG}/projects?include=cost_codes`)).find(p => p.id === target.id)
const have = matCount(after)
console.log(`${have === materialIds.length ? '✅' : '⚠️'} verify: ${have}/${materialIds.length} material codes attached.`)
