'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, X, AlertTriangle, Check } from 'lucide-react'
import { FormButton, InfoBlock } from '@/components/form'
import { usePayrollAgent } from '@/hooks/payroll/usePayrollAgent'

/**
 * Natural-language command bar. The manager types a request like
 * "add 10 hours to stan for wednesday of last week across the park portfolio";
 * the assistant resolves it and shows a preview that must be confirmed before
 * anything is written. Every confirmed action is audited server-side.
 *
 * Pass `onExecuted` to refresh page data after a successful write.
 */
export function CommandBar({ onExecuted }: { onExecuted?: () => void }) {
  const { messages, proposal, thinking, executing, error, send, confirm, cancel } =
    usePayrollAgent({ mode: 'full', onExecuted })
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, proposal, thinking])

  const submit = () => {
    if (!text.trim()) return
    send(text)
    setText('')
  }

  const hasConversation = messages.length > 0 || thinking
  const blocked = (proposal?.preview.blockers.length ?? 0) > 0

  return (
    <div className="border border-[var(--border)] bg-white">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Sparkles size={15} className="text-[var(--primary)]" />
        <span className="font-serif text-sm text-[var(--primary)]">Command</span>
        <span className="text-xs text-[var(--muted)]">
          e.g. &ldquo;add 10 hours to Stan for Wednesday of last week across the Park portfolio&rdquo;
        </span>
      </div>

      {hasConversation && (
        <div ref={logRef} className="max-h-56 overflow-y-auto px-4 py-3 space-y-2 text-sm">
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user' ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}
            >
              <span className="font-medium mr-1">{m.role === 'user' ? 'You:' : 'Assistant:'}</span>
              {m.content}
            </div>
          ))}
          {thinking && <div className="text-[var(--muted)] italic">Assistant is thinking…</div>}
        </div>
      )}

      {proposal && (
        <div className="px-4 py-3 border-t border-[var(--divider)]">
          <InfoBlock variant={blocked ? 'error' : 'default'} title={proposal.preview.summary}>
            <ul className="mt-1 space-y-0.5">
              {proposal.preview.changes.map((c, i) => (
                <li key={i} className="font-mono text-xs">
                  {c.kind === 'deactivate' ? '−' : c.kind === 'update' ? '~' : '+'} {c.description}
                </li>
              ))}
            </ul>
            {proposal.assumptions && (
              <p className="mt-2 text-xs text-[var(--muted)]">Assumptions: {proposal.assumptions}</p>
            )}
            {proposal.preview.warnings.map((w, i) => (
              <p key={i} className="mt-1 flex items-center gap-1 text-xs text-[var(--warning)]">
                <AlertTriangle size={12} /> {w}
              </p>
            ))}
            {proposal.preview.blockers.map((b, i) => (
              <p key={i} className="mt-1 flex items-center gap-1 text-xs text-[var(--error)]">
                <X size={12} /> {b}
              </p>
            ))}
          </InfoBlock>

          <div className="flex gap-2 mt-2">
            <FormButton size="sm" onClick={confirm} loading={executing} disabled={blocked}>
              <span className="flex items-center gap-1">
                <Check size={13} /> Confirm
              </span>
            </FormButton>
            <FormButton size="sm" variant="ghost" onClick={cancel} disabled={executing}>
              Cancel
            </FormButton>
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 pb-2">
          <InfoBlock variant="error">{error}</InfoBlock>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[var(--divider)]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          disabled={thinking}
          placeholder="Type a payroll command…"
          className="flex-1 px-3 py-2 border border-[var(--border)] bg-[var(--bg-input)] text-sm
            text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none
            focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20"
        />
        <FormButton size="sm" onClick={submit} loading={thinking} disabled={!text.trim()}>
          <span className="flex items-center gap-1">
            <Send size={13} /> Send
          </span>
        </FormButton>
      </div>
    </div>
  )
}
