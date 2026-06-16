const FALLBACK_SUPABASE_URL = 'https://wkwmxxlfheywwbgdbzxe.supabase.co'
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WQOVDdHR6F6iLoTeEXliHw_sXMthMaw'

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim()
}

export function getSupabaseConfig() {
  const supabaseUrl = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    FALLBACK_SUPABASE_URL
  )

  // Incident fallback order: prefer modern publishable keys and known-good fallback first.
  // This avoids production lockouts when legacy anon keys in env have been rotated/revoked.
  const supabaseAnonKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    FALLBACK_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_KEY
  )

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase configuration values.')
  }

  return { supabaseUrl, supabaseAnonKey }
}
