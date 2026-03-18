'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface PropertyOption {
  id: string
  code: string
  name: string
  workyard_aliases?: string[]
}

export function useProperties(activeOnly = true) {
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    let query = supabase.from('properties').select('id, code, name, workyard_aliases').order('code')
    if (activeOnly) query = query.eq('is_active', true)
    const { data, error: err } = await query
    if (err) setError(err.message)
    setProperties(data ?? [])
    setLoading(false)
  }, [activeOnly])

  useEffect(() => { load() }, [load])

  return { properties, loading, error, refetch: load }
}
