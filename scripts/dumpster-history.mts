// READ-ONLY: pull historical Workyard time cards and aggregate dumpster-overflow
// hauling hours by property, for a few sample past weeks. Proves history is
// queryable + how far back. Run: npx tsx scripts/dumpster-history.mts
import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'https://api.workyard.com'
const KEY = process.env.WORKYARD_API_KEY!
const ORG = process.env.WORKYARD_ORG_ID!
const TZ = 'America/New_York'
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

function orgMidnightUnix(dateStr: string): number {
  const probe = new Date(`${dateStr}T12:00:00Z`)
  const hr = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(probe))
  const off = 12 - hr
  return Math.floor(new Date(`${dateStr}T${String(off).padStart(2, '0')}:00:00Z`).getTime() / 1000)
}
function plusDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

async function projectMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>(); let page = 1
  while (true) {
    const r = await fetch(`${BASE}/orgs/${ORG}/projects?limit=100&page=${page}`, { headers: H })
    const j: any = await r.json()
    for (const p of j.data ?? []) map.set(p.id, p.name?.match(/^(S\d+)/)?.[1] ?? p.name ?? '?')
    if (page >= (j.meta?.last_page ?? 1)) break
    page++
  }
  return map
}

async function weekCards(weekStart: string): Promise<any[]> {
  const startU = orgMidnightUnix(weekStart)
  const endU = orgMidnightUnix(plusDays(weekStart, 7))
  const cards: any[] = []; let page = 1
  while (true) {
    const p = new URLSearchParams()
    p.set('start_dt_unix', `gte:${startU}+lt:${endU}`)
    p.set('include', 'cost_allocations,worker')
    p.set('limit', '100')
    p.set('page', String(page))
    const r = await fetch(`${BASE}/orgs/${ORG}/time_cards?${p.toString()}`, { headers: H })
    if (!r.ok) { console.log(`   [${weekStart}] HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`); break }
    const j: any = await r.json()
    cards.push(...(j.data ?? []))
    if (page >= (j.meta?.last_page ?? 1)) break
    page++
  }
  return cards
}

const DUMP_RE = /dumpster overflow/i

const pm = await projectMap()
console.log(`projects: ${pm.size}\n`)

// Sample weeks spread back in time to gauge retention + show data.
for (const ws of ['2026-06-08', '2026-05-04', '2026-03-09', '2026-01-05', '2025-10-06']) {
  const cards = await weekCards(ws)
  const byProp = new Map<string, number>()
  let dumpCards = 0
  for (const c of cards) {
    for (const a of c.cost_allocations ?? []) {
      if (DUMP_RE.test(a.job_code?.name ?? '')) {
        dumpCards++
        const key = a.org_project_id ? (pm.get(a.org_project_id) ?? `proj ${a.org_project_id}`) : '(no project)'
        byProp.set(key, (byProp.get(key) ?? 0) + (a.duration_secs ?? 0) / 3600)
      }
    }
  }
  const top = [...byProp.entries()].sort((a, b) => b[1] - a[1])
  console.log(`week ${ws}: ${cards.length} cards, ${dumpCards} dumpster-overflow allocations`)
  for (const [prop, hrs] of top) console.log(`   ${prop.padEnd(8)} ${hrs.toFixed(1)} h`)
  if (!top.length && cards.length) console.log('   (no dumpster-overflow entries this week)')
  console.log()
}
