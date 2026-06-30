'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { addLocalDays } from '@/lib/dates'

interface SessionData {
  worker: { name: string }
  week: { id: string; week_start: string; week_end: string; status: string } | null
  entries: { entry_date: string; regular_hours: number }[]
}

function addDaysUTC(dateStr: string, days: number): string {
  return addLocalDays(dateStr, days)
}

function PortalInner() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [session, setSession] = useState<SessionData | null>(null)
  const [hours, setHours] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) { setError('This link is missing its access token.'); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/session?token=${encodeURIComponent(token)}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Could not load your portal'); setLoading(false); return }
      const data = json as SessionData
      setSession(data)
      const prefill: Record<string, string> = {}
      for (const e of data.entries) prefill[e.entry_date] = String(e.regular_hours)
      setHours(prefill)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const days = session?.week
    ? Array.from({ length: 7 }, (_, i) => addDaysUTC(session.week!.week_start, i))
    : []

  const total = days.reduce((s, d) => s + (parseFloat(hours[d] || '0') || 0), 0)

  const submit = async () => {
    setSaving(true)
    setSavedMsg(null)
    setError(null)
    try {
      const payload = {
        token,
        days: days.map((d) => ({ date: d, hours: parseFloat(hours[d] || '0') || 0 })),
      }
      const res = await fetch('/api/portal/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Submission failed'); return }
      setSavedMsg(`Submitted ${json.totalHours}h across ${json.submittedDays} day(s). You can edit until payroll is finalized.`)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">Stanton Management</p>
          <h1 className="text-xl font-semibold text-slate-800">Remote Hours Submission</h1>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-12">Loading…</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded">{error}</div>
        ) : !session?.week ? (
          <div className="bg-white border border-slate-200 rounded p-6 text-center">
            <p className="text-slate-700 font-medium">Hi {session?.worker.name}.</p>
            <p className="text-sm text-slate-500 mt-2">There’s no open remote payroll week to submit hours for right now. Check back when the next run opens.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded p-6">
            <p className="text-slate-700 font-medium mb-1">Hi {session.worker.name}</p>
            <p className="text-sm text-slate-500 mb-4">
              Week of {format(new Date(session.week.week_start + 'T00:00:00'), 'MMM d')} –{' '}
              {format(new Date(session.week.week_end + 'T00:00:00'), 'MMM d, yyyy')}
            </p>

            <div className="space-y-2">
              {days.map((d) => (
                <div key={d} className="flex items-center justify-between gap-3">
                  <label className="text-sm text-slate-600 w-32">
                    {format(new Date(d + 'T00:00:00'), 'EEE, MMM d')}
                  </label>
                  <input
                    type="number" min="0" max="24" step="0.25"
                    value={hours[d] ?? ''}
                    onChange={(e) => setHours((p) => ({ ...p, [d]: e.target.value }))}
                    className="border border-slate-300 rounded px-2 py-1 w-24 text-right text-sm"
                    placeholder="0"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-sm font-semibold text-slate-800">{total.toFixed(2)} h</span>
            </div>

            {savedMsg && <div className="mt-4 bg-green-50 border border-green-200 text-green-700 text-sm p-3 rounded">{savedMsg}</div>}

            <button
              onClick={submit}
              disabled={saving}
              className="mt-4 w-full bg-slate-800 text-white text-sm font-medium py-2.5 rounded hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? 'Submitting…' : 'Submit Hours'}
            </button>
            <p className="text-xs text-slate-400 mt-3 text-center">
              These are the hours you’ll be paid for. Activity tracking is used only to review unusually high submissions.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PortalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>}>
      <PortalInner />
    </Suspense>
  )
}
