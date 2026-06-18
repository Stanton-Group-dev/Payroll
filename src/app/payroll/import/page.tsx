'use client'

import { useState, useCallback } from 'react'
import { Upload, AlertTriangle, CheckCircle2, X, RefreshCw } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { useProperties } from '@/hooks/payroll/useProperties'
import { PageHeader, FormButton, FormSelect, FormField, InfoBlock } from '@/components/form'
import { createClient } from '@/lib/supabase/client'
import { parseWorkyardCSV, isOverheadProperty, isSpreadOverheadProject, type WorkyardRow } from '@/lib/payroll/csv-parser'
import type { PayrollEmployee } from '@/lib/supabase/types'
import { format } from 'date-fns'

interface MatchedRow extends WorkyardRow {
  employeeId?: string
  employeeName2?: string
  propertyId?: string
  propertyName?: string
  flag?: string
  /** Overhead project (e.g. "Office") — paid, but spread across all billable properties
   *  by unit count rather than billed to one property. No property_id. */
  overheadSpread?: boolean
  status: 'ok' | 'flagged' | 'unmatched_employee' | 'unmatched_property'
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export default function ImportPage() {
  const { weeks, refetch: refetchWeeks } = usePayrollWeeks()
  const { employees, refetch: refetchEmployees } = usePayrollEmployees(false)
  const { properties: propertyList } = useProperties(true)

  const [importMode, setImportMode] = useState<'api' | 'csv'>('api')
  const { selectedWeekId, setSelectedWeekId } = useSelectedWeek()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<MatchedRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importSummary, setImportSummary] = useState({ imported: 0, flagged: 0, errors: 0 })
  const [apiFetching, setApiFetching] = useState(false)
  const [apiStats, setApiStats] = useState<{ total: number; allocations: number } | null>(null)

  const draftWeeks = weeks.filter(w => w.status === 'draft')

  const selectedWeek = draftWeeks.find(w => w.id === selectedWeekId)

  const matchRows = useCallback((rows: WorkyardRow[], employeePool: PayrollEmployee[] = employees): MatchedRow[] => {
    const propByCode = Object.fromEntries(propertyList.map(p => [p.code?.toLowerCase(), p]))
    const empByWorkyardId = Object.fromEntries(
      employeePool.filter(e => e.workyard_id).map(e => [e.workyard_id!.toLowerCase(), e])
    )
    const empByName = Object.fromEntries(employeePool.map(e => [normalizeName(e.name), e]))
    const empByFirstName = Object.fromEntries(employeePool.map(e => [normalizeName(e.name).split(' ')[0], e]))

    return rows.map(row => {
      const wyIdKey = row.workyardId?.toLowerCase()
      const nameKey = row.employeeName ? normalizeName(row.employeeName) : ''
      const firstNameKey = nameKey.split(' ')[0]
      const emp =
        (wyIdKey ? empByWorkyardId[wyIdKey] : undefined) ??
        (nameKey ? empByName[nameKey] : undefined) ??
        (firstNameKey ? empByFirstName[firstNameKey] : undefined)
      const prop = propByCode[row.projectName?.toLowerCase()]
      const overhead = isOverheadProperty(row.projectName)
      const spread = isSpreadOverheadProject(row.projectName)

      let status: MatchedRow['status'] = 'ok'
      let flag = ''

      if (!emp) {
        status = 'unmatched_employee'
        flag = `No employee match for "${row.workyardId || row.employeeName}"`
      } else if (spread) {
        // Overhead project (e.g. "Office") — paid and spread across all billable
        // properties by unit count, not billed to one. Stays active/unflagged.
        status = 'ok'
      } else if (overhead) {
        status = 'flagged'
        flag = `Overhead property: "${row.projectName}" — needs redistribution`
      } else if (!prop) {
        status = 'flagged'
        flag = `Property "${row.projectName}" not found in system`
      }

      return {
        ...row,
        employeeId: emp?.id,
        employeeName2: emp?.name,
        propertyId: spread ? undefined : prop?.id,
        propertyName: spread ? `${row.projectName} — spread across portfolio` : prop?.name ?? row.projectName,
        overheadSpread: spread,
        status,
        flag,
      }
    })
  }, [employees, propertyList])

  const syncEmployeesFromWorkyardRows = useCallback(async (rows: WorkyardRow[]): Promise<PayrollEmployee[]> => {
    const supabase = createClient()
    const byWorkyardId = new Map<string, PayrollEmployee>()
    const byName = new Map<string, PayrollEmployee>()
    const mergedEmployees = [...employees]

    for (const emp of mergedEmployees) {
      if (emp.workyard_id) byWorkyardId.set(emp.workyard_id.toLowerCase(), emp)
      byName.set(normalizeName(emp.name), emp)
    }

    const workers = new Map<string, string>()
    for (const row of rows) {
      const wyId = row.workyardId?.trim()
      const wyName = row.employeeName?.trim()
      if (!wyId || !wyName) continue
      if (!workers.has(wyId)) workers.set(wyId, wyName)
    }

    for (const [wyId, wyName] of workers.entries()) {
      const wyIdKey = wyId.toLowerCase()
      const nameKey = normalizeName(wyName)
      const existingById = byWorkyardId.get(wyIdKey)
      if (existingById) continue

      const existingByName = byName.get(nameKey)
      if (existingByName) {
        const { error } = await supabase
          .from('payroll_employees')
          .update({ workyard_id: wyId })
          .eq('id', existingByName.id)
        if (error) throw new Error(error.message)
        const updated = { ...existingByName, workyard_id: wyId }
        byWorkyardId.set(wyIdKey, updated)
        byName.set(nameKey, updated)
        const idx = mergedEmployees.findIndex(e => e.id === updated.id)
        if (idx >= 0) mergedEmployees[idx] = updated
        continue
      }

      const { data: inserted, error } = await supabase
        .from('payroll_employees')
        .insert({
          name: wyName,
          workyard_id: wyId,
          type: 'hourly',
          is_active: true,
          ot_allowed: false,
          pay_tax: false,
          wc: false,
        })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      if (inserted) {
        mergedEmployees.push(inserted)
        byWorkyardId.set(wyIdKey, inserted)
        byName.set(nameKey, inserted)
      }
    }

    if (workers.size > 0) {
      await refetchEmployees()
    }

    return mergedEmployees
  }, [employees, refetchEmployees])

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setImportDone(false)
    setParseErrors([])
    setPreview([])

    const text = await f.text()
    const { rows, errors } = parseWorkyardCSV(text)
    setParseErrors(errors)
    if (rows.length === 0) return
    setPreview(matchRows(rows))
  }, [matchRows])

  const handleApiPull = useCallback(async () => {
    if (!selectedWeek) return
    setApiFetching(true)
    setParseErrors([])
    setPreview([])
    setApiStats(null)

    try {
      const res = await fetch(`/api/workyard/timecards?weekStart=${selectedWeek.week_start}&approvedOnly=false`)
      const json = await res.json()
      if (!res.ok) {
        setParseErrors([json.error ?? 'Failed to fetch from Workyard'])
        return
      }
      const { rows, stats } = json as { rows: WorkyardRow[]; stats: { total: number; allocations: number } }
      setApiStats(stats)
      if (rows.length === 0) {
        setParseErrors([`No approved time cards found for week of ${selectedWeek.week_start}. Make sure cards are approved in Workyard first.`])
        return
      }
      const mergedEmployees = await syncEmployeesFromWorkyardRows(rows)
      setPreview(matchRows(rows, mergedEmployees))
    } catch (err) {
      setParseErrors([err instanceof Error ? err.message : 'Network error'])
    } finally {
      setApiFetching(false)
    }
  }, [selectedWeek, matchRows, syncEmployeesFromWorkyardRows])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && f.name.endsWith('.csv')) handleFile(f)
  }, [handleFile])

  const resetPreview = () => {
    setFile(null)
    setPreview([])
    setParseErrors([])
    setApiStats(null)
  }

  const handleImport = async () => {
    if (!selectedWeekId || preview.length === 0) return
    setImporting(true)

    const supabase = createClient()
    let imported = 0, flagged = 0, errors = 0

    for (const row of preview) {
      if (row.status === 'unmatched_employee') { errors++; continue }

      try {
        await supabase.from('payroll_time_entries').insert({
          payroll_week_id: selectedWeekId,
          employee_id: row.employeeId!,
          property_id: row.propertyId ?? null,
          entry_date: row.entryDate || format(new Date(), 'yyyy-MM-dd'),
          regular_hours: row.regularHours,
          ot_hours: row.otHours,
          pto_hours: row.ptoHours,
          miles: row.miles ?? 0,
          source: importMode === 'api' ? 'workyard_api' : 'workyard',
          workyard_timecardid: row.timecardId,
          is_flagged: row.status === 'flagged',
          flag_reason: row.flag ?? null,
          is_overhead_spread: row.overheadSpread ?? false,
        })
        if (row.status === 'flagged') flagged++
        else imported++
      } catch {
        errors++
      }
    }

    setImportSummary({ imported, flagged, errors })
    setImportDone(true)
    setImporting(false)
    await refetchWeeks()
  }

  const previewStats = preview.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )

  return (
    <div>
      <PageHeader
        title="Workyard Import"
        subtitle="Pull approved time cards from Workyard API or upload a CSV export"
      />

      <div className="p-6 max-w-4xl">

        {/* Workflow callout */}
        <InfoBlock title="Pre-import checklist">
          <ol className="space-y-1 list-decimal list-inside">
            <li>Employees have clocked in/out in Workyard for the full week</li>
            <li>Managers have reviewed, made any clock corrections, and <strong>approved all time cards in Workyard</strong></li>
            <li>Select the payroll week below, then pull from API — only approved cards will be fetched</li>
            <li>Further adjustments (property allocation, corrections, dept splits) are made here after import</li>
          </ol>
        </InfoBlock>

        {importDone ? (
          <div>
            <InfoBlock variant="success" title="Import Complete">
              <p>{importSummary.imported} entries imported • {importSummary.flagged} flagged for correction • {importSummary.errors} skipped (no match)</p>
              {importSummary.flagged > 0 && (
                <p className="mt-1">Go to <a href={`/payroll/corrections?week=${selectedWeekId}`} className="underline">Correction Queue</a> to resolve flagged entries.</p>
              )}
            </InfoBlock>
            <FormButton variant="secondary" onClick={() => { resetPreview(); setImportDone(false) }} className="mt-4">
              Import Another
            </FormButton>
          </div>
        ) : (
          <>
            {/* Week selector */}
            <div className="mb-6">
              <FormField label="Target Payroll Week" required>
                <FormSelect value={selectedWeekId} onChange={e => { setSelectedWeekId(e.target.value); resetPreview() }} className="max-w-xs">
                  <option value="">— Select week —</option>
                  {draftWeeks.map(w => (
                    <option key={w.id} value={w.id}>
                      Week of {format(new Date(w.week_start + 'T00:00:00'), 'MMM d, yyyy')}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
              {draftWeeks.length === 0 && (
                <p className="text-xs text-[var(--warning)] mt-1">No draft weeks available. Create one from the dashboard first.</p>
              )}
            </div>

            {/* Mode tabs */}
            <div className="flex border-b border-[var(--border)] mb-6">
              {(['api', 'csv'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => { setImportMode(mode); resetPreview() }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 ${
                    importMode === mode
                      ? 'border-[var(--primary)] text-[var(--primary)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {mode === 'api' ? 'Pull from API' : 'Upload CSV'}
                </button>
              ))}
            </div>

            {/* API pull panel */}
            {importMode === 'api' && preview.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-10 border-2 border-dashed border-[var(--border)]">
                <RefreshCw size={28} className="text-[var(--muted)]" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--ink)]">Pull approved time cards from Workyard</p>
                  <p className="text-xs text-[var(--muted)] mt-1">Fetches all cards with status = approved for the selected week</p>
                </div>
                <FormButton
                  onClick={handleApiPull}
                  loading={apiFetching}
                  disabled={!selectedWeekId}
                >
                  {apiFetching ? 'Fetching…' : 'Fetch Approved Time Cards'}
                </FormButton>
                {!selectedWeekId && (
                  <p className="text-xs text-[var(--muted)]">Select a payroll week first</p>
                )}
              </div>
            )}

            {/* CSV upload panel */}
            {importMode === 'csv' && preview.length === 0 && (
              <>
                {!file ? (
                  <div
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    className="border-2 border-dashed border-[var(--border)] p-12 text-center cursor-pointer hover:border-[var(--primary)] hover:bg-[var(--bg-section)] transition-colors"
                    onClick={() => document.getElementById('csv-input')?.click()}
                  >
                    <Upload size={32} className="mx-auto text-[var(--muted)] mb-3" />
                    <p className="text-sm font-medium text-[var(--ink)]">Drop Workyard CSV here or click to browse</p>
                    <p className="text-xs text-[var(--muted)] mt-1">Accepts .csv files exported from Workyard</p>
                    <input
                      id="csv-input" type="file" accept=".csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 border border-[var(--border)] bg-[var(--bg-section)] mb-4">
                    <CheckCircle2 size={16} className="text-[var(--success)]" />
                    <span className="text-sm text-[var(--ink)] flex-1">{file.name}</span>
                    <button onClick={resetPreview} className="text-[var(--muted)] hover:text-[var(--ink)]">
                      <X size={16} />
                    </button>
                  </div>
                )}
              </>
            )}

            {parseErrors.length > 0 && (
              <InfoBlock variant="error" title={importMode === 'api' ? 'API Error' : 'Parse Errors'}>
                {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
              </InfoBlock>
            )}

            {/* API fetch summary */}
            {apiStats && preview.length > 0 && (
              <div className="mb-4 text-xs text-[var(--muted)]">
                Fetched {apiStats.total} approved time card{apiStats.total !== 1 ? 's' : ''} → {apiStats.allocations} allocation row{apiStats.allocations !== 1 ? 's' : ''} (multi-property cards split proportionally)
              </div>
            )}

            {/* Preview table — shared for both modes */}
            {preview.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-serif text-base text-[var(--primary)]">
                    Preview — {preview.length} rows
                  </h3>
                  <div className="flex items-center gap-3 text-xs">
                    {previewStats.ok > 0 && <span className="text-[var(--success)]">✓ {previewStats.ok} ready</span>}
                    {previewStats.flagged > 0 && <span className="text-[var(--warning)]">⚑ {previewStats.flagged} flagged</span>}
                    {previewStats.unmatched_employee > 0 && <span className="text-[var(--error)]">✕ {previewStats.unmatched_employee} unmatched</span>}
                    <button onClick={resetPreview} className="text-[var(--muted)] hover:text-[var(--ink)] underline">clear</button>
                  </div>
                </div>

                <div className="border border-[var(--border)] overflow-auto max-h-96">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--primary)] text-white sticky top-0">
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Employee</th>
                        <th className="px-3 py-2 text-left font-medium">Date</th>
                        <th className="px-3 py-2 text-left font-medium">Property</th>
                        <th className="px-3 py-2 text-right font-medium">Reg</th>
                        <th className="px-3 py-2 text-right font-medium">OT</th>
                        <th className="px-3 py-2 text-right font-medium">PTO</th>
                        <th className="px-3 py-2 text-right font-medium">Miles</th>
                        <th className="px-3 py-2 text-left font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-b border-[var(--divider)] ${
                            row.status === 'unmatched_employee' ? 'bg-[var(--error)]/5' :
                            row.status === 'flagged' ? 'bg-[var(--warning)]/5' : ''
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            {row.status === 'ok' && <span className="text-[var(--success)]">✓</span>}
                            {row.status === 'flagged' && <AlertTriangle size={12} className="text-[var(--warning)]" />}
                            {row.status === 'unmatched_employee' && <span className="text-[var(--error)]">✕</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <div>{row.employeeName2 ?? <span className="text-[var(--error)]">{row.employeeName}</span>}</div>
                            <div className="text-[var(--muted)] font-mono">{row.workyardId}</div>
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{row.entryDate}</td>
                          <td className="px-3 py-1.5">
                            {row.propertyName ?? <span className="text-[var(--muted)]">{row.projectName}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right">{row.regularHours || '—'}</td>
                          <td className="px-3 py-1.5 text-right">{row.otHours || '—'}</td>
                          <td className="px-3 py-1.5 text-right">{row.ptoHours || '—'}</td>
                          <td className="px-3 py-1.5 text-right">{row.miles || '—'}</td>
                          <td className="px-3 py-1.5 text-[var(--muted)] max-w-48 truncate">{row.flag}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <FormButton
                    onClick={handleImport}
                    loading={importing}
                    disabled={!selectedWeekId || preview.every(r => r.status === 'unmatched_employee')}
                  >
                    Import {preview.filter(r => r.status !== 'unmatched_employee').length} Rows
                  </FormButton>
                  {previewStats.unmatched_employee > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      {previewStats.unmatched_employee} unmatched rows will be skipped
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
