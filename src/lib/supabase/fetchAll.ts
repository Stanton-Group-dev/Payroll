// PostgREST silently caps every select at 1,000 rows — a payroll week routinely
// exceeds that in payroll_time_entries (spread legs), so a bare select truncates
// the week without erroring.
const PAGE_SIZE = 1000

/**
 * Drains a Supabase select past the 1,000-row page cap.
 *
 * Pass a factory that rebuilds the same query for a given `.range(from, to)`
 * window. The query must carry a deterministic `.order()` with a unique
 * tiebreaker (e.g. `id`) — otherwise pages can skip or duplicate rows.
 */
export async function fetchAllRows<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) return { data: rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null }
  }
}
