'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { subDays, format, parseISO } from 'date-fns'
import type {
  PayrollExpenseSubmission,
  GasAllocationEntry,
  GasAllocationAudit,
  PropertyOverride,
  ExpenseApprovalAction,
} from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GasAllocationResult {
  windowStart: string
  windowEnd: string
  entries: GasAllocationEntry[]
  noData: boolean
}

// Pre-computed per-item allocations stored in hook state (item_id -> result)
export type GasAllocationMap = Record<string, GasAllocationResult>

// ── Internal gas allocation engine (no raw Supabase in components) ────────────

async function computeGasAllocation(
  supabase: ReturnType<typeof createClient>,
  employeeId: string,
  itemAmount: number,
  submittedAt: string,
): Promise<GasAllocationResult> {
  const submittedDate = parseISO(submittedAt)

  const { data: lastApproved } = await supabase
    .from('payroll_expense_submissions')
    .select('submitted_at, items:payroll_expense_items(expense_type)')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lt('submitted_at', submittedAt)
    .order('submitted_at', { ascending: false })
    .limit(20)

  let windowStart: Date = subDays(submittedDate, 7)

  if (lastApproved) {
    for (const sub of lastApproved as unknown as { submitted_at: string; items: { expense_type: string }[] }[]) {
      if (sub.items.some(it => it.expense_type === 'gas')) {
        const lastDate = parseISO(sub.submitted_at)
        windowStart = lastDate > windowStart ? lastDate : windowStart
        break
      }
    }
  }

  const windowStartStr = format(windowStart, "yyyy-MM-dd'T'HH:mm:ssxxx")
  const windowEndStr = format(submittedDate, "yyyy-MM-dd'T'HH:mm:ssxxx")

  const { data: entries } = await supabase
    .from('payroll_time_entries')
    .select('property_id, entry_date, property:properties(id, code, name)')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('entry_date', format(windowStart, 'yyyy-MM-dd'))
    .lte('entry_date', format(submittedDate, 'yyyy-MM-dd'))
    .not('property_id', 'is', null)

  if (!entries || entries.length === 0) {
    return { windowStart: windowStartStr, windowEnd: windowEndStr, entries: [], noData: true }
  }

  const visitMap = new Map<string, { visits: Set<string>; code: string; name: string }>()
  for (const e of entries as unknown as { property_id: string; entry_date: string; property: { id: string; code: string; name: string } | null }[]) {
    if (!e.property_id || !e.property) continue
    if (!visitMap.has(e.property_id)) {
      visitMap.set(e.property_id, { visits: new Set(), code: e.property.code, name: e.property.name })
    }
    visitMap.get(e.property_id)!.visits.add(e.entry_date)
  }

  const totalVisits = Array.from(visitMap.values()).reduce((s, v) => s + v.visits.size, 0)

  const allocationEntries: GasAllocationEntry[] = Array.from(visitMap.entries()).map(([propId, v]) => {
    const visits = v.visits.size
    const pct = totalVisits > 0 ? Math.round((visits / totalVisits) * 10000) / 100 : 0
    return {
      property_id: propId,
      property_code: v.code,
      property_name: v.name,
      visits,
      pct,
      amount: Math.round(itemAmount * (pct / 100) * 100) / 100,
    }
  }).sort((a, b) => b.visits - a.visits)

  const sumAmounts = allocationEntries.reduce((s, e) => s + e.amount, 0)
  const drift = Math.round((itemAmount - sumAmounts) * 100) / 100
  if (allocationEntries.length > 0 && drift !== 0) {
    allocationEntries[0].amount = Math.round((allocationEntries[0].amount + drift) * 100) / 100
  }

  return { windowStart: windowStartStr, windowEnd: windowEndStr, entries: allocationEntries, noData: false }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useExpenseApprovals() {
  const [pendingSubmissions, setPendingSubmissions] = useState<PayrollExpenseSubmission[]>([])
  const [bookkeepingSubmissions, setBookkeepingSubmissions] = useState<PayrollExpenseSubmission[]>([])
  const [gasAllocations, setGasAllocations] = useState<GasAllocationMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPending = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const { data, error: err } = await supabase
      .from('payroll_expense_submissions')
      .select(`
        *,
        employee:payroll_employees(id, name),
        week:payroll_weeks(id, week_start, week_end),
        items:payroll_expense_items(
          *,
          property:properties(id, code, name),
          prior_week:payroll_weeks(id, week_start)
        )
      `)
      .in('status', ['pending', 'correction_requested'])
      .eq('is_active', true)
      .order('submitted_at', { ascending: true })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const submissions = (data as unknown as PayrollExpenseSubmission[]) ?? []
    setPendingSubmissions(submissions)

    // Pre-compute gas allocations so components never call Supabase directly
    const newAllocations: GasAllocationMap = {}
    for (const sub of submissions) {
      const gasItems = (sub.items ?? []).filter(
        it => it.expense_type === 'gas' && it.payment_method === 'personal'
      )
      for (const item of gasItems) {
        if (sub.submitted_at) {
          newAllocations[item.id] = await computeGasAllocation(
            supabase, sub.employee_id, item.amount, sub.submitted_at,
          )
        }
      }
    }
    setGasAllocations(newAllocations)
    setLoading(false)
  }, [])

  const fetchBookkeeping = useCallback(async () => {
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_expense_submissions')
      .select(`
        *,
        employee:payroll_employees(id, name),
        week:payroll_weeks(id, week_start, week_end),
        items:payroll_expense_items(
          *,
          property:properties(id, code, name)
        )
      `)
      .eq('status', 'bookkeeping_only')
      .eq('is_active', true)
      .order('submitted_at', { ascending: false })
      .limit(100)

    if (err) { setError(err.message); return }
    setBookkeepingSubmissions((data as unknown as PayrollExpenseSubmission[]) ?? [])
  }, [])

  useEffect(() => {
    fetchPending()
    fetchBookkeeping()
  }, [fetchPending, fetchBookkeeping])

  // ── Approve ───────────────────────────────────────────────────────────────
  const approveSubmission = useCallback(async (params: {
    submission: PayrollExpenseSubmission
    finalAllocations: Map<string, GasAllocationEntry[]>
    propertyOverrides: PropertyOverride[]
    gasAudit: Map<string, GasAllocationAudit>
    notes: string
  }) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    const { submission, finalAllocations, propertyOverrides, gasAudit, notes } = params

    for (const [itemId, entries] of Array.from(finalAllocations.entries())) {
      const { error: err } = await supabase
        .from('payroll_expense_items')
        .update({ allocation_detail: entries })
        .eq('id', itemId)
      if (err) throw new Error(`Failed to write gas allocation: ${err.message}`)
    }

    for (const ov of propertyOverrides) {
      const { error: err } = await supabase
        .from('payroll_expense_items')
        .update({ property_id: ov.new_property_id })
        .eq('id', ov.item_id)
      if (err) throw new Error(`Failed to apply property override: ${err.message}`)
    }

    const combinedAudit = Array.from(gasAudit.entries()).map(([auditItemId, audit]) => ({
      item_id: auditItemId,
      ...audit,
    }))

    const { error: approvalErr } = await supabase
      .from('payroll_expense_approvals')
      .insert({
        submission_id: submission.id,
        action: 'approved' as ExpenseApprovalAction,
        actioned_by: userId,
        notes: notes || null,
        gas_allocation_audit: combinedAudit.length > 0 ? combinedAudit : null,
        property_overrides: propertyOverrides.length > 0 ? propertyOverrides : null,
        created_by: userId,
      })
    if (approvalErr) throw new Error(approvalErr.message)

    const { error: statusErr } = await supabase
      .from('payroll_expense_submissions')
      .update({ status: 'approved' })
      .eq('id', submission.id)
    if (statusErr) throw new Error(statusErr.message)

    const personalItems = (submission.items ?? []).filter(it => it.payment_method === 'personal')
    const companyItems = (submission.items ?? []).filter(
      it => it.payment_method === 'company_card' || it.payment_method === 'company_account'
    )

    for (const item of personalItems) {
      if (item.expense_type === 'gas' && finalAllocations.has(item.id)) {
        for (const alloc of Array.from(finalAllocations.get(item.id) ?? [])) {
          const { error: adjErr } = await supabase.from('payroll_adjustments').insert({
            payroll_week_id: submission.payroll_week_id,
            employee_id: submission.employee_id,
            type: 'expense_reimbursement',
            amount: alloc.amount,
            description: `Gas reimbursement - ${alloc.property_code ?? alloc.property_id}`,
            allocation_method: 'direct',
            property_id: alloc.property_id,
            expense_submission_id: submission.id,
            expense_item_id: item.id,
            prior_week_id: item.prior_week_id ?? null,
            created_by: userId,
          })
          if (adjErr) throw new Error(`Failed to create adjustment: ${adjErr.message}`)
        }
      } else if (item.expense_type === 'tools') {
        const { error: adjErr } = await supabase.from('payroll_adjustments').insert({
          payroll_week_id: submission.payroll_week_id,
          employee_id: submission.employee_id,
          type: 'expense_reimbursement',
          amount: item.amount,
          description: 'Tools reimbursement',
          allocation_method: 'unit_weighted',
          property_id: null,
          expense_submission_id: submission.id,
          expense_item_id: item.id,
          prior_week_id: item.prior_week_id ?? null,
          created_by: userId,
        })
        if (adjErr) throw new Error(`Failed to create adjustment: ${adjErr.message}`)
      } else {
        const finalPropertyId = propertyOverrides.find(o => o.item_id === item.id)?.new_property_id ?? item.property_id
        const label = item.expense_type.charAt(0).toUpperCase() + item.expense_type.slice(1)
        const { error: adjErr } = await supabase.from('payroll_adjustments').insert({
          payroll_week_id: submission.payroll_week_id,
          employee_id: submission.employee_id,
          type: 'expense_reimbursement',
          amount: item.amount,
          description: `${label} reimbursement${item.description ? ` - ${item.description}` : ''}`,
          allocation_method: 'direct',
          property_id: finalPropertyId ?? null,
          expense_submission_id: submission.id,
          expense_item_id: item.id,
          prior_week_id: item.prior_week_id ?? null,
          created_by: userId,
        })
        if (adjErr) throw new Error(`Failed to create adjustment: ${adjErr.message}`)
      }
    }

    // Mixed-payment: entire company-card batch goes to bookkeeping_only;
    // mixed batches stay approved but get a bookkeeping audit record
    if (companyItems.length > 0) {
      if (personalItems.length === 0) {
        const { error: bokErr } = await supabase
          .from('payroll_expense_submissions')
          .update({ status: 'bookkeeping_only' })
          .eq('id', submission.id)
        if (bokErr) throw new Error(`Failed to update submission to bookkeeping_only: ${bokErr.message}`)
      } else {
        const { error: routeAuditErr } = await supabase.from('payroll_expense_approvals').insert({
          submission_id: submission.id,
          action: 'routed_to_bookkeeping' as ExpenseApprovalAction,
          actioned_by: userId,
          notes: `${companyItems.length} company card item(s) in approved batch flagged for bookkeeping reconciliation.`,
          created_by: userId,
        })
        if (routeAuditErr) throw new Error(`Failed to insert bookkeeping audit record: ${routeAuditErr.message}`)
      }
    }

    await fetchPending()
    await fetchBookkeeping()
  }, [fetchPending, fetchBookkeeping])

  // ── Reject ────────────────────────────────────────────────────────────────
  const rejectSubmission = useCallback(async (submissionId: string, notes: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    const { error: approvalErr } = await supabase.from('payroll_expense_approvals').insert({
      submission_id: submissionId,
      action: 'rejected' as ExpenseApprovalAction,
      actioned_by: userId,
      notes,
      created_by: userId,
    })
    if (approvalErr) throw new Error(`Failed to insert rejection approval record: ${approvalErr.message}`)
    const { error: statusErr } = await supabase.from('payroll_expense_submissions').update({ status: 'rejected' }).eq('id', submissionId)
    if (statusErr) throw new Error(`Failed to update submission status to rejected: ${statusErr.message}`)
    await fetchPending()
  }, [fetchPending])

  // ── Request correction ────────────────────────────────────────────────────
  const requestCorrection = useCallback(async (submissionId: string, notes: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    const { error: approvalErr } = await supabase.from('payroll_expense_approvals').insert({
      submission_id: submissionId,
      action: 'correction_requested' as ExpenseApprovalAction,
      actioned_by: userId,
      notes,
      created_by: userId,
    })
    if (approvalErr) throw new Error(`Failed to insert correction_requested approval record: ${approvalErr.message}`)
    const { error: statusErr } = await supabase
      .from('payroll_expense_submissions')
      .update({ status: 'correction_requested' })
      .eq('id', submissionId)
    if (statusErr) throw new Error(`Failed to update submission status to correction_requested: ${statusErr.message}`)
    await fetchPending()
  }, [fetchPending])

  // ── Resolve payment method ────────────────────────────────────────────────
  const resolvePaymentMethod = useCallback(async (
    submissionId: string,
    itemId: string,
    resolvedMethod: 'personal' | 'company_card' | 'company_account',
    notes: string,
  ) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    const { error: itemErr } = await supabase.from('payroll_expense_items').update({ payment_method: resolvedMethod }).eq('id', itemId)
    if (itemErr) throw new Error(`Failed to update payment method on expense item: ${itemErr.message}`)
    const { error: approvalErr } = await supabase.from('payroll_expense_approvals').insert({
      submission_id: submissionId,
      action: 'payment_method_resolved' as ExpenseApprovalAction,
      actioned_by: userId,
      notes,
      created_by: userId,
    })
    if (approvalErr) throw new Error(`Failed to insert payment_method_resolved approval record: ${approvalErr.message}`)
    await fetchPending()
  }, [fetchPending])

  // ── Route to bookkeeping ──────────────────────────────────────────────────
  const routeToBookkeeping = useCallback(async (submissionId: string, notes: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    const { error: approvalErr } = await supabase.from('payroll_expense_approvals').insert({
      submission_id: submissionId,
      action: 'routed_to_bookkeeping' as ExpenseApprovalAction,
      actioned_by: userId,
      notes: notes || null,
      created_by: userId,
    })
    if (approvalErr) throw new Error(`Failed to insert routed_to_bookkeeping approval record: ${approvalErr.message}`)
    const { error: statusErr } = await supabase
      .from('payroll_expense_submissions')
      .update({ status: 'bookkeeping_only' })
      .eq('id', submissionId)
    if (statusErr) throw new Error(`Failed to update submission status to bookkeeping_only: ${statusErr.message}`)
    await fetchPending()
    await fetchBookkeeping()
  }, [fetchPending, fetchBookkeeping])

  return {
    pendingSubmissions,
    bookkeepingSubmissions,
    gasAllocations,
    loading,
    error,
    refetch: fetchPending,
    approveSubmission,
    rejectSubmission,
    requestCorrection,
    resolvePaymentMethod,
    routeToBookkeeping,
  }
}
