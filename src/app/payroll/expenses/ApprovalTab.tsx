'use client'

import { useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ChevronDown, ChevronUp, CheckCircle2, XCircle, MessageSquare,
  BookOpen, Eye, AlertTriangle, Pencil,
} from 'lucide-react'
import {
  FormButton, FormField, FormInput, FormSelect, FormTextarea,
  InfoBlock,
} from '@/components/form'
import {
  useExpenseApprovals,
  type GasAllocationResult,
  type GasAllocationMap,
} from '@/hooks/payroll/useExpenseApprovals'
import type {
  PayrollExpenseSubmission,
  PayrollExpenseItem,
  GasAllocationEntry,
  GasAllocationAudit,
  PropertyOverride,
} from '@/lib/supabase/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  gas: 'Gas',
  tolls: 'Tolls / EZ-Pass',
  parking: 'Parking',
  materials: 'Materials / Supplies',
  tools: 'Tools (unit-weighted)',
  food: 'Food',
  other: 'Other',
  mileage: 'Mileage',
}

// ── Gas Allocation Panel ──────────────────────────────────────────────────────
// Displays pre-computed allocation from the hook; allows manual override.

function GasAllocationPanel({
  item,
  employeeId,
  result,
  onAllocationReady,
}: {
  item: PayrollExpenseItem
  employeeId: string
  result: GasAllocationResult | undefined
  onAllocationReady: (itemId: string, entries: GasAllocationEntry[], audit: GasAllocationAudit) => void
}) {
  const [overrideMode, setOverrideMode] = useState(false)
  const [overrideEntries, setOverrideEntries] = useState<GasAllocationEntry[]>([])
  const [overrideNote, setOverrideNote] = useState('')
  const [pctError, setPctError] = useState<string | null>(null)

  const handleOverrideSave = () => {
    const sum = overrideEntries.reduce((s, e) => s + e.pct, 0)
    if (Math.abs(sum - 100) > 0.5) {
      setPctError(`Percentages must sum to 100% (currently ${sum.toFixed(1)}%)`)
      return
    }
    setPctError(null)
    const updated: GasAllocationEntry[] = overrideEntries.map(e => ({
      ...e,
      amount: Math.round(item.amount * (e.pct / 100) * 100) / 100,
    }))
    const drift = Math.round((item.amount - updated.reduce((s, e) => s + e.amount, 0)) * 100) / 100
    if (updated.length > 0 && drift !== 0) updated[0].amount = Math.round((updated[0].amount + drift) * 100) / 100

    const audit: GasAllocationAudit = {
      employee_id: employeeId,
      window_start: result?.windowStart ?? '',
      window_end: result?.windowEnd ?? '',
      auto_allocation: result?.entries ?? [],
      override_used: true,
    }
    onAllocationReady(item.id, updated, audit)
    setOverrideMode(false)
  }

  const startOverride = () => {
    setOverrideEntries((result?.entries ?? []).map(e => ({ ...e })))
    setOverrideMode(true)
  }

  if (!result) {
    return <div className="text-xs text-[var(--muted)] py-2">Calculating allocation...</div>
  }

  if (result.noData) {
    return (
      <div className="mt-2">
        <InfoBlock variant="warning" title="No time entries found in window">
          No property visits found for this employee in the allocation window.
          You must manually assign the allocation before approving.
        </InfoBlock>
        {!overrideMode ? (
          <FormButton variant="secondary" size="sm" type="button" onClick={startOverride}>
            <Pencil size={12} className="mr-1" /> Assign Manually
          </FormButton>
        ) : (
          <ManualAllocationEditor
            entries={overrideEntries}
            totalAmount={item.amount}
            onChange={setOverrideEntries}
            onSave={handleOverrideSave}
            onCancel={() => setOverrideMode(false)}
            note={overrideNote}
            onNoteChange={setOverrideNote}
            pctError={pctError}
          />
        )}
      </div>
    )
  }

  const windowLabel = `${format(parseISO(result.windowStart), 'M/d')}-${format(parseISO(result.windowEnd), 'M/d')}`

  return (
    <div className="mt-2 border border-[var(--border)] bg-[var(--bg-section)]">
      <div className="px-3 py-2 border-b border-[var(--divider)] flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--ink)]">
          Auto-allocation based on property visits {windowLabel}
        </p>
        {!overrideMode && (
          <FormButton variant="ghost" size="sm" type="button" onClick={startOverride}>
            <Pencil size={11} className="mr-1" /> Override
          </FormButton>
        )}
      </div>
      {!overrideMode ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--muted)]">
              <th className="px-3 py-1.5 text-left font-medium">Property</th>
              <th className="px-3 py-1.5 text-right font-medium">Visits</th>
              <th className="px-3 py-1.5 text-right font-medium">Allocation</th>
              <th className="px-3 py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {result.entries.map(e => (
              <tr key={e.property_id} className="border-t border-[var(--divider)]">
                <td className="px-3 py-1.5">{e.property_code} - {e.property_name}</td>
                <td className="px-3 py-1.5 text-right">{e.visits}</td>
                <td className="px-3 py-1.5 text-right">{e.pct.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right font-medium">${e.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--border)]">
              <td colSpan={3} className="px-3 py-1.5 text-right font-semibold">Total</td>
              <td className="px-3 py-1.5 text-right font-bold">${item.amount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="p-3">
          <ManualAllocationEditor
            entries={overrideEntries}
            totalAmount={item.amount}
            onChange={setOverrideEntries}
            onSave={handleOverrideSave}
            onCancel={() => setOverrideMode(false)}
            note={overrideNote}
            onNoteChange={setOverrideNote}
            pctError={pctError}
          />
        </div>
      )}
    </div>
  )
}

// ── Manual allocation editor ──────────────────────────────────────────────────

function ManualAllocationEditor({
  entries,
  totalAmount,
  onChange,
  onSave,
  onCancel,
  note,
  onNoteChange,
  pctError,
}: {
  entries: GasAllocationEntry[]
  totalAmount: number
  onChange: (entries: GasAllocationEntry[]) => void
  onSave: () => void
  onCancel: () => void
  note: string
  onNoteChange: (v: string) => void
  pctError: string | null
}) {
  const pctSum = entries.reduce((s, e) => s + e.pct, 0)
  return (
    <div>
      <p className="text-xs text-[var(--muted)] mb-2">
        Edit allocations below. Percentages must sum to 100%.
        Remaining: <strong>{(100 - pctSum).toFixed(1)}%</strong>
      </p>
      {entries.map((e, i) => (
        <div key={e.property_id} className="flex items-center gap-2 mb-1.5">
          <span className="text-xs flex-1 text-[var(--ink)]">{e.property_code} - {e.property_name}</span>
          <div className="flex items-center gap-1">
            <FormInput
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={e.pct}
              onChange={ev => {
                const updated = entries.map((x, j) => j === i ? { ...x, pct: parseFloat(ev.target.value) || 0 } : x)
                onChange(updated)
              }}
              className="w-16 text-right text-xs py-1"
            />
            <span className="text-xs text-[var(--muted)]">%</span>
            <span className="text-xs text-[var(--muted)] w-16 text-right">
              ${(totalAmount * (e.pct / 100)).toFixed(2)}
            </span>
          </div>
        </div>
      ))}
      {pctError && <p className="text-xs text-[var(--error)] mt-1">{pctError}</p>}
      <div className="mt-2">
        <FormField label="Reason for override" required>
          <FormTextarea
            rows={2}
            placeholder="Explain why the auto-allocation was changed"
            value={note}
            onChange={e => onNoteChange(e.target.value)}
          />
        </FormField>
        <div className="flex gap-2 mt-2">
          <FormButton size="sm" type="button" onClick={onSave}>Apply Override</FormButton>
          <FormButton size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</FormButton>
        </div>
      </div>
    </div>
  )
}

// ── Single submission card ────────────────────────────────────────────────────

function SubmissionApprovalCard({
  sub,
  allocationResults,
  onApprove,
  onReject,
  onCorrection,
  onRouteBookkeeping,
  onResolvePayment,
}: {
  sub: PayrollExpenseSubmission
  allocationResults: GasAllocationMap
  onApprove: (sub: PayrollExpenseSubmission, finalAllocations: Map<string, GasAllocationEntry[]>, overrides: PropertyOverride[], gasAudit: Map<string, GasAllocationAudit>, notes: string) => Promise<void>
  onReject: (id: string, notes: string) => Promise<void>
  onCorrection: (id: string, notes: string) => Promise<void>
  onRouteBookkeeping: (id: string, notes: string) => Promise<void>
  onResolvePayment: (subId: string, itemId: string, method: 'personal' | 'company_card' | 'company_account', notes: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(true)
  const [actionMode, setActionMode] = useState<'idle' | 'reject' | 'correction' | 'bookkeeping'>('idle')
  const [actionNote, setActionNote] = useState('')
  const [approvalNotes, setApprovalNotes] = useState('')
  const [processing, setProcessing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Local override state: item_id -> user-overridden entries (starts from hook pre-computed)
  const [localAllocations, setLocalAllocations] = useState<Map<string, GasAllocationEntry[]>>(new Map())
  const [gasAudit, setGasAudit] = useState<Map<string, GasAllocationAudit>>(new Map())
  const [propertyOverrides, setPropertyOverrides] = useState<PropertyOverride[]>([])

  const [resolveItemId, setResolveItemId] = useState<string | null>(null)
  const [resolvedMethod, setResolvedMethod] = useState<'personal' | 'company_card' | 'company_account'>('personal')
  const [resolveNote, setResolveNote] = useState('')

  const handleGasReady = useCallback((itemId: string, entries: GasAllocationEntry[], audit: GasAllocationAudit) => {
    setLocalAllocations(prev => {
      const next = new Map(prev)
      next.set(itemId, entries)
      return next
    })
    setGasAudit(prev => {
      const next = new Map(prev)
      next.set(itemId, audit)
      return next
    })
  }, [])

  const gasItems = (sub.items ?? []).filter(it => it.expense_type === 'gas' && it.payment_method === 'personal')
  const unknownItems = (sub.items ?? []).filter(it => it.payment_method === 'unknown')
  const hasUnresolvedUnknown = unknownItems.length > 0

  // For approval: use local override if set, otherwise fall back to hook pre-computed result entries
  const getFinalAllocations = (): Map<string, GasAllocationEntry[]> => {
    const merged = new Map<string, GasAllocationEntry[]>()
    for (const item of gasItems) {
      if (localAllocations.has(item.id)) {
        merged.set(item.id, localAllocations.get(item.id)!)
      } else {
        const precomputed = allocationResults[item.id]
        if (precomputed && !precomputed.noData) {
          merged.set(item.id, precomputed.entries)
        }
      }
    }
    return merged
  }

  const getFinalAudit = (): Map<string, GasAllocationAudit> => {
    const merged = new Map<string, GasAllocationAudit>(gasAudit)
    for (const item of gasItems) {
      if (!merged.has(item.id)) {
        const precomputed = allocationResults[item.id]
        if (precomputed && !precomputed.noData) {
          merged.set(item.id, {
            employee_id: sub.employee_id,
            window_start: precomputed.windowStart,
            window_end: precomputed.windowEnd,
            auto_allocation: precomputed.entries,
            override_used: false,
          })
        }
      }
    }
    return merged
  }

  const gasItemsReady = gasItems.every(it => {
    const precomputed = allocationResults[it.id]
    return localAllocations.has(it.id) || (precomputed && !precomputed.noData)
  })
  const canApprove = !hasUnresolvedUnknown && (gasItems.length === 0 || gasItemsReady)

  const doApprove = async () => {
    setProcessing(true)
    setActionError(null)
    try {
      await onApprove(sub, getFinalAllocations(), propertyOverrides, getFinalAudit(), approvalNotes)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Approval failed.')
    } finally {
      setProcessing(false)
    }
  }

  const doAction = async () => {
    if (!actionNote.trim()) { setActionError('A note is required.'); return }
    setProcessing(true)
    setActionError(null)
    try {
      if (actionMode === 'reject') await onReject(sub.id, actionNote)
      else if (actionMode === 'correction') await onCorrection(sub.id, actionNote)
      else if (actionMode === 'bookkeeping') await onRouteBookkeeping(sub.id, actionNote)
      setActionMode('idle')
      setActionNote('')
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setProcessing(false)
    }
  }

  const doResolvePayment = async () => {
    if (!resolveItemId) return
    if (!resolveNote.trim()) { setActionError('Note required to resolve payment method.'); return }
    setProcessing(true)
    try {
      await onResolvePayment(sub.id, resolveItemId, resolvedMethod, resolveNote)
      setResolveItemId(null)
      setResolveNote('')
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed.')
    } finally {
      setProcessing(false)
    }
  }

  const weekLabel = sub.week?.week_start
    ? `Week of ${format(parseISO(sub.week.week_start), 'MMM d')}`
    : 'No week assigned'
  const total = sub.total_amount ?? 0

  return (
    <div className={`border mb-4 ${sub.status === 'correction_requested' ? 'border-[var(--warning)]' : 'border-[var(--border)]'}`}>
      <div
        className="flex items-center justify-between px-4 py-3 bg-[var(--bg-section)] cursor-pointer"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-4">
          {sub.status === 'correction_requested' && (
            <span className="text-xs text-[var(--warning)] font-medium uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle size={11} /> Correction Requested
            </span>
          )}
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">
              {sub.employee?.name ?? 'Employee'} - ${total.toFixed(2)}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {weekLabel} · Submitted {format(parseISO(sub.submitted_at), 'MMM d, h:mm a')}
              {sub.items?.length ? ` · ${sub.items.length} receipt${sub.items.length !== 1 ? 's' : ''}` : ''}
              {hasUnresolvedUnknown ? ' · payment method unclear' : ''}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </div>

      {expanded && (
        <div className="p-4">
          {sub.notes && (
            <InfoBlock variant="default" title="Submitter note">{sub.notes}</InfoBlock>
          )}

          {(sub.items ?? []).map((item, i) => (
            <div key={item.id} className="mb-4 pb-4 border-b border-[var(--divider)] last:border-0 last:mb-0 last:pb-0">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {i + 1}. {EXPENSE_TYPE_LABELS[item.expense_type] ?? item.expense_type} - ${item.amount.toFixed(2)}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {item.property
                      ? `${item.property.code} - ${item.property.name}`
                      : item.expense_type === 'tools' ? 'Unit-weighted'
                      : item.expense_type === 'gas' ? 'Auto-allocated'
                      : '-'}
                    {' · '}{item.payment_method.replace(/_/g, ' ')}
                    {item.prior_week ? ` · Prior week: ${format(parseISO(item.prior_week.week_start), 'M/d')}` : ''}
                    {item.description ? ` · ${item.description}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <a
                    href={`/api/expense-receipt?path=${encodeURIComponent(item.receipt_image_url ?? '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] text-xs hover:underline flex items-center gap-1"
                  >
                    <Eye size={12} /> Receipt
                  </a>
                  <a
                    href={`/api/expense-receipt?path=${encodeURIComponent(sub.signature_url ?? '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--muted)] text-xs hover:underline flex items-center gap-1"
                  >
                    Signature
                  </a>
                </div>
              </div>

              {item.expense_type === 'gas' && item.payment_method === 'personal' && (
                <GasAllocationPanel
                  item={item}
                  employeeId={sub.employee_id}
                  result={allocationResults[item.id]}
                  onAllocationReady={handleGasReady}
                />
              )}

              {item.payment_method === 'unknown' && (
                <div className="mt-2">
                  <InfoBlock variant="warning" title="Payment method unclear">
                    Submitter was unsure how this was paid. Resolve before routing.
                  </InfoBlock>
                  {resolveItemId === item.id ? (
                    <div className="mt-2 space-y-2">
                      <FormField label="Resolved payment method" required>
                        <FormSelect
                          value={resolvedMethod}
                          onChange={e => setResolvedMethod(e.target.value as 'personal' | 'company_card' | 'company_account')}
                        >
                          <option value="personal">Personal card / cash - enters reimbursement flow</option>
                          <option value="company_card">Company card - bookkeeping only</option>
                          <option value="company_account">Company account - bookkeeping only</option>
                        </FormSelect>
                      </FormField>
                      <FormField label="Note" required>
                        <FormInput
                          placeholder="Note explaining the resolution"
                          value={resolveNote}
                          onChange={e => setResolveNote(e.target.value)}
                        />
                      </FormField>
                      <div className="flex gap-2">
                        <FormButton size="sm" type="button" onClick={doResolvePayment} loading={processing}>
                          Save
                        </FormButton>
                        <FormButton size="sm" variant="ghost" type="button" onClick={() => setResolveItemId(null)}>
                          Cancel
                        </FormButton>
                      </div>
                    </div>
                  ) : (
                    <FormButton variant="secondary" size="sm" type="button" className="mt-1" onClick={() => setResolveItemId(item.id)}>
                      Resolve Payment Method
                    </FormButton>
                  )}
                </div>
              )}
            </div>
          ))}

          {actionError && <InfoBlock variant="error">{actionError}</InfoBlock>}

          {actionMode === 'idle' ? (
            <div className="mt-4 space-y-3">
              <FormField label="Approval notes (optional)">
                <FormTextarea
                  rows={2}
                  placeholder="Any notes for the record"
                  value={approvalNotes}
                  onChange={e => setApprovalNotes(e.target.value)}
                />
              </FormField>
              <div className="flex items-center gap-2 flex-wrap">
                <FormButton
                  onClick={doApprove}
                  loading={processing}
                  disabled={!canApprove || processing}
                  title={!canApprove ? (hasUnresolvedUnknown ? 'Resolve unknown payment methods first' : 'Gas allocation not ready') : ''}
                >
                  <CheckCircle2 size={14} className="mr-1.5" />
                  Approve
                </FormButton>
                <FormButton variant="secondary" size="md" type="button" onClick={() => setActionMode('correction')}>
                  <MessageSquare size={13} className="mr-1.5" />
                  Request Correction
                </FormButton>
                <FormButton variant="ghost" size="md" type="button" onClick={() => setActionMode('bookkeeping')}>
                  <BookOpen size={13} className="mr-1.5" />
                  Route to Bookkeeping
                </FormButton>
                <FormButton variant="danger" size="md" type="button" onClick={() => setActionMode('reject')}>
                  <XCircle size={13} className="mr-1.5" />
                  Reject
                </FormButton>
              </div>
              {!canApprove && (
                <p className="text-xs text-[var(--warning)]">
                  {hasUnresolvedUnknown
                    ? 'Resolve all unknown payment methods before approving.'
                    : 'Gas allocation is being calculated...'}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 border border-[var(--border)] p-4">
              <p className="text-sm font-medium text-[var(--ink)] mb-3">
                {actionMode === 'reject' ? 'Reject - required note'
                  : actionMode === 'correction' ? 'Request Correction - required note'
                  : 'Route to Bookkeeping - note'}
              </p>
              <FormField label="Note" required>
                <FormTextarea
                  rows={3}
                  placeholder={
                    actionMode === 'reject' ? 'Reason for rejection'
                      : actionMode === 'correction' ? 'What needs to be fixed'
                      : 'Note for bookkeeping (optional)'
                  }
                  value={actionNote}
                  onChange={e => setActionNote(e.target.value)}
                />
              </FormField>
              {actionError && <InfoBlock variant="error">{actionError}</InfoBlock>}
              <div className="flex gap-2 mt-2">
                <FormButton
                  size="sm"
                  variant={actionMode === 'reject' ? 'danger' : 'primary'}
                  type="button"
                  onClick={doAction}
                  loading={processing}
                >
                  Confirm
                </FormButton>
                <FormButton
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => { setActionMode('idle'); setActionNote(''); setActionError(null) }}
                >
                  Cancel
                </FormButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Approval Tab ──────────────────────────────────────────────────────────────

export function ApprovalTab() {
  const {
    pendingSubmissions,
    gasAllocations,
    loading,
    error,
    approveSubmission,
    rejectSubmission,
    requestCorrection,
    routeToBookkeeping,
    resolvePaymentMethod,
  } = useExpenseApprovals()

  if (loading) {
    return <div className="p-6 text-sm text-[var(--muted)]">Loading pending submissions...</div>
  }

  if (error) {
    return <div className="p-6"><InfoBlock variant="error">{error}</InfoBlock></div>
  }

  return (
    <div className="p-6 max-w-3xl">
      {pendingSubmissions.length === 0 ? (
        <InfoBlock variant="success" title="Queue is clear">
          No submissions pending approval.
        </InfoBlock>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)] mb-4">
            {pendingSubmissions.length} submission{pendingSubmissions.length !== 1 ? 's' : ''} pending - oldest first
          </p>
          {pendingSubmissions.map(sub => (
            <SubmissionApprovalCard
              key={sub.id}
              sub={sub}
              allocationResults={gasAllocations}
              onApprove={async (s, finalAllocations, overrides, audit, notes) => {
                await approveSubmission({ submission: s, finalAllocations, propertyOverrides: overrides, gasAudit: audit, notes })
              }}
              onReject={rejectSubmission}
              onCorrection={requestCorrection}
              onRouteBookkeeping={routeToBookkeeping}
              onResolvePayment={resolvePaymentMethod}
            />
          ))}
        </>
      )}
    </div>
  )
}
