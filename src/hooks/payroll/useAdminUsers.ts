'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/hooks/payroll/useAuth'

export interface UserRow {
  id: string
  email: string | null
  full_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  portfolio_ids: string[]
  portfolio_names: string[]
}

export interface PortfolioOption {
  id: string
  name: string
}

/** POST an admin action to the server route (service-role gated, admin-only). */
async function adminAction(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? `Request failed (${res.status})`)
  }
}

export function useAdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [profilesRes, portfolioRes] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, role, is_active, created_at').order('full_name'),
      supabase.from('portfolios').select('id, name').eq('is_active', true).order('name'),
    ])
    if (profilesRes.error) { setError(profilesRes.error.message); setLoading(false); return }

    const allPortfolios = portfolioRes.data ?? []
    setPortfolios(allPortfolios)

    const { data: puData } = await supabase.from('portfolio_users').select('user_id, portfolio_id')
    const puMap: Record<string, string[]> = {}
    for (const pu of (puData ?? [])) {
      if (!puMap[pu.user_id]) puMap[pu.user_id] = []
      puMap[pu.user_id].push(pu.portfolio_id)
    }
    const portMap: Record<string, string> = {}
    for (const p of allPortfolios) portMap[p.id] = p.name

    setUsers((profilesRes.data ?? []).map(p => {
      const ids = puMap[p.id] ?? []
      return {
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        role: (p.role as UserRole) ?? 'manager',
        is_active: p.is_active ?? true,
        created_at: p.created_at,
        portfolio_ids: ids,
        portfolio_names: ids.map(pid => portMap[pid] ?? pid).filter(Boolean),
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const inviteUser = useCallback(async (email: string, fullName: string, role: UserRole, portfolioIds: string[] = []) => {
    await adminAction({ action: 'invite', email: email.trim(), fullName, role, portfolioIds })
    await load()
  }, [load])

  const updateUser = useCallback(async (userId: string, fullName: string, role: UserRole, portfolioIds: string[] = []) => {
    await adminAction({ action: 'update', userId, fullName, role, portfolioIds })
    await load()
  }, [load])

  const deactivateUser = useCallback(async (userId: string) => {
    await adminAction({ action: 'setActive', userId, isActive: false })
    await load()
  }, [load])

  const reactivateUser = useCallback(async (userId: string) => {
    await adminAction({ action: 'setActive', userId, isActive: true })
    await load()
  }, [load])

  const resetPassword = useCallback(async (email: string) => {
    await adminAction({ action: 'resetPassword', email: email.trim() })
  }, [])

  const resendInvite = useCallback(async (email: string, fullName: string) => {
    await adminAction({ action: 'resendInvite', email: email.trim(), fullName })
  }, [])

  const deleteUser = useCallback(async (userId: string) => {
    await adminAction({ action: 'delete', userId })
    await load()
  }, [load])

  return {
    users, portfolios, loading, error,
    inviteUser, updateUser, deactivateUser, reactivateUser,
    resetPassword, resendInvite, deleteUser,
    refetch: load,
  }
}
