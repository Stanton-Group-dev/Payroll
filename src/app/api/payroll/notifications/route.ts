import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTwilioLive, isTwilioConfigured, sendSms } from '@/lib/payroll/twilio-api'
import {
  DEFAULT_UNALLOCATED_SMS_TEMPLATE,
  SMS_TEMPLATE_PLACEHOLDERS,
  getUnallocatedSmsTemplate,
} from '@/lib/payroll/unallocatedHolds'

export const runtime = 'nodejs'

const MANAGER_ROLES = ['superadmin', 'admin', 'manager']

/** Resolve the caller and enforce manager-or-above. Returns the admin client + userId. */
async function authorize() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'manager'
  if (!MANAGER_ROLES.includes(role)) {
    return { error: NextResponse.json({ error: 'Manager access required' }, { status: 403 }) }
  }
  const admin = createAdminClient()
  if (!admin) return { error: NextResponse.json({ error: 'Service role key not configured' }, { status: 503 }) }
  return { admin, userId: user.id }
}

/**
 * GET /api/payroll/notifications?weekId=&limit=
 * Powers the Admin → Employee SMS screen: SMS provider status, the editable
 * template (+ its built-in default and placeholder legend), and the recent
 * outbox (every send attempt, joined to employee + week). `weekId` filters the
 * outbox to one week; `limit` caps rows (default 100, max 500).
 */
export async function GET(req: NextRequest) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { admin } = auth

  const weekId = req.nextUrl.searchParams.get('weekId')
  const limitParam = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100

  try {
    let query = admin
      .from('payroll_notifications')
      .select('*, employee:payroll_employees(id, name), week:payroll_weeks(id, week_start, week_end)')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (weekId) query = query.eq('payroll_week_id', weekId)
    const { data: outbox, error } = await query
    if (error) throw new Error(error.message)

    const template = await getUnallocatedSmsTemplate(admin)

    return NextResponse.json({
      twilioLive: isTwilioLive(),
      twilioConfigured: isTwilioConfigured(),
      template,
      defaultTemplate: DEFAULT_UNALLOCATED_SMS_TEMPLATE,
      placeholders: SMS_TEMPLATE_PLACEHOLDERS,
      outbox: outbox ?? [],
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load notifications' }, { status: 500 })
  }
}

/**
 * POST /api/payroll/notifications
 *   { action: 'save_template', template }   → store the unallocated-hours SMS body (empty = revert to default)
 *   { action: 'test', to }                  → send a test SMS to `to`, recorded in the outbox
 */
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  let body: { action?: string; template?: string; to?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  try {
    if (body.action === 'save_template') {
      // Empty/whitespace clears the override so the built-in default is used again.
      const value = (body.template ?? '').trim() || null

      // Singleton config: update the latest row, or seed one if none exists yet.
      const { data: existing } = await admin
        .from('payroll_global_config')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        const { error } = await admin
          .from('payroll_global_config')
          .update({ unallocated_sms_template: value, created_by: userId })
          .eq('id', existing.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await admin
          .from('payroll_global_config')
          .insert({ unallocated_sms_template: value, created_by: userId })
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true, template: value ?? DEFAULT_UNALLOCATED_SMS_TEMPLATE })
    }

    if (body.action === 'test') {
      const to = (body.to ?? '').trim()
      if (!to) return NextResponse.json({ error: 'A destination phone number is required' }, { status: 400 })
      const msg = 'Stanton Management Payroll: this is a test message confirming SMS is configured. No action needed.'

      const res = await sendSms(to, msg)
      const status = res.status
      const providerRef = res.status === 'sent' ? res.providerRef : null
      const error = res.status === 'failed' ? res.error : null

      // Record the test in the outbox too, so it shows in history. Tests aren't tied to
      // an employee (employee_id is nullable as of 20260624_01).
      const { error: logErr } = await admin.from('payroll_notifications').insert({
        payroll_week_id: null,
        employee_id: null,
        channel: 'sms',
        to_address: to,
        body: msg,
        status,
        provider: res.provider,
        provider_ref: providerRef,
        error,
        created_by: userId,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })
      if (logErr) console.error('test notification log failed', logErr.message)

      return NextResponse.json({ ok: true, status, providerRef, error, live: isTwilioLive() })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Operation failed' }, { status: 500 })
  }
}
