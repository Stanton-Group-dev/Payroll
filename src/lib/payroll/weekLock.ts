import type { SupabaseClient } from '@supabase/supabase-js'

export const LOCKED_WEEK_STATUSES = ['payroll_approved', 'invoiced', 'statement_sent'] as const

/** Throws a friendly error if the given payroll week is locked (approved or later).
 *  Use before any write to a week-scoped pay table. */
export async function assertWeekWritable(supabase: SupabaseClient, weekId: string | null | undefined): Promise<void> {
  if (!weekId) return
  const { data, error } = await supabase.from('payroll_weeks').select('status').eq('id', weekId).maybeSingle()
  if (error) throw new Error(`Could not verify week lock state: ${error.message}`)
  if (data && (LOCKED_WEEK_STATUSES as readonly string[]).includes(data.status)) {
    throw new Error('This payroll week is locked — it has been approved and its hours, adjustments, allocations, and mileage can no longer be changed. Make corrections as a carry-forward in the current week.')
  }
}

/**
 * Admin escape hatch — reopen a locked (approved) week so its hours, adjustments, allocations,
 * and costs can be edited and recomputed. Moves the week back to `corrections_complete` (an
 * UNLOCKED status) and clears the payroll-stage approval so the review page offers
 * "Approve Payroll" again. Pay data is untouched; re-approving re-runs the engine and re-stores
 * payroll_weekly_property_costs (picking up the latest math). No-op if the week isn't locked.
 *
 * Manager/admin only — enforced by RLS on payroll_weeks / payroll_approvals. The DB lock
 * trigger only guards the six pay-input tables, NOT payroll_weeks.status, so flipping the
 * status here is permitted and is exactly what re-enables writes.
 */
export async function reopenWeek(supabase: SupabaseClient, weekId: string): Promise<void> {
  const { data, error } = await supabase.from('payroll_weeks').select('status').eq('id', weekId).maybeSingle()
  if (error) throw new Error(`Could not read week: ${error.message}`)
  if (!data) throw new Error('Week not found.')
  if (!(LOCKED_WEEK_STATUSES as readonly string[]).includes(data.status)) return // already open
  const { error: updErr } = await supabase
    .from('payroll_weeks')
    .update({ status: 'corrections_complete' })
    .eq('id', weekId)
  if (updErr) throw new Error(`Could not reopen week: ${updErr.message}`)
  const { error: delErr } = await supabase
    .from('payroll_approvals')
    .delete()
    .eq('payroll_week_id', weekId)
    .eq('stage', 'payroll')
  if (delErr) throw new Error(`Week reopened, but the old approval record could not be cleared: ${delErr.message}`)
}
