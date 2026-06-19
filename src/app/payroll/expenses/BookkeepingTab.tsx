'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ChevronUp, Eye } from 'lucide-react'
import { InfoBlock } from '@/components/form'
import { useExpenseApprovals } from '@/hooks/payroll/useExpenseApprovals'
import type { PayrollExpenseSubmission } from '@/lib/supabase/types'

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  gas: 'Gas',
  tolls: 'Tolls / EZ-Pass',
  parking: 'Parking',
  materials: 'Materials / Supplies',
  tools: 'Tools',
  food: 'Food',
  other: 'Other',
  mileage: 'Mileage',
}

function BookkeepingRow({ sub }: { sub: PayrollExpenseSubmission }) {
  const [open, setOpen] = useState(false)
  const total = sub.total_amount ?? 0
  const weekLabel = sub.week?.week_start
    ? `Week of ${format(parseISO(sub.week.week_start), 'MMM d')}`
    : 'Unassigned'

  return (
    <div className="border border-[var(--border)] mb-2 bg-white">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-section)] transition-colors"
        onClick={() => setOpen(p => !p)}
      >
        <div className="flex items-center gap-5">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">
              {sub.employee?.name ?? 'Employee'} — ${total.toFixed(2)}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {weekLabel} · Submitted {format(parseISO(sub.submitted_at), 'MMM d, yyyy h:mm a')}
              {sub.items?.length ? ` · ${sub.items.length} receipt${sub.items.length !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </div>

      {open && sub.items && (
        <div className="border-t border-[var(--divider)] px-4 py-3">
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
                  <td className="py-2">{EXPENSE_TYPE_LABELS[item.expense_type] ?? item.expense_type}</td>
                  <td className="py-2 text-[var(--muted)]">
                    {item.property ? `${item.property.code} — ${item.property.name}` : '—'}
                  </td>
                  <td className="py-2 text-[var(--muted)] capitalize">
                    {item.payment_method.replace(/_/g, ' ')}
                  </td>
                  <td className="py-2 text-right font-medium">${item.amount.toFixed(2)}</td>
                  <td className="py-2 text-center">
                    <a
                      href={`/api/expense-receipt?path=${encodeURIComponent(item.receipt_image_url ?? '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] hover:underline text-xs"
                    >
                      <Eye size={13} className="inline" />
                    </a>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-section)]">
                <td colSpan={3} className="py-2 px-0 text-sm font-semibold">Total</td>
                <td className="py-2 text-right font-bold">${total.toFixed(2)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          {sub.notes && (
            <p className="text-xs text-[var(--muted)] mt-2 pt-2 border-t border-[var(--divider)]">
              Note: {sub.notes}
            </p>
          )}
          <div className="mt-2">
            <a
              href={`/api/expense-receipt?path=${encodeURIComponent(sub.signature_url ?? '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--muted)] hover:text-[var(--primary)] hover:underline"
            >
              View employee signature
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export function BookkeepingTab() {
  const { bookkeepingSubmissions, loading, error } = useExpenseApprovals()

  if (loading) {
    return <div className="p-6 text-sm text-[var(--muted)]">Loading…</div>
  }

  if (error) {
    return <div className="p-6"><InfoBlock variant="error">{error}</InfoBlock></div>
  }

  return (
    <div className="p-6 max-w-3xl">
      <InfoBlock variant="default" title="Bookkeeping reconciliation view">
        Company card and company account receipts are shown here. These do not flow through payroll —
        they are captured for Kathleen&apos;s bookkeeping reconciliation only.
      </InfoBlock>

      {bookkeepingSubmissions.length === 0 ? (
        <p className="text-sm text-[var(--muted)] mt-4">No company card / account submissions on record.</p>
      ) : (
        <div className="mt-4">
          <p className="text-xs text-[var(--muted)] mb-3">
            {bookkeepingSubmissions.length} submission{bookkeepingSubmissions.length !== 1 ? 's' : ''} — most recent first
          </p>
          {bookkeepingSubmissions.map(sub => (
            <BookkeepingRow key={sub.id} sub={sub} />
          ))}
        </div>
      )}
    </div>
  )
}
