'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PayrollEmployeeHold } from '@/lib/supabase/types'

export interface UnallocatedEmployee {
  employee_id: string
  name: string
  phone: string | null
  unallocated_hours: number
}

interface HoldsState {
  threshold: number
  twilioLive: boolean
  unallocated: UnallocatedEmployee[]
  holds: PayrollEmployeeHold[]
}

/**
 * Drives the review-screen "unallocated holds" panel: who is over the threshold,
 * the holds on record, and the apply/release actions (which call the manager-gated
 * /api/payroll/holds route). `onChange` lets the caller refetch the payroll review
 * after a hold is applied/released so the pay summary reflects the exclusion.
 */
export function useUnallocatedHolds(weekId: string, onChange?: () => void) {
  const [state, setState] = useState<HoldsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/payroll/holds?weekId=${weekId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setState(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [weekId])

  useEffect(() => { load() }, [load])

  const applyHolds = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/payroll/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', weekId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to apply holds')
      await load()
      onChange?.()
      return json as { twilioLive: boolean; held: Array<{ name: string; notification_status: string }> }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to apply holds')
      return null
    } finally {
      setBusy(false)
    }
  }, [weekId, load, onChange])

  const releaseHold = useCallback(async (holdId: string, resolutionNote: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/payroll/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release', holdId, resolutionNote }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to release hold')
      await load()
      onChange?.()
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to release hold')
      return false
    } finally {
      setBusy(false)
    }
  }, [load, onChange])

  return { state, loading, busy, error, refetch: load, applyHolds, releaseHold }
}
