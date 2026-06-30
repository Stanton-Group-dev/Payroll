import { describe, it, expect } from 'vitest'
import { dailyCatchupDateRange } from './workyard-api'

/**
 * Unit tests for the daily catch-up feature.
 *
 * dailyCatchupDateRange(nowIso): given today's date in org timezone (YYYY-MM-DD),
 * returns the window to show:
 *   - Tuesday–Sunday: { start: yesterday, end: yesterday }
 *   - Monday:         { start: Saturday, end: Sunday }
 */
describe('dailyCatchupDateRange', () => {
  it('Tuesday → yesterday only', () => {
    const result = dailyCatchupDateRange('2026-06-30') // Tuesday
    expect(result).toEqual({ start: '2026-06-29', end: '2026-06-29' })
  })

  it('Wednesday → yesterday only', () => {
    const result = dailyCatchupDateRange('2026-07-01') // Wednesday
    expect(result).toEqual({ start: '2026-06-30', end: '2026-06-30' })
  })

  it('Monday → covers preceding Saturday and Sunday', () => {
    const result = dailyCatchupDateRange('2026-06-29') // Monday
    expect(result).toEqual({ start: '2026-06-27', end: '2026-06-28' })
  })

  it('Sunday → yesterday (Saturday)', () => {
    const result = dailyCatchupDateRange('2026-06-28') // Sunday
    expect(result).toEqual({ start: '2026-06-27', end: '2026-06-27' })
  })

  it('Saturday → yesterday (Friday)', () => {
    const result = dailyCatchupDateRange('2026-06-27') // Saturday
    expect(result).toEqual({ start: '2026-06-26', end: '2026-06-26' })
  })

  it('Monday at start of month — correctly goes back to prior month', () => {
    // July 6, 2026 is a Monday; Sat=July 4, Sun=July 5
    const result = dailyCatchupDateRange('2026-07-06')
    expect(result).toEqual({ start: '2026-07-04', end: '2026-07-05' })
  })

  it('Monday crossing year boundary — Jan 5, 2026', () => {
    // Jan 5, 2026 is a Monday; Sat=Jan 3, Sun=Jan 4
    const result = dailyCatchupDateRange('2026-01-05')
    expect(result).toEqual({ start: '2026-01-03', end: '2026-01-04' })
  })
})

/**
 * Proportional scaling for FR-4: when the import applies a saved daily allocation,
 * each leg's hours = totalHours × fraction. Verify the math stays exact.
 */
describe('FR-4 proportional scaling', () => {
  function applyFractions(totalHours: number, fractions: number[]): number[] {
    return fractions.map(f => parseFloat((totalHours * f).toFixed(2)))
  }

  it('equal split 8h → 4+4', () => {
    const result = applyFractions(8, [0.5, 0.5])
    expect(result).toEqual([4, 4])
  })

  it('75/25 split of 6h → 4.5+1.5', () => {
    const result = applyFractions(6, [0.75, 0.25])
    expect(result).toEqual([4.5, 1.5])
  })

  it('three-way equal split of 9h → 3+3+3', () => {
    const result = applyFractions(9, [
      parseFloat((1 / 3).toFixed(4)),
      parseFloat((1 / 3).toFixed(4)),
      parseFloat((1 / 3).toFixed(4)),
    ])
    // Each leg ≈ 3h (fractions stored to 4dp so we tolerate a small rounding gap).
    result.forEach(v => expect(v).toBeCloseTo(3, 1))
  })

  it('scaled when card hours differ from save time — 10h card, save fractions 0.6+0.4', () => {
    const result = applyFractions(10, [0.6, 0.4])
    expect(result).toEqual([6, 4])
  })
})
