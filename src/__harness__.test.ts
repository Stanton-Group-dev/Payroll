import { describe, it, expect } from 'vitest'

// Smoke test proving the Vitest harness runs in CI. Real coverage (the
// golden-week payroll fixture) is added with PRP-02. Keep this trivial.
describe('test harness', () => {
  it('executes and asserts', () => {
    expect(1 + 1).toBe(2)
  })
})
