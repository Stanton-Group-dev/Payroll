'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollWorkyardCustomerMap } from '@/lib/supabase/types'

/**
 * CRUD over the owner-LLC -> Workyard-customer map (PRP-06 CF-6).
 *
 * NOTE: the `payroll_workyard_customer_map` table is staged (migration
 * 20260623_01) and not yet applied to prod. Until it is applied, the fetch
 * resolves to an empty list with a soft `pending` flag rather than surfacing a
 * scary "relation does not exist" error.
 */
export function useWorkyardCustomerMap() {
  const [rows, setRows] = useState<PayrollWorkyardCustomerMap[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** True when the backing table is not yet present (migration not applied). */
  const [pending, setPending] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPending(false)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('payroll_workyard_customer_map')
      .select('*')
      .order('owner_llc', { ascending: true })
    if (err) {
      // 42P01 = undefined_table — the staged migration hasn't been applied yet.
      if (err.code === '42P01' || /does not exist/i.test(err.message)) {
        setPending(true)
        setRows([])
      } else {
        setError(err.message)
      }
    } else {
      setRows(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetch()
  }, [fetch])

  const addMapping = useCallback(
    async (params: { ownerLlc: string; orgCustomerId: number }) => {
      const supabase = createClient()
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null
      const { error: err } = await supabase.from('payroll_workyard_customer_map').insert({
        owner_llc: params.ownerLlc,
        org_customer_id: params.orgCustomerId,
        created_by: userId,
      })
      if (err) throw new Error(err.message)
      await fetch()
    },
    [fetch],
  )

  const deleteMapping = useCallback(
    async (id: string) => {
      const supabase = createClient()
      const { error: err } = await supabase.from('payroll_workyard_customer_map').delete().eq('id', id)
      if (err) throw new Error(err.message)
      await fetch()
    },
    [fetch],
  )

  return { rows, loading, error, pending, refetch: fetch, addMapping, deleteMapping }
}
