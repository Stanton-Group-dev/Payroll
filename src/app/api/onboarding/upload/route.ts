import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/supabase/config'

function getAnonClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig()
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const token = formData.get('token') as string
    const documentType = formData.get('document_type') as string
    const file = formData.get('file') as File | null

    if (!token || !documentType || !file) {
      return NextResponse.json({ error: 'Missing token, document_type, or file' }, { status: 400 })
    }

    const supabase = getAnonClient()

    // Validate token
    const { data: inv, error: invErr } = await supabase
      .from('payroll_onboarding_invitations')
      .select('id, expires_at, completed_at')
      .eq('token', token)
      .single()

    if (invErr || !inv) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (inv.completed_at) return NextResponse.json({ error: 'already_completed' }, { status: 409 })
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'expired' }, { status: 410 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const fileName = `${documentType}_${Date.now()}.${ext}`
    const path = `${inv.id}/${documentType}/${fileName}`

    const { data: uploaded, error: uploadErr } = await supabase.storage
      .from('onboarding-documents')
      .upload(path, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      })

    if (uploadErr || !uploaded) {
      console.error('Upload error:', uploadErr)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, path: uploaded.path })
  } catch (err) {
    console.error('POST /api/onboarding/upload', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
