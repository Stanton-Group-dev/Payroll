// Verifies the server-side role gating. Run: npx tsx scripts/verify-authz.mts
import { getOperation } from '../src/lib/payroll/operations/index.ts'
import { previewOperation } from '../src/lib/payroll/operations/core.ts'
import { roleAtLeast, UnauthorizedError } from '../src/lib/payroll/operations/roles.ts'

let failures = 0
function check(name: string, cond: boolean) {
  if (!cond) failures++
  console.log(`${cond ? '✓' : '✗'} ${name}`)
}

// --- role hierarchy ---
check('superadmin ≥ admin', roleAtLeast('superadmin', 'admin'))
check('admin ≥ manager', roleAtLeast('admin', 'manager'))
check('admin NOT ≥ superadmin', !roleAtLeast('admin', 'superadmin'))
check('manager NOT ≥ admin', !roleAtLeast('manager', 'admin'))
check('bookkeeper NOT ≥ manager', !roleAtLeast('bookkeeper', 'manager'))
check('unknown NOT ≥ manager', !roleAtLeast('whatever', 'manager'))

// --- registry authorization matrix ---
check('time_entry.add → manager', getOperation('time_entry.add')?.minRole === 'manager')
check('employee.add → admin', getOperation('employee.add')?.minRole === 'admin')
check('employee.deactivate → admin', getOperation('employee.deactivate')?.minRole === 'admin')
check('external_project.update → admin', getOperation('external_project.update')?.minRole === 'admin')

// --- central enforcement (gate runs before DB, so a stub client is never touched) ---
const ctx = (role: string) =>
  ({ supabase: {} as never, actor: { id: 'u', email: 'e@x', role }, source: 'ui' as const })

async function expectThrow(label: string, fn: () => Promise<unknown>, wantUnauthorized: boolean) {
  try {
    await fn()
    check(`${label} (threw)`, false)
  } catch (err) {
    // Compare by name as well as instanceof: under tsx, a relative `.ts` import
    // and core's `./roles` import can resolve to two class identities, so
    // instanceof alone is unreliable in this harness (it is fine in the real app).
    const isUnauth =
      err instanceof UnauthorizedError || (err as Error)?.name === 'UnauthorizedError'
    check(`${label} [${(err as Error)?.name}]`, isUnauth === wantUnauthorized)
  }
}

const employeeAdd = getOperation('employee.add')!
const timeAdd = getOperation('time_entry.add')!

// manager hitting an admin-only op → UnauthorizedError, before any validation/DB.
await expectThrow('manager→employee.add denied', () => previewOperation(ctx('manager'), employeeAdd, {}), true)
// admin hitting employee.add → passes the gate, then fails validation (NOT Unauthorized).
await expectThrow('admin→employee.add passes gate', () => previewOperation(ctx('admin'), employeeAdd, {}), false)
// manager hitting a manager op → passes the gate (fails later on validation/DB, NOT Unauthorized).
await expectThrow('manager→time_entry.add passes gate', () => previewOperation(ctx('manager'), timeAdd, {}), false)
// bookkeeper hitting a manager op → denied.
await expectThrow('bookkeeper→time_entry.add denied', () => previewOperation(ctx('bookkeeper'), timeAdd, {}), true)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
