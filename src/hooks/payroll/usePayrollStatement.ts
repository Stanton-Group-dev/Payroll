'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollWeek, PayrollInvoice, PayrollADPReconciliation } from '@/lib/supabase/types'

export function usePayrollStatement(weekId: string) {
  const [week, setWeek] = useState<PayrollWeek | null>(null)
  const [invoices, setInvoices] = useState<PayrollInvoice[]>([])
  const [adpRecon, setAdpRecon] = useState<PayrollADPReconciliation | null>(null)
  const [reimbursementsTotal, setReimbursementsTotal] = useState(0)
  const [approved, setApproved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [weekRes, invRes, approvalRes, reconRes, adjRes] = await Promise.all([
      supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
      supabase.from('payroll_invoices').select('*').eq('payroll_week_id', weekId).order('owner_llc'),
      supabase.from('payroll_approvals').select('*').eq('payroll_week_id', weekId).eq('stage', 'statement'),
      supabase.from('payroll_adp_reconciliation').select('*').eq('payroll_week_id', weekId).maybeSingle(),
      supabase.from('payroll_adjustments').select('amount, type').eq('payroll_week_id', weekId).eq('is_active', true),
    ])
    if (weekRes.error) { setError(weekRes.error.message); setLoading(false); return }
    setWeek(weekRes.data)
    setInvoices(invRes.data ?? [])
    setApproved((approvalRes.data?.length ?? 0) > 0)
    setAdpRecon(reconRes.data ?? null)
    const reimbTotal = (adjRes.data ?? [])
      .filter((a: { type: string; amount: number }) => a.type === 'phone' || a.type === 'tool')
      .reduce((s: number, a: { amount: number }) => s + Math.max(0, Number(a.amount)), 0)
    setReimbursementsTotal(Math.round(reimbTotal * 100) / 100)
    setLoading(false)
  }, [weekId])

  useEffect(() => { load() }, [load])

  const approveStatement = useCallback(async (invoiceIds: string[]) => {
    setApproving(true)
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id
    const { error: approvalErr } = await supabase.from('payroll_approvals').insert({
      payroll_week_id: weekId,
      stage: 'statement',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    if (approvalErr) { setError(approvalErr.message); setApproving(false); return }
    const { error: weekErr } = await supabase.from('payroll_weeks').update({ status: 'statement_sent' }).eq('id', weekId)
    if (weekErr) { setError(weekErr.message); setApproving(false); return }
    for (const id of invoiceIds) {
      const { error: invoiceErr } = await supabase.from('payroll_invoices').update({ status: 'sent' }).eq('id', id)
      if (invoiceErr) { setError(invoiceErr.message); setApproving(false); return }
    }
    setApproved(true)
    setApproving(false)
  }, [weekId])

  return {
    week, invoices, adpRecon, reimbursementsTotal, approved, loading, error, approving,
    approveStatement, refetch: load,
  }
}
