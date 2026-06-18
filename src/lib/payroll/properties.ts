// Shared property classification helpers.
//
// Properties have no dedicated "deleted" or "westend" column — both are conventions
// layered on top of the AppFolio import:
//   • "delete-marked"  → code/name carries a `delete…` (or junk `zz …`) prefix. These
//     are decommissioned units that should never appear in pickers or dropdowns.
//   • "Westend"        → billing_llc = 'SREP Westend LLC'. These are billed to a
//     separate entity and are opt-in for labor spread (excluded by default).

import type { Property } from '@/lib/supabase/types'

export const WESTEND_BILLING_LLC = 'SREP Westend LLC'

// --------------------------------------------------------------------------------------------
// Curated overlay seam.
//
// `payroll_property` is the payroll app's curated, AppFolio-proof property record (1:1 with
// `properties`, keyed by property_id). Every payroll read of a property should go through the
// curated overlay so manual corrections survive AppFolio re-imports. `curatedToProperty` maps
// a curated row into the legacy `Property` shape the app already consumes, so downstream logic
// (filters, calculatePayroll, invoice generation) needs no changes — it just receives curated
// values. `owner_llc` maps to `billing_llc`; `id` stays the shared properties.id so existing
// FK joins to cost/time rows line up.
// --------------------------------------------------------------------------------------------

/** Columns to select from payroll_property so a row maps straight via curatedToProperty(). */
export const CURATED_PROPERTY_COLUMNS =
  'property_id, appfolio_property_id, code, name, address, total_units, portfolio_id, owner_llc, include_in_invoicing, is_active'

/** Raw row shape returned by selecting CURATED_PROPERTY_COLUMNS from payroll_property. */
export interface CuratedPropertyRow {
  property_id: string
  appfolio_property_id: string | null
  code: string | null
  name: string | null
  address: string | null
  total_units: number | null
  portfolio_id: string | null
  owner_llc: string | null
  include_in_invoicing: boolean
  is_active: boolean
}

/** Map a curated payroll_property row into the `Property` shape the payroll app consumes. */
export function curatedToProperty(r: CuratedPropertyRow): Property {
  return {
    id: r.property_id,
    appfolio_property_id: r.appfolio_property_id ?? '',
    code: r.code ?? '',
    name: r.name ?? '',
    address: r.address,
    total_units: r.total_units,
    portfolio_id: r.portfolio_id,
    billing_llc: r.owner_llc,
    is_active: r.is_active,
    include_in_invoicing: r.include_in_invoicing,
  }
}

export interface PropertyMarkers {
  code?: string | null
  name?: string | null
  billing_llc?: string | null
}

/** True when a property is tagged for deletion via the `delete…`/`zz …` naming convention. */
export function isDeleteMarked(p: PropertyMarkers): boolean {
  const code = (p.code ?? '').trim().toLowerCase()
  const name = (p.name ?? '').trim().toLowerCase()
  return (
    code.startsWith('delete') ||
    name.startsWith('delete') ||
    code === 'zz' ||
    name.startsWith('zz -') ||
    name.startsWith('zz-')
  )
}

/**
 * True for any property that must NEVER appear on a customer invoice — the
 * delete-marked rows (above) plus the test/placeholder scaffolding that the
 * AppFolio import keeps re-creating ("000 - Test Property", "… Test …").
 *
 * The flag `include_in_invoicing` is NOT enough on its own: the AppFolio re-sync
 * resets it to true, which is exactly why these rows kept reappearing on bills
 * even after being hidden from the pickers. Name/code is the durable signal, so
 * the invoicing and review paths gate on this regardless of the flag.
 */
export function isNonBillableProperty(p: PropertyMarkers): boolean {
  if (isDeleteMarked(p)) return true
  const code = (p.code ?? '').trim().toLowerCase()
  const name = (p.name ?? '').trim().toLowerCase()
  return code === '000' || name.includes('test property')
}

/** True when a property belongs to a Westend billing entity (opt-in for spread).
 *  Matches the whole family — the legacy consolidated "SREP Westend LLC" and the granular
 *  split "SREP Westend 81 / 77 / Oxford LLC" — so the curated owner-LLC split doesn't change
 *  Westend's spread behavior. */
export function isWestendProperty(p: PropertyMarkers): boolean {
  return (p.billing_llc ?? '').trim().toLowerCase().startsWith('srep westend')
}
