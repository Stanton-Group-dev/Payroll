'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Save, Send, RotateCcw, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/payroll/useAuth'
import { useSmsAdmin } from '@/hooks/payroll/useSmsAdmin'
import {
  PageHeader, FormButton, FormField, FormInput, FormTextarea,
  InfoBlock, SectionDivider,
} from '@/components/form'
import { format } from 'date-fns'

const STATUS_STYLE: Record<string, string> = {
  sent: 'text-[var(--success)]',
  dry_run: 'text-[var(--muted)]',
  skipped: 'text-[var(--muted)]',
  queued: 'text-[var(--primary)]',
  failed: 'text-[var(--danger)]',
}
const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  dry_run: 'Dry run',
  skipped: 'Skipped',
  queued: 'Queued',
  failed: 'Failed',
}

/** Fill placeholders with sample values so the manager sees what employees receive. */
function previewBody(template: string): string {
  return template
    .replace(/\{first_name\}/g, 'Maria')
    .replace(/\{full_name\}/g, 'Maria Gomez')
    .replace(/\{hours\}/g, '2.5 hours')
    .replace(/\{week_start\}/g, '2026-06-15')
    .replace(/\{week_end\}/g, '2026-06-21')
}

export default function NotificationsAdminPage() {
  const { isManager } = useAuth()
  const { state, loading, busy, error, saveTemplate, sendTest } = useSmsAdmin()

  const [draft, setDraft] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)

  // Seed the editor once the template loads (only when the user hasn't started typing).
  useEffect(() => {
    if (state && draft === '') setDraft(state.template)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.template])

  const handleSave = async () => {
    const ok = await saveTemplate(draft)
    if (ok) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000) }
  }

  const handleReset = async () => {
    if (!state) return
    setDraft(state.defaultTemplate)
    await saveTemplate('') // empty clears the override → built-in default
  }

  const handleTest = async () => {
    setTestResult(null)
    const res = await sendTest(testPhone)
    if (res) {
      setTestResult(
        res.status === 'sent' ? '✓ Sent — check the phone.'
        : res.status === 'dry_run' ? 'Dry run — no provider configured, nothing was actually sent.'
        : res.status === 'failed' ? `Failed: ${res.error ?? 'unknown error'}`
        : res.status,
      )
    }
  }

  const charCount = draft.length
  const segments = Math.max(1, Math.ceil(charCount / 153)) // GSM concatenated-segment estimate

  return (
    <div>
      <PageHeader
        title="Employee SMS"
        subtitle="Edit the text employees receive, send a test, and review everything that's been sent"
      />

      <div className="p-6 space-y-6">
        {!isManager && (
          <InfoBlock variant="warning" title="Access restricted">Manager or admin access required.</InfoBlock>
        )}
        {error && <InfoBlock variant="error">{error}</InfoBlock>}

        {loading ? (
          <div className="text-center py-8 text-[var(--muted)]">Loading…</div>
        ) : !state ? null : (
          <>
            {/* ---- Provider status + test send (supports "go live") ---- */}
            <div className="border border-[var(--border)] bg-white">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--divider)]">
                <MessageSquare size={16} className="text-[var(--primary)]" />
                <h3 className="font-serif text-base text-[var(--primary)]">SMS Provider</h3>
                <span className={`ml-auto text-xs font-medium ${state.twilioLive ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                  {state.twilioLive ? '● Live — texts send for real'
                    : state.twilioConfigured ? '● Configured but mock-forced (TWILIO_MOCK=1)'
                    : '● Dry-run — no provider configured'}
                </span>
              </div>
              <div className="p-4 space-y-3">
                {!state.twilioConfigured && (
                  <InfoBlock variant="default" title="How to go live">
                    Messages are composed and logged but not actually sent until Twilio is configured.
                    Set these secrets (Infisical / Vercel env), then redeploy:
                    <span className="block mt-1 font-mono text-xs">
                      TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_FROM_NUMBER
                    </span>
                    <span className="block mt-1">(or <span className="font-mono">TWILIO_MESSAGING_SERVICE_SID</span> instead of a single From number).</span>
                  </InfoBlock>
                )}
                <div className="flex items-end gap-2">
                  <div className="w-56">
                    <FormField label="Send a test SMS to">
                      <FormInput
                        type="tel"
                        value={testPhone}
                        onChange={e => setTestPhone(e.target.value)}
                        placeholder="+15551234567"
                        disabled={!isManager}
                      />
                    </FormField>
                  </div>
                  <FormButton size="sm" variant="secondary" loading={busy} disabled={!isManager || !testPhone.trim()} onClick={handleTest}>
                    <span className="inline-flex items-center gap-1.5"><Send size={13} />Send test</span>
                  </FormButton>
                  {testResult && <span className="text-xs text-[var(--ink)] pb-2">{testResult}</span>}
                </div>
              </div>
            </div>

            {/* ---- Editable template ---- */}
            <div className="border border-[var(--border)] bg-white">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--divider)]">
                <h3 className="font-serif text-base text-[var(--primary)]">Unallocated-Hours Message</h3>
                <span className="ml-auto text-xs text-[var(--muted)]">{charCount} chars · ~{segments} segment{segments > 1 ? 's' : ''}</span>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-[var(--muted)]">
                  Sent when an employee is held from a pay run for leaving hours unallocated. Use the placeholders below —
                  they&apos;re filled in per employee at send time.
                </p>
                <div className="flex flex-wrap gap-2">
                  {state.placeholders.map(p => (
                    <button
                      key={p.token}
                      type="button"
                      title={p.describe}
                      onClick={() => setDraft(d => d + p.token)}
                      disabled={!isManager}
                      className="font-mono text-xs px-2 py-1 border border-[var(--divider)] bg-[var(--bg-section)] hover:border-[var(--primary)] disabled:opacity-50"
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
                <FormTextarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={5}
                  disabled={!isManager}
                  placeholder={state.defaultTemplate}
                />
                <div className="border border-[var(--divider)] bg-[var(--bg-section)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-1">Preview</p>
                  <p className="text-sm text-[var(--ink)]">{previewBody(draft || state.defaultTemplate)}</p>
                </div>
                {isManager && (
                  <div className="flex gap-2">
                    <FormButton size="sm" loading={busy} disabled={draft.trim() === state.template.trim()} onClick={handleSave}>
                      <span className="inline-flex items-center gap-1.5">
                        {savedFlash ? <><CheckCircle2 size={13} />Saved</> : <><Save size={13} />Save message</>}
                      </span>
                    </FormButton>
                    <FormButton size="sm" variant="ghost" loading={busy} onClick={handleReset}>
                      <span className="inline-flex items-center gap-1.5"><RotateCcw size={13} />Reset to default</span>
                    </FormButton>
                  </div>
                )}
              </div>
            </div>

            {/* ---- Outbox / history ---- */}
            <div>
              <SectionDivider label={`Recent messages (${state.outbox.length})`} />
              {state.outbox.length === 0 ? (
                <p className="text-sm text-[var(--muted)] py-4">No messages sent yet.</p>
              ) : (
                <div className="border border-[var(--border)] overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[var(--primary)] text-white text-xs">
                        <th className="px-3 py-2.5 text-left font-medium">When</th>
                        <th className="px-3 py-2.5 text-left font-medium">Employee</th>
                        <th className="px-3 py-2.5 text-left font-medium">To</th>
                        <th className="px-3 py-2.5 text-left font-medium">Status</th>
                        <th className="px-3 py-2.5 text-left font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.outbox.map((n, i) => (
                        <tr key={n.id} className={`border-b border-[var(--divider)] align-top ${i % 2 === 0 ? 'bg-white' : 'bg-[var(--bg-section)]'}`}>
                          <td className="px-3 py-2.5 text-xs text-[var(--muted)] whitespace-nowrap">
                            {format(new Date(n.created_at), 'MMM d, h:mm a')}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{n.employee?.name ?? <span className="text-[var(--muted)] text-xs">— (test)</span>}</td>
                          <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{n.to_address ?? '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`text-xs font-medium ${STATUS_STYLE[n.status] ?? ''}`}>{STATUS_LABEL[n.status] ?? n.status}</span>
                            {n.error && <span className="block text-xs text-[var(--danger)]">{n.error}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-[var(--ink)] max-w-md">{n.body}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
