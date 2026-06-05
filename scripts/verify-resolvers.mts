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
