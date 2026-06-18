// Unallocated-hours pay holds. SERVER ONLY (uses the service-role client and the
// Twilio client). The API route in src/app/api/payroll/holds owns auth + the
// admin client; this module is the deterministic core: detect who's unallocated,
// compose the message, apply holds + send texts, and release a hold.
//
// "Unallocated" == an active time entry with no property_id. Tiny fragments are
// ignored via a threshold (Workyard routinely emits a few unallocated minutes).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PayrollEmployeeHold, PayrollNotification } from '@/lib/supabase/types'
import { sendSms, isTwilioLive } from '@/lib/payroll/twilio-api'

/** Below this many unallocated hours we don't hold or notify (≈15 min). */
export const UNALLOCATED_HOLD_THRESHOLD_HOURS = 0.25

const round2 = (n: number) => Math.round(n * 100) / 100

export interface UnallocatedEmployee {
  employee_id: string
  name: string
  phone: string | null
  unallocated_hours: number
}

interface WeekRow {
  id: string
  week_start: string
  week_end: string
}

/**
 * Sum unallocated (no-property) hours per employee for a week and return those at
 * or above `threshold`, with the name + phone needed to notify them.
 */
export async function detectUnallocatedEmployees(
  admin: SupabaseClient,
  weekId: string,
  threshold: number = UNALLOCATED_HOLD_THRESHOLD_HOURS,
): Promise<UnallocatedEmployee[]> {
  const { data: rows, error } = await admin
    .from('payroll_time_entries')
    .select('employee_id, regular_hours, ot_hours')
    .eq('payroll_week_id', weekId)
    .is('property_id', null)
    .eq('is_active', true)
  if (error) throw new Error(error.message)

  const hoursByEmp = new Map<string, number>()
  for (const r of rows ?? []) {
    const h = (r.regular_hours ?? 0) + (r.ot_hours ?? 0)
    hoursByEmp.set(r.employee_id, (hoursByEmp.get(r.employee_id) ?? 0) + h)
  }

  const candidateIds = [...hoursByEmp.entries()]
    .filter(([, h]) => round2(h) >= threshold)
    .map(([id]) => id)
  if (candidateIds.length === 0) return []

  const { data: emps, error: empErr } = await admin
    .from('payroll_employees')
    .select('id, name, phone')
    .in('id', candidateIds)
  if (empErr) throw new Error(empErr.message)
  const empMap = new Map((emps ?? []).map(e => [e.id, e]))

  return candidateIds
    .map(id => ({
      employee_id: id,
      name: empMap.get(id)?.name ?? 'Unknown',
      phone: empMap.get(id)?.phone ?? null,
      unallocated_hours: round2(hoursByEmp.get(id) ?? 0),
    }))
    .sort((a, b) => b.unallocated_hours - a.unallocated_hours)
}

/** The SMS body sent to an employee who's being held for unallocated hours. */
export function composeUnallocatedSms(emp: UnallocatedEmployee, week: WeekRow): string {
  const hrs = emp.unallocated_hours === 1 ? '1 hour' : `${emp.unallocated_hours} hours`
  const first = emp.name.split(' ')[0] || emp.name
  return (
    `Stanton Management Payroll: ${first}, you have ${hrs} unallocated for the week of ` +
    `${week.week_start}. Your pay is on hold until this is resolved. Please come into the ` +
    `office with a written reason explaining why these hours weren't assigned to a property.`
  )
}

export interface ApplyHoldsResult {
  twilioLive: boolean
  threshold: number
  held: Array<{
    employee_id: string
    name: string
    unallocated_hours: number
    notification_status: PayrollNotification['status']
    notification_error: string | null
  }>
}

/**
 * Apply (or refresh) holds for every employee over the threshold this week and
 * text each one. Idempotent on (week, employee): re-running updates the snapshot
 * and re-sends. Returns a per-employee summary including the send outcome.
 */
export async function applyUnallocatedHolds(
  admin: SupabaseClient,
  opts: { weekId: string; userId: string | null; threshold?: number },
): Promise<ApplyHoldsResult> {
  const threshold = opts.threshold ?? UNALLOCATED_HOLD_THRESHOLD_HOURS

  const { data: week, error: weekErr } = await admin
    .from('payroll_weeks')
    .select('id, week_start, week_end')
    .eq('id', opts.weekId)
    .single()
  if (weekErr || !week) throw new Error(weekErr?.message ?? 'Week not found')

  const candidates = await detectUnallocatedEmployees(admin, opts.weekId, threshold)
  const held: ApplyHoldsResult['held'] = []

  for (const emp of candidates) {
    // Upsert the hold, re-arming it to 'held' even if a stale 'released' row exists.
    const { error: holdErr } = await admin
      .from('payroll_employee_holds')
      .upsert(
        {
          payroll_week_id: opts.weekId,
          employee_id: emp.employee_id,
          reason: 'unallocated_hours',
          unallocated_hours: emp.unallocated_hours,
          status: 'held',
          held_by: opts.userId,
          held_at: new Date().toISOString(),
          resolution_note: null,
          released_by: null,
          released_at: null,
        },
        { onConflict: 'payroll_week_id,employee_id' },
      )
    if (holdErr) throw new Error(holdErr.message)

    const body = composeUnallocatedSms(emp, week as WeekRow)
    let status: PayrollNotification['status']
    let provider: string | null
    let providerRef: string | null = null
    let error: string | null = null

    if (!emp.phone) {
      status = 'skipped'
      provider = null
      error = 'No phone on file'
    } else {
      const res = await sendSms(emp.phone, body)
      status = res.status
      provider = res.provider
      providerRef = res.status === 'sent' ? res.providerRef : null
      error = res.status === 'failed' ? res.error : null
    }

    await admin.from('payroll_notifications').insert({
      payroll_week_id: opts.weekId,
      employee_id: emp.employee_id,
      channel: 'sms',
      to_address: emp.phone,
      body,
      status,
      provider,
      provider_ref: providerRef,
      error,
      created_by: opts.userId,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    })

    held.push({
      employee_id: emp.employee_id,
      name: emp.name,
      unallocated_hours: emp.unallocated_hours,
      notification_status: status,
      notification_error: error,
    })
  }

  return { twilioLive: isTwilioLive(), threshold, held }
}

/** Release a hold once the employee has come in with a written reason. */
export async function releaseHold(
  admin: SupabaseClient,
  opts: { holdId: string; userId: string | null; resolutionNote: string },
): Promise<PayrollEmployeeHold> {
  const note = opts.resolutionNote.trim()
  if (!note) throw new Error('A written reason is required to release the hold')

  const { data, error } = await admin
    .from('payroll_employee_holds')
    .update({
      status: 'released',
      resolution_note: note,
      released_by: opts.userId,
      released_at: new Date().toISOString(),
    })
    .eq('id', opts.holdId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PayrollEmployeeHold
}
