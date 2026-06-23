import { describe, it, expect } from 'vitest'
import { splitHoursLargestRemainder } from './workyard-api'

const sumCents = (arr: number[]) => arr.reduce((s, v) => s + Math.round(v * 100), 0)
const round2Cents = (n: number) => Math.round(Math.round(n * 100) / 100 * 100)

describe('splitHoursLargestRemainder', () => {
  it('Case A: equal weights 3-way, 10h — sum equals canonical total', () => {
    const result = splitHoursLargestRemainder(10, [1, 1, 1])
    expect(result).toHaveLength(3)
    // sum in cents must equal round2(10) * 100 = 1000
    expect(sumCents(result)).toBe(round2Cents(10))
    // largest-remainder assigns the extra cent to the first leg
    expect(result[0]).toBe(3.34)
    expect(result[1]).toBe(3.33)
    expect(result[2]).toBe(3.33)
  })

  it('Case B: tricky fractional total 8.01 split 3-way — sum === 8.01', () => {
    const result = splitHoursLargestRemainder(8.01, [1, 1, 1])
    expect(result).toHaveLength(3)
    expect(sumCents(result)).toBe(round2Cents(8.01))
  })

  it('Case C: uneven weights [3600,1800,600] with 7.5h — sum === 7.5', () => {
    const result = splitHoursLargestRemainder(7.5, [3600, 1800, 600])
    expect(result).toHaveLength(3)
    expect(sumCents(result)).toBe(round2Cents(7.5))
    // Proportions: 3600/6000=0.6, 1800/6000=0.3, 600/6000=0.1
    // 7.5*0.6=4.5, 7.5*0.3=2.25, 7.5*0.1=0.75 — all exact, no residue needed
    expect(result[0]).toBeCloseTo(4.5, 10)
    expect(result[1]).toBeCloseTo(2.25, 10)
    expect(result[2]).toBeCloseTo(0.75, 10)
  })

  it('Case D: zero totalHours → all zeros', () => {
    const result = splitHoursLargestRemainder(0, [1, 1])
    expect(result).toEqual([0, 0])
  })

  it('Case D: all-zero weights → splits evenly, sums to canonical total', () => {
    const result = splitHoursLargestRemainder(9, [0, 0, 0])
    expect(result).toHaveLength(3)
    expect(sumCents(result)).toBe(round2Cents(9))
  })

  it('single weight → [round2(total)]', () => {
    const result = splitHoursLargestRemainder(7.333, [42])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(Math.round(7.333 * 100) / 100)
  })

  it('empty weights → empty array', () => {
    expect(splitHoursLargestRemainder(5, [])).toEqual([])
  })

  it('real-world style: 8h across 4 unequal legs — sum exact', () => {
    // 4 allocations typical of a spread card
    const result = splitHoursLargestRemainder(8, [3600, 2700, 900, 1800])
    expect(result).toHaveLength(4)
    expect(sumCents(result)).toBe(round2Cents(8))
  })
})
