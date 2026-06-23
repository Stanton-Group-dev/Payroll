'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'needs_correction'

export interface OnboardingSubmission {
  id: string
  invitation_id: string | null
  employee_id: string | null
  full_name: string
  email: string
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  tax_id_type: 'ssn' | 'itin' | 'ein'
  tax_id_last4: string
  date_of_birth: string | null
  employee_type: 'hourly' | 'salaried' | 'contractor'
  start_date: string | null
  job_title: string | null
  // W-4
  w4_filing_status: string | null
  w4_multiple_jobs: boolean | null
  w4_dependents_amount: number | null
  w4_other_income: number | null
  w4_deductions: number | null
  w4_extra_withholding: number | null
  w4_exempt: boolean
  w4_pdf_url: string | null
  w4_signed_at: string | null
  // W-9
  w9_business_name: string | null
  w9_tax_classification: string | null
  w9_llc_tax_classification: string | null
  w9_pdf_url: string | null
  w9_signed_at: string | null
  // Banking
  bank_name: string | null
  account_type: string | null
  routing_number: string | null
  account_number_last4: string | null
  pay_by_check: boolean
  voided_check_url: string | null
  // Documents
  state_id_front_url: string | null
  state_id_back_url: string | null
  tax_id_document_url: string | null
  // Metadata
  submitted_at: string
  language: string
  filled_by_helper: boolean
  helper_name: string | null
  helper_role: string | null
  status: SubmissionStatus
  admin_notes: string | null
  approved_by: string | null
  approved_at: string | null
  progress_pct: number
  last_saved_step: number
  created_at: string
  updated_at: string
}

export interface ApprovalOperationalData {
  hourly_rate?: number | null
  weekly_rate?: number | null
  trade?: string | null
  workyard_id?: string | null
  ot_allowed?: boolean
  pay_tax?: boolean
  wc?: boolean
}

export function useOnboardingSubmissions() {
  const [submissions, setSubmissions] = useState<OnboardingSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (status?: SubmissionStatus) => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      let query = supabase
        .from('payroll_onboarding_submissions')
        .select('*')
        .order('submitted_at', { ascending: false })
      if (status) query = query.eq('status', status)
      const { data, error: err } = await query
      if (err) throw err
      setSubmissions(data ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load submissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const approveSubmission = useCallback(async (
    id: string,
    operational: ApprovalOperationalData,
    adminNotes: string,
  ) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Get submission
    const { data: sub, error: subErr } = await supabase
      .from('payroll_onboarding_submissions')
      .select('*')
      .eq('id', id)
      .single()
    if (subErr || !sub) throw new Error('Submission not found')

    // Create payroll_employees record
    const { data: emp, error: empErr } = await supabase
      .from('payroll_employees')
      .insert({
        name: sub.full_name,
        workyard_id: operational.workyard_id ?? null,
        type: sub.employee_type,
        hourly_rate: operational.hourly_rate ?? null,
        weekly_rate: operational.weekly_rate ?? null,
        trade: operational.trade ?? null,
        is_active: true,
        ot_allowed: operational.ot_allowed ?? false,
        pay_tax: operational.pay_tax ?? false,
        wc: operational.wc ?? false,
        created_by: user?.id ?? null,
      })
      .select('id')
      .single()
    if (empErr || !emp) throw new Error(empErr?.message ?? 'Failed to create employee')

    // Update submission
    const { error: updateErr } = await supabase
      .from('payroll_onboarding_submissions')
      .update({
        status: 'approved',
        admin_notes: adminNotes || null,
        approved_by: user?.id ?? null,
        approved_at: new Date().toISOString(),
        employee_id: emp.id,
      })
      .eq('id', id)
    if (updateErr) throw updateErr

    // Audit
    await supabase.from('payroll_onboarding_audit').insert({
      submission_id: id,
      action: 'approved',
      actor_id: user?.id ?? null,
      details: { employee_id: emp.id },
    })

    await load()
    return emp.id
  }, [load])

  const rejectSubmission = useCallback(async (id: string, adminNotes: string) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { error: err } = await supabase
      .from('payroll_onboarding_submissions')
      .update({ status: 'rejected', admin_notes: adminNotes || null, approved_by: user?.id ?? null })
      .eq('id', id)
    if (err) throw err
    await supabase.from('payroll_onboarding_audit').insert({
      submission_id: id,
      action: 'rejected',
      actor_id: user?.id ?? null,
      details: { notes: adminNotes },
    })
    await load()
  }, [load])

  const requestCorrection = useCallback(async (id: string, adminNotes: string) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { error: err } = await supabase
      .from('payroll_onboarding_submissions')
      .update({ status: 'needs_correction', admin_notes: adminNotes || null })
      .eq('id', id)
    if (err) throw err
    await supabase.from('payroll_onboarding_audit').insert({
      submission_id: id,
      action: 'correction_requested',
      actor_id: user?.id ?? null,
      details: { notes: adminNotes },
    })
    await load()
  }, [load])

  const getSignedUrl = useCallback(async (path: string) => {
    const supabase = createClient()
    const { data, error: err } = await supabase.storage
      .from('onboarding-documents')
      .createSignedUrl(path, 3600)
    if (err) throw err
    return data.signedUrl
  }, [])

  return {
    submissions,
    loading,
    error,
    approveSubmission,
    rejectSubmission,
    requestCorrection,
    getSignedUrl,
    refetch: load,
  }
}
