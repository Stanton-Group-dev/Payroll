import { describe, it, expect } from 'vitest'
import { parseLocalDate, addLocalDays } from './dates'

describe('parseLocalDate', () => {
  it('returns null for null / undefined / empty string', () => {
    expect(parseLocalDate(null)).toBeNull()
    expect(parseLocalDate(undefined)).toBeNull()
    expect(parseLocalDate('')).toBeNull()
  })

  it('parses YYYY-MM-DD as LOCAL midnight — not UTC', () => {
    // 2026-01-15 local midnight: month is 0-indexed January, day 15.
    const d = parseLocalDate('2026-01-15')!
    expect(d).not.toBeNull()
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)   // January
    expect(d.getDate()).toBe(15)
  })

  it('consecutive dates parse to consecutive local days (no UTC off-by-one)', () => {
    const d1 = parseLocalDate('2026-03-01')!
    const d2 = parseLocalDate('2026-03-02')!
    const msPerDay = 24 * 60 * 60 * 1000
    // The gap between local midnights is exactly one day.
    expect(d2.getTime() - d1.getTime()).toBe(msPerDay)
  })

  it('passes through a Date object unchanged', () => {
    const now = new Date()
    expect(parseLocalDate(now)).toBe(now)
  })

  it('returns null for an invalid date string', () => {
    expect(parseLocalDate('not-a-date')).toBeNull()
  })

  it('compares effective_dates correctly (filter + sort pattern)', () => {
    // Simulates the getMgmtFeeRate ceiling comparison.
    const dates = ['2026-06-01', '2026-05-01', '2026-07-01']
    const ceiling = parseLocalDate('2026-06-15')!
    const filtered = dates.filter(d => parseLocalDate(d)! <= ceiling)
    filtered.sort(
      (a, b) => parseLocalDate(b)!.getTime() - parseLocalDate(a)!.getTime(),
    )
    expect(filtered).toEqual(['2026-06-01', '2026-05-01'])
  })
})

describe('addLocalDays', () => {
  it('adds days correctly across a month boundary', () => {
    expect(addLocalDays('2026-01-30', 3)).toBe('2026-02-02')
  })

  it('adds 0 days returns the same date', () => {
    expect(addLocalDays('2026-06-08', 0)).toBe('2026-06-08')
  })

  it('generates Mon–Fri from a Sunday week_start (the workyard-mock pattern)', () => {
    const weekStart = '2026-06-08' // Sunday
    const workdays = [1, 2, 3, 4, 5].map(o => addLocalDays(weekStart, o))
    expect(workdays).toEqual([
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
    ])
  })
})
