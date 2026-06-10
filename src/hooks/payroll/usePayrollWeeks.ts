'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollWeek, PayGroup } from '@/lib/supabase/types'

export function usePayrollWeeks() {
  const [weeks, setWeeks] = useState<PayrollWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_weeks')
      .select('*')
      .order('week_start', { ascending: false })
    if (err) setError(err.message)
    else setWeeks(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const createWeek = useCallback(async (weekStart: string, weekEnd: string, payGroup: PayGroup = 'field') => {
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_weeks')
      .insert({ week_start: weekStart, week_end: weekEnd, status: 'draft', pay_group: payGroup })
      .select()
      .single()
    if (err) throw new Error(err.message)
    await fetch()
    return data as PayrollWeek
  }, [fetch])

  return { weeks, loading, error, refetch: fetch, createWeek }
}
