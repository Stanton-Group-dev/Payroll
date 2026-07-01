'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/supabase/fetchAll'
import type { PayrollTimeEntry, PayrollTimesheetCorrection } from '@/lib/supabase/types'
import { assertWeekWritable } from '@/lib/payroll/weekLock'

export interface SplitTarget {
  propertyId: string
  hours: number
}

export interface SpreadConfig {
  propertyIds: string[]
  totalHours: number
  portfolioId?: string
}

export interface AdjustmentLogEntry extends PayrollTimesheetCorrection {
  time_entry?: {
    id: string
    entry_date: string
    regular_hours: number
    ot_hours: number
    employee_id: string
    employee: { name: string } | null
    from_property: { code: string; name: string } | null
  }
  to_property?: { code: string; name: string } | null
  corrector?: { email: string; full_name: string | null } | null
}

export function useTimesheetAdjustments(weekId: string | null) {
  const [allEntries, setAllEntries] = useState<PayrollTimeEntry[]>([])
  const [corrections, setCorrections] = useState<AdjustmentLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    if (!weekId) { setAllEntries([]); return }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await fetchAllRows((from, to) => supabase
      .from('payroll_time_entries')
      .select(`
        *,
        employee:payroll_employees(id, name, workyard_id, type, hourly_rate, weekly_rate),
        property:properties(id, code, name, total_units, portfolio_id)
      `)
      .eq('payroll_week_id', weekId)
      .eq('is_active', true)
      .order('entry_date')
      .order('id')
      .range(from, to))
    if (err) setError(err.message)
    else setAllEntries(data ?? [])
    setLoading(false)
  }, [weekId])

  const fetchCorrections = useCallback(async () => {
    if (!weekId) { setCorrections([]); return }
    const supabase = createClient()
    // Scope to the selected week through the corrected entry (!inner makes the
    // filter bite) — a bulk audit can log 1,000+ correction rows, so page too.
    const { data } = await fetchAllRows((from, to) => supabase
      .from('payroll_timesheet_corrections')
      .select(`
        *,
        time_entry:payroll_time_entries!inner(
          id, entry_date, regular_hours, ot_hours, employee_id, payroll_week_id,
          employee:payroll_employees(name),
          from_property:properties!payroll_time_entries_property_id_fkey(code, name)
        ),
        to_property:properties!payroll_timesheet_corrections_to_property_id_fkey(code, name),
        corrector:profiles!payroll_timesheet_corrections_corrected_by_fkey(email, full_name)
      `)
      .eq('time_entry.payroll_week_id', weekId)
      .order('corrected_at', { ascending: false })
      .order('id')
      .range(from, to))
    setCorrections(data ?? [])
  }, [weekId])

  const refetch = useCallback(async () => {
    await Promise.all([fetchEntries(), fetchCorrections()])
  }, [fetchEntries, fetchCorrections])

  useEffect(() => { refetch() }, [refetch])

  // Derived: unallocated = active *work* entries with no property_id. A pure PTO
  // entry legitimately has no property and must not count as needing allocation
  // (it would otherwise block timesheet approval and inflate the unresolved count).
  const unallocatedEntries = allEntries.filter(e => !e.property_id && (e.regular_hours + e.ot_hours) > 0)

  // Derived: pending entries
  const pendingEntries = allEntries.filter(e => e.pending_resolution)

  // ── Operations ────────────────────────────────────────────────────────────

  const reassign = useCallback(async (
    entryIds: string[],
    splits: SplitTarget[],
    reason: string
  ) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    // An unallocated cell can hold several same-day entries for one employee;
    // the whole block is reassigned together. (Allocated edits pass one id.)
    const entries = entryIds
      .map(id => allEntries.find(e => e.id === id))
      .filter((e): e is PayrollTimeEntry => Boolean(e))
    if (entries.length === 0) throw new Error('Entry not found')
    const first = entries[0]
    await assertWeekWritable(supabase, first.payroll_week_id)

    const totalSplit = splits.reduce((s, t) => s + t.hours, 0)
    const blockTotal = parseFloat(
      entries.reduce((s, e) => s + e.regular_hours + e.ot_hours, 0).toFixed(2)
    )
    if (Math.abs(totalSplit - blockTotal) > 0.01) {
      throw new Error(`Split hours (${totalSplit}) must equal entry total (${blockTotal})`)
    }

    const isSplit = splits.length > 1
    const operation = isSplit ? 'split' : 'reassign'

    if (isSplit) {
      // Deactivate every source entry in the block
      const { error: deactErr } = await supabase
        .from('payroll_time_entries')
        .update({ is_active: false })
        .in('id', entryIds)
      if (deactErr) throw new Error(deactErr.message)

      // Create one new entry per split target
      const newEntries = splits.map(t => ({
        payroll_week_id: first.payroll_week_id,
        employee_id: first.employee_id,
        property_id: t.propertyId,
        entry_date: first.entry_date,
        regular_hours: t.hours,
        ot_hours: 0,
        pto_hours: 0,
        source: 'workyard_corrected' as const,
        is_flagged: false,
        is_active: true,
      }))
      const { data: inserted, error: insErr } = await supabase
        .from('payroll_time_entries')
        .insert(newEntries)
        .select('id')
      if (insErr) throw new Error(insErr.message)

      // Write correction records for each split leg
      const corrRows = (inserted ?? []).map((row, i) => ({
        time_entry_id: row.id,
        from_property_id: first.property_id,
        to_property_id: splits[i].propertyId,
        hours: splits[i].hours,
        reason,
        operation,
        corrected_by: userId,
        corrected_at: new Date().toISOString(),
      }))
      const { error: corrSplitErr } = await supabase.from('payroll_timesheet_corrections').insert(corrRows)
      if (corrSplitErr) console.error('payroll_timesheet_corrections insert (split)', corrSplitErr)
    } else {
      // Simple reassign — move every source entry in the block to the property,
      // preserving each entry's own regular/OT hours.
      const { error: updErr } = await supabase
        .from('payroll_time_entries')
        .update({
          property_id: splits[0].propertyId,
          source: 'workyard_corrected',
          is_flagged: false,
          pending_resolution: false,
          pending_note: null,
          pending_since: null,
        })
        .in('id', entryIds)
      if (updErr) throw new Error(updErr.message)

      // One correction row per moved entry, carrying that entry's own hours.
      const corrRows = entries.map(e => ({
        time_entry_id: e.id,
        from_property_id: e.property_id,
        to_property_id: splits[0].propertyId,
        hours: e.regular_hours + e.ot_hours,
        reason,
        operation,
        corrected_by: userId,
        corrected_at: new Date().toISOString(),
      }))
      const { error: corrReassignErr } = await supabase.from('payroll_timesheet_corrections').insert(corrRows)
      if (corrReassignErr) console.error('payroll_timesheet_corrections insert (reassign)', corrReassignErr)
    }

    await refetch()
  }, [allEntries, refetch])

  const addEntry = useCallback(async (params: {
    employeeId: string
    date: string
    hours: number
    propertyId: string
    reason: string
    payType?: 'regular' | 'overtime' | 'pto'
  }) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    await assertWeekWritable(supabase, weekId)
    const pt = params.payType ?? 'regular'
    const { error: err } = await supabase.from('payroll_time_entries').insert({
      payroll_week_id: weekId,
      employee_id: params.employeeId,
      property_id: params.propertyId,
      entry_date: params.date,
      regular_hours: pt === 'regular' ? params.hours : 0,
      ot_hours: pt === 'overtime' ? params.hours : 0,
      pto_hours: pt === 'pto' ? params.hours : 0,
      source: 'manual_manager',
      is_flagged: false,
      is_active: true,
      created_by: userId,
    })
    if (err) throw new Error(err.message)
    // time entry with source='manual_manager' is its own audit record
    await refetch()
  }, [weekId, refetch])

  const spread = useCallback(async (params: {
    employeeId: string
    date: string
    totalHours: number
    propertyIds: string[]
    portfolioId?: string
    reason: string
    sourceEntryIds?: string[]
  }) => {
    if (params.propertyIds.length === 0) throw new Error('Select at least one property')
    if (params.totalHours <= 0) throw new Error('Hours to spread must be greater than 0')
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    await assertWeekWritable(supabase, weekId)

    // Distribute hours so the per-property legs sum *exactly* to totalHours.
    // Each leg is rounded to the cent; the final leg absorbs any rounding remainder
    // so we never silently drop (or invent) fractions of an hour.
    const n = params.propertyIds.length
    const hoursPer: number[] = []
    let running = 0
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        hoursPer.push(parseFloat((params.totalHours - running).toFixed(2)))
      } else {
        const h = Math.round((params.totalHours / n) * 100) / 100
        hoursPer.push(h)
        running += h
      }
    }

    // Create spread event parent
    const { data: spreadEvent, error: seErr } = await supabase
      .from('payroll_spread_events')
      .insert({
        payroll_week_id: weekId,
        employee_id: params.employeeId,
        entry_date: params.date,
        total_hours: params.totalHours,
        portfolio_id: params.portfolioId ?? null,
        reason: params.reason,
        created_by: userId,
      })
      .select('id')
      .single()
    if (seErr) throw new Error(seErr.message)

    // Create one entry per property
    const entries = params.propertyIds.map((pid, i) => ({
      payroll_week_id: weekId,
      employee_id: params.employeeId,
      property_id: pid,
      entry_date: params.date,
      regular_hours: hoursPer[i],
      ot_hours: 0,
      pto_hours: 0,
      source: 'manual_spread' as const,
      is_flagged: false,
      is_active: true,
      spread_event_id: spreadEvent.id,
      created_by: userId,
    }))
    const { error: entErr } = await supabase.from('payroll_time_entries').insert(entries)
    if (entErr) throw new Error(entErr.message)

    // Reconcile the source unallocated entries. We absorb `totalHours` across the
    // whole block in order: each fully-spread entry is deactivated, and the entry
    // that straddles the boundary is shrunk to the leftover so any remainder
    // stays visible as unallocated. (Previously only the first entry was touched,
    // leaving the rest of a multi-entry block stranded as unallocated.)
    if (params.sourceEntryIds?.length) {
      const sources = params.sourceEntryIds
        .map(id => allEntries.find(e => e.id === id))
        .filter((e): e is PayrollTimeEntry => Boolean(e))
      let toAbsorb = params.totalHours
      for (const src of sources) {
        if (toAbsorb <= 0.01) break
        const srcTotal = (src.regular_hours ?? 0) + (src.ot_hours ?? 0)
        if (srcTotal <= toAbsorb + 0.01) {
          const { error: srcDeactErr } = await supabase.from('payroll_time_entries')
            .update({ is_active: false })
            .eq('id', src.id)
          if (srcDeactErr) throw new Error(srcDeactErr.message)
          toAbsorb = parseFloat((toAbsorb - srcTotal).toFixed(2))
        } else {
          const remainder = parseFloat((srcTotal - toAbsorb).toFixed(2))
          const { error: srcPartialErr } = await supabase.from('payroll_time_entries')
            .update({ regular_hours: remainder, ot_hours: 0 })
            .eq('id', src.id)
          if (srcPartialErr) throw new Error(srcPartialErr.message)
          toAbsorb = 0
        }
      }
    }

    await refetch()
  }, [weekId, refetch, allEntries])

  const removeEntry = useCallback(async (entryId: string, reason: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const entry = allEntries.find(e => e.id === entryId)
    await assertWeekWritable(supabase, entry?.payroll_week_id)

    const { error: err } = await supabase
      .from('payroll_time_entries')
      .update({ is_active: false })
      .eq('id', entryId)
    if (err) throw new Error(err.message)

    // Only write correction record if there is a property to reference
    if (entry?.property_id) {
      const { error: corrRemoveErr } = await supabase.from('payroll_timesheet_corrections').insert({
        time_entry_id: entryId,
        from_property_id: entry.property_id,
        to_property_id: entry.property_id,
        hours: (entry.regular_hours ?? 0) + (entry.ot_hours ?? 0),
        reason,
        operation: 'remove',
        corrected_by: userId,
        corrected_at: new Date().toISOString(),
      })
      if (corrRemoveErr) console.error('payroll_timesheet_corrections insert (remove)', corrRemoveErr)
    }

    await refetch()
  }, [allEntries, refetch])

  const reduceHours = useCallback(async (entryId: string, hoursToRemove: number, reason: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const entry = allEntries.find(e => e.id === entryId)
    if (!entry) throw new Error('Entry not found')

    const worked = (entry.regular_hours ?? 0) + (entry.ot_hours ?? 0)
    if (!(hoursToRemove > 0)) throw new Error('Enter a number of hours to remove (> 0)')
    if (hoursToRemove >= worked - 0.001) {
      throw new Error(`Removing ${hoursToRemove}h would empty the ${worked}h entry — use Remove for the whole entry`)
    }

    // Keep the remaining hours as regular and let the pay engine recompute OT from
    // the weekly total (same convention as Split/Spread, which carry ot_hours: 0).
    const remaining = parseFloat((worked - hoursToRemove).toFixed(2))
    const { error: updErr } = await supabase
      .from('payroll_time_entries')
      .update({ regular_hours: remaining, ot_hours: 0 })
      .eq('id', entryId)
    if (updErr) throw new Error(updErr.message)

    // Audit row records the hours removed. Skip if the entry has no property to
    // reference (corrections.to_property_id is non-null); mirrors removeEntry.
    if (entry.property_id) {
      const { error: corrReduceErr } = await supabase.from('payroll_timesheet_corrections').insert({
        time_entry_id: entryId,
        from_property_id: entry.property_id,
        to_property_id: entry.property_id,
        hours: hoursToRemove,
        reason,
        operation: 'reduce',
        corrected_by: userId,
        corrected_at: new Date().toISOString(),
      })
      if (corrReduceErr) console.error('payroll_timesheet_corrections insert (reduce)', corrReduceErr)
    }

    await refetch()
  }, [allEntries, refetch])

  const setPending = useCallback(async (entryId: string, note: string) => {
    const supabase = createClient()
    const entry = allEntries.find(e => e.id === entryId)
    await assertWeekWritable(supabase, entry?.payroll_week_id)
    const { error: err } = await supabase
      .from('payroll_time_entries')
      .update({
        pending_resolution: true,
        pending_note: note || null,
        pending_since: new Date().toISOString(),
      })
      .eq('id', entryId)
    if (err) throw new Error(err.message)
    await fetchEntries()
  }, [allEntries, fetchEntries])

  const resolvePending = useCallback(async (entryId: string) => {
    const supabase = createClient()
    const entry = allEntries.find(e => e.id === entryId)
    await assertWeekWritable(supabase, entry?.payroll_week_id)
    const { error: err } = await supabase
      .from('payroll_time_entries')
      .update({ pending_resolution: false, pending_note: null, pending_since: null })
      .eq('id', entryId)
    if (err) throw new Error(err.message)
    await fetchEntries()
  }, [allEntries, fetchEntries])

  const addCarryForward = useCallback(async (params: {
    employeeId: string
    priorWeekId: string
    amount: number
    description: string
    propertyId?: string
  }) => {
    if (!weekId) return
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    const { error: err } = await supabase.from('payroll_adjustments').insert({
      payroll_week_id: weekId,
      employee_id: params.employeeId,
      type: 'advance',
      amount: params.amount,
      description: params.description,
      allocation_method: 'employee_pay',
      prior_week_id: params.priorWeekId,
      created_by: userId,
    })
    if (err) throw new Error(err.message)
  }, [weekId])

  return {
    allEntries,
    unallocatedEntries,
    pendingEntries,
    corrections,
    loading,
    error,
    refetch,
    reassign,
    addEntry,
    spread,
    removeEntry,
    reduceHours,
    setPending,
    resolvePending,
    addCarryForward,
  }
}
