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
