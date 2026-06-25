// Canonical display order for billing LLCs on the statement and invoices.
//
// The weekly statement, the per-LLC invoice pages, the invoice preview, and the invoice
// generator all sort by this fixed order (NOT by amount), so the customer-facing documents
// always read the same way. Matching is case/whitespace-insensitive, so the casing drift in
// the source data (e.g. "SREP Park 1 LLC" vs "SREP PARK 6 LLC") doesn't matter. Any LLC not in
// this list (e.g. a new owner, or an "Unassigned — …" bucket) sorts to the end, alphabetically.

export const LLC_STATEMENT_ORDER: readonly string[] = [
  'STANTON REP 90 PARK STREET HARTFORD LLC',
  'SREP SOUTHEND LLC',
  'SREP Hartford 1 LLC',
  'SREP NORTHEND LLC',
  'SREP Park 1 LLC',
  'SREP Park 2 LLC',
  'SREP Park 3 LLC',
  'SREP Park 4 LLC',
  'SREP Park 5 LLC',
  'SREP PARK 6 LLC',
  'SREP PARK 7 LLC',
  'SREP PARK 8 LLC',
  'SREP PARK 9 LLC',
  'SREP PARK 10 LLC',
  'SREP PARK 11 LLC',
  'SREP PARK 12 LLC',
  'SREP Westend LLC',
]

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const RANK = new Map(LLC_STATEMENT_ORDER.map((name, i) => [norm(name), i]))

/** Position of an LLC in the canonical order; unknown LLCs rank last. */
export function llcOrderRank(name: string | null | undefined): number {
  const r = RANK.get(norm(name))
  return r === undefined ? Number.MAX_SAFE_INTEGER : r
}

/** Comparator for sorting by the canonical statement order, then alphabetically for ties
 *  (i.e. any LLCs not on the list). */
export function compareLlcOrder(a: string | null | undefined, b: string | null | undefined): number {
  const ra = llcOrderRank(a)
  const rb = llcOrderRank(b)
  if (ra !== rb) return ra - rb
  return (a ?? '').localeCompare(b ?? '')
}
