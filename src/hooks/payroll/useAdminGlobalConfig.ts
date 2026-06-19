'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PayrollGlobalConfig } from '@/lib/supabase/types'

export interface PropertyWithApprover {
  id: string
  code: string
  name: string
  portfolio_id: string | null
  portfolio_name: string | null
  approver_user_id: string | null
  approver_name: string | null
}

export interface UserOption {
  id: string
  email: string
  full_name: string | null
  role: string
}

export function useAdminGlobalConfig() {
  const [config, setConfig] = useState<PayrollGlobalConfig | null>(null)
  const [properties, setProperties] = useState<PropertyWithApprover[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const [configRes, propsRes, usersRes] = await Promise.all([
      supabase
        .from('payroll_global_config')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('properties')
        .select('id, code, name, portfolio_id, approver_user_id')
        .eq('is_active', true)
        .order('code'),
      supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .in('role', ['admin', 'manager'])
        .order('full_name'),
    ])

    if (configRes.error) setError(configRes.error.message)
    setConfig(configRes.data ?? null)

    // Fetch portfolio names
    const portfolioIds = Array.from(new Set((propsRes.data ?? []).map((p: { portfolio_id: string | null }) => p.portfolio_id).filter(Boolean)))
    let portfolioMap: Record<string, string> = {}
    if (portfolioIds.length > 0) {
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id, name')
        .in('id', portfolioIds as string[])
      portfolioMap = Object.fromEntries((portfolios ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
    }

    // Build user map for approver names
    const userList = (usersRes.data ?? []) as { id: string; email: string; full_name: string | null; role: string }[]
    const userMap = Object.fromEntries(userList.map(u => [u.id, u.full_name ?? u.email]))
    setUsers(userList.map(u => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role })))

    setProperties(
      (propsRes.data ?? []).map((p: { id: string; code: string; name: string; portfolio_id: string | null; approver_user_id: string | null }) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        portfolio_id: p.portfolio_id,
        portfolio_name: p.portfolio_id ? (portfolioMap[p.portfolio_id] ?? null) : null,
        approver_user_id: p.approver_user_id,
        approver_name: p.approver_user_id ? (userMap[p.approver_user_id] ?? null) : null,
      }))
    )

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveCutoff = useCallback(async (cutoffDay: number, cutoffTime: string) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    if (config) {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .update({ expense_cutoff_day: cutoffDay, expense_cutoff_time: cutoffTime, created_by: userId })
        .eq('id', config.id)
      if (err) throw new Error(err.message)
    } else {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .insert({ expense_cutoff_day: cutoffDay, expense_cutoff_time: cutoffTime, created_by: userId })
      if (err) throw new Error(err.message)
    }
    await load()
  }, [config, load])

  const savePrefundToggle = useCallback(async (prefundIncludesMgmtFee: boolean) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    if (config) {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .update({ prefund_includes_mgmt_fee: prefundIncludesMgmtFee, created_by: userId })
        .eq('id', config.id)
      if (err) throw new Error(err.message)
    } else {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .insert({ prefund_includes_mgmt_fee: prefundIncludesMgmtFee, created_by: userId })
      if (err) throw new Error(err.message)
    }
    await load()
  }, [config, load])

  const saveRateSettings = useCallback(async (rates: {
    payrollTaxRate: number
    workersCompRate: number
    phoneAmount: number
    otThresholdHours: number
  }) => {
    const supabase = createClient()
    const userId = (await supabase.auth.getUser()).data.user?.id ?? ''
    const patch = {
      payroll_tax_rate: rates.payrollTaxRate,
      workers_comp_rate: rates.workersCompRate,
      phone_reimbursement_amount: rates.phoneAmount,
      ot_threshold_hours: rates.otThresholdHours,
      created_by: userId,
    }
    if (config) {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .update(patch)
        .eq('id', config.id)
      if (err) throw new Error(err.message)
    } else {
      const { error: err } = await supabase
        .from('payroll_global_config')
        .insert(patch)
      if (err) throw new Error(err.message)
    }
    await load()
  }, [config, load])

  const setPropertyApprover = useCallback(async (propertyId: string, userId: string | null) => {
    const supabase = createClient()
    const { error: err } = await supabase
      .from('properties')
      .update({ approver_user_id: userId ?? null })
      .eq('id', propertyId)
    if (err) throw new Error(err.message)
    await load()
  }, [load])

  return { config, properties, users, loading, error, refetch: load, saveCutoff, savePrefundToggle, saveRateSettings, setPropertyApprover }
}
