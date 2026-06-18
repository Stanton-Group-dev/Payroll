'use client'

import { useState } from 'react'
import { AlertTriangle, MessageSquare, UserX, Scissors } from 'lucide-react'
import { useUnallocatedHolds } from '@/hooks/payroll/useUnallocatedHolds'
import { FormButton, FormTextarea, InfoBlock } from '@/components/form'
import type { PayrollEmployeeHold, PayrollEmployee } from '@/lib/supabase/types'

const NOTIF_LABEL: Record<string, string> = {
  sent: 'Texted',
  dry_run: 'Dry run (no SMS provider)',
  skipped: 'No phone on file',
  failed: 'Send failed',
  queued: 'Queued',
}

/**
 * Review-screen panel for the unallocated-hours pay policy. Shows employees who
 * left hours unallocated this week, holds them out of the run + texts them with
 * one action, and lets a manager release a hold once the employee comes in with a
 * written reason. `onChange` refetches the payroll review so the pay summary
 * reflects who's currently excluded.
 */
export function UnallocatedHoldsPanel({ weekId, onChange }: { weekId: string; onChange?: () => void }) {
  const { state, loading, busy, error, applyHolds, releaseHold, waive, unwaive } = useUnallocatedHolds(weekId, onChange)
  const [releasingId, setReleasingId] = useState<string | null>(null)
  const [note, setNote] = useState('')

  if (loading) return <div className="text-xs text-[var(--muted)]">Checking unallocated hours…</div>
  if (!state) return null

  const activeHolds = state.holds.filter(h => h.status === 'held')
  const waivedHolds = state.holds.filter(h => h.status === 'waived')
  const releasedHolds = state.holds.filter(h => h.status === 'released')
  const heldIds = new Set(activeHolds.map(h => h.employee_id))
  const waivedIds = new Set(waivedHolds.map(h => h.employee_id))
  // Unallocated employees not yet held or waived — the ones the actions will act on.
  const pending = state.unallocated.filter(u => !heldIds.has(u.employee_id) && !waivedIds.has(u.employee_id))

  const empName = (h: PayrollEmployeeHold) =>
    (h.employee as PayrollEmployee | undefined)?.name ?? 'Employee'

  const doRelease = async (holdId: string) => {
    const ok = await releaseHold(holdId, note)
    if (ok) { setReleasingId(null); setNote('') }
  }

  return (
    <div className="border border-[var(--border)] bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--divider)]">
        <UserX size={16} className="text-[var(--warning)]" />
        <h3 className="font-serif text-base text-[var(--primary)]">Unallocated-Hours Holds</h3>
        <span className="ml-auto text-xs text-[var(--muted)]">
          Threshold {state.threshold}h · {state.twilioLive ? 'SMS live' : 'SMS dry-run'}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {!state.twilioLive && (
          <p className="text-xs text-[var(--muted)]">
            No SMS provider is configured, so messages are composed and logged (dry-run) but not actually sent.
            Add <span className="font-mono">TWILIO_*</span> secrets to switch on live texting.
          </p>
        )}

        {/* Employees over the threshold who aren't held yet */}
        {pending.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
              <AlertTriangle size={14} className="text-[var(--warning)]" />
              <span className="font-medium">
                {pending.length} {pending.length === 1 ? 'employee has' : 'employees have'} unallocated hours
              </span>
            </div>
            <ul className="text-sm divide-y divide-[var(--divider)] border border-[var(--divider)]">
              {pending.map(u => (
                <li key={u.employee_id} className="flex items-center justify-between px-3 py-2">
                  <span>{u.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium text-[var(--warning)]">{u.unallocated_hours}h unallocated</span>
                    {!u.phone && <span className="text-xs text-[var(--muted)]">no phone</span>}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => waive(u.employee_id)}
                      title="Pay this employee for their allocated work but drop the unallocated hours from pay. No text is sent."
                      className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
                    >
                      <Scissors size={12} />
                      Don&apos;t pay these hours
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <FormButton size="sm" variant="danger" loading={busy} onClick={() => applyHolds()}>
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare size={13} />
                Hold from pay &amp; notify {pending.length}
              </span>
            </FormButton>
            <p className="text-xs text-[var(--muted)]">
              <strong>Hold</strong> pulls each employee from this week&apos;s pay run entirely and texts them to come in with a
              written reason. <strong>Don&apos;t pay these hours</strong> keeps paying the employee for their allocated work and
              only drops the unallocated hours — no text, reversible.
            </p>
          </div>
        ) : activeHolds.length === 0 && waivedHolds.length === 0 ? (
          <p className="text-sm text-[var(--success)]">✓ No unallocated hours above the threshold this week.</p>
        ) : null}

        {/* Active holds — excluded from pay until released */}
        {activeHolds.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink)]">Held (excluded from pay)</p>
            <ul className="text-sm divide-y divide-[var(--divider)] border border-[var(--divider)]">
              {activeHolds.map(h => (
                <li key={h.id} className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{empName(h)}</span>
                    <span className="text-xs text-[var(--warning)]">{h.unallocated_hours}h unallocated</span>
                  </div>
                  {releasingId === h.id ? (
                    <div className="mt-2 space-y-2">
                      <FormTextarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Written reason the employee provided (required)"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <FormButton size="sm" loading={busy} disabled={!note.trim()} onClick={() => doRelease(h.id)}>
                          Release &amp; restore pay
                        </FormButton>
                        <FormButton size="sm" variant="ghost" onClick={() => { setReleasingId(null); setNote('') }}>
                          Cancel
                        </FormButton>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setReleasingId(h.id); setNote('') }}
                      className="mt-1 text-xs text-[var(--primary)] hover:underline"
                    >
                      Record reason &amp; release
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Unallocated hours written off — employee still paid for allocated work */}
        {waivedHolds.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink)]">Unallocated hours not paid (still paid for allocated work)</p>
            <ul className="text-sm divide-y divide-[var(--divider)] border border-[var(--divider)]">
              {waivedHolds.map(h => (
                <li key={h.id} className="flex items-center justify-between px-3 py-2">
                  <span className="font-medium">{empName(h)}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-[var(--muted)]">{h.unallocated_hours}h dropped</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => unwaive(h.employee_id)}
                      className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
                    >
                      Pay anyway
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Resolved this week — for the audit trail */}
        {releasedHolds.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--ink)]">Resolved</p>
            <ul className="text-xs text-[var(--muted)] divide-y divide-[var(--divider)] border border-[var(--divider)]">
              {releasedHolds.map(h => (
                <li key={h.id} className="px-3 py-2">
                  <span className="text-[var(--ink)]">{empName(h)}</span> — released
                  {h.resolution_note ? `: "${h.resolution_note}"` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
