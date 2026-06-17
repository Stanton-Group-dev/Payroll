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

/** True when a property belongs to the Westend billing entity (opt-in for spread). */
export function isWestendProperty(p: PropertyMarkers): boolean {
  return (p.billing_llc ?? '').trim().toLowerCase() === WESTEND_BILLING_LLC.toLowerCase()
}
