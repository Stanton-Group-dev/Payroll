import type { WorkyardRow } from '@/lib/payroll/csv-parser'
import { WORKYARD_ORG_TIMEZONE } from '@/lib/payroll/config'
import { isWorkyardMockEnabled, generateMockTimecards } from '@/lib/payroll/workyard-mock'

/**
 * Splits `totalHours` across N legs proportionally to `weights`, returning one
 * 2-decimal-place value per leg such that the array sum equals round2(totalHours)
 * exactly (largest-remainder method).
 *
 * Edge cases:
 * - totalHours === 0  → all zeros.
 * - all weights === 0 → equal split (1/N each).
 * - single weight     → [round2(totalHours)].
 */
export function splitHoursLargestRemainder(totalHours: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  const round2 = (n: number) => Math.round(n * 100) / 100
  const canonical = round2(totalHours)

  if (canonical === 0) return weights.map(() => 0)

  const totalWeight = weights.reduce((s, w) => s + w, 0)

  // Compute raw (unrounded) share per leg.
  const raws = weights.map(w =>
    totalWeight > 0 ? (canonical * w) / totalWeight : canonical / weights.length
  )

  // Floor each to 2 dp (in integer cents to avoid fp drift).
  const floored = raws.map(r => Math.floor(Math.round(r * 10000) / 100) / 100)

  // Residue to distribute (in cents to keep it integer arithmetic).
  const flooredSumCents = floored.reduce((s, v) => s + Math.round(v * 100), 0)
  const canonicalCents = Math.round(canonical * 100)
  let residueCents = canonicalCents - flooredSumCents

  if (residueCents > 0) {
    // Fractional remainders (after flooring) in descending order.
    const remainders = raws.map((r, i) => ({
      i,
      frac: Math.round(r * 10000) / 100 - Math.floor(Math.round(r * 10000) / 100),
    }))
    // Sort descending by fraction; ties broken by ascending index.
    remainders.sort((a, b) => b.frac - a.frac || a.i - b.i)

    for (let k = 0; k < residueCents; k++) {
      floored[remainders[k % remainders.length].i] =
        Math.round((floored[remainders[k % remainders.length].i] + 0.01) * 100) / 100
    }
  }

  return floored
}

const BASE_URL = 'https://api.workyard.com'
const API_KEY = process.env.WORKYARD_API_KEY!
const ORG_ID = process.env.WORKYARD_ORG_ID!

type TimeCardFilterFormat = 'combined' | 'separate'

interface WorkyardDebugContext {
  endpoint: string
  query: string
  page?: number
  startUnix?: number
  endUnix?: number
  approvedOnly?: boolean
  filterFormat?: TimeCardFilterFormat
}

class WorkyardApiError extends Error {
  status: number
  bodyText: string
  bodyJson: unknown
  debug?: WorkyardDebugContext

  constructor(status: number, bodyText: string, bodyJson: unknown, debug?: WorkyardDebugContext) {
    super(`Workyard API ${status}: ${bodyText}`)
    this.name = 'WorkyardApiError'
    this.status = status
    this.bodyText = bodyText
    this.bodyJson = bodyJson
    this.debug = debug
  }
}

export function isWorkyardApiError(err: unknown): err is WorkyardApiError {
  return err instanceof WorkyardApiError
}

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function workyardFetch<T>(path: string, debug?: WorkyardDebugContext): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers(), cache: 'no-store' })
  if (!res.ok) {
    const body = await res.text()
    let bodyJson: unknown = null
    try {
      bodyJson = JSON.parse(body)
    } catch {
      bodyJson = null
    }
    throw new WorkyardApiError(res.status, body, bodyJson, debug)
  }
  return res.json() as Promise<T>
}

interface WYProject {
  id: number
  name: string
  org_customer_id: number
  customer?: { id: number; name: string }
}

interface WYGeofence {
  id: number
  name: string
}

interface WYJobCode {
  id: number
  name: string
  code: string
}

interface WYCostAllocation {
  org_project_id: number | null
  geofence_id: number | null
  geofence?: WYGeofence
  job_code_id: number | null
  job_code?: WYJobCode
  duration_secs: number | null
}

interface WYWorker {
  employee_id: number
  display_name: string
  first_name: string
  last_name: string
}

interface WYTimeSummaryV2 {
  duration_secs: number
  regular_secs: number
  over_time_secs: number
  double_time_secs: number
  paid_break_secs: number
  unpaid_break_secs: number
}

interface WYTimeCard {
  id: number
  employee_id: number
  start_dt_unix: number
  end_dt_unix: number | null
  status: 'working' | 'submitted' | 'approved' | 'processed' | 'deleted'
  timezone: string
  time_summary_v2: WYTimeSummaryV2 | null
  cost_allocations: WYCostAllocation[]
  worker: WYWorker
}

interface WYListResponse<T> {
  data: T[]
  meta: {
    current_page: number
    last_page: number
    total: number
    per_page: number
  }
}

/** Fetch all projects for the org, returning a map of project_id → S-code */
async function fetchProjectMap(): Promise<Map<number, { sCode: string; customerName: string }>> {
  const map = new Map<number, { sCode: string; customerName: string }>()
  let page = 1

  while (true) {
    const data = await workyardFetch<WYListResponse<WYProject>>(
      `/orgs/${ORG_ID}/projects?limit=100&page=${page}&include=customer`
    )
    for (const proj of data.data) {
      const sCode = proj.name.match(/^(S\d+)/)?.[1] ?? proj.name
      map.set(proj.id, {
        sCode,
        customerName: proj.customer?.name ?? '',
      })
    }
    if (page >= data.meta.last_page) break
    page++
  }

  return map
}

function assertUnixSeconds(unix: number, label: string) {
  if (!Number.isInteger(unix) || unix < 1_000_000_000 || unix > 9_999_999_999) {
    throw new Error(`Invalid ${label}: ${unix}. Expected 10-digit Unix seconds.`)
  }
}

function buildTimeCardsQuery(
  startUnix: number,
  endUnix: number,
  approvedOnly: boolean,
  page: number,
  format: TimeCardFilterFormat
): string {
  assertUnixSeconds(startUnix, 'startUnix')
  assertUnixSeconds(endUnix, 'endUnix')

  const params = new URLSearchParams()
  // Workyard /time_cards expects both bounds in start_dt_unix: gte:<start>+lt:<end>
  if (format === 'combined') {
    params.set('start_dt_unix', `gte:${startUnix}+lt:${endUnix}`)
  } else {
    params.set('start_dt_unix', `gte:${startUnix}`)
    params.set('end_dt_unix', `lt:${endUnix}`)
  }
  if (approvedOnly) params.set('status', 'eq:approved')
  params.set('include', 'cost_allocations,worker')
  params.set('limit', '100')
  params.set('page', String(page))

  return params.toString()
}

function hasStartUnixValidationError(err: unknown): boolean {
  if (!isWorkyardApiError(err) || err.status !== 400 || !err.bodyJson || typeof err.bodyJson !== 'object') {
    return false
  }
  const hints = (err.bodyJson as { field_hints?: { start_dt_unix?: unknown } }).field_hints
  return Array.isArray(hints?.start_dt_unix) && hints.start_dt_unix.length > 0
}

/** Fetch time cards for a date range, paginating automatically */
async function fetchApprovedTimeCards(startUnix: number, endUnix: number, approvedOnly: boolean): Promise<WYTimeCard[]> {
  const cards: WYTimeCard[] = []
  let page = 1
  let filterFormat: TimeCardFilterFormat = 'combined'

  while (true) {
    const qs = buildTimeCardsQuery(startUnix, endUnix, approvedOnly, page, filterFormat)
    const debugContext: WorkyardDebugContext = {
      endpoint: `/orgs/${ORG_ID}/time_cards`,
      query: qs,
      page,
      startUnix,
      endUnix,
      approvedOnly,
      filterFormat,
    }

    if (process.env.NODE_ENV !== 'production') {
      console.info('[workyard] time_cards request', debugContext)
    }

    try {
      const data = await workyardFetch<WYListResponse<WYTimeCard>>(
        `/orgs/${ORG_ID}/time_cards?${qs}`,
        debugContext
      )
      cards.push(...data.data)
      if (page >= data.meta.last_page) break
      page++
    } catch (err) {
      if (filterFormat === 'combined' && hasStartUnixValidationError(err)) {
        filterFormat = 'separate'
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[workyard] retrying time_cards with separate start/end filters')
        }
        continue
      }
      throw err
    }
  }

  return cards
}

/**
 * Returns the Unix timestamp for midnight in the org timezone on a given YYYY-MM-DD
 * date string. Uses a noon-UTC probe to derive the correct UTC offset, handling DST.
 */
function orgMidnightUnix(dateStr: string): number {
  const probe = new Date(`${dateStr}T12:00:00Z`)
  const nycHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: WORKYARD_ORG_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).format(probe)
  )
  const utcOffset = 12 - nycHour // 5 in EST, 4 in EDT
  return Math.floor(
    new Date(`${dateStr}T${String(utcOffset).padStart(2, '0')}:00:00Z`).getTime() / 1000
  )
}

/** Convert a Unix timestamp to YYYY-MM-DD in the org timezone */
function unixToDate(unix: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKYARD_ORG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

/**
 * Fetch all approved Workyard time cards for a given week and convert them to
 * WorkyardRow[] — the same interface produced by parseWorkyardCSV().
 *
 * A single time card with multiple cost allocations is split into one row per
 * allocation, with hours distributed proportionally by duration_secs.
 */
export async function fetchWorkyardTimecards(
  weekStart: string,
  approvedOnly = true
): Promise<{ rows: WorkyardRow[]; stats: { total: number; allocations: number } }> {
  // Dev/test path: return deterministic dummy data instead of calling Workyard.
  if (isWorkyardMockEnabled()) {
    return generateMockTimecards(weekStart)
  }

  const startUnix = orgMidnightUnix(weekStart)
  // Advance 7 days from noon UTC to stay in the right calendar day, then find midnight
  const endProbe = new Date(`${weekStart}T12:00:00Z`)
  endProbe.setUTCDate(endProbe.getUTCDate() + 7)
  const endDateStr = endProbe.toISOString().slice(0, 10)
  const endUnix = orgMidnightUnix(endDateStr)

  const [cards, projectMap] = await Promise.all([
    fetchApprovedTimeCards(startUnix, endUnix, approvedOnly),
    fetchProjectMap(),
  ])

  const rows: WorkyardRow[] = []

  for (const card of cards) {
    const workyardId = String(card.worker?.employee_id ?? card.employee_id)
    const employeeName = card.worker?.display_name ?? `Employee ${card.employee_id}`
    const entryDate = unixToDate(card.start_dt_unix)
    const timecardId = String(card.id)

    const summary = card.time_summary_v2
    const totalRegSecs = summary?.regular_secs ?? 0
    const totalOtSecs = summary?.over_time_secs ?? 0
    const totalDtSecs = summary?.double_time_secs ?? 0

    const allocations = card.cost_allocations?.filter(a => a.org_project_id !== null) ?? []

    if (allocations.length === 0) {
      rows.push({
        workyardId,
        employeeName,
        projectName: '',
        customerName: '',
        entryDate,
        regularHours: Math.round((totalRegSecs / 3600) * 100) / 100,
        otHours: Math.round(((totalOtSecs + totalDtSecs) / 3600) * 100) / 100,
        ptoHours: 0,
        timecardId,
        costCode: '',
        costCodeName: '',
      })
      continue
    }

    const weights = allocations.map(a => a.duration_secs ?? 0)
    const regHours = totalRegSecs / 3600
    const otHours = (totalOtSecs + totalDtSecs) / 3600
    const regSplit = splitHoursLargestRemainder(regHours, weights)
    const otSplit = splitHoursLargestRemainder(otHours, weights)

    for (let i = 0; i < allocations.length; i++) {
      const alloc = allocations[i]
      const proj = alloc.org_project_id ? projectMap.get(alloc.org_project_id) : null

      rows.push({
        workyardId,
        employeeName,
        projectName: proj?.sCode ?? alloc.geofence?.name ?? '',
        customerName: proj?.customerName ?? '',
        entryDate,
        regularHours: regSplit[i],
        otHours: otSplit[i],
        ptoHours: 0,
        timecardId,
        // costCode keeps the NAME here (unchanged activity behavior); the CSV path supplies
        // the real code. costCodeName captures the human label for both.
        costCode: alloc.job_code?.name ?? '',
        costCodeName: alloc.job_code?.name ?? '',
      })
    }
  }

  return {
    rows,
    stats: { total: cards.length, allocations: rows.length },
  }
}

/** Matches the Workyard "Dumpster Overflow" cost code (English + Spanish "desborde"). */
const DUMP_OVERFLOW_RE = /desborde|dumpster overflow/i

/** One property's overflow-hauling labor over the queried range. */
export interface DumpsterOverflowRow {
  /** Workyard org_project_id (null only for the no-project bucket). */
  projectId: number | null
  /** Leading S-code parsed from the Workyard project name (the bill-to property). */
  sCode: string
  customerName: string
  hours: number
}

export interface DumpsterOverflowResult {
  /** Per-property overflow hours, ranked high→low. Excludes the no-project bucket. */
  byProperty: DumpsterOverflowRow[]
  /** Overflow hours tagged to no project — billing leakage (PRD metric 3). */
  noProjectHours: number
  /** Total overflow hours including the no-project bucket. */
  totalHours: number
  /** Span of the queried range in weeks, for annualization. */
  weeks: number
  /** Time cards scanned in the range. */
  cardsScanned: number
  start: string
  end: string
}

/**
 * Aggregate Dumpster-Overflow (DUMP) hauling hours per property over a date range, read
 * live from Workyard. `start` inclusive, `end` exclusive, both YYYY-MM-DD in org time.
 *
 * Hours come from each matching cost allocation's clocked `duration_secs` (the activity time),
 * matching scripts/dumpster-history.mts — the proven read-only pull this report grew out of.
 * The crew is physically at the building hauling overflow, so the allocation's project already
 * is the property; no S-code-in-cost-code recovery is needed for the DUMP signal.
 */
export async function fetchDumpsterOverflowByProperty(
  start: string,
  end: string,
  approvedOnly = true
): Promise<DumpsterOverflowResult> {
  const startUnix = orgMidnightUnix(start)
  const endUnix = orgMidnightUnix(end)
  const spanWeeks = Math.max((endUnix - startUnix) / 86400 / 7, 1 / 7)

  // Dev/test path: deterministic dummy data instead of calling Workyard.
  if (isWorkyardMockEnabled()) {
    const byProperty: DumpsterOverflowRow[] = [
      { projectId: 1, sCode: 'S0020', customerName: 'Mock LLC', hours: 8.6 * spanWeeks },
      { projectId: 2, sCode: 'S0049', customerName: 'Mock LLC', hours: 3.4 * spanWeeks },
      { projectId: 3, sCode: 'S0010', customerName: 'Mock LLC', hours: 3.0 * spanWeeks },
    ]
    const noProjectHours = 2.5 * spanWeeks
    return {
      byProperty,
      noProjectHours,
      totalHours: byProperty.reduce((s, p) => s + p.hours, 0) + noProjectHours,
      weeks: spanWeeks,
      cardsScanned: 0,
      start,
      end,
    }
  }

  const [cards, projectMap] = await Promise.all([
    fetchApprovedTimeCards(startUnix, endUnix, approvedOnly),
    fetchProjectMap(),
  ])

  const byCode = new Map<string, { projectId: number; sCode: string; customerName: string; secs: number }>()
  let noProjectSecs = 0

  for (const card of cards) {
    for (const alloc of card.cost_allocations ?? []) {
      if (!DUMP_OVERFLOW_RE.test(alloc.job_code?.name ?? '')) continue
      const secs = alloc.duration_secs ?? 0
      if (!alloc.org_project_id) {
        noProjectSecs += secs
        continue
      }
      const proj = projectMap.get(alloc.org_project_id)
      const sCode = proj?.sCode ?? `proj ${alloc.org_project_id}`
      const entry = byCode.get(sCode) ?? {
        projectId: alloc.org_project_id,
        sCode,
        customerName: proj?.customerName ?? '',
        secs: 0,
      }
      entry.secs += secs
      byCode.set(sCode, entry)
    }
  }

  const byProperty: DumpsterOverflowRow[] = [...byCode.values()]
    .map(e => ({ projectId: e.projectId, sCode: e.sCode, customerName: e.customerName, hours: e.secs / 3600 }))
    .sort((a, b) => b.hours - a.hours)

  const noProjectHours = noProjectSecs / 3600

  return {
    byProperty,
    noProjectHours,
    totalHours: byProperty.reduce((s, p) => s + p.hours, 0) + noProjectHours,
    weeks: spanWeeks,
    cardsScanned: cards.length,
    start,
    end,
  }
}
