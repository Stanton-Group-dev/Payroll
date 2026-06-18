import type { InvoiceStatus, WeekStatus } from '@/lib/supabase/types'

/**
 * Cross-week billing ledger — the "all invoices, by LLC" rollup.
 *
 * Invoices are created per week (one row per billing LLC) by the Invoice
 * Generator. This module aggregates every invoice across every week into a
 * by-LLC ledger: the consolidated output a manager actually bills from.
 *
 * Pure + side-effect free so the on-screen view, the Excel export, and the
 * per-LLC PDF all derive from the exact same numbers.
 */

/** A single per-week invoice, flattened for the ledger. */
export interface BillingInvoice {
  invoice_id: string
  week_id: string
  week_start: string
  week_end: string
  status: InvoiceStatus
  labor: number
  spread: number
  mgmt_fee: number
  total: number
  property_count: number
}

/** All invoices for one billing LLC, summed across weeks. */
export interface BillingLLCGroup {
  owner_llc: string
  invoice_count: number
  week_count: number
  labor: number
  spread: number
  mgmt_fee: number
  total: number
  /** count of invoices in each status, e.g. { draft: 2, approved: 1 } */
  status_counts: Partial<Record<InvoiceStatus, number>>
  invoices: BillingInvoice[]
}

/** One payroll week with its billing progress — drives the "create invoices" hub. */
export interface BillingWeekRow {
  week_id: string
  week_start: string
  week_end: string
  status: WeekStatus
  invoice_count: number
  invoice_total: number
}

export interface BillingLedger {
  groups: BillingLLCGroup[]
  weeks: BillingWeekRow[]
  grand_total: number
  labor_total: number
  spread_total: number
  mgmt_fee_total: number
  invoice_count: number
  llc_count: number
  /** distinct weeks that have at least one invoice */
  billed_week_count: number
}

export interface BillingFilters {
  /** inclusive lower bound on week_start (YYYY-MM-DD) */
  from?: string
  /** inclusive upper bound on week_start (YYYY-MM-DD) */
  to?: string
  status?: InvoiceStatus | 'all'
  /** case-insensitive substring match on owner_llc */
  llc?: string
}

/* ---- raw shapes as returned by Supabase selects ---- */

export interface RawBillingLineItem {
  labor_amount: number | string | null
  spread_amount: number | string | null
  mgmt_fee_amount: number | string | null
  total_amount: number | string | null
}

export interface RawBillingInvoice {
  id: string
  payroll_week_id: string
  owner_llc: string | null
  status: InvoiceStatus
  total_amount: number | string | null
  week: { week_start: string; week_end: string } | null
  line_items: RawBillingLineItem[] | null
}

export interface RawBillingWeek {
  id: string
  week_start: string
  week_end: string
  status: WeekStatus
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0
  return Number.isFinite(n as number) ? (n as number) : 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Unlabelled / null LLC — surfaced explicitly so it can't silently vanish from a total. */
export const UNASSIGNED_LLC = 'Unassigned (no billing LLC)'

function matchesFilters(inv: RawBillingInvoice, f: BillingFilters): boolean {
  const weekStart = inv.week?.week_start ?? ''
  if (f.from && weekStart && weekStart < f.from) return false
  if (f.to && weekStart && weekStart > f.to) return false
  if (f.status && f.status !== 'all' && inv.status !== f.status) return false
  if (f.llc && !(inv.owner_llc ?? '').toLowerCase().includes(f.llc.toLowerCase())) return false
  return true
}

/**
 * Fold raw invoices (+ their weeks) into the by-LLC ledger. `weeks` is the full
 * list of payroll weeks, used for the create-invoices hub and to bound the
 * "billed week" count; it is NOT filtered by `status`/`llc` (those apply to
 * invoices), only by the from/to date window.
 */
export function buildBillingLedger(
  invoices: RawBillingInvoice[],
  weeks: RawBillingWeek[],
  filters: BillingFilters = {},
): BillingLedger {
  const groups = new Map<string, BillingLLCGroup>()

  for (const inv of invoices) {
    if (!matchesFilters(inv, filters)) continue
    const key = inv.owner_llc?.trim() || UNASSIGNED_LLC
    const items = inv.line_items ?? []
    const labor = round2(items.reduce((s, li) => s + num(li.labor_amount), 0))
    const spread = round2(items.reduce((s, li) => s + num(li.spread_amount), 0))
    const mgmt_fee = round2(items.reduce((s, li) => s + num(li.mgmt_fee_amount), 0))
    const total = num(inv.total_amount)

    let g = groups.get(key)
    if (!g) {
      g = {
        owner_llc: key,
        invoice_count: 0, week_count: 0,
        labor: 0, spread: 0, mgmt_fee: 0, total: 0,
        status_counts: {}, invoices: [],
      }
      groups.set(key, g)
    }
    g.invoice_count += 1
    g.labor = round2(g.labor + labor)
    g.spread = round2(g.spread + spread)
    g.mgmt_fee = round2(g.mgmt_fee + mgmt_fee)
    g.total = round2(g.total + total)
    g.status_counts[inv.status] = (g.status_counts[inv.status] ?? 0) + 1
    g.invoices.push({
      invoice_id: inv.id,
      week_id: inv.payroll_week_id,
      week_start: inv.week?.week_start ?? '',
      week_end: inv.week?.week_end ?? '',
      status: inv.status,
      labor, spread, mgmt_fee, total,
      property_count: items.length,
    })
  }

  // Finalize per-group derived fields, sort weeks newest-first within a group.
  const groupList = [...groups.values()].map(g => {
    g.invoices.sort((a, b) => b.week_start.localeCompare(a.week_start))
    g.week_count = new Set(g.invoices.map(i => i.week_id)).size
    return g
  }).sort((a, b) => b.total - a.total)

  const inDateWindow = (w: RawBillingWeek) =>
    (!filters.from || w.week_start >= filters.from) &&
    (!filters.to || w.week_start <= filters.to)

  const invoicesByWeek = new Map<string, BillingInvoice[]>()
  for (const g of groupList) {
    for (const inv of g.invoices) {
      const arr = invoicesByWeek.get(inv.week_id) ?? []
      arr.push(inv)
      invoicesByWeek.set(inv.week_id, arr)
    }
  }

  const weekRows: BillingWeekRow[] = weeks
    .filter(inDateWindow)
    .map(w => {
      const invs = invoicesByWeek.get(w.id) ?? []
      return {
        week_id: w.id,
        week_start: w.week_start,
        week_end: w.week_end,
        status: w.status,
        invoice_count: invs.length,
        invoice_total: round2(invs.reduce((s, i) => s + i.total, 0)),
      }
    })
    .sort((a, b) => b.week_start.localeCompare(a.week_start))

  return {
    groups: groupList,
    weeks: weekRows,
    grand_total: round2(groupList.reduce((s, g) => s + g.total, 0)),
    labor_total: round2(groupList.reduce((s, g) => s + g.labor, 0)),
    spread_total: round2(groupList.reduce((s, g) => s + g.spread, 0)),
    mgmt_fee_total: round2(groupList.reduce((s, g) => s + g.mgmt_fee, 0)),
    invoice_count: groupList.reduce((s, g) => s + g.invoice_count, 0),
    llc_count: groupList.length,
    billed_week_count: new Set(groupList.flatMap(g => g.invoices.map(i => i.week_id))).size,
  }
}
