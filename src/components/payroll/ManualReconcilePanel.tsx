'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ClipboardPaste, Check, AlertTriangle } from 'lucide-react'
import { FormButton, InfoBlock, FormTextarea } from '@/components/form'
import { formatCurrency, type PayrollCalculationResult } from '@/lib/payroll/calculations'
import { parseManualPaste, matchManualToEmployees, reconcile } from '@/lib/payroll/reconcile'

/**
 * Reconcile the system's computed gross pay against a manually-prepared payroll
 * (the Excel sheet done by hand). The user types or pastes their manual figure
 * per employee and sees the per-line and total delta — so a new run can be
 * validated against the hand calculation it replaces.
 */
export function ManualReconcilePanel({ result }: { result: PayrollCalculationResult }) {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [unmatched, setUnmatched] = useState<string[]>([])

  const employees = useMemo(
    () => result.employee_summaries.map((e) => ({ id: e.employee_id, name: e.employee_name })),
    [result]
  )

  // Show employees who have system pay/hours, plus anyone given a manual value.
  const systemRows = useMemo(
    () =>
      result.employee_summaries
        .filter((e) => e.gross_pay !== 0 || e.regular_hours > 0 || manual[e.employee_id] != null)
        .map((e) => ({ id: e.employee_id, name: e.employee_name, gross: e.gross_pay }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [result, manual]
  )

  const manualNumbers = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [id, v] of Object.entries(manual)) {
      const n = Number(String(v).replace(/[,$\s]/g, ''))
      if (v !== '' && !Number.isNaN(n)) out[id] = n
    }
    return out
  }, [manual])

  const recon = useMemo(() => reconcile(systemRows, manualNumbers), [systemRows, manualNumbers])

  const applyPaste = () => {
    const lines = parseManualPaste(pasteText)
    const { matched, unmatched: um } = matchManualToEmployees(lines, employees)
    setManual((prev) => {
      const next = { ...prev }
      for (const [id, amt] of Object.entries(matched)) next[id] = String(amt)
      return next
    })
    setUnmatched(um)
    setPasteOpen(false)
  }

  const clearAll = () => {
    setManual({})
    setUnmatched([])
  }

  const hasAnyManual = Object.keys(manualNumbers).length > 0
  const allMatch = hasAnyManual && recon.mismatchCount === 0 && recon.missingManual === 0

  return (
    <div className="border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[var(--bg-section)] hover:bg-[var(--primary)]/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ClipboardPaste size={15} className="text-[var(--primary)]" />
          <span className="font-serif text-base text-[var(--primary)]">Reconcile vs Manual Payroll</span>
          <span className="text-xs text-[var(--muted)]">compare this run to the one you did by hand</span>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--muted)]" /> : <ChevronDown size={14} className="text-[var(--muted)]" />}
      </button>

      {open && (
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FormButton size="sm" variant="secondary" onClick={() => setPasteOpen((v) => !v)}>
              <ClipboardPaste size={13} className="mr-1" /> Paste from Excel
            </FormButton>
            {hasAnyManual && (
              <FormButton size="sm" variant="ghost" onClick={clearAll}>Clear</FormButton>
            )}
            <span className="text-xs text-[var(--muted)]">
              …or type each manual gross below.
            </span>
          </div>

          {pasteOpen && (
            <div className="space-y-2">
              <FormTextarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={5}
                placeholder={'Paste two columns — name and gross pay — straight from your sheet:\nStan Baldyga\t1,400.00\nCarlos Nieves\t1,080'}
              />
              <FormButton size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>Apply</FormButton>
            </div>
          )}

          {unmatched.length > 0 && (
            <InfoBlock variant="warning" title="Some pasted names didn't match an employee">
              {unmatched.join(', ')} — enter those manually below or fix the name.
            </InfoBlock>
          )}

          {hasAnyManual && (
            <InfoBlock variant={allMatch ? 'success' : recon.mismatchCount > 0 ? 'error' : 'default'}>
              {allMatch ? (
                <span className="flex items-center gap-1"><Check size={13} /> System matches your manual payroll exactly.</span>
              ) : (
                <>
                  {recon.mismatchCount > 0 && <span className="flex items-center gap-1 text-[var(--error)]"><AlertTriangle size={13} /> {recon.mismatchCount} line{recon.mismatchCount === 1 ? '' : 's'} differ.</span>}
                  {recon.missingManual > 0 && <span className="text-[var(--muted)] block mt-0.5">{recon.missingManual} employee{recon.missingManual === 1 ? '' : 's'} have a system figure but no manual entry yet.</span>}
                </>
              )}
            </InfoBlock>
          )}

          <div className="border border-[var(--border)] overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--primary)] text-white text-xs">
                  <th className="px-3 py-2.5 text-left font-medium">Employee</th>
                  <th className="px-3 py-2.5 text-right font-medium">System Gross</th>
                  <th className="px-3 py-2.5 text-right font-medium">Manual Gross</th>
                  <th className="px-3 py-2.5 text-right font-medium">Δ (manual − system)</th>
                  <th className="px-3 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {recon.rows.map((r, i) => (
                  <tr key={r.id} className={`border-b border-[var(--divider)] ${i % 2 ? 'bg-[var(--bg-section)]' : 'bg-white'}`}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(r.system)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        inputMode="decimal"
                        value={manual[r.id] ?? ''}
                        onChange={(e) => setManual((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="—"
                        className="w-28 text-right px-2 py-1 border border-[var(--border)] bg-[var(--bg-input)] text-sm focus:outline-none focus:border-[var(--primary)]"
                      />
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${r.delta == null ? 'text-[var(--muted)]' : r.delta === 0 ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                      {r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${formatCurrency(r.delta)}`}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.manual != null && (r.match ? <Check size={13} className="text-[var(--success)] inline" /> : <AlertTriangle size={13} className="text-[var(--error)] inline" />)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--primary)] text-white text-xs font-semibold">
                  <td className="px-3 py-2.5">Totals</td>
                  <td className="px-3 py-2.5 text-right">{formatCurrency(recon.totals.system)}</td>
                  <td className="px-3 py-2.5 text-right">{hasAnyManual ? formatCurrency(recon.totals.manual) : '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    {hasAnyManual ? `${recon.totals.delta > 0 ? '+' : ''}${formatCurrency(recon.totals.delta)}` : '—'}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
