import type { MonitaskActivityRow } from '@/lib/payroll/timesources/types'
import { addLocalDays } from '@/lib/dates'

/**
 * Dummy Monitask activity for the remote-run import path.
 *
 * Enabled by setting MONITASK_MOCK=1 (or true/yes). When enabled,
 * `fetchMonitaskActivity` returns the rows generated here instead of calling the
 * real Monitask API — so the remote import flow can be exercised with no creds
 * (mirrors WORKYARD_MOCK for the field run).
 *
 * The `monitaskId`s below are placeholders; map them onto real remote employees
 * via payroll_employees.monitask_id once the roster exists. Until then the
 * activity-vs-submitted overpay check can still be demoed by name match.
 */

const MOCK_REMOTE_WORKERS: { monitaskId: string; name: string }[] = [
  { monitaskId: 'mt-1001', name: 'Priya Nair' },
  { monitaskId: 'mt-1002', name: 'Diego Ramos' },
  { monitaskId: 'mt-1003', name: 'Aisha Khan' },
]

export function isMonitaskMockEnabled(): boolean {
  const v = process.env.MONITASK_MOCK?.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Add `days` to a YYYY-MM-DD string, returning YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  return addLocalDays(dateStr, days)
}

/**
 * Generate a realistic week of dummy Monitask activity for `weekStart`
 * (a Sunday YYYY-MM-DD): Mon–Fri active hours per worker, with productivity %
 * and a couple of low-activity days so the overpay check has something to flag.
 */
export function generateMockActivity(
  weekStart: string,
): { rows: MonitaskActivityRow[]; stats: { workers: number; days: number } } {
  const rows: MonitaskActivityRow[] = []
  const workdays = [1, 2, 3, 4, 5].map((o) => addDays(weekStart, o))

  MOCK_REMOTE_WORKERS.forEach((w, wi) => {
    workdays.forEach((date, di) => {
      // A couple of intentionally low-activity days (worker may still submit 8h).
      const lowDay = (wi + di) % 7 === 0
      const activeHours = lowDay ? 4.2 : 7.5 + (di % 2 === 0 ? 0.3 : -0.4)
      const productivityPct = lowDay ? 0.51 : 0.82 + (wi % 3) * 0.03
      rows.push({
        monitaskUserId: w.monitaskId,
        employeeName: w.name,
        entryDate: date,
        activeHours: Math.round(activeHours * 100) / 100,
        productivityPct: Math.round(productivityPct * 100) / 100,
        raw: { mock: true },
      })
    })
  })

  return { rows, stats: { workers: MOCK_REMOTE_WORKERS.length, days: workdays.length } }
}
