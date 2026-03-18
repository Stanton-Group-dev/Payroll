'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollWeek } from '@/lib/supabase/types'

export function usePayrollWeeks() {
  const [weeks, setWeeks] = useState<PayrollWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_weeks')
      .select('*')
      .order('week_start', { ascending: false })
    if (err) setError(err.message)
    else setWeeks(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const createWeek = useCallback(async (weekStart: string, weekEnd: string) => {
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_weeks')
      .insert({ week_start: weekStart, week_end: weekEnd, status: 'draft' })
      .select()
      .single()
    if (err) throw new Error(err.message)
    await fetch()
    return data as PayrollWeek
  }, [fetch])

  const deleteWeek = useCallback(async (weekId: string) => {
    const supabase = createClient()

    // Delete child records in FK-safe order (deepest children first)
    // 1. Records that reference payroll_time_entries
    const { data: timeEntryIds } = await supabase
      .from('payroll_time_entries')
      .select('id')
      .eq('payroll_week_id', weekId)
    if (timeEntryIds && timeEntryIds.length > 0) {
      const ids = timeEntryIds.map(r => r.id)
      await supabase.from('payroll_timesheet_corrections').delete().in('time_entry_id', ids)
    }

    // 2. Records that reference payroll_invoices
    const { data: invoiceIds } = await supabase
      .from('payroll_invoices')
      .select('id')
      .eq('payroll_week_id', weekId)
    if (invoiceIds && invoiceIds.length > 0) {
      const ids = invoiceIds.map(r => r.id)
      await supabase.from('payroll_invoice_line_items').delete().in('invoice_id', ids)
    }

    // 3. Records that reference payroll_adp_reconciliation
    const { data: adpIds } = await supabase
      .from('payroll_adp_reconciliation')
      .select('id')
      .eq('payroll_week_id', weekId)
    if (adpIds && adpIds.length > 0) {
      const ids = adpIds.map(r => r.id)
      await supabase.from('payroll_adp_recon_rows').delete().in('reconciliation_id', ids)
    }

    // 4. Records that reference payroll_expense_submissions
    const { data: expSubIds } = await supabase
      .from('payroll_expense_submissions')
      .select('id')
      .eq('payroll_week_id', weekId)
    if (expSubIds && expSubIds.length > 0) {
      const ids = expSubIds.map(r => r.id)
      await supabase.from('payroll_expense_approvals').delete().in('submission_id', ids)
      await supabase.from('payroll_expense_items').delete().in('submission_id', ids)
    }

    // 5. Direct children of payroll_weeks
    await supabase.from('payroll_time_entries').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_adjustments').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_approvals').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_invoices').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_weekly_property_costs').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_spread_events').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_expense_submissions').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_adp_reconciliation').delete().eq('payroll_week_id', weekId)
    await supabase.from('payroll_dept_split_overrides').delete().eq('payroll_week_id', weekId)

    // 6. Null out prior_week_id references (don't cascade-delete unrelated records)
    await supabase.from('payroll_adjustments').update({ prior_week_id: null }).eq('prior_week_id', weekId)
    await supabase.from('payroll_expense_items').update({ prior_week_id: null }).eq('prior_week_id', weekId)

    // 7. Finally delete the week itself
    const { error: err } = await supabase
      .from('payroll_weeks')
      .delete()
      .eq('id', weekId)
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  return { weeks, loading, error, refetch: fetch, createWeek, deleteWeek }
}
