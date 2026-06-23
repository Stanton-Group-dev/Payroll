'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, ClipboardList, SlidersHorizontal, GitBranch } from 'lucide-react'
import { useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'

const weekTabs = [
  { href: 'review', label: 'Payroll Review' },
  { href: 'invoices', label: 'Invoices' },
  { href: 'statement', label: 'Statement' },
  { href: 'adp-export', label: 'ADP Export' },
  { href: 'adp-reconciliation', label: 'ADP Reconciliation' },
]

export default function WeekLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ weekId: string }>
}) {
  const { weekId } = use(params)
  const pathname = usePathname()
  const { setSelectedWeekId } = useSelectedWeek()

  // Keep the sidebar's "selected week" in sync with the week being viewed so the
  // close-out pipeline links (Review → ADP Reconciliation) point at this week.
  useEffect(() => {
    if (weekId) setSelectedWeekId(weekId)
  }, [weekId, setSelectedWeekId])

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
            return (
              <Link
                key={tab.href}
                href={href}
                className={`px-3 py-3 text-sm border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[var(--primary)] text-[var(--primary)] font-medium'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
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
