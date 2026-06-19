import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/expense-receipt?path=<storagePathOrLegacyUrl>
 *
 * Auth-gated redirect to an expense receipt or signature stored in the
 * private 'expense-receipts' Supabase Storage bucket.
 *
 * - Legacy rows (stored full public URL starting with 'http'): redirect
 *   straight to the stored URL — backward-compatible, no signed URL needed.
 * - New rows (stored storage path, e.g. 'receipts/uid/…jpg'): generate a
 *   60-second signed URL and redirect to it.
 *
 * IMPORTANT: the bucket must be flipped to private ONLY after this route
 * (and the path-storing write code) is deployed. See migration
 * 20260619_05_expense_receipts_private.sql.
 */
export async function GET(req: Request) {
  const supabase = await createClient()

  // Auth guard
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Read path from query string
  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')
  if (!path) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 })
  }

  // Legacy passthrough: old rows stored a full public URL
  if (path.startsWith('http')) {
    return NextResponse.redirect(path)
  }

  // New rows: generate a short-lived signed URL (60 seconds)
  const { data, error } = await supabase.storage
    .from('expense-receipts')
    .createSignedUrl(path, 60)

  if (error || !data) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  return NextResponse.redirect(data.signedUrl)
}
