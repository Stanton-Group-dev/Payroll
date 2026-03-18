'use client'

import { useState, useCallback, useEffect } from 'react'
import { Upload, AlertTriangle, CheckCircle2, X, RefreshCw, Link2, Plus, Ban } from 'lucide-react'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { usePayrollEmployees } from '@/hooks/payroll/usePayrollEmployees'
import { useProperties } from '@/hooks/payroll/useProperties'
import { PageHeader, FormButton, FormSelect, FormField, FormInput, InfoBlock } from '@/components/form'
import { createClient } from '@/lib/supabase/client'
import { parseWorkyardCSV, isOverheadProperty, type WorkyardRow } from '@/lib/payroll/csv-parser'
import type { PayrollEmployee } from '@/lib/supabase/types'
import { format } from 'date-fns'

interface ExternalProject {
  id: string
  name: string
  client_name: string
  billed_to: string
  is_active: boolean
  workyard_customer_names: string[]
}

type RowStatus = 'ok' | 'flagged' | 'unmatched_employee' | 'unmatched_property' | 'unrecognized_project'

interface MatchedRow extends WorkyardRow {
  employeeId?: string
  employeeName2?: string
  propertyId?: string
  propertyName?: string
  externalProjectId?: string
  flag?: string
  status: RowStatus
}

/** Resolution for an unrecognized project string */
type ProjectResolution =
  | { action: 'link_property'; propertyId: string }
  | { action: 'link'; projectId: string }
  | { action: 'create'; name: string; client_name: string; billed_to: string }
  | { action: 'ignore' }

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export default function ImportPage() {
  const { weeks, refetch: refetchWeeks } = usePayrollWeeks()
  const { employees, refetch: refetchEmployees } = usePayrollEmployees(false)
  const { properties: propertyList } = useProperties(true)

  const [importMode, setImportMode] = useState<'api' | 'csv'>('api')
  const [selectedWeekId, setSelectedWeekId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<MatchedRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importSummary, setImportSummary] = useState({ imported: 0, flagged: 0, errors: 0 })
  const [apiFetching, setApiFetching] = useState(false)
  const [apiStats, setApiStats] = useState<{ total: number; allocations: number } | null>(null)

  // External projects for Workyard customer name matching
  const [extProjects, setExtProjects] = useState<ExternalProject[]>([])
  // Resolutions for unrecognized project strings (keyed by normalized customerName)
  const [resolutions, setResolutions] = useState<Record<string, ProjectResolution>>({})

  // Fetch external projects on mount
  useEffect(() => {
    const supabase = createClient()
    supabase.from('payroll_external_projects').select('id,name,client_name,billed_to,is_active,workyard_customer_names').eq('is_active', true).order('name')
      .then(({ data }) => setExtProjects(data ?? []))
  }, [])

  const draftWeeks = weeks.filter(w => w.status === 'draft')

  const selectedWeek = draftWeeks.find(w => w.id === selectedWeekId)

  const matchRows = useCallback((rows: WorkyardRow[], employeePool: PayrollEmployee[] = employees, extPool: ExternalProject[] = extProjects): MatchedRow[] => {
    const propByCode = Object.fromEntries(propertyList.map(p => [p.code?.toLowerCase(), p]))
    const empByWorkyardId = Object.fromEntries(
      employeePool.filter(e => e.workyard_id).map(e => [e.workyard_id!.toLowerCase(), e])
    )
    const empByName = Object.fromEntries(employeePool.map(e => [normalizeName(e.name), e]))
    const empByFirstName = Object.fromEntries(employeePool.map(e => [normalizeName(e.name).split(' ')[0], e]))

    // Build property alias lookup: normalized alias → property
    const propByAlias = new Map<string, typeof propertyList[0]>()
    for (const p of propertyList) {
      for (const alias of (p.workyard_aliases ?? [])) {
        propByAlias.set(alias.trim().toLowerCase(), p)
      }
    }

    // Build external project lookup: normalized customer name → project
    const extByCustomerName = new Map<string, ExternalProject>()
    for (const ep of extPool) {
      for (const cn of (ep.workyard_customer_names ?? [])) {
        extByCustomerName.set(cn.trim().toLowerCase(), ep)
      }
    }

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

      let status: MatchedRow['status'] = 'ok'
      let flag = ''
      let externalProjectId: string | undefined
      let propertyId = prop?.id
      let propertyName = prop?.name ?? row.projectName

      if (!emp) {
        status = 'unmatched_employee'
        flag = `No employee match for "${row.workyardId || row.employeeName}"`
      } else if (overhead) {
        status = 'flagged'
        flag = `Overhead property: "${row.projectName}" — needs redistribution`
      } else if (!prop) {
        // Try property alias match (workyard_aliases on properties table)
        const custKey = row.customerName?.trim().toLowerCase()
        const projKey = row.projectName?.trim().toLowerCase()
        const aliasMatch = (custKey ? propByAlias.get(custKey) : undefined) ?? (projKey ? propByAlias.get(projKey) : undefined)
        if (aliasMatch) {
          status = 'ok'
          propertyId = aliasMatch.id
          propertyName = aliasMatch.name
        } else {
          // Try external project match by customerName
          const extMatch = (custKey ? extByCustomerName.get(custKey) : undefined) ?? (projKey ? extByCustomerName.get(projKey) : undefined)
          if (extMatch) {
            status = 'ok'
            externalProjectId = extMatch.id
            propertyName = extMatch.name
            propertyId = undefined as unknown as string // external project, not a property
          } else {
            // Is it an S-code that just isn't in the system? (starts with S followed by digits)
            const looksLikeSCode = /^s\d{3,}/i.test(row.projectName?.trim() ?? '')
            if (looksLikeSCode) {
              status = 'flagged'
              flag = `Property "${row.projectName}" not found in system`
            } else {
              status = 'unrecognized_project'
              flag = `Unrecognized project: "${row.customerName || row.projectName}" — resolve before import`
            }
          }
        }
      }

      return {
        ...row,
        employeeId: emp?.id,
        employeeName2: emp?.name,
        propertyId,
        propertyName,
        externalProjectId,
        status,
        flag,
      }
    })
  }, [employees, propertyList, extProjects])

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
    setResolutions({})
  }

  // Get unique unrecognized project strings from preview
  const unresolvedProjectStrings = Array.from(new Set(
    preview.filter(r => r.status === 'unrecognized_project').map(r => (r.customerName || r.projectName).trim().toLowerCase())
  ))
  const hasUnresolvedProjects = unresolvedProjectStrings.some(s => !resolutions[s])

  const resolveProject = (key: string, resolution: ProjectResolution) => {
    setResolutions(prev => ({ ...prev, [key]: resolution }))
  }

  // Apply all resolutions: link to property, existing project, or create new ones, then re-match
  const applyResolutions = async () => {
    const supabase = createClient()
    const updatedExt = [...extProjects]

    for (const [key, res] of Object.entries(resolutions)) {
      if (res.action === 'ignore') continue
      if (res.action === 'link_property') {
        const prop = propertyList.find(p => p.id === res.propertyId)
        if (prop) {
          const aliases = [...(prop.workyard_aliases ?? [])]
          const originalStr = preview.find(r => (r.customerName || r.projectName).trim().toLowerCase() === key)?.customerName || preview.find(r => (r.customerName || r.projectName).trim().toLowerCase() === key)?.projectName || key
          if (!aliases.some(a => a.toLowerCase() === key)) aliases.push(originalStr.trim())
          await supabase.from('properties').update({ workyard_aliases: aliases }).eq('id', prop.id)
          prop.workyard_aliases = aliases
        }
      } else if (res.action === 'link') {
        const proj = updatedExt.find(p => p.id === res.projectId)
        if (proj) {
          const names = [...(proj.workyard_customer_names ?? [])]
          const raw = key // already lowercased key, find original casing from preview
          const originalStr = preview.find(r => (r.customerName || r.projectName).trim().toLowerCase() === raw)?.customerName || preview.find(r => (r.customerName || r.projectName).trim().toLowerCase() === raw)?.projectName || key
          if (!names.some(n => n.toLowerCase() === raw)) names.push(originalStr.trim())
          await supabase.from('payroll_external_projects').update({ workyard_customer_names: names }).eq('id', proj.id)
          proj.workyard_customer_names = names
        }
      } else if (res.action === 'create') {
        const originalStr = preview.find(r => (r.customerName || r.projectName).trim().toLowerCase() === key)?.customerName || preview.find(r => (r.customerName || r.projectName).trim().toLowerCase() === key)?.projectName || key
        const { data: newProj } = await supabase.from('payroll_external_projects').insert({
          name: res.name,
          client_name: res.client_name,
          billed_to: res.billed_to,
          is_active: true,
          workyard_customer_names: [originalStr.trim()],
        }).select('id,name,client_name,billed_to,is_active,workyard_customer_names').single()
        if (newProj) updatedExt.push(newProj)
      }
    }

    setExtProjects(updatedExt)
    // Re-match all rows with updated external projects
    setPreview(prev => {
      const rawRows: WorkyardRow[] = prev.map(r => ({
        workyardId: r.workyardId,
        employeeName: r.employeeName,
        projectName: r.projectName,
        customerName: r.customerName,
        entryDate: r.entryDate,
        regularHours: r.regularHours,
        otHours: r.otHours,
        ptoHours: r.ptoHours,
        timecardId: r.timecardId,
        costCode: r.costCode,
      }))
      return matchRows(rawRows, employees, updatedExt)
    })
    // Mark ignored rows
    setResolutions({})
  }

  const handleImport = async () => {
    if (!selectedWeekId || preview.length === 0) return
    setImporting(true)

    const supabase = createClient()
    let imported = 0, flagged = 0, errors = 0

    for (const row of preview) {
      if (row.status === 'unmatched_employee') { errors++; continue }
      if (row.status === 'unrecognized_project') { errors++; continue }

      try {
        await supabase.from('payroll_time_entries').insert({
          payroll_week_id: selectedWeekId,
          employee_id: row.employeeId!,
          property_id: row.propertyId ?? null,
          entry_date: row.entryDate || format(new Date(), 'yyyy-MM-dd'),
          regular_hours: row.regularHours,
          ot_hours: row.otHours,
          pto_hours: row.ptoHours,
          source: importMode === 'api' ? 'workyard_api' : 'workyard',
          workyard_timecardid: row.timecardId,
          is_flagged: row.status === 'flagged',
          flag_reason: row.flag ?? null,
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
                    {previewStats.unmatched_employee > 0 && <span className="text-[var(--error)]">✕ {previewStats.unmatched_employee} unmatched emp</span>}
                    {previewStats.unrecognized_project > 0 && <span className="text-orange-500">? {previewStats.unrecognized_project} unrecognized proj</span>}
                    <button onClick={resetPreview} className="text-[var(--muted)] hover:text-[var(--ink)] underline">clear</button>
                  </div>
                </div>

                {/* Unrecognized project resolution panel */}
                {unresolvedProjectStrings.length > 0 && (
                  <div className="mb-4 border border-orange-300 bg-orange-50 p-4">
                    <h4 className="text-sm font-medium text-orange-800 mb-3">Unrecognized Projects — resolve before import</h4>
                    <div className="space-y-3">
                      {unresolvedProjectStrings.map(key => {
                        const sampleRow = preview.find(r => r.status === 'unrecognized_project' && (r.customerName || r.projectName).trim().toLowerCase() === key)
                        const displayStr = sampleRow?.customerName || sampleRow?.projectName || key
                        const rowCount = preview.filter(r => r.status === 'unrecognized_project' && (r.customerName || r.projectName).trim().toLowerCase() === key).length
                        const res = resolutions[key]
                        return (
                          <div key={key} className="bg-white border border-orange-200 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className="text-sm font-medium text-[var(--ink)]">&ldquo;{displayStr}&rdquo;</span>
                                <span className="text-xs text-[var(--muted)] ml-2">{rowCount} row{rowCount !== 1 ? 's' : ''}</span>
                              </div>
                              {res && (
                                <button onClick={() => setResolutions(prev => { const n = { ...prev }; delete n[key]; return n })} className="text-xs text-[var(--muted)] hover:text-[var(--ink)] underline">
                                  undo
                                </button>
                              )}
                            </div>
                            {!res ? (
                              <div className="flex items-center gap-2">
                                <FormSelect
                                  className="flex-1 text-xs"
                                  defaultValue=""
                                  onChange={e => {
                                    const v = e.target.value
                                    if (!v) return
                                    if (v.startsWith('prop::')) {
                                      resolveProject(key, { action: 'link_property', propertyId: v.slice(6) })
                                    } else if (v.startsWith('ext::')) {
                                      resolveProject(key, { action: 'link', projectId: v.slice(5) })
                                    }
                                  }}
                                >
                                  <option value="">Assign to…</option>
                                  <optgroup label="Properties">
                                    {propertyList.map(p => (
                                      <option key={p.id} value={`prop::${p.id}`}>{p.code} — {p.name}</option>
                                    ))}
                                  </optgroup>
                                  {extProjects.length > 0 && (
                                    <optgroup label="External Projects">
                                      {extProjects.map(p => (
                                        <option key={p.id} value={`ext::${p.id}`}>{p.name} ({p.client_name})</option>
                                      ))}
                                    </optgroup>
                                  )}
                                </FormSelect>
                                <FormButton
                                  size="sm" variant="secondary"
                                  onClick={() => resolveProject(key, { action: 'create', name: displayStr, client_name: displayStr, billed_to: '' })}
                                >
                                  <Plus size={12} className="mr-1" />New
                                </FormButton>
                                <FormButton
                                  size="sm" variant="ghost"
                                  onClick={() => resolveProject(key, { action: 'ignore' })}
                                >
                                  <Ban size={12} className="mr-1" />Ignore
                                </FormButton>
                              </div>
                            ) : res.action === 'link_property' ? (
                              <p className="text-xs text-[var(--success)]">
                                <Link2 size={11} className="inline mr-1" />
                                Linking to property: {propertyList.find(p => p.id === res.propertyId)?.name ?? 'Unknown'}
                              </p>
                            ) : res.action === 'link' ? (
                              <p className="text-xs text-[var(--success)]">
                                <Link2 size={11} className="inline mr-1" />
                                Linking to project: {extProjects.find(p => p.id === res.projectId)?.name ?? 'Unknown'}
                              </p>
                            ) : res.action === 'create' ? (
                              <div className="space-y-2">
                                <p className="text-xs text-blue-600"><Plus size={11} className="inline mr-1" />Creating new project:</p>
                                <div className="grid grid-cols-3 gap-2">
                                  <FormInput
                                    value={res.name}
                                    onChange={e => resolveProject(key, { ...res, name: e.target.value })}
                                    placeholder="Display Name"
                                    className="text-xs"
                                  />
                                  <FormInput
                                    value={res.client_name}
                                    onChange={e => resolveProject(key, { ...res, client_name: e.target.value })}
                                    placeholder="Client Name"
                                    className="text-xs"
                                  />
                                  <FormInput
                                    value={res.billed_to}
                                    onChange={e => resolveProject(key, { ...res, billed_to: e.target.value })}
                                    placeholder="Billed To"
                                    className="text-xs"
                                  />
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--muted)]"><Ban size={11} className="inline mr-1" />Ignored — rows will be dropped from import</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {!hasUnresolvedProjects && (
                      <FormButton className="mt-3" size="sm" onClick={applyResolutions}>
                        Apply Resolutions & Re-match
                      </FormButton>
                    )}
                  </div>
                )}

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
                        <th className="px-3 py-2 text-left font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-b border-[var(--divider)] ${
                            row.status === 'unmatched_employee' ? 'bg-[var(--error)]/5' :
                            row.status === 'unrecognized_project' ? 'bg-orange-50' :
                            row.status === 'flagged' ? 'bg-[var(--warning)]/5' : ''
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            {row.status === 'ok' && <span className="text-[var(--success)]">✓</span>}
                            {row.status === 'flagged' && <AlertTriangle size={12} className="text-[var(--warning)]" />}
                            {row.status === 'unmatched_employee' && <span className="text-[var(--error)]">✕</span>}
                            {row.status === 'unrecognized_project' && <span className="text-orange-500">?</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <div>{row.employeeName2 ?? <span className="text-[var(--error)]">{row.employeeName}</span>}</div>
                            <div className="text-[var(--muted)] font-mono">{row.workyardId}</div>
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{row.entryDate}</td>
                          <td className="px-3 py-1.5">
                            {row.status === 'unrecognized_project'
                              ? <span className="text-orange-600">{row.customerName || row.projectName}</span>
                              : row.propertyName ?? <span className="text-[var(--muted)]">{row.projectName}</span>
                            }
                          </td>
                          <td className="px-3 py-1.5 text-right">{row.regularHours || '—'}</td>
                          <td className="px-3 py-1.5 text-right">{row.otHours || '—'}</td>
                          <td className="px-3 py-1.5 text-right">{row.ptoHours || '—'}</td>
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
                    disabled={!selectedWeekId || preview.every(r => r.status === 'unmatched_employee' || r.status === 'unrecognized_project') || (previewStats.unrecognized_project > 0)}
                  >
                    Import {preview.filter(r => r.status !== 'unmatched_employee' && r.status !== 'unrecognized_project').length} Rows
                  </FormButton>
                  {previewStats.unrecognized_project > 0 && (
                    <p className="text-xs text-orange-600">
                      Resolve unrecognized projects above before importing
                    </p>
                  )}
                  {previewStats.unmatched_employee > 0 && !previewStats.unrecognized_project && (
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
