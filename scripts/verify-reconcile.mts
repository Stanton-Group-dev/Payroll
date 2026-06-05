// Verifies manual-vs-system reconciliation. Run: npx tsx scripts/verify-reconcile.mts
import { parseManualPaste, matchManualToEmployees, reconcile } from '../src/lib/payroll/reconcile.ts'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) failures++
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${extra}`}`)
}

// --- paste parsing: tab, comma, $/commas, multi-space ---
const parsed = parseManualPaste(
  'Stan Baldyga\t1,400.00\nCarlos Nieves, 1080\nRene Arevalo   $1,280.50\njunk line\nWilliam Thomas\t0'
)
check('parsed 4 lines', parsed.length === 4, JSON.stringify(parsed))
check('tab + commas', parsed[0].name === 'Stan Baldyga' && parsed[0].amount === 1400)
check('comma sep', parsed[1].name === 'Carlos Nieves' && parsed[1].amount === 1080)
check('$ + decimals', parsed[2].amount === 1280.5)
check('zero amount kept', parsed[3].name === 'William Thomas' && parsed[3].amount === 0)

// --- fuzzy matching to employees ---
const employees = [
  { id: 'e-stan', name: 'Stan Baldyga' },
  { id: 'e-carlos', name: 'Carlos Nieves' },
  { id: 'e-rene', name: 'Rene Arevalo' },
  { id: 'e-will', name: 'William Thomas' },
]
const { matched, unmatched } = matchManualToEmployees(parsed, employees)
check('matched stan', matched['e-stan'] === 1400)
check('matched carlos', matched['e-carlos'] === 1080)
check('no unmatched', unmatched.length === 0, JSON.stringify(unmatched))

// first-name-only paste still matches
const fn = matchManualToEmployees(parseManualPaste('Stan\t999'), employees)
check('first-name "Stan" matches', fn.matched['e-stan'] === 999)

// ambiguous / unknown name → unmatched, not a wrong pick
const unk = matchManualToEmployees(parseManualPaste('Zzz Nobody\t500'), employees)
check('unknown name unmatched', unk.unmatched.length === 1 && Object.keys(unk.matched).length === 0)

// --- reconcile diff ---
const systemRows = [
  { id: 'e-stan', name: 'Stan Baldyga', gross: 1400 },
  { id: 'e-carlos', name: 'Carlos Nieves', gross: 1100 }, // manual says 1080 → diff -20
  { id: 'e-rene', name: 'Rene Arevalo', gross: 1280.5 },
  { id: 'e-will', name: 'William Thomas', gross: 0 }, // no manual entry
]
const r = reconcile(systemRows, { 'e-stan': 1400, 'e-carlos': 1080, 'e-rene': 1280.5 })
check('stan matches (delta 0)', r.rows.find((x) => x.id === 'e-stan')!.match === true)
check('carlos mismatch delta -20', r.rows.find((x) => x.id === 'e-carlos')!.delta === -20)
check('matchedCount = 2', r.matchedCount === 2)
check('mismatchCount = 1', r.mismatchCount === 1)
check('missingManual = 1 (will)', r.missingManual === 1)
check('totals.system', r.totals.system === 3780.5)
check('totals.manual', r.totals.manual === 3760.5)
check('totals.delta -20', r.totals.delta === -20)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
