import { NextResponse } from 'next/server'
import { isWorkyardMockEnabled, generateMockEmployees } from '@/lib/payroll/workyard-mock'

const BASE_URL = 'https://api.workyard.com'
const API_KEY = process.env.WORKYARD_API_KEY!
const ORG_ID = process.env.WORKYARD_ORG_ID!

export interface WYEmployeeBasic {
  employee_id: number
  display_name: string
  first_name: string
  last_name: string
  email: string | null
  status: string
  title: string | null
  /** Hourly pay rate pulled from Workyard (mock-provided when WORKYARD_MOCK=1). */
  hourly_rate: number | null
}

interface WYListResponse<T> {
  data: T[]
  meta: { current_page: number; last_page: number; total: number; per_page: number }
}

/**
 * Read an hourly wage off a raw Workyard employee object, defensively. Workyard's
 * exact wage field is not yet confirmed against a live org, so we check the common
 * shapes (flat number, string, *_cents, or a nested wage object). When real creds
 * are available, verify the field name and tighten this.
 */
function parseWorkyardWage(e: Record<string, unknown>): number | null {
  for (const k of ['wage', 'pay_rate', 'hourly_rate', 'hourly_wage', 'default_wage', 'rate']) {
    const v = e[k]
    if (typeof v === 'number' && v > 0) return v
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) > 0) return Number(v)
  }
  for (const k of ['wage_cents', 'pay_rate_cents', 'hourly_wage_cents']) {
    const v = e[k]
    if (typeof v === 'number' && v > 0) return Math.round(v) / 100
  }
  const nested = e['wage']
  if (nested && typeof nested === 'object') {
    const amt = (nested as Record<string, unknown>).amount ?? (nested as Record<string, unknown>).rate
    if (typeof amt === 'number' && amt > 0) return amt
  }
  return null
}

export async function GET() {
  // Mock path: deterministic roster with rates, no creds needed (WORKYARD_MOCK=1).
  if (isWorkyardMockEnabled()) {
    return NextResponse.json({ employees: generateMockEmployees(), mock: true })
  }

  if (!API_KEY || !ORG_ID) {
    return NextResponse.json({ error: 'Workyard API credentials not configured' }, { status: 500 })
  }

  try {
    const employees: WYEmployeeBasic[] = []
    let page = 1

    while (true) {
      const qs = `limit=100&page=${page}&sort_by=asc:employee_display_name`

      const res = await fetch(`${BASE_URL}/orgs/${ORG_ID}/employees.v2?${qs}`, {
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Workyard API ${res.status}: ${body}`)
      }

      const data = (await res.json()) as WYListResponse<Record<string, unknown>>
      for (const e of data.data) {
        employees.push({
          employee_id: Number(e.employee_id),
          display_name: String(e.display_name ?? ''),
          first_name: String(e.first_name ?? ''),
          last_name: String(e.last_name ?? ''),
          email: (e.email as string | null) ?? null,
          status: String(e.status ?? ''),
          title: (e.title as string | null) ?? null,
          hourly_rate: parseWorkyardWage(e),
        })
      }
      if (page >= data.meta.last_page) break
      page++
    }

    return NextResponse.json({ employees })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
