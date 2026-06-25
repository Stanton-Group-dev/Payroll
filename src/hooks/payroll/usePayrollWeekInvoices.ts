'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  isNonBillableProperty,
  curatedToProperty,
  CURATED_PROPERTY_COLUMNS,
  type CuratedPropertyRow,
} from '@/lib/payroll/properties'
import type { PayrollWeek, Property } from '@/lib/supabase/types'

export interface PropertyCost {
  property_id: string
  property_code: string
  property_name: string
  total_units: number
  labor_cost: number
  spread_cost: number
  expense_cost: number
  mgmt_fee: number
  total_cost: number
  portfolio_id: string | null
  billing_llc: string | null
  portfolio_owner_llc: string | null
}

interface WeeklyCostRow {
  property_id: string
  labor_cost: number | null
  spread_cost: number | null
  expense_cost: number | null
  total_cost: number
}

export function usePayrollWeekInvoices(weekId: string) {
  const [week, setWeek] = useState<PayrollWeek | null>(null)
  const [propertyCosts, setPropertyCosts] = useState<PropertyCost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Property attributes (owner LLC, include flag, name, units) come from the curated
    // payroll_property overlay — never the AppFolio-synced `properties` table — so corrections
    // survive re-imports. Costs still key on the shared property_id (= properties.id).
    const [weekRes, costsRes, propsRes, portRes] = await Promise.all([
      supabase.from('payroll_weeks').select('*').eq('id', weekId).single(),
      supabase.from('payroll_weekly_property_costs')
        .select('property_id, labor_cost, spread_cost, expense_cost, total_cost')
        .eq('payroll_week_id', weekId),
      supabase.from('payroll_property').select(CURATED_PROPERTY_COLUMNS),
      supabase.from('portfolios').select('id, include_in_invoicing'),
    ])
    if (weekRes.error) { setError(weekRes.error.message); setLoading(false); return }
    setWeek(weekRes.data)

    const curatedById = new Map<string, Property>()
    for (const row of (propsRes.data ?? [])) {
      const p = curatedToProperty(row as unknown as CuratedPropertyRow)
      curatedById.set(p.id, p)
    }
    // Whole portfolios turned off in Invoicing settings (absence of flag = included).
    const excludedPortfolios = new Set(
      (portRes.data ?? [])
        .filter((p: { include_in_invoicing?: boolean }) => p.include_in_invoicing === false)
        .map((p: { id: string }) => p.id),
    )

    const costs: PropertyCost[] = []
    for (const row of (costsRes.data ?? [])) {
      const typedRow = row as unknown as WeeklyCostRow
      const prop = curatedById.get(typedRow.property_id)
      if (!prop) continue
      // Never bill delete-marked / test-placeholder rows, nor properties (or whole
      // portfolios) turned off in Invoicing settings. The curated overlay's include flag
      // is AppFolio-proof, so these stay off for good.
      if (isNonBillableProperty(prop)) continue
      if (prop.include_in_invoicing === false) continue
      if (prop.portfolio_id != null && excludedPortfolios.has(prop.portfolio_id)) continue
      const labor = typedRow.labor_cost ?? 0
      const spread = typedRow.spread_cost ?? 0
      const expense = typedRow.expense_cost ?? 0
      // What's left after labor/spread/expense is mileage + mgmt fee. Mileage isn't stored
      // separately, so it stays bundled in this remainder (unchanged behavior); expenses are
      // now broken out on their own line.
      const mgmt_fee = typedRow.total_cost - labor - spread - expense
      costs.push({
        property_id: prop.id,
        property_code: prop.code,
        property_name: prop.name,
        total_units: prop.total_units ?? 0,
        labor_cost: labor,
        spread_cost: spread,
        expense_cost: expense,
        mgmt_fee: Math.max(0, mgmt_fee),
        total_cost: typedRow.total_cost,
        portfolio_id: prop.portfolio_id,
        // owner_llc already resolves billing_llc-or-portfolio-owner at seed time, so it is
        // the single owner key here; the portfolio_owner_llc fallback is no longer needed.
        billing_llc: prop.billing_llc ?? null,
        portfolio_owner_llc: null,
      })
    }
    setPropertyCosts(costs)
    setLoading(false)
  }, [weekId])

  useEffect(() => { load() }, [load])

  const generateInvoices = useCallback(async (refetchInvoices: () => Promise<void>) => {
    setGenerating(true)
    const supabase = createClient()

    const groups: Record<string, PropertyCost[]> = {}
    for (const pc of propertyCosts) {
      const llcName = pc.billing_llc ?? pc.portfolio_owner_llc ?? `Park — ${pc.property_code}`
      if (!groups[llcName]) groups[llcName] = []
      groups[llcName].push(pc)
    }

    for (const [llc, props] of Object.entries(groups)) {
      if (props.length === 0) continue
      const total = props.reduce((s, p) => s + p.total_cost, 0)
      if (total === 0) continue

      const { data: existing } = await supabase
        .from('payroll_invoices')
        .select('id')
        .eq('payroll_week_id', weekId)
        .eq('owner_llc', llc)
        .single()

      let invoiceId: string
      if (existing) {
        invoiceId = existing.id
      } else {
        const { data: inv, error: invErr } = await supabase.from('payroll_invoices').insert({
          payroll_week_id: weekId,
          owner_llc: llc,
          status: 'draft',
          total_amount: total,
        }).select().single()
        if (invErr || !inv) continue
        invoiceId = inv.id
      }

      for (const pc of props) {
        const { error: lineErr } = await supabase.from('payroll_invoice_line_items').upsert({
          invoice_id: invoiceId,
          property_id: pc.property_id,
          description: `${pc.property_code} — ${pc.property_name}`,
          cost_type: 'labor',
          labor_amount: pc.labor_cost,
          spread_amount: pc.spread_cost,
          expense_amount: pc.expense_cost,
          mgmt_fee_amount: pc.mgmt_fee,
          total_amount: pc.total_cost,
        })
        if (lineErr) continue
      }
    }

    const { error: weekUpdateErr } = await supabase.from('payroll_weeks').update({ status: 'invoiced' }).eq('id', weekId)
    if (weekUpdateErr) { setError(weekUpdateErr.message); setGenerating(false); return }
    await refetchInvoices()
    setGenerating(false)
  }, [weekId, propertyCosts])

  const approveAll = useCallback(async (
    invoiceIds: string[],
    approveInvoice: (id: string) => Promise<void>,
  ) => {
    setApprovingAll(true)
    for (const id of invoiceIds) {
      await approveInvoice(id)
    }
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id
    const { error: approvalErr } = await supabase.from('payroll_approvals').insert({
      payroll_week_id: weekId,
      stage: 'invoice',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    if (approvalErr) { setError(approvalErr.message); setApprovingAll(false); return }
    setApprovingAll(false)
  }, [weekId])

  return {
    week, propertyCosts, loading, error, generating, approvingAll,
    generateInvoices, approveAll, refetch: load,
  }
}
