import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/supabase/config'

function getAnonClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig()
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { token, form_data } = body

    if (!token || !form_data) {
      return NextResponse.json({ error: 'Missing token or form_data' }, { status: 400 })
    }

    const supabase = getAnonClient()

    // Validate token
    const { data: inv, error: invErr } = await supabase
      .from('payroll_onboarding_invitations')
      .select('id, employee_type, expires_at, completed_at')
      .eq('token', token)
      .single()

    if (invErr || !inv) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (inv.completed_at) return NextResponse.json({ error: 'already_completed' }, { status: 409 })
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'expired' }, { status: 410 })

    // Validate required docs
    if (!form_data.state_id_front_url || !form_data.state_id_back_url || !form_data.tax_id_document_url) {
      return NextResponse.json({ error: 'Required documents missing' }, { status: 400 })
    }

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null
    const userAgent = request.headers.get('user-agent') ?? null

    // Insert submission (only last 4 of tax_id and account stored)
    const { data: submission, error: subErr } = await supabase
      .from('payroll_onboarding_submissions')
      .insert({
        invitation_id: inv.id,
        full_name: form_data.full_name,
        email: form_data.email,
        phone: form_data.phone ?? null,
        address_line1: form_data.address_line1 ?? null,
        address_line2: form_data.address_line2 ?? null,
        city: form_data.city ?? null,
        state: form_data.state ?? null,
        zip: form_data.zip ?? null,
        tax_id_type: form_data.tax_id_type,
        tax_id_last4: form_data.tax_id_last4,
        date_of_birth: form_data.date_of_birth ?? null,
        employee_type: inv.employee_type,
        start_date: form_data.start_date ?? null,
        job_title: form_data.job_title ?? null,
        // W-4
        w4_filing_status: form_data.w4_filing_status ?? null,
        w4_multiple_jobs: form_data.w4_multiple_jobs ?? null,
        w4_dependents_amount: form_data.w4_dependents_amount ?? null,
        w4_other_income: form_data.w4_other_income ?? null,
        w4_deductions: form_data.w4_deductions ?? null,
        w4_extra_withholding: form_data.w4_extra_withholding ?? null,
        w4_exempt: form_data.w4_exempt ?? false,
        // W-9
        w9_business_name: form_data.w9_business_name ?? null,
        w9_tax_classification: form_data.w9_tax_classification ?? null,
        w9_llc_tax_classification: form_data.w9_llc_tax_classification ?? null,
        // Direct deposit
        bank_name: form_data.bank_name ?? null,
        account_type: form_data.account_type ?? null,
        routing_number: form_data.routing_number ?? null,
        account_number_last4: form_data.account_number_last4 ?? null,
        pay_by_check: form_data.pay_by_check ?? false,
        voided_check_url: form_data.voided_check_url ?? null,
        // Documents
        state_id_front_url: form_data.state_id_front_url,
        state_id_back_url: form_data.state_id_back_url,
        tax_id_document_url: form_data.tax_id_document_url,
        // Metadata
        language: form_data.language ?? 'en',
        filled_by_helper: form_data.filled_by_helper ?? false,
        helper_name: form_data.helper_name ?? null,
        helper_role: form_data.helper_role ?? null,
        ip_address: ip,
        user_agent: userAgent,
        status: 'pending',
        progress_pct: 100,
        last_saved_step: 4,
      })
      .select('id')
      .single()

    if (subErr || !submission) {
      console.error('Submission insert error:', subErr)
      return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
    }

    // Mark invitation as completed
    await supabase
      .from('payroll_onboarding_invitations')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', inv.id)

    // Delete draft
    await supabase
      .from('payroll_onboarding_drafts')
      .delete()
      .eq('invitation_id', inv.id)

    // Audit log
    await supabase.from('payroll_onboarding_audit').insert({
      submission_id: submission.id,
      invitation_id: inv.id,
      action: 'submitted',
      ip_address: ip,
      details: { language: form_data.language, filled_by_helper: form_data.filled_by_helper },
    })

    return NextResponse.json({ ok: true, submission_id: submission.id })
  } catch (err) {
    console.error('POST /api/onboarding/submit', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
