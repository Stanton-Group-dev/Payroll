import type { WorkyardRow } from '@/lib/payroll/csv-parser'

/**
 * Dummy Workyard data for the API-pull import path.
 *
 * Enabled by setting WORKYARD_MOCK=1 (or true/yes). When enabled,
 * `fetchWorkyardTimecards` returns the rows generated here instead of calling the
 * real Workyard API — so the API-first import flow can be tested with no creds.
 *
 * The roster `workyardId`s and the property S-codes below intentionally match the
 * seeded `payroll_employees.workyard_id` and `properties.code` values so the import
 * preview auto-matches employees and properties.
 */

/** Workyard team-member IDs that match seeded payroll_employees.workyard_id. */
const MOCK_WORKERS: { workyardId: string; name: string }[] = [
  { workyardId: '122736', name: 'Angel Salazar' },
  { workyardId: '127502', name: 'Darwin Montesdeoca' },
  { workyardId: '205764', name: 'Javier Rivera' },
  { workyardId: '165157', name: 'Lui Maldonado' },
  { workyardId: '160547', name: 'Luis Perez' },
  { workyardId: '127359', name: 'Rene Arevalo' },
  { workyardId: '127507', name: 'Rolando Vasquez' },
  { workyardId: '205770', name: 'Stan Baldyga' },
  { workyardId: '165161', name: 'William Thomas' },
  { workyardId: '83306', name: 'Carlos Nieves' },
  { workyardId: '143157', name: 'Christian Arevalo' },
]

/** Property S-codes that exist in the seeded `properties` table. */
const MOCK_PROPERTY_CODES = [
  'S0001', 'S0002', 'S0003', 'S0004', 'S0005', 'S0006', 'S0007', 'S0008', 'S0009',
]

export function isWorkyardMockEnabled(): boolean {
  const v = process.env.WORKYARD_MOCK?.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** Add `days` to a YYYY-MM-DD string (UTC-safe), returning YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function mkRow(
  worker: { workyardId: string; name: string },
  projectCode: string,
  entryDate: string,
  regularHours: number,
  otHours: number,
  timecardId: string,
): WorkyardRow {
  return {
    workyardId: worker.workyardId,
    employeeName: worker.name,
    projectName: projectCode,
    customerName: '',
    entryDate,
    regularHours,
    otHours,
    ptoHours: 0,
    timecardId,
    costCode: 'LABOR',
  }
}

/**
 * Generate a realistic week of dummy approved time cards for `weekStart`
 * (a Sunday YYYY-MM-DD). Produces Mon–Fri entries for every mock worker, with a
 * few intentional variations: a split-property day, some Friday OT, and three
 * "needs attention" rows (overhead, unknown property, PTO) to exercise the
 * correction queue.
 */
export function generateMockTimecards(
  weekStart: string,
): { rows: WorkyardRow[]; stats: { total: number; allocations: number } } {
  const rows: WorkyardRow[] = []
  let cardSeq = 0
  const nextCard = () => `mock-${weekStart}-${String(++cardSeq).padStart(3, '0')}`

  // Mon–Fri are offsets 1..5 from a Sunday week_start.
  const workdays = [1, 2, 3, 4, 5].map(o => addDays(weekStart, o))

  MOCK_WORKERS.forEach((w, wi) => {
    const home = MOCK_PROPERTY_CODES[wi % MOCK_PROPERTY_CODES.length]
    const second = MOCK_PROPERTY_CODES[(wi + 3) % MOCK_PROPERTY_CODES.length]

    workdays.forEach((date, di) => {
      const timecardId = nextCard()
      // Mid-week, every third worker splits the day across two properties (4h + 4h).
      if (di === 2 && wi % 3 === 0) {
        rows.push(mkRow(w, home, date, 4, 0, timecardId))
        rows.push(mkRow(w, second, date, 4, 0, timecardId))
        return
      }
      // Friday OT for a subset of workers.
      const ot = di === 4 && wi % 4 === 1 ? 2 : 0
      rows.push(mkRow(w, home, date, 8, ot, timecardId))
    })
  })

  // ── A few rows that should land in the correction queue ──────────────────────
  // Overhead / unallocated time → flagged for redistribution on import.
  rows.push(mkRow(MOCK_WORKERS[0], 'Stanton Management LLC', workdays[0], 6, 0, nextCard()))
  // Unknown property code → flagged "property not found".
  rows.push(mkRow(MOCK_WORKERS[1], 'S9999', workdays[1], 8, 0, nextCard()))
  // A PTO day (no worked hours).
  rows.push({
    ...mkRow(MOCK_WORKERS[2], MOCK_PROPERTY_CODES[2], workdays[3], 0, 0, nextCard()),
    ptoHours: 8,
  })

  return { rows, stats: { total: cardSeq, allocations: rows.length } }
}
