function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim()
}

export function getSupabaseConfig() {
  const supabaseUrl = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL
  )

  // Prefer modern publishable keys; fall back to legacy anon key env vars.
  const supabaseAnonKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_KEY
  )

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required (see .env.example).'
    )
  }

  return { supabaseUrl, supabaseAnonKey }
}
