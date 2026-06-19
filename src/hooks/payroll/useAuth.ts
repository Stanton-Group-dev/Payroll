'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export type UserRole = 'superadmin' | 'admin' | 'manager' | 'bookkeeper' | 'analyst' | 'worker'

export interface AuthProfile {
  id: string
  email: string | null
  full_name: string | null
  role: UserRole | null
  is_active: boolean
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AuthProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let supabase
    try {
      supabase = createClient()
    } catch (error) {
      console.error('Supabase client initialization failed:', error)
      setUser(null)
      setProfile(null)
      setLoading(false)
      return
    }

    const loadProfile = async (u: User) => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('id', u.id)
        .maybeSingle()
      if (data) {
        setProfile({
          id: data.id,
          email: data.email ?? u.email ?? null,
          full_name: data.full_name,
          // Fail closed: a profile row with no role grants NO access (was `?? 'manager'`,
          // which combined with the DB fail-open let any session act as a manager).
          role: (data.role as UserRole) ?? null,
          // Fail closed: missing is_active is treated as inactive (was `?? true`).
          is_active: data.is_active ?? false,
        })
      } else {
        // No profile row -> no role, no access (previously synthesized a manager/active profile).
        setProfile(null)
      }
    }

    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u)
      if (u) loadProfile(u).finally(() => setLoading(false))
      else setLoading(false)
    }).catch(() => {
      setUser(null)
      setProfile(null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) loadProfile(u).catch(() => setLoading(false))
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {}
    window.location.href = '/payroll/login'
  }

  // superadmin is the apex role: it implies admin (and therefore manager) too.
  const isSuperAdmin = profile?.role === 'superadmin'
  const isAdmin = isSuperAdmin || profile?.role === 'admin'
  const isManager = isAdmin || profile?.role === 'manager'
  // analyst is a lateral role (remote payroll + bonuses); admins also act as analyst.
  const isAnalyst = isAdmin || profile?.role === 'analyst'

  return { user, profile, loading, signOut, isSuperAdmin, isAdmin, isManager, isAnalyst }
}
