/**
 * Cost-code → activity breakdown for invoice line items.
 *
 * Workyard tags each timecard with a Project (the bill-to property, S-code) and a
 * Cost Code (the activity). We split a property's billed labor across those
 * activities proportionally by logged hours, so an invoice line for a property can
 * show *what the labor was for* (Maintenance, Showings, Material Pickup, …) without
 * changing the property's total. The split is hours-weighted and derived live from
 * Workyard — it is a presentation breakdown of an already-computed labor dollar, not
 * a re-computation of cost. See [[workyard-cost-code-model]].
 */

import type { WorkyardRow } from '@/lib/payroll/csv-parser'

/** Map a (Spanish / old / pickup) cost-code name to a clean English activity for the customer. */
export function activityOf(name: string): string {
  const n = (name ?? '').toLowerCase().trim()
  if (!n) return 'Unallocated'
  if (n.includes('material pickup')) return 'Material Pickup'
  if (n.includes('desborde') || n.includes('dumpster overflow')) return 'Dumpster Overflow'
  if (n.includes('voluminoso') || n.includes('bulky') || n.includes('bulkywaste')) return 'Bulky Waste'
  if (n.includes('mantenimiento') || n.includes('maintenance') || n.includes('work order')) return 'Maintenance'
  if (n.includes('obra') || n.includes('construction')) return 'Construction & Repairs'
  if (n.includes('vacante') || n.includes('turnover')) return 'Turnover'
  if (n.includes('jard') || n.includes('landscape') || n.includes('lawn')) return 'Landscaping'
  if (n.includes('plagas') || n.includes('pest')) return 'Pest Control'
  if (n.includes('nieve') || n.includes('snow')) return 'Snow & Ice'
  if (n.includes('aparato') || n.includes('appliance')) return 'Appliance Repair'
  if (n.includes('muestra') || n.includes('showing')) return 'Showings'
  if (n.includes('veh')) return 'Vehicles & Equipment'
  if (n.includes('oficina') || n.includes('office')) return 'Office'
  return name
}

/** One activity sub-line under a property: the activity, its hours, and its share of the labor. */
export interface ActivityLine {
  act: string
  hours: number
  labor: number
}

/**
 * Aggregate Workyard hours per property CODE per activity.
 * `projectName` carries the S-code (bill-to property); `costCode` carries the activity.
 */
export function buildActivityHoursByCode(rows: WorkyardRow[]): Record<string, Record<string, number>> {
  const hoursByCode: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const code = r.projectName
    if (!code) continue
    const act = activityOf(r.costCode)
    ;(hoursByCode[code] ??= {})[act] = (hoursByCode[code][act] ?? 0) + (r.regularHours ?? 0) + (r.otHours ?? 0)
  }
  return hoursByCode
}

/**
 * Split a property's labor dollars across its activities, weighted by logged hours.
 * Falls back to a single "Labor (no cost-code data)" line when Workyard has no hours
 * for that property code (so the line never silently disappears). Sorted high→low.
 */
export function splitLaborByActivity(
  propertyCode: string | null | undefined,
  laborCost: number,
  hoursByCode: Record<string, Record<string, number>>,
): ActivityLine[] {
  const acts = (propertyCode ? hoursByCode[propertyCode] : undefined) ?? {}
  const totalH = Object.values(acts).reduce((s, h) => s + h, 0)
  if (totalH <= 0) {
    return [{ act: 'Labor (no cost-code data)', hours: 0, labor: laborCost }]
  }
  return Object.entries(acts)
    .sort((a, b) => b[1] - a[1])
    .map(([act, hours]) => ({ act, hours, labor: laborCost * (hours / totalH) }))
}
