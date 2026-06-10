import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePortalContext } from '@/lib/payroll/portal'

export const runtime = 'nodejs'

/**
 * Portal session bootstrap. Given a worker token, returns the worker, the open
 * remote run, and any hours they've already submitted for it. No Supabase session
 * involved — the token is the credential and everything is service-role + scoped.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Portal not configured (missing service role key)' }, { status: 503 })

  const ctx = await resolvePortalContext(admin, token)
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })

  let entries: { entry_date: string; regular_hours: number }[] = []
  if (ctx.week) {
    const { data } = await admin
      .from('payroll_time_entries')
      .select('entry_date, regular_hours')
      .eq('employee_id', ctx.worker.id)
      .eq('payroll_week_id', ctx.week.id)
      .eq('source', 'remote_submitted')
      .eq('is_active', true)
    entries = (data ?? []) as { entry_date: string; regular_hours: number }[]
  }

  return NextResponse.json({
    worker: { name: ctx.worker.name },
    week: ctx.week,
    entries,
  })
}
