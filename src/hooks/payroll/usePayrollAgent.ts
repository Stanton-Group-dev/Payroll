'use client'

import { useCallback, useState } from 'react'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface PlannedChange {
  kind: 'create' | 'update' | 'deactivate'
  entity: string
  description: string
}

export interface PlanPreview {
  operation: string
  summary: string
  weekId: string | null
  changes: PlannedChange[]
  warnings: string[]
  blockers: string[]
  input: unknown
}

export interface AgentProposal {
  operation: string
  input: unknown
  assumptions?: string
  preview: PlanPreview
}

/** 'report' = read-only Q&A (manager+); 'full' = read + write proposals (super-admin). */
export type AgentMode = 'report' | 'full'

/**
 * Drives the natural-language command bar / console: send a message, receive
 * either a clarifying reply or a proposed operation + preview, then confirm to
 * execute. Confirmation re-validates server-side; nothing is written until
 * confirm(). In 'report' mode the server exposes no write tools, so proposals
 * never appear.
 */
export function usePayrollAgent(
  opts: { mode?: AgentMode; onExecuted?: () => void } = {}
) {
  const { mode = 'report', onExecuted } = opts
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [proposal, setProposal] = useState<AgentProposal | null>(null)
  const [thinking, setThinking] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || thinking) return
      setError(null)
      setProposal(null)
      const next: ChatTurn[] = [...messages, { role: 'user', content: trimmed }]
      setMessages(next)
      setThinking(true)
      try {
        const res = await fetch('/api/payroll/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next, mode }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Command failed')
        if (data.assistantText) {
          setMessages((m) => [...m, { role: 'assistant', content: data.assistantText }])
        }
        if (data.proposal) setProposal(data.proposal as AgentProposal)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Command failed')
      } finally {
        setThinking(false)
      }
    },
    [messages, thinking, mode]
  )

  const confirm = useCallback(async () => {
    if (!proposal || executing) return
    setError(null)
    setExecuting(true)
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content
      const res = await fetch('/api/payroll/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: proposal.operation,
          input: proposal.input,
          agentPrompt: lastUser,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Execution failed')
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `✓ Done — ${proposal.preview.summary}` },
      ])
      setProposal(null)
      onExecuted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution failed')
    } finally {
      setExecuting(false)
    }
  }, [proposal, executing, messages, onExecuted])

  const cancel = useCallback(() => {
    setProposal(null)
    setMessages((m) => [...m, { role: 'assistant', content: 'Cancelled.' }])
  }, [])

  const reset = useCallback(() => {
    setMessages([])
    setProposal(null)
    setError(null)
  }, [])

  return { messages, proposal, thinking, executing, error, send, confirm, cancel, reset }
}
