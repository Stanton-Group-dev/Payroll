import {
  MONITASK_TOKEN_URL,
  MONITASK_API_BASE,
  MONITASK_ORG_TIMEZONE,
} from '@/lib/payroll/config'
import { isMonitaskMockEnabled, generateMockActivity } from '@/lib/payroll/monitask-mock'
import type { MonitaskActivityRow } from '@/lib/payroll/timesources/types'

/**
 * Monitask client — the remote-worker activity source (reference data for the
 * separate remote payroll run). Mirrors workyard-api.ts in spirit but Monitask's
 * auth is different: OAuth2 / IdentityServer with short-lived (~1h) access tokens
 * that must be refreshed, not a static API key.
 *
 * Two things are deliberately isolated so the integration is testable now and a
 * one-spot change once Monitask grants real access:
 *   1. getAccessToken() — the full refresh-token grant + in-memory token cache.
 *   2. fetchActivityRaw() — the SINGLE HTTP call to the activity/report endpoint.
 *      The exact path/params are gated behind Monitask's manual developer-portal
 *      grant and not yet public; override via MONITASK_ACTIVITY_PATH and adjust
 *      the response mapping in mapActivityResponse() when the contract is known.
 */

const CLIENT_ID = process.env.MONITASK_CLIENT_ID
const CLIENT_SECRET = process.env.MONITASK_CLIENT_SECRET
const REFRESH_TOKEN = process.env.MONITASK_REFRESH_TOKEN
/** TODO: confirm the real path from the Monitask developer portal grant. */
const ACTIVITY_PATH = process.env.MONITASK_ACTIVITY_PATH ?? '/v1/reports/activity'

interface MonitaskDebugContext {
  endpoint: string
  query?: string
  startDate?: string
  endDate?: string
}

class MonitaskApiError extends Error {
  status: number
  bodyText: string
  debug?: MonitaskDebugContext

  constructor(status: number, bodyText: string, debug?: MonitaskDebugContext) {
    super(`Monitask API ${status}: ${bodyText}`)
    this.name = 'MonitaskApiError'
    this.status = status
    this.bodyText = bodyText
    this.debug = debug
  }
}

export function isMonitaskApiError(err: unknown): err is MonitaskApiError {
  return err instanceof MonitaskApiError
}

export function isMonitaskConfigured(): boolean {
  return isMonitaskMockEnabled() || (!!CLIENT_ID && !!CLIENT_SECRET && !!REFRESH_TOKEN)
}

/* ------------------------------------------------------------------ */
/* OAuth: refresh-token grant with a small in-memory token cache.     */
/* ------------------------------------------------------------------ */

let cachedToken: { accessToken: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  // Reuse a still-valid token (refresh 60s early to avoid edge expiry).
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.accessToken
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Monitask credentials not configured')
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN,
  })

  const res = await fetch(MONITASK_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new MonitaskApiError(res.status, text, { endpoint: MONITASK_TOKEN_URL })
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new MonitaskApiError(500, 'Token response missing access_token', {
      endpoint: MONITASK_TOKEN_URL,
    })
  }
  const expiresInMs = (json.expires_in ?? 3600) * 1000
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + expiresInMs }
  return cachedToken.accessToken
}

/* ------------------------------------------------------------------ */
/* Data fetch — the single endpoint-specific seam.                    */
/* ------------------------------------------------------------------ */

/** Add `days` to a YYYY-MM-DD string (UTC-safe), returning YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Raw shape we expect from the report endpoint. Adjust once the contract is known. */
interface MonitaskActivityApiItem {
  user_id?: string | number
  user_name?: string
  date?: string
  active_seconds?: number
  active_hours?: number
  productivity?: number
}

async function fetchActivityRaw(
  startDate: string,
  endDate: string,
): Promise<MonitaskActivityApiItem[]> {
  const token = await getAccessToken()
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
  const url = `${MONITASK_API_BASE}${ACTIVITY_PATH}?${params.toString()}`
  const debug: MonitaskDebugContext = {
    endpoint: `${MONITASK_API_BASE}${ACTIVITY_PATH}`,
    query: params.toString(),
    startDate,
    endDate,
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[monitask] activity request', debug)
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new MonitaskApiError(res.status, await res.text(), debug)
  }
  const json = (await res.json()) as { data?: MonitaskActivityApiItem[] } | MonitaskActivityApiItem[]
  return Array.isArray(json) ? json : (json.data ?? [])
}

function mapActivityResponse(items: MonitaskActivityApiItem[]): MonitaskActivityRow[] {
  return items
    .filter((it) => it.user_id != null && it.date)
    .map((it) => {
      const activeHours =
        it.active_hours ?? (it.active_seconds != null ? it.active_seconds / 3600 : 0)
      return {
        monitaskUserId: String(it.user_id),
        employeeName: it.user_name ?? `Monitask ${it.user_id}`,
        entryDate: it.date as string,
        activeHours: Math.round(activeHours * 100) / 100,
        productivityPct: it.productivity ?? null,
        raw: it as Record<string, unknown>,
      }
    })
}

/**
 * Fetch a week of Monitask activity for `weekStart` (a Sunday YYYY-MM-DD).
 * Returns reference rows — these are NOT paid directly; they feed the optional
 * overpay check against remote workers' self-submitted hours.
 */
export async function fetchMonitaskActivity(
  weekStart: string,
): Promise<{ rows: MonitaskActivityRow[]; stats: { workers: number; days: number } }> {
  // Dev/test path: deterministic dummy activity instead of calling Monitask.
  if (isMonitaskMockEnabled()) {
    return generateMockActivity(weekStart)
  }

  // Monitask reports by calendar date; pull Mon..Sat of the run week (start is Sunday).
  const startDate = weekStart
  const endDate = addDays(weekStart, 6)

  const items = await fetchActivityRaw(startDate, endDate)
  const rows = mapActivityResponse(items)
  const workers = new Set(rows.map((r) => r.monitaskUserId)).size
  const days = new Set(rows.map((r) => r.entryDate)).size

  // MONITASK_ORG_TIMEZONE reserved for future day-boundary normalization if the
  // report endpoint returns timestamps rather than calendar dates.
  void MONITASK_ORG_TIMEZONE

  return { rows, stats: { workers, days } }
}
