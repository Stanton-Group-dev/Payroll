const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Parse any date-ish value into a local-midnight Date.
 *
 * YYYY-MM-DD strings are constructed as local midnight (no UTC conversion) to
 * avoid the off-by-one that `new Date('YYYY-MM-DD')` causes in negative-offset
 * timezones (e.g. Eastern) where UTC midnight is the previous calendar day.
 *
 * Returns null for null / undefined / '' / NaN inputs.
 */
export function parseLocalDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value)
    const d = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}

/**
 * Format a date value for display. Falls back to `fallback` (default '—') when
 * the value is null/undefined/invalid.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTS,
  locale = 'en-US',
  fallback = '—',
): string {
  const d = parseLocalDate(value)
  return d ? d.toLocaleDateString(locale, opts) : fallback
}

/**
 * Add `days` to a YYYY-MM-DD string in local time, returning a YYYY-MM-DD string.
 * Equivalent to the old UTC-based addDays helpers but uses local-midnight to stay
 * consistent with parseLocalDate throughout the codebase.
 */
export function addLocalDays(dateStr: string, days: number): string {
  const d = parseLocalDate(dateStr)
  if (!d) throw new RangeError(`addLocalDays: invalid date string "${dateStr}"`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}
