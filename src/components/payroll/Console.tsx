'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, X, AlertTriangle, Check, Lock } from 'lucide-react'
import { FormButton, InfoBlock } from '@/components/form'
import { usePayrollAgent, type AgentMode } from '@/hooks/payroll/usePayrollAgent'

const REPORT_EXAMPLES = [
  'How much was Rolando paid over the last 5 weeks?',
  'How many hours did Rolando work last week?',
  'Was Rolando at 23 Squire last week?',
  'How many hours did we knock off last week?',
]

const FULL_EXAMPLES = [
  'Add 8 hours to Rolando for yesterday at 23 Squire',
  'How much was Rolando paid over the last 5 weeks?',
  'Remove the duplicate entry for Stan on Friday',
  'Give everyone in the Park portfolio their phone reimbursement',
]

/**
 * Full-page natural-language console. In 'report' mode it answers questions
 * (read-only) to help managers respond to employees; in 'full' mode (super-admin)
 * it also proposes writes that must be confirmed before anything is saved.
 */
export function Console({ mode }: { mode: AgentMode }) {
  const { messages, proposal, thinking, executing, error, send, confirm, cancel } =
    usePayrollAgent({ mode })
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, proposal, thinking])

  const submit = (value?: string) => {
    const v = (value ?? text).trim()
    if (!v) return
    send(v)
    setText('')
  }

  const hasConversation = messages.length > 0 || thinking
  const blocked = (proposal?.preview.blockers.length ?? 0) > 0
  const examples = mode === 'full' ? FULL_EXAMPLES : REPORT_EXAMPLES

  return (
    <div className="flex flex-col border border-[var(--border)] bg-white h-[calc(100vh-220px)] min-h-[420px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-section)] border-b border-[var(--divider)]">
        <Sparkles size={15} className="text-[var(--primary)]" />
        <span className="font-serif text-sm text-[var(--primary)]">
          {mode === 'full' ? 'Payroll Console' : 'Payroll Assistant'}
        </span>
        {mode === 'report' && (
          <span className="ml-1 inline-flex items-center gap-1 text-xs text-[var(--muted)] border border-[var(--divider)] px-1.5 py-0.5">
            <Lock size={10} /> Read-only
          </span>
        )}
      </div>

      {/* Conversation */}
      <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm">
        {!hasConversation && (
          <div className="text-[var(--muted)]">
            <p className="mb-3">
              {mode === 'full'
                ? 'Ask a question or describe a change. Changes are previewed before anything is saved.'
                : 'Ask about pay, hours, or where someone worked. This assistant is read-only.'}
            </p>
            <div className="space-y-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => submit(ex)}
                  className="block w-full text-left px-3 py-2 border border-[var(--border)]
                    bg-[var(--bg-section)] text-[var(--ink)] hover:border-[var(--primary)]
                    transition-colors text-xs"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <span className="block text-xs text-[var(--muted)] mb-0.5">
              {m.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <div
              className={
                m.role === 'user'
                  ? 'inline-block bg-[var(--primary)] text-white px-3 py-1.5 text-sm max-w-[85%] text-left'
                  : 'text-[var(--ink)]'
              }
            >
              {m.role === 'assistant' ? <MarkdownLite text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {thinking && <div className="text-[var(--muted)] italic">Assistant is thinking…</div>}
      </div>

      {/* Proposal (full mode only) */}
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

      {/* Input */}
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
          placeholder={mode === 'full' ? 'Ask a question or describe a change…' : 'Ask about pay, hours, or locations…'}
          className="flex-1 px-3 py-2 border border-[var(--border)] bg-[var(--bg-input)] text-sm
            text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none
            focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/20"
        />
        <FormButton size="sm" onClick={() => submit()} loading={thinking} disabled={!text.trim()}>
          <span className="flex items-center gap-1">
            <Send size={13} /> Send
          </span>
        </FormButton>
      </div>
    </div>
  )
}

/**
 * Minimal markdown renderer for assistant replies: GitHub-style pipe tables,
 * **bold**, and paragraphs. Avoids a markdown dependency for the few constructs
 * the agent is asked to emit (a short summary plus a small table).
 */
function MarkdownLite({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let key = 0

  const isTableRow = (s: string) => s.trim().startsWith('|') && s.includes('|')
  const isDivider = (s: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes('-')

  while (i < lines.length) {
    const line = lines[i]

    // Table: header row, divider row, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push(
        <table key={key++} className="my-2 border-collapse text-xs">
          <thead>
            <tr>
              {header.map((h, hi) => (
                <th key={hi} className="border border-[var(--divider)] px-2 py-1 text-left bg-[var(--bg-section)] font-medium">
                  <Inline text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className="border border-[var(--divider)] px-2 py-1">
                    <Inline text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    blocks.push(
      <p key={key++} className="my-0.5">
        <Inline text={line} />
      </p>
    )
    i++
  }

  return <div className="space-y-0.5">{blocks}</div>
}

function splitRow(s: string): string[] {
  return s
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** Render inline **bold** segments; everything else is plain text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}
