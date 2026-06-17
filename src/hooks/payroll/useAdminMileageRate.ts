'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollMileageRate } from '@/lib/supabase/types'

export function useAdminMileageRate() {
  const [rates, setRates] = useState<PayrollMileageRate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_mileage_rates')
      .select('*')
      .order('effective_date', { ascending: false })
    if (err) setError(err.message)
    setRates(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addRate = useCallback(async (ratePerMile: number, effectiveDate: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const { error: err } = await supabase.from('payroll_mileage_rates').insert({
      rate_per_mile: ratePerMile,
      effective_date: effectiveDate,
      created_by: userId,
    })
    if (err) throw new Error(err.message)
    await load()
  }, [load])

  return { rates, loading, error, addRate, refetch: load }
}
