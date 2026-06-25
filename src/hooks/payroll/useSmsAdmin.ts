'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PayrollNotification, PayrollEmployee, PayrollWeek } from '@/lib/supabase/types'

export interface OutboxRow extends Omit<PayrollNotification, 'employee'> {
  employee?: Pick<PayrollEmployee, 'id' | 'name'> | null
  week?: Pick<PayrollWeek, 'id' | 'week_start' | 'week_end'> | null
}

export interface SmsAdminState {
  twilioLive: boolean
  twilioConfigured: boolean
  template: string
  defaultTemplate: string
  placeholders: Array<{ token: string; describe: string }>
  outbox: OutboxRow[]
}

/**
 * Drives the Admin → Employee SMS screen: SMS provider status, the editable
 * unallocated-hours template, the recent outbox, and the save / test-send
 * actions (all via the manager-gated /api/payroll/notifications route).
 */
export function useSmsAdmin() {
  const [state, setState] = useState<SmsAdminState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/payroll/notifications')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setState(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveTemplate = useCallback(async (template: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/payroll/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_template', template }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save template')
      await load()
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save template')
      return false
    } finally {
      setBusy(false)
    }
  }, [load])

  const sendTest = useCallback(async (to: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/payroll/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to send test')
      await load()
      return json as { status: string; error: string | null; live: boolean }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send test')
      return null
    } finally {
      setBusy(false)
    }
  }, [load])

  return { state, loading, busy, error, refetch: load, saveTemplate, sendTest }
}
