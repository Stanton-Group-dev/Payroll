import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTwilioLive } from '@/lib/payroll/twilio-api'
import { applyUnallocatedHolds } from '@/lib/payroll/unallocatedHolds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Daily unallocated-hours notification job (Vercel Cron → GET this route).
 *
 * GATED THREE WAYS, in order:
 *   1. CRON_SECRET — Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. No secret
 *      (or a wrong one) → 401. Nothing public can trigger this.
 *   2. The master switch — payroll_global_config.unallocated_notifications_enabled.
 *      FALSE by default, so the feature ships dormant: the cron fires daily but does
 *      nothing until an admin turns it on from the Settings page.
 *   3. Twilio config — sends stay in dry-run (logged, not delivered) until TWILIO_* is
 *      configured. Going live needs no code change.
 *
 * The manual "Hold & notify" button (POST /api/payroll/holds) is independent of all this.
 */

// Weeks still open for time edits. A closed week (payroll_approved / invoiced /
// statement_sent) can no longer be fixed in Workyard, so there's nothing to chase.
const OPEN_WEEK_STATUSES = ['draft', 'corrections_complete']
// Don't chase ancient lingering drafts — only weeks that ended within this window.
const MAX_WEEK_AGE_DAYS = 21
// One text per employee per week per 24h, even if a manager also clicks Apply today.
const DEDUPE_WINDOW_HOURS = 24

export async function GET(req: NextRequest) {
  // 1) Authenticate the scheduler.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Service role key not configured' }, { status: 503 })
  }

  // 2) The master switch — OFF by default. This is the gate the UI toggle controls.
  const { data: cfg, error: cfgErr } = await admin
    .from('payroll_global_config')
    .select('unallocated_notifications_enabled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr.message }, { status: 500 })
  }
  if (!cfg?.unallocated_notifications_enabled) {
    return NextResponse.json({ ok: true, enabled: false, skipped: 'feature disabled', weeks: [] })
  }

  // 3) Run detection + notification for every open, recent week.
  const cutoff = new Date(Date.now() - MAX_WEEK_AGE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data: weeks, error: weeksErr } = await admin
    .from('payroll_weeks')
    .select('id, week_start, week_end, status')
    .in('status', OPEN_WEEK_STATUSES)
    .gte('week_end', cutoff)
    .order('week_end', { ascending: false })
  if (weeksErr) {
    return NextResponse.json({ error: weeksErr.message }, { status: 500 })
  }

  const results: Array<Record<string, unknown>> = []
  for (const w of weeks ?? []) {
    try {
      const r = await applyUnallocatedHolds(admin, {
        weekId: w.id,
        userId: null, // system actor — held_by stays null so it reads as automated
        dedupeWindowHours: DEDUPE_WINDOW_HOURS,
        respectResolvedHolds: true, // never re-arm a hold a manager already released/waived
        continueOnError: true, // one bad row shouldn't suppress the rest of the week
      })
      const counts = r.held.reduce<Record<string, number>>((acc, h) => {
        acc[h.notification_status] = (acc[h.notification_status] ?? 0) + 1
        return acc
      }, {})
      results.push({ weekId: w.id, week_start: w.week_start, held: r.held.length, ...counts })
    } catch (e: unknown) {
      results.push({ weekId: w.id, week_start: w.week_start, error: e instanceof Error ? e.message : 'failed' })
    }
  }

  return NextResponse.json({ ok: true, enabled: true, twilioLive: isTwilioLive(), weeks: results })
}
