// Standalone verification of the employee-operation input schemas.
// These refinements (type ↔ rate pairing, "at least one field" on update) are
// the bug-prone deterministic surface; they need no DB. Run: npx tsx scripts/verify-employee-ops.mts
import {
  addEmployeeSchema,
  updateEmployeeSchema,
  deactivateEmployeeSchema,
} from '../src/lib/payroll/operations/employees.ts'
import {
  addExternalProjectSchema,
  updateExternalProjectSchema,
} from '../src/lib/payroll/operations/externalProjects.ts'

let failures = 0
function check(name: string, ok: boolean) {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${name}`)
}

const UUID = '00000000-0000-4000-8000-000000000000'

// --- employee.add: type ↔ rate pairing ---
check('hourly + hourlyRate ok', addEmployeeSchema.safeParse({ name: 'New Hire', type: 'hourly', hourlyRate: 25 }).success)
check('contractor + hourlyRate ok', addEmployeeSchema.safeParse({ name: 'Sub', type: 'contractor', hourlyRate: 40 }).success)
check('salaried + weeklyRate ok', addEmployeeSchema.safeParse({ name: 'Mgr', type: 'salaried', weeklyRate: 1500 }).success)
check('hourly WITHOUT rate rejected', !addEmployeeSchema.safeParse({ name: 'X', type: 'hourly' }).success)
check('salaried WITHOUT weeklyRate rejected', !addEmployeeSchema.safeParse({ name: 'X', type: 'salaried', hourlyRate: 25 }).success)
check('bad type rejected', !addEmployeeSchema.safeParse({ name: 'X', type: 'intern', hourlyRate: 10 }).success)
check('empty name rejected', !addEmployeeSchema.safeParse({ name: '   ', type: 'hourly', hourlyRate: 25 }).success)
check('negative rate rejected', !addEmployeeSchema.safeParse({ name: 'X', type: 'hourly', hourlyRate: -5 }).success)

// flag defaults applied
const parsed = addEmployeeSchema.safeParse({ name: 'Y', type: 'hourly', hourlyRate: 30 })
check('flag defaults → false', parsed.success && parsed.data.otAllowed === false && parsed.data.wc === false && parsed.data.isManagement === false)

// --- employee.update: at least one changed field ---
check('update with only employeeId rejected', !updateEmployeeSchema.safeParse({ employeeId: UUID }).success)
check('update with only reason rejected', !updateEmployeeSchema.safeParse({ employeeId: UUID, reason: 'note' }).success)
check('update with one field ok', updateEmployeeSchema.safeParse({ employeeId: UUID, hourlyRate: 31 }).success)
check('update nullable trade ok', updateEmployeeSchema.safeParse({ employeeId: UUID, trade: null }).success)
check('update bad uuid rejected', !updateEmployeeSchema.safeParse({ employeeId: 'not-a-uuid', wc: true }).success)

// --- employee.deactivate ---
check('deactivate needs uuid', !deactivateEmployeeSchema.safeParse({ employeeId: 'nope' }).success)
check('deactivate ok', deactivateEmployeeSchema.safeParse({ employeeId: UUID }).success)

// --- external_project.add: required name/client/billedTo ---
check('project full ok', addExternalProjectSchema.safeParse({ name: 'Zimmerman', clientName: 'Zimmerman', billedTo: 'Zach' }).success)
check('project missing billedTo rejected', !addExternalProjectSchema.safeParse({ name: 'Z', clientName: 'Z' }).success)
check('project blank name rejected', !addExternalProjectSchema.safeParse({ name: '  ', clientName: 'Z', billedTo: 'Zach' }).success)
const proj = addExternalProjectSchema.safeParse({ name: 'A', clientName: 'B', billedTo: 'C' })
check('project isActive default → true', proj.success && proj.data.isActive === true)
check('project workyard names ok', addExternalProjectSchema.safeParse({ name: 'A', clientName: 'B', billedTo: 'C', workyardCustomerNames: ['New City', 'Zimmerman'] }).success)

// --- external_project.update: at least one field ---
check('project update only id rejected', !updateExternalProjectSchema.safeParse({ projectId: UUID }).success)
check('project update one field ok', updateExternalProjectSchema.safeParse({ projectId: UUID, billedTo: 'Zach' }).success)
check('project update nullable notes ok', updateExternalProjectSchema.safeParse({ projectId: UUID, notes: null }).success)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
