'use client'

import { useCallback, useState } from 'react'
import type { PayrollComparison } from '@/lib/payroll/calculations'

export type PayrollComparisonReport = PayrollComparison & { hasPrior: boolean }

/**
 * Lazily fetches a week-over-week payroll comparison from /api/payroll/compare.
 * The figures are produced server-side by the canonical payroll engine, so they
 * match an actual run. Call load() to fetch (e.g. when a panel is expanded).
 */
export function usePayrollComparison(weekId: string | null) {
  const [report, setReport] = useState<PayrollComparisonReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!weekId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/payroll/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Comparison failed')
      setReport(data.report as PayrollComparisonReport)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed')
    } finally {
      setLoading(false)
    }
  }, [weekId])

  return { report, loading, error, load }
}
