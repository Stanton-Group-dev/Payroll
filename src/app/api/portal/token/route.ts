import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/**
 * Mint (or fetch) a remote-portal access link for a remote worker. Analyst/admin
 * only. Returns the existing active token if one exists, otherwise creates one.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'manager'
  if (!['analyst', 'admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Analyst or admin access required' }, { status: 403 })
  }

  let body: { employeeId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Portal not configured (missing service role key)' }, { status: 503 })

  // Worker must be a remote employee.
  const { data: emp } = await admin
    .from('payroll_employees')
    .select('id, pay_group')
    .eq('id', body.employeeId)
    .maybeSingle()
  if (!emp || emp.pay_group !== 'remote') {
    return NextResponse.json({ error: 'Employee is not a remote worker' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('remote_portal_tokens')
    .select('token')
    .eq('employee_id', body.employeeId)
    .eq('is_active', true)
    .maybeSingle()

  let token = existing?.token as string | undefined
  if (!token) {
    token = randomBytes(24).toString('hex')
    const { error } = await admin.from('remote_portal_tokens').insert({
      token,
      employee_id: body.employeeId,
      created_by: user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, token, path: `/portal?token=${token}` })
}
