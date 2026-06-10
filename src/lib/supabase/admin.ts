import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/supabase/config'

/**
 * Service-role Supabase client. SERVER ONLY — this key bypasses RLS and can manage
 * auth users, so it must never reach the browser. Used by the admin user-management
 * route (/api/admin/users) for invites, password resets, and account changes that
 * the Supabase Auth admin API requires the service role to perform.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set, so callers can degrade
 * with a clear error instead of crashing.
 */
export function createAdminClient(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return null
  const { supabaseUrl } = getSupabaseConfig()
  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function isAdminClientConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY
}
