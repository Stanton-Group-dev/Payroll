// Standalone verification of the remote-bonus + pay-group operation schemas.
// Deterministic, no DB. Run: npx tsx scripts/verify-bonus-ops.mts
import { setBonusConfigSchema, addBonusSchema } from '../src/lib/payroll/operations/bonuses.ts'
import { addEmployeeSchema, updateEmployeeSchema } from '../src/lib/payroll/operations/employees.ts'

let failures = 0
function check(name: string, ok: boolean) {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${name}`)
}

const UUID = '00000000-0000-4000-8000-000000000000'

// --- remote_bonus.set_config ---
check('set_config minimal ok', setBonusConfigSchema.safeParse({ employeeId: UUID, structureNote: 'Q2 productivity bonus' }).success)
const cfg = setBonusConfigSchema.safeParse({ employeeId: UUID, structureNote: 'x' })
check('set_config basis default → manual', cfg.success && cfg.data.basis === 'manual')
check('set_config blank note rejected', !setBonusConfigSchema.safeParse({ employeeId: UUID, structureNote: '   ' }).success)
check('set_config bad basis rejected', !setBonusConfigSchema.safeParse({ employeeId: UUID, structureNote: 'x', basis: 'lottery' }).success)
check('set_config negative target rejected', !setBonusConfigSchema.safeParse({ employeeId: UUID, structureNote: 'x', targetAmount: -1 }).success)
check('set_config bad uuid rejected', !setBonusConfigSchema.safeParse({ employeeId: 'nope', structureNote: 'x' }).success)

// --- remote_bonus.add ---
check('add bonus ok', addBonusSchema.safeParse({ employeeId: UUID, weekId: UUID, amount: 250, description: 'Q2 bonus' }).success)
check('add bonus zero amount rejected', !addBonusSchema.safeParse({ employeeId: UUID, weekId: UUID, amount: 0, description: 'x' }).success)
check('add bonus negative rejected', !addBonusSchema.safeParse({ employeeId: UUID, weekId: UUID, amount: -50, description: 'x' }).success)
check('add bonus blank description rejected', !addBonusSchema.safeParse({ employeeId: UUID, weekId: UUID, amount: 50, description: '  ' }).success)
check('add bonus bad weekId rejected', !addBonusSchema.safeParse({ employeeId: UUID, weekId: 'nope', amount: 50, description: 'x' }).success)

// --- pay_group on employee schemas ---
const empDefault = addEmployeeSchema.safeParse({ name: 'Remote One', type: 'hourly', hourlyRate: 30 })
check('employee.add payGroup default → field', empDefault.success && empDefault.data.payGroup === 'field')
check('employee.add payGroup remote ok', addEmployeeSchema.safeParse({ name: 'R', type: 'hourly', hourlyRate: 30, payGroup: 'remote' }).success)
check('employee.add bad payGroup rejected', !addEmployeeSchema.safeParse({ name: 'R', type: 'hourly', hourlyRate: 30, payGroup: 'satellite' }).success)
check('employee.add monitaskId ok', addEmployeeSchema.safeParse({ name: 'R', type: 'hourly', hourlyRate: 30, payGroup: 'remote', monitaskId: 'mt-1' }).success)
check('employee.update payGroup-only ok', updateEmployeeSchema.safeParse({ employeeId: UUID, payGroup: 'remote' }).success)

console.log(failures === 0 ? '\nAll bonus/pay-group checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
