'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isDeleteMarked, isWestendProperty } from '@/lib/payroll/properties'

export interface PropertyOption {
  id: string
  code: string
  name: string
  billing_llc?: string | null
  isWestend?: boolean
}

export function useProperties(activeOnly = true) {
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Read from the curated payroll_property overlay (owner_llc -> billing_llc, property_id -> id)
    // so pickers reflect manual corrections, not the AppFolio-synced `properties` table.
    let query = supabase.from('payroll_property').select('id:property_id, code, name, billing_llc:owner_llc').order('code')
    if (activeOnly) query = query.eq('is_active', true)
    const { data, error: err } = await query
    if (err) setError(err.message)
    const options: PropertyOption[] = (data ?? [])
      .filter(p => !isDeleteMarked(p))
      .map(p => ({ ...p, isWestend: isWestendProperty(p) }))
    setProperties(options)
    setLoading(false)
  }, [activeOnly])

  useEffect(() => { load() }, [load])

  return { properties, loading, error, refetch: load }
}
