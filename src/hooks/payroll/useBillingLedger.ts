'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RawBillingInvoice, RawBillingWeek } from '@/lib/payroll/billing'

/**
 * Fetches every invoice (with line items + its week) and every payroll week.
 * Read-only — aggregation into the by-LLC ledger happens in buildBillingLedger
 * so the view and exports share one computation. Creating invoices stays in the
 * per-week flow; this hook never writes.
 */
export function useBillingLedger() {
  const [invoices, setInvoices] = useState<RawBillingInvoice[]>([])
  const [weeks, setWeeks] = useState<RawBillingWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [invRes, weekRes] = await Promise.all([
      supabase
        .from('payroll_invoices')
        .select(`
          id, payroll_week_id, owner_llc, status, total_amount,
          week:payroll_weeks(week_start, week_end),
          line_items:payroll_invoice_line_items(labor_amount, spread_amount, mgmt_fee_amount, total_amount)
        `),
      supabase
        .from('payroll_weeks')
        .select('id, week_start, week_end, status')
        .order('week_start', { ascending: false }),
    ])
    if (invRes.error) { setError(invRes.error.message); setLoading(false); return }
    if (weekRes.error) { setError(weekRes.error.message); setLoading(false); return }
    setInvoices((invRes.data ?? []) as unknown as RawBillingInvoice[])
    setWeeks((weekRes.data ?? []) as RawBillingWeek[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { invoices, weeks, loading, error, refetch: load }
}
