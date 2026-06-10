/**
 * Date resolution for natural-language time references like
 * "wednesday of last week", "last friday", "yesterday", "3/11", "2026-03-11".
 *
 * Payroll weeks run Sunday→Saturday (week_start is a Sunday), so all week math
 * uses weekStartsOn: 0. Resolution is deterministic; the agent only supplies the
 * phrase, never the computed date.
 */
import {
  addDays,
  format,
  isValid,
  parse,
  parseISO,
  startOfWeek,
  subDays,
  subWeeks,
} from 'date-fns'
import type { OperationContext } from '@/lib/payroll/operations/core'

export interface ParsedDate {
  /** yyyy-MM-dd */
  iso: string
  /** Human-readable echo, e.g. "Wednesday, Mar 11, 2026". */
  description: string
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

const ISO_FMT = 'yyyy-MM-dd'

function out(d: Date): ParsedDate {
  return { iso: format(d, ISO_FMT), description: format(d, 'EEEE, MMM d, yyyy') }
}

function findWeekday(text: string): { name: string; index: number } | null {
  for (const [name, index] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return { name, index }
  }
  return null
}

/** Most recent past date (strictly before `today`) landing on `weekdayIndex`. */
function mostRecentWeekday(today: Date, weekdayIndex: number): Date {
  let d = subDays(today, 1)
  for (let i = 0; i < 7; i++) {
    if (d.getDay() === weekdayIndex) return d
    d = subDays(d, 1)
  }
  return d
}

/** Next future date (strictly after `today`) landing on `weekdayIndex`. */
function nextWeekday(today: Date, weekdayIndex: number): Date {
  let d = addDays(today, 1)
  for (let i = 0; i < 7; i++) {
    if (d.getDay() === weekdayIndex) return d
    d = addDays(d, 1)
  }
  return d
}

/**
 * The date landing on `weekdayIndex` within the 7-day window starting at
 * `weekStart` (inclusive). Robust to the week's alignment — payroll weeks may
 * start on a Sunday or a Monday depending on pay_group — because it scans the
 * actual span rather than assuming a fixed first day.
 */
function weekdayWithinWeek(weekStart: Date, weekdayIndex: number): Date {
  let d = weekStart
  for (let i = 0; i < 7; i++) {
    if (d.getDay() === weekdayIndex) return d
    d = addDays(d, 1)
  }
  return weekStart
}

/**
 * Parse a natural-language or explicit date phrase relative to `today`.
 * Returns null when nothing recognizable is found (caller should disambiguate).
 *
 * When `weekAnchor` is supplied (the Sunday week_start of the week the user is
 * viewing), week-relative phrases anchor to that week instead of today's week:
 * a bare "monday" means the Monday of the viewed week, "this week" is the viewed
 * week, and "last/next week" step off it. Phrases that are inherently relative to
 * now ("today", "yesterday", "last friday", "next tuesday") always use `today`.
 */
export function parseRelativeDate(
  phrase: string,
  today: Date = new Date(),
  weekAnchor?: Date | null
): ParsedDate | null {
  const text = phrase.toLowerCase().trim()
  if (!text) return null

  // Anchors.
  if (/\btoday\b/.test(text)) return out(today)
  if (/\byesterday\b/.test(text)) return out(subDays(today, 1))
  if (/\btomorrow\b/.test(text)) return out(addDays(today, 1))

  // Explicit ISO date anywhere in the string.
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (isoMatch) {
    const d = parseISO(isoMatch[1])
    if (isValid(d)) return out(d)
  }

  // Numeric m/d or m/d/yyyy.
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (slash) {
    const year = slash[3]
      ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])
      : today.getFullYear()
    const d = parse(`${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`, ISO_FMT, today)
    if (isValid(d)) return out(d)
  }

  // Month-name forms: "march 11", "mar 11 2026".
  for (const fmt of ['MMMM d yyyy', 'MMM d yyyy', 'MMMM d', 'MMM d']) {
    const cleaned = text.replace(/(\d+)(st|nd|rd|th)/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
    const d = parse(cleaned, fmt, today)
    if (isValid(d)) {
      // parse() without a year defaults to today's year — acceptable for payroll context.
      return out(d)
    }
  }

  // Weekday-relative phrases.
  const weekday = findWeekday(text)
  if (weekday) {
    const lastWeek = /\b(last\s+week|of\s+last\s+week|previous\s+week)\b/.test(text)
    const thisWeek = /\bthis\s+week\b/.test(text)
    const lastMod = /\blast\b/.test(text) && !lastWeek
    const nextMod = /\bnext\b/.test(text)

    // "last monday"/"next tuesday" are relative to now, so always anchor on today.
    if (nextMod) return out(nextWeekday(today, weekday.index))
    if (lastMod) return out(mostRecentWeekday(today, weekday.index))

    // When viewing a specific week, anchor week-relative phrases to that week's
    // actual span (which may start Sunday or Monday). Scan the window so the
    // mapping is correct regardless of alignment.
    if (weekAnchor) {
      if (lastWeek) return out(weekdayWithinWeek(subWeeks(weekAnchor, 1), weekday.index))
      return out(weekdayWithinWeek(weekAnchor, weekday.index)) // bare or "this week"
    }

    // No viewed week → fall back to the calendar week containing today.
    const weekStart = startOfWeek(today, { weekStartsOn: 0 })
    if (lastWeek) return out(addDays(subWeeks(weekStart, 1), weekday.index))
    if (thisWeek) return out(addDays(weekStart, weekday.index))
    return out(addDays(weekStart, weekday.index))
  }

  return null
}

export interface ResolvedWeek {
  id: string
  week_start: string
  week_end: string
  status: string
}

/** Find the payroll week whose [week_start, week_end] span contains `iso`. */
export async function resolveWeekForDate(
  ctx: OperationContext,
  iso: string
): Promise<ResolvedWeek | null> {
  const { data, error } = await ctx.supabase
    .from('payroll_weeks')
    .select('id, week_start, week_end, status')
    .lte('week_start', iso)
    .gte('week_end', iso)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to resolve week for ${iso}: ${error.message}`)
  return (data as ResolvedWeek | null) ?? null
}

/** Weeks that may be freely edited. Approved/invoiced/sent weeks are locked. */
export const EDITABLE_WEEK_STATUSES = ['draft', 'corrections_complete'] as const

export function isWeekEditable(status: string): boolean {
  return (EDITABLE_WEEK_STATUSES as readonly string[]).includes(status)
}
