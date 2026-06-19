'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  PayrollExpenseSubmission,
  PayrollGlobalConfig,
  ExpenseType,
  ExpensePaymentMethod,
  ExpenseAllocationMethod,
} from '@/lib/supabase/types'
import { addDays, format, isAfter, parseISO, setHours, setMinutes, startOfDay } from 'date-fns'

export interface DraftExpenseItem {
  id: string  // local draft id only
  expense_type: ExpenseType
  amount: string  // string for form binding
  property_id: string
  payment_method: ExpensePaymentMethod
  receipt_file: File | null
  receipt_preview: string | null
  description: string
  prior_week_id: string
  allocation_method: ExpenseAllocationMethod
}

export function blankDraftItem(): DraftExpenseItem {
  return {
    id: crypto.randomUUID(),
    expense_type: 'gas',
    amount: '',
    property_id: '',
    payment_method: 'personal',
    receipt_file: null,
    receipt_preview: null,
    description: '',
    prior_week_id: '',
    allocation_method: 'gas_auto',
  }
}

export interface CutoffInfo {
  currentWeekId: string | null
  currentWeekStart: string | null
  nextWeekStart: string | null
  assignedWeekId: string | null
  assignedWeekStart: string | null
  isAfterCutoff: boolean
  message: string
}

function parseCutoffTime(timeStr: string | null): { hours: number; minutes: number } {
  if (!timeStr) return { hours: 17, minutes: 0 }
  const parts = timeStr.split(':')
  return { hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) }
}

export function useCutoffInfo(config: PayrollGlobalConfig | null) {
  const [info, setInfo] = useState<CutoffInfo>({
    currentWeekId: null,
    currentWeekStart: null,
    nextWeekStart: null,
    assignedWeekId: null,
    assignedWeekStart: null,
    isAfterCutoff: false,
    message: '',
  })

  const compute = useCallback(async () => {
    const supabase = createClient()
    const now = new Date()

    // Get current open week and the next one
    const { data: weeks } = await supabase
      .from('payroll_weeks')
      .select('id, week_start, week_end, status')
      .in('status', ['draft', 'corrections_complete'])
      .order('week_start', { ascending: true })
      .limit(2)

    if (!weeks || weeks.length === 0) {
      setInfo(prev => ({ ...prev, message: 'No open payroll week found.' }))
      return
    }

    const current = weeks[0]
    const next = weeks[1] ?? null

    // Build cutoff datetime
    const cutoffDay = config?.expense_cutoff_day ?? 3  // Wednesday
    const { hours, minutes } = parseCutoffTime(config?.expense_cutoff_time ?? null)

    // Find most recent cutoff in the past
    const weekStart = parseISO(current.week_start)
    let cutoffDate = startOfDay(weekStart)
    // Advance to the cutoff day within or after weekStart
    while (cutoffDate.getDay() !== cutoffDay) {
      cutoffDate = addDays(cutoffDate, 1)
    }
    cutoffDate = setHours(setMinutes(cutoffDate, minutes), hours)

    const afterCutoff = isAfter(now, cutoffDate)

    if (!afterCutoff) {
      setInfo({
        currentWeekId: current.id,
        currentWeekStart: current.week_start,
        nextWeekStart: next?.week_start ?? null,
        assignedWeekId: current.id,
        assignedWeekStart: current.week_start,
        isAfterCutoff: false,
        message: `This will be included in this week's payroll (week of ${format(parseISO(current.week_start), 'MMM d')}).`,
      })
    } else {
      setInfo({
        currentWeekId: current.id,
        currentWeekStart: current.week_start,
        nextWeekStart: next?.week_start ?? null,
        assignedWeekId: next?.id ?? null,
        assignedWeekStart: next?.week_start ?? null,
        isAfterCutoff: true,
        message: next
          ? `The cutoff for this week has passed. This will be included in next week's payroll — week of ${format(parseISO(next.week_start), 'MMM d')}.`
          : `The cutoff for this week has passed. The next payroll week has not been created yet — submit now and an admin will assign it.`,
      })
    }
  }, [config])

  useEffect(() => { compute() }, [compute])

  return info
}

export function useExpenseSubmissions(employeeIdFilter?: string) {
  const [submissions, setSubmissions] = useState<PayrollExpenseSubmission[]>([])
  const [config, setConfig] = useState<PayrollGlobalConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('payroll_global_config')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setConfig(data ?? null)
  }, [])

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    let q = supabase
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
      .eq('is_active', true)
      .order('submitted_at', { ascending: false })

    if (employeeIdFilter) {
      q = q.eq('employee_id', employeeIdFilter)
    }

    const { data, error: err } = await q
    if (err) setError(err.message)
    else setSubmissions(data as unknown as PayrollExpenseSubmission[])
    setLoading(false)
  }, [employeeIdFilter])

  useEffect(() => {
    fetchConfig()
    fetchSubmissions()
  }, [fetchConfig, fetchSubmissions])

  const submitBatch = useCallback(async (params: {
    employeeId: string
    submittedBy: string
    weekId: string | null
    signatureDataUrl: string
    notes: string
    items: DraftExpenseItem[]
  }) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''

    // 1. Upload signature — store the storage PATH (not a public URL)
    const signatureBlob = await (await fetch(params.signatureDataUrl)).blob()
    const sigPath = `signatures/${userId}/${Date.now()}.png`
    const { error: sigErr } = await supabase.storage
      .from('expense-receipts')
      .upload(sigPath, signatureBlob, { contentType: 'image/png', upsert: false })
    if (sigErr) throw new Error(`Signature upload failed: ${sigErr.message}`)

    const signatureUrl = sigPath  // store the object path; reads go via /api/expense-receipt

    // 2. Upload receipts — store the storage PATH (not a public URL)
    const receiptUrls: string[] = []
    for (const item of params.items) {
      if (!item.receipt_file) throw new Error(`Receipt required for all items`)
      const ext = item.receipt_file.name.split('.').pop() ?? 'jpg'
      const path = `receipts/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
      const { error: rErr } = await supabase.storage
        .from('expense-receipts')
        .upload(path, item.receipt_file, { contentType: item.receipt_file.type, upsert: false })
      if (rErr) throw new Error(`Receipt upload failed: ${rErr.message}`)
      receiptUrls.push(path)  // store the object path; reads go via /api/expense-receipt
    }

    // 3. Compute total
    const total = params.items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0)

    // 4. Insert submission
    const { data: sub, error: subErr } = await supabase
      .from('payroll_expense_submissions')
      .insert({
        employee_id: params.employeeId,
        submitted_by: params.submittedBy,
        payroll_week_id: params.weekId,
        signature_url: signatureUrl,
        status: 'pending',
        total_amount: total,
        notes: params.notes || null,
        created_by: userId,
      })
      .select()
      .single()
    if (subErr) throw new Error(subErr.message)

    // 5. Insert items
    const itemRows = params.items.map((item, i) => {
      const expType = item.expense_type
      const allocMethod: ExpenseAllocationMethod =
        expType === 'gas' ? 'gas_auto' :
        expType === 'tools' ? 'unit_weighted' : 'direct'
      return {
        submission_id: sub.id,
        expense_type: expType,
        amount: parseFloat(item.amount),
        property_id: item.property_id || null,
        payment_method: item.payment_method,
        receipt_image_url: receiptUrls[i],
        description: item.description || null,
        prior_week_id: item.prior_week_id || null,
        allocation_method: allocMethod,
        created_by: userId,
      }
    })

    const { error: itemsErr } = await supabase.from('payroll_expense_items').insert(itemRows)
    if (itemsErr) throw new Error(itemsErr.message)

    await fetchSubmissions()
    return sub.id as string
  }, [fetchSubmissions])

  const saveConfig = useCallback(async (cutoffDay: number, cutoffTime: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    if (config) {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .update({ expense_cutoff_day: cutoffDay, expense_cutoff_time: cutoffTime, created_by: userId })
        .eq('id', config.id)
      if (err) throw new Error(err.message)
    } else {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .insert({ expense_cutoff_day: cutoffDay, expense_cutoff_time: cutoffTime, created_by: userId })
      if (err) throw new Error(err.message)
    }
    await fetchConfig()
  }, [config, fetchConfig])

  return {
    submissions,
    config,
    loading,
    error,
    refetch: fetchSubmissions,
    submitBatch,
    saveConfig,
  }
}
