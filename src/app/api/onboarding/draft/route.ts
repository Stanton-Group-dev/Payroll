import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/supabase/config'

function getAnonClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig()
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  try {
    const supabase = getAnonClient()

    const { data: inv, error: invErr } = await supabase
      .from('payroll_onboarding_invitations')
      .select('id, employee_type, full_name, email, expires_at, completed_at')
      .eq('token', token)
      .single()

    if (invErr || !inv) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (inv.completed_at) return NextResponse.json({ error: 'already_completed', invitation: inv }, { status: 409 })
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'expired' }, { status: 410 })

    const { data: draft } = await supabase
      .from('payroll_onboarding_drafts')
      .select('form_data, current_step')
      .eq('invitation_id', inv.id)
      .single()

    return NextResponse.json({ invitation: inv, draft: draft ?? null })
  } catch (err) {
    console.error('GET /api/onboarding/draft', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { token, form_data, current_step } = await request.json()
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

    const supabase = getAnonClient()

    const { data: inv, error: invErr } = await supabase
      .from('payroll_onboarding_invitations')
      .select('id, expires_at, completed_at')
      .eq('token', token)
      .single()

    if (invErr || !inv) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (inv.completed_at) return NextResponse.json({ error: 'already_completed' }, { status: 409 })
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'expired' }, { status: 410 })

    const { error } = await supabase
      .from('payroll_onboarding_drafts')
      .upsert(
        { invitation_id: inv.id, form_data: form_data ?? {}, current_step: current_step ?? 1 },
        { onConflict: 'invitation_id' }
      )

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/onboarding/draft', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
