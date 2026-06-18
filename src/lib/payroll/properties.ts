// Shared property classification helpers.
//
// Properties have no dedicated "deleted" or "westend" column — both are conventions
// layered on top of the AppFolio import:
//   • "delete-marked"  → code/name carries a `delete…` (or junk `zz …`) prefix. These
//     are decommissioned units that should never appear in pickers or dropdowns.
//   • "Westend"        → billing_llc = 'SREP Westend LLC'. These are billed to a
//     separate entity and are opt-in for labor spread (excluded by default).

export const WESTEND_BILLING_LLC = 'SREP Westend LLC'

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

/** True when a property belongs to the Westend billing entity (opt-in for spread). */
export function isWestendProperty(p: PropertyMarkers): boolean {
  return (p.billing_llc ?? '').trim().toLowerCase() === WESTEND_BILLING_LLC.toLowerCase()
}
