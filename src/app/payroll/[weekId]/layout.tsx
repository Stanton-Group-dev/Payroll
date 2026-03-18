'use client'

import { use, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, ClipboardList, SlidersHorizontal, GitBranch, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { WeekStatus } from '@/lib/supabase/types'
import { statusOrder } from '@/lib/payroll/stepRouting'

interface WeekTab {
  href: string
  label: string
  /** Minimum status required for this tab to be clickable */
  minStatus: WeekStatus | null
  /** Label shown in tooltip when locked */
  previousStep?: string
}

const weekTabs: WeekTab[] = [
  { href: 'review', label: 'Payroll Review', minStatus: null },
  { href: 'invoices', label: 'Invoices', minStatus: 'payroll_approved', previousStep: 'Approve Payroll' },
  { href: 'statement', label: 'Statement', minStatus: 'invoiced', previousStep: 'Invoices' },
  { href: 'adp-export', label: 'ADP Export', minStatus: 'statement_sent', previousStep: 'Statement' },
  { href: 'adp-reconciliation', label: 'ADP Reconciliation', minStatus: 'statement_sent', previousStep: 'Statement' },
]

/** Status values that count as "at or past" a given minimum */
function isStatusAtLeast(current: WeekStatus, minimum: WeekStatus): boolean {
  return (statusOrder[current] ?? 0) >= (statusOrder[minimum] ?? 0)
}

/** Is this tab's step already completed (behind the current status)? */
function isTabCompleted(tabMinStatus: WeekStatus | null, current: WeekStatus): boolean {
  if (!tabMinStatus) return statusOrder[current] >= statusOrder['corrections_complete']
  return (statusOrder[current] ?? 0) > (statusOrder[tabMinStatus] ?? 0)
}

export default function WeekLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ weekId: string }>
}) {
  const { weekId } = use(params)
  const pathname = usePathname()
  const [weekStatus, setWeekStatus] = useState<WeekStatus | null>(null)

  const fetchStatus = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('payroll_weeks')
      .select('status')
      .eq('id', weekId)
      .single()
    if (data) setWeekStatus(data.status as WeekStatus)
  }, [weekId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  return (
    <div className="flex flex-col h-full">
      {/* Week sub-nav */}
      <div className="bg-white border-b border-[var(--divider)] px-6">
        <div className="flex items-center gap-1 -mb-px">
          <Link
            href="/payroll"
            className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors mr-3 py-3"
          >
            <ArrowLeft size={12} />
            Weeks
          </Link>
          {weekTabs.map(tab => {
            const href = `/payroll/${weekId}/${tab.href}`
            const active = pathname === href
            const locked = weekStatus && tab.minStatus
              ? !isStatusAtLeast(weekStatus, tab.minStatus)
              : false
            const completed = weekStatus && !active
              ? isTabCompleted(tab.minStatus, weekStatus)
              : false

            if (locked) {
              return (
                <span
                  key={tab.href}
                  title={`Complete ${tab.previousStep} first`}
                  className="px-3 py-3 text-sm border-b-2 border-transparent text-[var(--muted)]/40 cursor-not-allowed whitespace-nowrap opacity-40"
                >
                  {tab.label}
                </span>
              )
            }

            return (
              <Link
                key={tab.href}
                href={href}
                className={`px-3 py-3 text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  active
                    ? 'border-[var(--primary)] text-[var(--primary)] font-medium'
                    : completed
                      ? 'border-[var(--accent)]/40 text-[var(--muted)] hover:text-[var(--ink)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {completed && <Check size={12} className="text-[var(--accent)] shrink-0" />}
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Week utility bar — quick links to week-scoped global pages */}
      <div className="bg-[var(--bg-section)] border-b border-[var(--divider)] px-6 py-1.5 flex items-center gap-4">
        <span className="text-xs text-[var(--muted)] font-medium uppercase tracking-wide mr-1">This week:</span>
        <Link
          href={`/payroll/corrections?week=${weekId}`}
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
        >
          <ClipboardList size={11} />
          Corrections
        </Link>
        <Link
          href={`/payroll/adjustments?week=${weekId}`}
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
        >
          <SlidersHorizontal size={11} />
          Adjustments
        </Link>
        <Link
          href={`/payroll/splits?week=${weekId}`}
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
        >
          <GitBranch size={11} />
          Dept Splits
        </Link>
      </div>

      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
