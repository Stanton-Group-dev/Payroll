import { OVERHEAD_PROPERTY_NAMES, SPREAD_OVERHEAD_PROJECT_NAMES } from '@/lib/payroll/config'

export interface WorkyardRow {
  workyardId: string
  employeeName: string
  projectName: string
  customerName: string
  entryDate: string
  regularHours: number
  otHours: number
  ptoHours: number
  /** Miles driven, from the Workyard payroll export. Optional — the API path does not expose it. */
  miles?: number
  timecardId: string
  /** Cost-code CODE (e.g. "S0020" or "001"). For overhead/vendor projects an S-code here
   *  names the destination building the time bills to. */
  costCode: string
  /** Cost-code human NAME (e.g. "31 Park - Material Pickup", "Work Order - Standard").
   *  This is what maps to a customer-facing activity. */
  costCodeName: string
}

export interface ParseResult {
  rows: WorkyardRow[]
  errors: string[]
}

export function isOverheadProperty(name: string): boolean {
  return OVERHEAD_PROPERTY_NAMES.some(n => name.toLowerCase().includes(n))
}

/**
 * True when a Workyard project name is an overhead project that should be paid but
 * spread across all billable properties by unit count (like salaried), rather than
 * direct-billed to one property. Whole-name (trimmed, case-insensitive) match.
 */
export function isSpreadOverheadProject(name: string): boolean {
  return SPREAD_OVERHEAD_PROJECT_NAMES.includes(name.trim().toLowerCase())
}

export function parseWorkyardCSV(csvText: string): ParseResult {
  const errors: string[] = []
  const rows: WorkyardRow[] = []

  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    errors.push('CSV appears empty or has no data rows')
    return { rows, errors }
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))

  const get = (row: string[], key: string): string => {
    const idx = headers.indexOf(key)
    return idx >= 0 ? (row[idx] ?? '').trim().replace(/^"|"$/g, '') : ''
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i])
    if (cells.every(c => !c.trim())) continue

    const workyardId = get(cells, 'workyard_team_member_id') || get(cells, 'team_member_id') || get(cells, 'employee_id')
    const employeeName = get(cells, 'employee') || get(cells, 'team_member') || get(cells, 'name')
    const projectName = get(cells, 'project_name') || get(cells, 'project') || get(cells, 'property')
    const customerName = get(cells, 'customer_name') || get(cells, 'customer') || get(cells, 'llc')
    const entryDate = get(cells, 'date') || get(cells, 'entry_date') || get(cells, 'work_date')
    const timecardId = get(cells, 'timecard_id') || get(cells, 'id') || `row-${i}`
    const costCode = get(cells, 'cost_code') || get(cells, 'cost_codes') || ''
    const costCodeName = get(cells, 'cost_code_name') || ''

    const regularHours = parseFloat(get(cells, 'regular_hours') || get(cells, 'reg_hours') || '0') || 0
    const otHours = parseFloat(get(cells, 'ot_hours') || get(cells, 'overtime_hours') || '0') || 0
    const ptoHours = parseFloat(get(cells, 'pto_hours') || get(cells, 'pto') || '0') || 0
    const miles = parseFloat(get(cells, 'miles') || get(cells, 'mileage') || get(cells, 'total_miles') || '0') || 0

    if (!workyardId && !employeeName) {
      errors.push(`Row ${i + 1}: missing employee identifier`)
      continue
    }

    rows.push({
      workyardId: workyardId || employeeName,
      employeeName,
      projectName,
      customerName,
      entryDate,
      regularHours,
      otHours,
      ptoHours,
      miles,
      timecardId,
      costCode,
      costCodeName,
    })
  }

  return { rows, errors }
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}
