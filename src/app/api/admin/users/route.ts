import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSupabaseConfig } from '@/lib/supabase/config'

/**
 * Admin user-management endpoint. The Supabase Auth admin API (invite, delete,
 * etc.) requires the service-role key, which must stay server-side — so these
 * actions live here rather than in the browser hook. Every action is gated to
 * admin-or-above, verified from the caller's own session.
 */

type Action =
  | { action: 'invite'; email: string; fullName?: string; role: string; portfolioIds?: string[] }
  | { action: 'update'; userId: string; fullName?: string; role?: string; portfolioIds?: string[] }
  | { action: 'setActive'; userId: string; isActive: boolean }
  | { action: 'resetPassword'; email: string }
  | { action: 'resendInvite'; email: string; fullName?: string }
  | { action: 'delete'; userId: string }

const ASSIGNABLE = new Set(['admin', 'manager', 'analyst', 'bookkeeper'])

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'manager'
  if (role !== 'admin' && role !== 'superadmin') {
    return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  }
  return { callerId: user.id }
}

/** Replace a user's portfolio_users rows with the given set. */
async function setPortfolios(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  portfolioIds: string[],
  grantedBy: string,
) {
  if (!admin) return
  await admin.from('portfolio_users').delete().eq('user_id', userId)
  if (portfolioIds.length === 0) return
  const rows = portfolioIds.map((pid) => ({
    user_id: userId,
    portfolio_id: pid,
    role,
    granted_by: grantedBy,
  }))
  const { error } = await admin.from('portfolio_users').insert(rows)
  if (error) throw new Error(`Failed to set portfolios: ${error.message}`)
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const callerId = gate.callerId

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'User management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.' },
      { status: 503 },
    )
  }

  let body: Action
  try {
    body = (await req.json()) as Action
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    switch (body.action) {
      case 'invite': {
        if (!body.email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
        if (!ASSIGNABLE.has(body.role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
        const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email.trim(), {
          data: { full_name: body.fullName ?? null },
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        const newId = data.user?.id
        if (newId) {
          const { error: upErr } = await admin.from('profiles').upsert({
            id: newId,
            email: body.email.trim(),
            full_name: body.fullName || null,
            role: body.role,
            is_active: true,
          })
          if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
          await setPortfolios(admin, newId, body.role, body.portfolioIds ?? [], callerId)
        }
        return NextResponse.json({ ok: true, userId: newId })
      }

      case 'update': {
        if (body.role && !ASSIGNABLE.has(body.role)) {
          return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
        }
        const patch: Record<string, unknown> = {}
        if (body.fullName !== undefined) patch.full_name = body.fullName || null
        if (body.role !== undefined) patch.role = body.role
        if (Object.keys(patch).length > 0) {
          const { error } = await admin.from('profiles').update(patch).eq('id', body.userId)
          if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        }
        if (body.portfolioIds !== undefined && body.role) {
          await setPortfolios(admin, body.userId, body.role, body.portfolioIds, callerId)
        }
        return NextResponse.json({ ok: true })
      }

      case 'setActive': {
        const { error } = await admin.from('profiles').update({ is_active: body.isActive }).eq('id', body.userId)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ ok: true })
      }

      case 'resetPassword': {
        // resetPasswordForEmail sends the email (admin.generateLink does not), so use
        // a keyless anon client purely to trigger the recovery email.
        const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig()
        const anon = createSupabaseClient(supabaseUrl, supabaseAnonKey)
        const { error } = await anon.auth.resetPasswordForEmail(body.email.trim())
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ ok: true })
      }

      case 'resendInvite': {
        const { error } = await admin.auth.admin.inviteUserByEmail(body.email.trim(), {
          data: { full_name: body.fullName ?? null },
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ ok: true })
      }

      case 'delete': {
        if (body.userId === callerId) {
          return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
        }
        await admin.from('portfolio_users').delete().eq('user_id', body.userId)
        await admin.from('profiles').delete().eq('id', body.userId)
        const { error } = await admin.auth.admin.deleteUser(body.userId)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
