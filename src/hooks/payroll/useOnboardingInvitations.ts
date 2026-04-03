'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export type OnboardingInvitationStatus = 'pending' | 'completed' | 'expired'

export interface OnboardingInvitation {
  id: string
  email: string
  full_name: string | null
  employee_type: 'hourly' | 'salaried' | 'contractor'
  token: string
  expires_at: string
  completed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export function useOnboardingInvitations() {
  const [invitations, setInvitations] = useState<OnboardingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: err } = await supabase
        .from('payroll_onboarding_invitations')
        .select('*')
        .order('created_at', { ascending: false })
      if (err) throw err
      setInvitations(data ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load invitations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createInvitation = useCallback(async (
    email: string,
    fullName: string | null,
    employeeType: 'hourly' | 'salaried' | 'contractor',
    startDate?: string | null,
  ) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Generate a secure token
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const token = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const { data, error: err } = await supabase
      .from('payroll_onboarding_invitations')
      .insert({
        email: email.trim(),
        full_name: fullName?.trim() || null,
        employee_type: employeeType,
        token,
        expires_at: expiresAt.toISOString(),
        created_by: user?.id ?? null,
      })
      .select()
      .single()

    if (err) throw err
    await load()
    return data as OnboardingInvitation
  }, [load])

  const extendInvitation = useCallback(async (id: string) => {
    const supabase = createClient()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)
    const { error: err } = await supabase
      .from('payroll_onboarding_invitations')
      .update({ expires_at: expiresAt.toISOString(), completed_at: null })
      .eq('id', id)
    if (err) throw err
    await load()
  }, [load])

  const getOnboardingUrl = (token: string) => {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    return `${base}/onboarding/${token}`
  }

  return { invitations, loading, error, createInvitation, extendInvitation, getOnboardingUrl, refetch: load }
}
