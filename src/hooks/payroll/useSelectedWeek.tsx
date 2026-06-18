'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'payroll:selectedWeekId'

interface SelectedWeekContextValue {
  /** The field payroll week the user is currently working in. Persists across navigation. */
  selectedWeekId: string
  setSelectedWeekId: (id: string) => void
  /** True once the persisted value has been read from localStorage (client-only). */
  hydrated: boolean
}

const SelectedWeekContext = createContext<SelectedWeekContextValue | null>(null)

/**
 * Holds the "week I'm working in" for the field payroll flow so it survives
 * navigation between pages (timesheets, mileage, adjustments, splits, import).
 * The selection is persisted to localStorage; a `?week=` URL param still wins
 * as a one-shot override on the page that reads it.
 *
 * Remote payroll runs on a separate pay group and keeps its own week state.
 */
export function SelectedWeekProvider({ children }: { children: React.ReactNode }) {
  const [selectedWeekId, setStored] = useState('')
  const [hydrated, setHydrated] = useState(false)

  // Read the persisted selection after mount to avoid an SSR hydration mismatch.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved) setStored(saved)
    } catch {
      /* localStorage unavailable — fall back to in-memory only */
    }
    setHydrated(true)
  }, [])

  const setSelectedWeekId = useCallback((id: string) => {
    setStored(id)
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore persistence failures */
    }
  }, [])

  return (
    <SelectedWeekContext.Provider value={{ selectedWeekId, setSelectedWeekId, hydrated }}>
      {children}
    </SelectedWeekContext.Provider>
  )
}

export function useSelectedWeek() {
  const ctx = useContext(SelectedWeekContext)
  if (!ctx) throw new Error('useSelectedWeek must be used within a SelectedWeekProvider')
  return ctx
}
