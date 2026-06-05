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
  /** Hourly pay rate from Workyard (`pay_rate` on the v1 employees endpoint). */
  hourly_rate: number | null
  /** Workyard pay_type: 'hourly' | '1099' | 'salary' | etc. Helps the user judge the rate. */
  pay_type: string | null
}

/**
 * Raw v1 employee shape (subset). NOTE: the v1 `/employees` endpoint exposes
 * pay_rate / pay_type; the newer `/employees.v2` endpoint omits them — that is
 * why we use v1 here.
 */
interface WYEmployeeV1 {
  employee_id: number
  first_name?: string
  last_name?: string
  display_name?: string
  email?: string | null
  title?: string | null
  pay_rate?: number | string | null
  pay_type?: string | null
  is_pending_profile?: boolean
  end_dt_unix?: number | null
}

interface WYListResponse<T> {
  data: T[]
  meta: { current_page: number; last_page: number; total: number; per_page: number }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && v > 0) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) > 0) return Number(v)
  return null
}

function mapV1(e: WYEmployeeV1): WYEmployeeBasic {
  const first = e.first_name ?? ''
  const last = e.last_name ?? ''
  return {
    employee_id: Number(e.employee_id),
    display_name: e.display_name ?? `${first} ${last}`.trim(),
    first_name: first,
    last_name: last,
    email: e.email ?? null,
    status: e.end_dt_unix ? 'inactive' : e.is_pending_profile ? 'pending' : 'active',
    title: e.title ?? null,
    hourly_rate: toNumber(e.pay_rate),
    pay_type: e.pay_type ?? null,
  }
}

export async function GET() {
  // Prefer real Workyard whenever creds are present — the v1 employees endpoint
  // returns the actual pay_rate. The mock is only a no-creds fallback so the
  // sync flow still works offline. (WORKYARD_MOCK governs timecards separately.)
  if (API_KEY && ORG_ID) {
    try {
      const employees: WYEmployeeBasic[] = []
      let page = 1
      while (true) {
        const res = await fetch(`${BASE_URL}/orgs/${ORG_ID}/employees?limit=100&page=${page}`, {
          headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = await res.text()
          throw new Error(`Workyard API ${res.status}: ${body}`)
        }
        const data = (await res.json()) as WYListResponse<WYEmployeeV1>
        for (const e of data.data) employees.push(mapV1(e))
        if (page >= data.meta.last_page) break
        page++
      }
      return NextResponse.json({ employees })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  // No creds: deterministic mock roster (with illustrative rates) for offline use.
  if (isWorkyardMockEnabled()) {
    return NextResponse.json({ employees: generateMockEmployees(), mock: true })
  }

  return NextResponse.json({ error: 'Workyard API credentials not configured' }, { status: 500 })
}
