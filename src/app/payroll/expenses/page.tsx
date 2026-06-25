'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Plus, X, Upload, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle2, Eye, RotateCcw,
} from 'lucide-react'
import {
  PageHeader, FormButton, FormField, FormInput, FormSelect,
  FormTextarea, InfoBlock, SectionDivider, StatusBadge,
} from '@/components/form'
import { SignatureCanvas } from '@/components/form/SignatureCanvas'
import {
  useExpenseSubmissions,
  useCutoffInfo,
  blankDraftItem,
  type DraftExpenseItem,
} from '@/hooks/payroll/useExpenseSubmissions'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { useProperties } from '@/hooks/payroll/useProperties'
import { useAuth } from '@/hooks/payroll/useAuth'
import type { PayrollExpenseSubmission, ExpenseType, ExpensePaymentMethod, ExpenseAllocationMethod, PayrollWeek } from '@/lib/supabase/types'
import { ApprovalTab } from './ApprovalTab'
import { BookkeepingTab } from './BookkeepingTab'

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  gas: 'Gas',
  tolls: 'Tolls / EZ-Pass',
  parking: 'Parking',
  materials: 'Materials / Supplies',
  tools: 'Tools (unit-weighted)',
  food: 'Food',
  other: 'Other',
  mileage: 'Mileage (future)',
}

const PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  personal: 'Personal card / cash — I paid out of pocket',
  company_card: 'Company card',
  company_account: 'Company account / check',
  unknown: 'Not sure',
}

const PAYMENT_METHOD_NOTES: Record<ExpensePaymentMethod, string | null> = {
  personal: null,
  company_card: 'Receipt will be routed to bookkeeping — no reimbursement.',
  company_account: 'Receipt will be routed to bookkeeping — no reimbursement.',
  unknown: 'Will go to manager queue for clarification before routing.',
}

type TabId = 'submit' | 'pending' | 'bookkeeping'

// Allocation modes a submitter can pick for a non-gas, non-tools expense.
const ALLOCATION_MODE_LABELS: Record<'direct' | 'unit_weighted' | 'custom_split', string> = {
  direct: 'One property',
  unit_weighted: 'Spread across all properties (by unit count)',
  custom_split: 'Split across selected properties',
}

// Count the valid legs of a custom split (property set + positive percent).
function validSplitLegs(item: DraftExpenseItem): { property_id: string; pct: string }[] {
  return item.split_entries.filter(s => s.property_id && (parseFloat(s.pct) || 0) > 0)
}

// ── Split allocation editor ───────────────────────────────────────────────────
// Divide one receipt across several properties by percent. Percentages must total 100%.

function SplitAllocationEditor({
  item,
  properties,
  onChange,
}: {
  item: DraftExpenseItem
  properties: { id: string; code: string; name: string }[]
  onChange: (id: string, patch: Partial<DraftExpenseItem>) => void
}) {
  const amount = parseFloat(item.amount) || 0
  const rows = item.split_entries
  const setRows = (next: typeof rows) => onChange(item.id, { split_entries: next })
  const pctSum = rows.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)

  return (
    <div className="mt-2 border border-[var(--border)] bg-[var(--bg-section)] p-3">
      <p className="text-xs text-[var(--muted)] mb-2">
        Divide this receipt across properties — percentages must total 100%.
        Remaining: <strong className={Math.abs(pctSum - 100) > 0.5 ? 'text-[var(--warning)]' : 'text-[var(--success)]'}>{(100 - pctSum).toFixed(1)}%</strong>
      </p>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <FormSelect
            value={r.property_id}
            onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, property_id: e.target.value } : x))}
            className="flex-1 text-xs py-1"
          >
            <option value="">— property —</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </FormSelect>
          <FormInput
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0"
            value={r.pct}
            onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))}
            className="w-16 text-right text-xs py-1"
          />
          <span className="text-xs text-[var(--muted)]">%</span>
          <span className="text-xs text-[var(--muted)] w-16 text-right">
            ${(amount * (parseFloat(r.pct) || 0) / 100).toFixed(2)}
          </span>
          <button
            type="button"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="text-[var(--muted)] hover:text-[var(--error)] p-1"
            title="Remove property"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <FormButton
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => setRows([...rows, { property_id: '', pct: '' }])}
      >
        <Plus size={12} className="mr-1" /> Add property
      </FormButton>
    </div>
  )
}

// ── Receipt Item Card ─────────────────────────────────────────────────────────

function ItemCard({
  item,
  index,
  properties,
  weeks,
  onChange,
  onRemove,
}: {
  item: DraftExpenseItem
  index: number
  properties: { id: string; code: string; name: string }[]
  weeks: { id: string; week_start: string; week_end: string }[]
  onChange: (id: string, patch: Partial<DraftExpenseItem>) => void
  onRemove: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  // tools is always unit-weighted (no picker); gas is auto-allocated at approval; every
  // other type lets the submitter choose one / spread / split below.
  const showAllocation = item.expense_type !== 'tools' && item.expense_type !== 'mileage'
  const needsDescription = item.expense_type === 'other'
  const descriptionOptional = ['materials', 'food'].includes(item.expense_type)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    onChange(item.id, { receipt_file: file, receipt_preview: preview })
  }

  return (
    <div className="border border-[var(--border)] bg-white mb-3">
      {/* Card header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-[var(--bg-section)] cursor-pointer"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-[var(--muted)] w-5 text-center">{index + 1}</span>
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">
              {EXPENSE_TYPE_LABELS[item.expense_type]}
              {item.amount ? ` — $${parseFloat(item.amount).toFixed(2)}` : ''}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {item.payment_method ? PAYMENT_METHOD_LABELS[item.payment_method].split('—')[0].trim() : ''}
              {item.receipt_file ? ' · receipt attached' : ' · no receipt yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRemove(item.id) }}
            className="text-[var(--muted)] hover:text-[var(--error)] transition-colors p-1"
            title="Remove item"
          >
            <X size={14} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 grid grid-cols-2 gap-4">
          {/* Expense type */}
          <FormField label="Expense Type" required>
            <FormSelect
              value={item.expense_type}
              onChange={e => {
                const t = e.target.value as ExpenseType
                // Keep allocation_method valid for the new type: gas → auto, tools → spread,
                // anything else → keep the chosen mode, defaulting to a single property.
                const allocation_method: ExpenseAllocationMethod =
                  t === 'gas' ? 'gas_auto'
                  : t === 'tools' ? 'unit_weighted'
                  : (item.allocation_method === 'direct' || item.allocation_method === 'unit_weighted' || item.allocation_method === 'custom_split')
                    ? item.allocation_method
                    : 'direct'
                onChange(item.id, { expense_type: t, allocation_method })
              }}
            >
              {(Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[])
                .filter(t => t !== 'mileage')
                .map(t => (
                  <option key={t} value={t}>{EXPENSE_TYPE_LABELS[t]}</option>
                ))}
            </FormSelect>
          </FormField>

          {/* Amount */}
          <FormField label="Amount ($)" required>
            <FormInput
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={item.amount}
              onChange={e => onChange(item.id, { amount: e.target.value })}
            />
          </FormField>

          {/* Allocation — hidden for tools (always unit-weighted) */}
          {item.expense_type === 'gas' ? (
            <FormField
              label="Property (auto-allocated at approval)"
              helperText="Gas will be split by your property visits — no selection needed."
            >
              <div className="px-3 py-2 border border-[var(--divider)] bg-[var(--bg-section)] text-sm text-[var(--muted)] italic">
                Auto-allocated at approval time
              </div>
            </FormField>
          ) : showAllocation ? (
            <div className="col-span-2">
              <FormField
                label="Bill to property"
                required
                helperText="Every expense is billed to the property owner. Choose how to allocate it."
              >
                <FormSelect
                  value={item.allocation_method}
                  onChange={e => onChange(item.id, { allocation_method: e.target.value as ExpenseAllocationMethod })}
                >
                  {(['direct', 'unit_weighted', 'custom_split'] as const).map(m => (
                    <option key={m} value={m}>{ALLOCATION_MODE_LABELS[m]}</option>
                  ))}
                </FormSelect>
              </FormField>

              {item.allocation_method === 'direct' && (
                <div className="mt-2">
                  <FormSelect
                    value={item.property_id}
                    onChange={e => onChange(item.id, { property_id: e.target.value })}
                  >
                    <option value="">— Select property —</option>
                    {properties.map(p => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </FormSelect>
                </div>
              )}

              {item.allocation_method === 'unit_weighted' && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Billed across every managed property in proportion to its unit count — no selection needed.
                </p>
              )}

              {item.allocation_method === 'custom_split' && (
                <SplitAllocationEditor item={item} properties={properties} onChange={onChange} />
              )}
            </div>
          ) : null}

          {/* Payment method */}
          <FormField label="How was this paid?" required>
            <FormSelect
              value={item.payment_method}
              onChange={e => onChange(item.id, { payment_method: e.target.value as ExpensePaymentMethod })}
            >
              {(Object.keys(PAYMENT_METHOD_LABELS) as ExpensePaymentMethod[]).map(m => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </FormSelect>
            {PAYMENT_METHOD_NOTES[item.payment_method] && (
              <p className="mt-1 text-xs text-[var(--warning)]">{PAYMENT_METHOD_NOTES[item.payment_method]}</p>
            )}
          </FormField>

          {/* Description */}
          {(needsDescription || descriptionOptional) && (
            <div className="col-span-2">
              <FormField label="Description" required={needsDescription}>
                <FormInput
                  placeholder={needsDescription ? 'Describe the expense' : 'Optional note'}
                  value={item.description}
                  onChange={e => onChange(item.id, { description: e.target.value })}
                />
              </FormField>
            </div>
          )}

          {/* Prior week */}
          <div className="col-span-2">
            <FormField
              label="Prior week expense?"
              helperText="If this expense is from a previous pay period, select that week."
            >
              <FormSelect
                value={item.prior_week_id}
                onChange={e => onChange(item.id, { prior_week_id: e.target.value })}
              >
                <option value="">— Current week —</option>
                {weeks.slice(1).map(w => (
                  <option key={w.id} value={w.id}>
                    Week of {format(parseISO(w.week_start), 'MMM d, yyyy')}
                  </option>
                ))}
              </FormSelect>
            </FormField>
          </div>

          {/* Receipt upload */}
          <div className="col-span-2">
            <FormField label="Receipt Photo" required>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFile}
              />
              {item.receipt_preview ? (
                <div className="flex items-start gap-3">
                  <img
                    src={item.receipt_preview}
                    alt="receipt"
                    className="h-20 w-auto border border-[var(--border)] object-cover"
                  />
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-[var(--success)] flex items-center gap-1">
                      <CheckCircle2 size={12} /> Receipt attached
                    </p>
                    <FormButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => fileRef.current?.click()}
                    >
                      Replace
                    </FormButton>
                  </div>
                </div>
              ) : (
                <FormButton
                  variant="secondary"
                  size="sm"
                  type="button"
                  fullWidth
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={13} className="mr-1.5" />
                  Attach Receipt Photo
                </FormButton>
              )}
            </FormField>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Submission History Row ────────────────────────────────────────────────────

function SubmissionRow({
  sub,
  weeks,
  canEdit,
  onReassignWeek,
}: {
  sub: PayrollExpenseSubmission
  weeks: PayrollWeek[]
  canEdit: boolean
  onReassignWeek: (submissionId: string, weekId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignErr, setReassignErr] = useState<string | null>(null)
  const statusMap: Record<string, string> = {
    pending: 'flagged',
    approved: 'approved',
    rejected: 'inactive',
    correction_requested: 'flagged',
    bookkeeping_only: 'draft',
  }
  const total = sub.total_amount ?? 0
  const weekLabel = sub.week?.week_start
    ? `Week of ${format(parseISO(sub.week.week_start), 'MMM d')}`
    : 'No week assigned'

  // Only weeks that aren't locked can be a move target — and the expense can only be
  // moved at all if its current week is itself unlocked (or unassigned).
  const writableWeeks = weeks.filter(w => w.status === 'draft' || w.status === 'corrections_complete')
  const currentWritable = !sub.payroll_week_id || writableWeeks.some(w => w.id === sub.payroll_week_id)

  const handleReassign = async (weekId: string) => {
    if (!weekId || weekId === sub.payroll_week_id) return
    setReassigning(true)
    setReassignErr(null)
    try {
      await onReassignWeek(sub.id, weekId)
    } catch (e) {
      setReassignErr(e instanceof Error ? e.message : 'Could not move week.')
    } finally {
      setReassigning(false)
    }
  }

  return (
    <div className="border border-[var(--border)] mb-2">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-section)] transition-colors"
        onClick={() => setOpen(p => !p)}
      >
        <div className="flex items-center gap-4">
          <StatusBadge status={statusMap[sub.status] ?? 'draft'} label={sub.status.replace(/_/g, ' ')} />
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">${total.toFixed(2)}</p>
            <p className="text-xs text-[var(--muted)]">
              {weekLabel} · {format(parseISO(sub.submitted_at), 'MMM d, h:mm a')}
              {sub.items?.length ? ` · ${sub.items.length} item${sub.items.length !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </div>

      {open && sub.items && (
        <div className="border-t border-[var(--divider)] px-4 py-3 bg-[var(--bg-section)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted)]">
                <th className="text-left pb-2 font-medium">Type</th>
                <th className="text-left pb-2 font-medium">Property</th>
                <th className="text-left pb-2 font-medium">Payment</th>
                <th className="text-right pb-2 font-medium">Amount</th>
                <th className="text-center pb-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {sub.items.map(item => (
                <tr key={item.id} className="border-t border-[var(--divider)]">
                  <td className="py-2">{EXPENSE_TYPE_LABELS[item.expense_type]}</td>
                  <td className="py-2 text-[var(--muted)]">
                    {item.property ? item.property.code
                      : item.expense_type === 'tools' ? 'Spread'
                      : item.expense_type === 'gas' ? 'Auto-alloc'
                      : item.allocation_method === 'unit_weighted' ? 'Spread'
                      : item.allocation_method === 'custom_split' ? `Split (${item.allocation_detail?.length ?? 0})`
                      : '—'}
                  </td>
                  <td className="py-2 text-[var(--muted)]">{item.payment_method.replace(/_/g, ' ')}</td>
                  <td className="py-2 text-right font-medium">${item.amount.toFixed(2)}</td>
                  <td className="py-2 text-center">
                    <a href={`/api/expense-receipt?path=${encodeURIComponent(item.receipt_image_url ?? '')}`} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline text-xs">
                      <Eye size={13} className="inline" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sub.notes && (
            <p className="text-xs text-[var(--muted)] mt-2 pt-2 border-t border-[var(--divider)]">Note: {sub.notes}</p>
          )}

          {/* Reassign the payroll week — moves the submission + its reimbursement adjustments. */}
          {canEdit && sub.status !== 'rejected' && (
            <div className="mt-2 pt-2 border-t border-[var(--divider)] flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--muted)]">Billed week:</span>
              {currentWritable ? (
                <>
                  <FormSelect
                    value={sub.payroll_week_id ?? ''}
                    disabled={reassigning}
                    onChange={e => handleReassign(e.target.value)}
                    className="text-xs py-1 w-auto"
                  >
                    {!sub.payroll_week_id && <option value="">— unassigned —</option>}
                    {writableWeeks.map(w => (
                      <option key={w.id} value={w.id}>Week of {format(parseISO(w.week_start), 'MMM d, yyyy')}</option>
                    ))}
                  </FormSelect>
                  {reassigning && <span className="text-xs text-[var(--muted)]">Moving…</span>}
                </>
              ) : (
                <span className="text-xs text-[var(--warning)]">
                  {weekLabel} is locked (approved/invoiced) — correct via a carry-forward in the open week.
                </span>
              )}
              {reassignErr && <span className="text-xs text-[var(--error)]">{reassignErr}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { profile, isManager } = useAuth()
  const { employees } = usePayrollEmployees()
  const { weeks } = usePayrollWeeks()
  const { properties } = useProperties()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')

  const {
    submissions,
    config,
    loading,
    error: hookError,
    refetch,
    submitBatch,
    reassignWeek,
  } = useExpenseSubmissions(selectedEmployeeId || undefined)

  const cutoffInfo = useCutoffInfo(config)

  // Which payroll week this batch lands in. Defaults to the cutoff rule's
  // assignment (current before cutoff, next after) but can be overridden.
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedWeekId(cutoffInfo.assignedWeekId)
  }, [cutoffInfo.assignedWeekId])

  const [activeTab, setActiveTab] = useState<TabId>('submit')

  // Submission form state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Batch items
  const [items, setItems] = useState<DraftExpenseItem[]>([blankDraftItem()])

  // Notes
  const [batchNotes, setBatchNotes] = useState('')

  // Review / signature step
  const [reviewing, setReviewing] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)

  const updateItem = useCallback((id: string, patch: Partial<DraftExpenseItem>) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id))
  }, [])

  const addItem = useCallback(() => {
    setItems(prev => [...prev, blankDraftItem()])
  }, [])

  // Validation
  const validationErrors = useMemo(() => {
    const errs: string[] = []
    if (!selectedEmployeeId) errs.push('Select an employee.')
    items.forEach((item, i) => {
      if (!item.receipt_file) errs.push(`Item ${i + 1}: receipt photo required.`)
      if (!item.amount || parseFloat(item.amount) <= 0) errs.push(`Item ${i + 1}: valid amount required.`)
      if (item.expense_type !== 'gas' && item.expense_type !== 'tools') {
        if (item.allocation_method === 'direct' && !item.property_id) {
          errs.push(`Item ${i + 1}: select a property (or choose spread / split).`)
        } else if (item.allocation_method === 'custom_split') {
          const legs = validSplitLegs(item)
          if (legs.length === 0) {
            errs.push(`Item ${i + 1}: add at least one property to the split.`)
          } else {
            const sum = item.split_entries.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0)
            if (Math.abs(sum - 100) > 0.5) {
              errs.push(`Item ${i + 1}: split percentages must total 100% (currently ${sum.toFixed(1)}%).`)
            }
            const ids = legs.map(l => l.property_id)
            if (new Set(ids).size !== ids.length) {
              errs.push(`Item ${i + 1}: each property can appear only once in the split.`)
            }
          }
        }
      }
      if (item.expense_type === 'other' && !item.description) {
        errs.push(`Item ${i + 1}: description required for "Other".`)
      }
    })
    return errs
  }, [items, selectedEmployeeId])

  const totalAmount = useMemo(() =>
    items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0),
    [items]
  )

  const handleReview = () => {
    if (validationErrors.length > 0) return
    setReviewing(true)
  }

  const handleSubmit = async () => {
    if (!signatureDataUrl) {
      setSubmitError('Signature is required.')
      return
    }
    const userId = profile?.id ?? ''
    if (!userId) { setSubmitError('Not authenticated.'); return }

    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitBatch({
        employeeId: selectedEmployeeId,
        submittedBy: userId,
        weekId: selectedWeekId,
        signatureDataUrl,
        notes: batchNotes,
        items,
      })
      setSubmitSuccess(true)
      setItems([blankDraftItem()])
      setBatchNotes('')
      setSignatureDataUrl(null)
      setReviewing(false)
      setSelectedEmployeeId('')
      refetch()
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  // submissions is already server-filtered by selectedEmployeeId via the hook

  const tabs: { id: TabId; label: string }[] = [
    { id: 'submit', label: 'Submit Expense' },
    { id: 'pending', label: 'Pending Approval' },
    { id: 'bookkeeping', label: 'Bookkeeping' },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Expense Reimbursements"
        subtitle="Submit receipts, track approvals, and manage reimbursement flow"
      />

      {/* Tab bar */}
      <div className="flex border-b border-[var(--divider)] bg-white px-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors duration-200 -mb-px ${
              activeTab === tab.id
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Submit tab */}
      {activeTab === 'submit' && (
        <div className="p-6 max-w-3xl">

          {submitSuccess && (
            <InfoBlock variant="success" title="Submission received">
              Your expense batch has been submitted and is pending approval.
              {' '}<button className="underline text-[var(--success)] text-sm" onClick={() => setSubmitSuccess(false)}>Dismiss</button>
            </InfoBlock>
          )}

          {/* Cutoff banner */}
          {cutoffInfo.message && (
            <InfoBlock variant={cutoffInfo.isAfterCutoff ? 'warning' : 'default'}>
              {cutoffInfo.isAfterCutoff && <AlertTriangle size={14} className="inline mr-1.5 text-[var(--warning)]" />}
              {cutoffInfo.message}
            </InfoBlock>
          )}

          {/* Week override — the cutoff sets a default, but you can reassign */}
          {cutoffInfo.currentWeekId && cutoffInfo.nextWeekId && (
            <div className="mb-5">
              <FormField label="Payroll week">
                <FormSelect
                  value={selectedWeekId ?? ''}
                  onChange={e => setSelectedWeekId(e.target.value)}
                >
                  <option value={cutoffInfo.currentWeekId}>
                    Current week{cutoffInfo.currentWeekStart ? ` — ${format(parseISO(cutoffInfo.currentWeekStart), 'MMM d')}` : ''}
                    {selectedWeekId === cutoffInfo.assignedWeekId && !cutoffInfo.isAfterCutoff ? ' (default)' : ''}
                  </option>
                  <option value={cutoffInfo.nextWeekId}>
                    Next week{cutoffInfo.nextWeekStart ? ` — ${format(parseISO(cutoffInfo.nextWeekStart), 'MMM d')}` : ''}
                    {cutoffInfo.isAfterCutoff ? ' (default after cutoff)' : ''}
                  </option>
                </FormSelect>
              </FormField>
            </div>
          )}

          {!reviewing ? (
            <>
              {/* Employee selector */}
              <div className="mb-5">
                <FormField label="Employee" required>
                  <FormSelect
                    value={selectedEmployeeId}
                    onChange={e => setSelectedEmployeeId(e.target.value)}
                  >
                    <option value="">— Select employee —</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </FormSelect>
                </FormField>
              </div>

              <SectionDivider label={`Receipt Items (${items.length})`} />

              {items.map((item, i) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  index={i}
                  properties={properties}
                  weeks={weeks}
                  onChange={updateItem}
                  onRemove={removeItem}
                />
              ))}

              <FormButton
                variant="secondary"
                size="sm"
                type="button"
                onClick={addItem}
                className="mb-5"
              >
                <Plus size={13} className="mr-1.5" />
                Add Another Receipt
              </FormButton>

              {/* Notes */}
              <SectionDivider label="Batch Notes (optional)" />
              <FormField label="Notes">
                <FormTextarea
                  rows={2}
                  placeholder="Any notes for the approver about this batch"
                  value={batchNotes}
                  onChange={e => setBatchNotes(e.target.value)}
                />
              </FormField>

              {/* Validation errors */}
              {validationErrors.length > 0 && (
                <InfoBlock variant="error" title="Please fix the following">
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </InfoBlock>
              )}

              <div className="flex items-center gap-3 mt-4">
                <FormButton
                  onClick={handleReview}
                  disabled={validationErrors.length > 0 || items.length === 0}
                >
                  Review &amp; Sign — ${totalAmount.toFixed(2)}
                </FormButton>
                <span className="text-xs text-[var(--muted)]">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              </div>
            </>
          ) : (
            // ── Review + Signature step ────────────────────────────────────────
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-lg text-[var(--primary)]">Review &amp; Sign</h2>
                <FormButton
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => { setReviewing(false); setSignatureDataUrl(null) }}
                >
                  <RotateCcw size={13} className="mr-1" />
                  Edit
                </FormButton>
              </div>

              {/* Cutoff reminder (before they commit) */}
              {cutoffInfo.message && (
                <InfoBlock variant={cutoffInfo.isAfterCutoff ? 'warning' : 'success'}>
                  {cutoffInfo.message}
                </InfoBlock>
              )}

              {/* Summary table */}
              <table className="w-full text-sm border border-[var(--border)] mb-5">
                <thead>
                  <tr className="bg-[var(--bg-section)] text-xs text-[var(--muted)]">
                    <th className="px-4 py-2.5 text-left font-medium">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-left font-medium">Property</th>
                    <th className="px-4 py-2.5 text-left font-medium">Payment</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-center font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={item.id} className="border-t border-[var(--divider)]">
                      <td className="px-4 py-2.5 text-[var(--muted)]">{i + 1}</td>
                      <td className="px-4 py-2.5">{EXPENSE_TYPE_LABELS[item.expense_type]}</td>
                      <td className="px-4 py-2.5 text-[var(--muted)]">
                        {item.expense_type === 'tools' ? 'Spread (all)'
                          : item.expense_type === 'gas' ? 'Auto at approval'
                          : item.allocation_method === 'unit_weighted' ? 'Spread (all)'
                          : item.allocation_method === 'custom_split' ? `Split (${validSplitLegs(item).length})`
                          : properties.find(p => p.id === item.property_id)?.code ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--muted)] capitalize">
                        {item.payment_method.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        ${(parseFloat(item.amount) || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {item.receipt_preview && (
                          <a href={item.receipt_preview} target="_blank" rel="noopener noreferrer">
                            <Eye size={13} className="inline text-[var(--primary)]" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-section)]">
                    <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-[var(--ink)]">Total</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[var(--primary)]">${totalAmount.toFixed(2)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>

              {/* Attestation */}
              <InfoBlock variant="default" title="Attestation">
                By signing below, I certify that all expenses listed above are accurate, legitimate business expenses
                incurred on behalf of Stanton Management, and that all receipts represent actual purchases.
              </InfoBlock>

              {/* Signature canvas */}
              <div className="mt-4 mb-5">
                <FormField label="Signature" required>
                  <SignatureCanvas
                    onCapture={url => setSignatureDataUrl(url)}
                    onClear={() => setSignatureDataUrl(null)}
                    height={160}
                  />
                </FormField>
              </div>

              {submitError && <InfoBlock variant="error">{submitError}</InfoBlock>}

              <div className="flex items-center gap-3">
                <FormButton
                  onClick={handleSubmit}
                  loading={submitting}
                  disabled={!signatureDataUrl || submitting}
                >
                  Submit — ${totalAmount.toFixed(2)}
                </FormButton>
                <FormButton
                  variant="ghost"
                  type="button"
                  onClick={() => { setReviewing(false); setSignatureDataUrl(null) }}
                  disabled={submitting}
                >
                  Back
                </FormButton>
              </div>
            </div>
          )}

          {/* Submission history */}
          {submissions.length > 0 && !reviewing && (
            <div className="mt-8">
              <SectionDivider label={`Submissions — ${employees.find(e => e.id === selectedEmployeeId)?.name ?? ''}`} />
              {loading ? (
                <div className="text-sm text-[var(--muted)] py-4">Loading…</div>
              ) : (
                submissions.map(sub => (
                  <SubmissionRow
                    key={sub.id}
                    sub={sub}
                    weeks={weeks}
                    canEdit={isManager}
                    onReassignWeek={reassignWeek}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Pending Approval tab */}
      {activeTab === 'pending' && <ApprovalTab />}

      {/* Bookkeeping tab */}
      {activeTab === 'bookkeeping' && <BookkeepingTab />}
    </div>
  )
}
