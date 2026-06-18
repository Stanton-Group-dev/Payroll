import * as XLSX from 'xlsx'
import type { BillingLedger } from '@/lib/payroll/billing'

/**
 * Export the by-LLC billing ledger to an .xlsx workbook with two sheets:
 *   - "Summary by LLC": one row per billing LLC + a grand-total row.
 *   - "Invoice Detail": one row per per-week invoice.
 * Runs client-side; XLSX.writeFile triggers the browser download.
 */
export function exportBillingXlsx(ledger: BillingLedger, rangeLabel?: string): void {
  const wb = XLSX.utils.book_new()

  // --- Sheet 1: Summary by LLC ---
  const summaryRows: (string | number)[][] = [
    ['Billing LLC', 'Invoices', 'Weeks', 'Labor', 'Spread', 'Mgmt Fee', 'Total'],
    ...ledger.groups.map(g => [
      g.owner_llc, g.invoice_count, g.week_count, g.labor, g.spread, g.mgmt_fee, g.total,
    ]),
    [],
    ['GRAND TOTAL', ledger.invoice_count, ledger.billed_week_count,
      ledger.labor_total, ledger.spread_total, ledger.mgmt_fee_total, ledger.grand_total],
  ]
  const summary = XLSX.utils.aoa_to_sheet(summaryRows)
  summary['!cols'] = [{ wch: 32 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, summary, 'Summary by LLC')

  // --- Sheet 2: Invoice Detail ---
  const detailRows: (string | number)[][] = [
    ['Billing LLC', 'Week Start', 'Week End', 'Status', 'Properties', 'Labor', 'Spread', 'Mgmt Fee', 'Total'],
  ]
  for (const g of ledger.groups) {
    for (const inv of g.invoices) {
      detailRows.push([
        g.owner_llc, inv.week_start, inv.week_end, inv.status,
        inv.property_count, inv.labor, inv.spread, inv.mgmt_fee, inv.total,
      ])
    }
  }
  const detail = XLSX.utils.aoa_to_sheet(detailRows)
  detail['!cols'] = [{ wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, detail, 'Invoice Detail')

  const suffix = rangeLabel ? `_${rangeLabel}` : ''
  XLSX.writeFile(wb, `stanton_invoices_by_llc${suffix}.xlsx`)
}
