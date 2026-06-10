// Standalone verification of the deterministic resolver logic.
// Run: npx tsx scripts/verify-resolvers.mts
import { parseRelativeDate } from '../src/lib/payroll/resolve/dates.ts'
import { scoreMatch, resolveOne } from '../src/lib/payroll/resolve/text.ts'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`}`)
}

// Reference "today": Thursday, 2026-06-04.
const today = new Date('2026-06-04T12:00:00')

// "wednesday of last week" → previous calendar week's Wednesday = 2026-05-27.
check('wednesday of last week', parseRelativeDate('wednesday of last week', today)?.iso, '2026-05-27')
// "last friday" → most recent past Friday = 2026-05-29.
check('last friday', parseRelativeDate('last friday', today)?.iso, '2026-05-29')
// "this monday" → current week (Sun 5/31 start) Monday = 2026-06-01.
check('this monday', parseRelativeDate('this monday', today)?.iso, '2026-06-01')
// "yesterday"/"today"/"tomorrow".
check('yesterday', parseRelativeDate('yesterday', today)?.iso, '2026-06-03')
check('today', parseRelativeDate('today', today)?.iso, '2026-06-04')
check('tomorrow', parseRelativeDate('tomorrow', today)?.iso, '2026-06-05')
// Explicit forms.
check('iso passthrough', parseRelativeDate('2026-03-11', today)?.iso, '2026-03-11')
check('m/d', parseRelativeDate('3/11', today)?.iso, '2026-03-11')
check('next tuesday', parseRelativeDate('next tuesday', today)?.iso, '2026-06-09')
check('garbage → null', parseRelativeDate('whenever', today), null)

// Week-anchored resolution: user is viewing the Mon 6/1 → Sun 6/7 week while
// "today" is later (Jun 10). Bare/relative weekdays must anchor to the VIEWED
// week, not the calendar week containing today. (Regression: "monday" used to
// resolve to Jun 8 — outside the viewed week — when today was Jun 10.)
const jun10 = new Date('2026-06-10T12:00:00') // a Wednesday
const viewedWeek = new Date('2026-06-01T00:00:00') // week_start, a Monday
check('anchored "monday" → viewed week', parseRelativeDate('monday', jun10, viewedWeek)?.iso, '2026-06-01')
check('anchored "sunday" → viewed week end', parseRelativeDate('sunday', jun10, viewedWeek)?.iso, '2026-06-07')
check('anchored "this week wednesday"', parseRelativeDate('wednesday this week', jun10, viewedWeek)?.iso, '2026-06-03')
check('anchored "monday of last week"', parseRelativeDate('monday of last week', jun10, viewedWeek)?.iso, '2026-05-25')
// "last/next <weekday>" stay relative to today even when a week is viewed.
check('anchored "last friday" still today-relative', parseRelativeDate('last friday', jun10, viewedWeek)?.iso, '2026-06-05')
// Without an anchor, behavior is unchanged (calendar week of today, Jun 10).
check('unanchored "monday" → today’s week', parseRelativeDate('monday', jun10)?.iso, '2026-06-08')

// Fuzzy matching against the real roster.
const employees = [
  'Alex', 'Angel Salazar', 'Carlos Nieves', 'Christian Arevalo', 'Darwin Montesdeoca',
  'Javier Rivera', 'Lui Maldonado', 'Luis Perez', 'Rene Arevalo', 'Rolando Vasquez',
  'Stan Baldyga', 'William Thomas',
].map((name, i) => ({ id: String(i), name }))

const stan = resolveOne('stan', employees, (e) => e.name)
check('"stan" resolves uniquely', stan.status === 'unique' && stan.match.name, 'Stan Baldyga')

const portfolios = [
  'Hartford 1 - Stanton Mgmt', 'Hartford Portfolio', 'New Haven Portfolio',
  'Northend - Stanton Mgmt', 'Park Portfolio - Stanton Mgmt', 'Southend - Stanton Mgmt',
  'Stanton Management LLC', 'Test Portfolio', 'UI Test Portfolio',
].map((name, i) => ({ id: String(i), name }))

const park = resolveOne('park', portfolios, (p) => p.name)
check('"park" resolves to Park Portfolio', park.status === 'unique' && park.match.name, 'Park Portfolio - Stanton Mgmt')

// "arevalo" is shared by two employees → ambiguous, not a silent wrong pick.
const arevalo = resolveOne('arevalo', employees, (e) => e.name)
check('"arevalo" is ambiguous', arevalo.status, 'ambiguous')

console.log(scoreMatch('stna', 'Stan Baldyga') > 0.3 ? '✓ typo "stna" still scores' : '✗ typo scoring')

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
