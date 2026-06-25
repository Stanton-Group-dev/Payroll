'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isHiddenProperty, isWestendProperty } from '@/lib/payroll/properties'

export interface PortfolioProperty {
  id: string
  code: string
  name: string
  portfolio_id: string | null
  billing_llc?: string | null
  isWestend?: boolean
}

export interface PortfolioWithProperties {
  id: string
  name: string
  properties: PortfolioProperty[]
}

export function usePortfolios() {
  const [portfolios, setPortfolios] = useState<PortfolioWithProperties[]>([])
  const [allProperties, setAllProperties] = useState<PortfolioProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const [portResult, propResult] = await Promise.all([
      supabase.from('portfolios').select('id, name').eq('is_active', true).order('name'),
      supabase.from('payroll_property').select('id:property_id, code, name, portfolio_id, billing_llc:owner_llc, is_suppressed').eq('is_active', true).order('code'),
    ])

    if (portResult.error) { setError(portResult.error.message); setLoading(false); return }
    if (propResult.error) { setError(propResult.error.message); setLoading(false); return }

    const props: PortfolioProperty[] = (propResult.data ?? [])
      .filter(p => !isHiddenProperty(p))
      .map(p => ({ ...p, isWestend: isWestendProperty(p) }))
    setAllProperties(props)

    const propsByPortfolio = new Map<string, PortfolioProperty[]>()
    for (const p of props) {
      if (!p.portfolio_id) continue
      if (!propsByPortfolio.has(p.portfolio_id)) propsByPortfolio.set(p.portfolio_id, [])
      propsByPortfolio.get(p.portfolio_id)!.push(p)
    }

    const result: PortfolioWithProperties[] = (portResult.data ?? []).map(port => ({
      id: port.id as string,
      name: port.name as string,
      properties: propsByPortfolio.get(port.id as string) ?? [],
    })).filter(p => p.properties.length > 0)

    setPortfolios(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { portfolios, allProperties, loading, error, refetch: load }
}
