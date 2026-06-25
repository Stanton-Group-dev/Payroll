'use client'

import { useState } from 'react'
import { Unlock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/payroll/useAuth'
import { reopenWeek } from '@/lib/payroll/weekLock'

/**
 * Admin-only control to reopen a locked (approved) payroll week. Renders nothing for
 * non-admins. On confirm it unlocks the week (status → corrections_complete) and clears the
 * payroll approval so edits + re-approval are possible again; pay data is untouched.
 * `onReopened` is called after success so the host page can refetch.
 */
export function ReopenWeekButton({
  weekId,
  onReopened,
  className = '',
}: {
  weekId: string
  onReopened?: () => void
  className?: string
}) {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!isAdmin) return null

  const handle = async () => {
    const ok = window.confirm(
      'Reopen this approved week?\n\nIt will be unlocked so hours, adjustments, allocations, and costs can be edited and recomputed. Nobody’s pay changes. Re-approve payroll when you’re done to re-lock it and re-store the billing costs.',
    )
    if (!ok) return
    setBusy(true)
    setErr(null)
    try {
      await reopenWeek(createClient(), weekId)
      onReopened?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reopen the week.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mt-2 ${className}`}>
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        className="inline-flex items-center gap-1.5 border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--ink)] hover:bg-[var(--bg-section)] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Unlock size={13} />}
        {busy ? 'Reopening…' : 'Reopen week (admin)'}
      </button>
      {err && <p className="mt-1 text-xs text-[var(--error)]">{err}</p>}
    </div>
  )
}
