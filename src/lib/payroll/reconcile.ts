/**
 * Reconcile the system's computed payroll against a manually-prepared payroll
 * (e.g. the Excel sheet someone did by hand). Pure + deterministic so it can be
 * unit-tested and reused by the UI. Matching of pasted names to employees uses
 * the same fuzzy resolver as the rest of the app.
 */
import { resolveOne, normalize } from './resolve/text'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface ManualLine {
  name: string
  amount: number
}

/**
 * Parse pasted manual figures. Accepts one entry per line in any of:
 *   "Stan Baldyga\t1400"   (tab — straight from Excel)
 *   "Stan Baldyga, 1400.00"
 *   "Stan Baldyga   $1,400"
 * Lines that don't contain a name + number are ignored.
 */
export function parseManualPaste(text: string): ManualLine[] {
  const out: ManualLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // Name = everything before the trailing amount; amount = the last number on
    // the line (optional $, thousands commas, decimals). Anchoring the number at
    // end-of-line avoids treating a thousands-comma as a field separator.
    const m = line.match(/^(.*?)[\s,]*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*$/)
    if (!m) continue
    const name = m[1].trim()
    const amount = Number(m[2].replace(/,/g, ''))
    if (!name || Number.isNaN(amount)) continue
    out.push({ name, amount })
  }
  return out
}

export interface ManualMatchResult {
  /** employeeId → manual amount */
  matched: Record<string, number>
  /** names that could not be confidently matched to an employee */
  unmatched: string[]
}

/** Match parsed manual lines to employees by name (fuzzy, unique-only). */
export function matchManualToEmployees(
  lines: ManualLine[],
  employees: { id: string; name: string }[]
): ManualMatchResult {
  const matched: Record<string, number> = {}
  const unmatched: string[] = []
  for (const line of lines) {
    const res = resolveOne(line.name, employees, (e) => e.name)
    if (res.status === 'unique') matched[res.match.id] = line.amount
    else {
      // Accept an exact normalized name even if the fuzzy resolver was unsure.
      const exact = employees.find((e) => normalize(e.name) === normalize(line.name))
      if (exact) matched[exact.id] = line.amount
      else unmatched.push(line.name)
    }
  }
  return { matched, unmatched }
}

export interface ReconcileRow {
  id: string
  name: string
  system: number
  manual: number | null
  /** manual − system; null when no manual value was provided. */
  delta: number | null
  /** true when a manual value is present and matches system within a cent. */
  match: boolean
}

export interface ReconcileResult {
  rows: ReconcileRow[]
  totals: { system: number; manual: number; delta: number }
  matchedCount: number
  mismatchCount: number
  /** employee ids that have a system figure but no manual entry. */
  missingManual: number
}

/**
 * Diff system gross pay vs manual gross pay, keyed by employee id. `manual` maps
 * employeeId → amount (only the ones the user filled in).
 */
export function reconcile(
  systemRows: { id: string; name: string; gross: number }[],
  manual: Record<string, number>
): ReconcileResult {
  let sysTotal = 0
  let manTotal = 0
  let matchedCount = 0
  let mismatchCount = 0
  let missingManual = 0

  const rows: ReconcileRow[] = systemRows.map((r) => {
    const system = round2(r.gross)
    sysTotal += system
    const hasManual = manual[r.id] != null
    const manualVal = hasManual ? round2(manual[r.id]) : null
    let delta: number | null = null
    let match = false
    if (manualVal != null) {
      manTotal += manualVal
      delta = round2(manualVal - system)
      match = Math.abs(delta) < 0.01
      if (match) matchedCount++
      else mismatchCount++
    } else {
      missingManual++
    }
    return { id: r.id, name: r.name, system, manual: manualVal, delta, match }
  })

  return {
    rows,
    totals: { system: round2(sysTotal), manual: round2(manTotal), delta: round2(manTotal - sysTotal) },
    matchedCount,
    mismatchCount,
    missingManual,
  }
}
