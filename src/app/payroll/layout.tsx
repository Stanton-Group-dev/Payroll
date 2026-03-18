'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Users,
  Upload,
  ClipboardEdit,
  DollarSign,
  BarChart2,
  TrendingUp,
  History,
  Settings,
  ChevronRight,
  ChevronDown,
  Building2,
  LogOut,
  UserCircle,
  Target,
  Briefcase,
  SplitSquareVertical,
  Car,
  Receipt,
  Calendar,
  CheckSquare,
  FileText,
  ScrollText,
  FileOutput,
  FileCheck,
  Circle,
} from 'lucide-react'
import { useAuth } from '@/hooks/payroll/useAuth'
import { usePayrollWeeks } from '@/hooks/payroll/usePayrollWeeks'
import { format } from 'date-fns'
import type { LucideIcon } from 'lucide-react'
import { getStepHref } from '@/lib/payroll/stepRouting'

/* ---------- Setup items (do-once, revisit occasionally) ---------- */
const setupItems = [
  { href: '/payroll/employees', label: 'Employees & Rates', icon: Users },
  { href: '/payroll/admin/portfolios', label: 'Portfolios & Properties', icon: Briefcase },
  { href: '/payroll/admin/external-projects', label: 'External Projects', icon: Building2 },
  { href: '/payroll/admin/mgmt-fee', label: 'Management Fee', icon: Settings },
  { href: '/payroll/admin/travel-premiums', label: 'Travel Premiums', icon: Car },
  { href: '/payroll/admin/users', label: 'Users & Roles', icon: Users },
  { href: '/payroll/admin/thresholds', label: 'Budget Thresholds', icon: Target },
]

/* ---------- This Week steps (numbered workflow) ---------- */
interface WeeklyStep {
  step: number
  label: string
  icon: LucideIcon
  /** Static href (steps 1-5) or null (steps 6-10 resolve to active week) */
  href: string | null
  /** Sub-path under /payroll/[weekId]/ for steps 6-10 */
  weekSub?: string
  exact?: boolean
}

const weeklySteps: WeeklyStep[] = [
  { step: 1, label: 'Select / Create Week', icon: Calendar, href: '/payroll', exact: true },
  { step: 2, label: 'Import Time Cards', icon: Upload, href: '/payroll/import' },
  { step: 3, label: 'Adjust Timesheets', icon: ClipboardEdit, href: '/payroll/timesheets' },
  { step: 4, label: 'Adjustments', icon: DollarSign, href: '/payroll/adjustments' },
  { step: 5, label: 'Dept Splits', icon: SplitSquareVertical, href: '/payroll/splits' },
  { step: 6, label: 'Review & Approve', icon: CheckSquare, href: null, weekSub: 'review' },
  { step: 7, label: 'Invoices', icon: FileText, href: null, weekSub: 'invoices' },
  { step: 8, label: 'Statement', icon: ScrollText, href: null, weekSub: 'statement' },
  { step: 9, label: 'ADP Export', icon: FileOutput, href: null, weekSub: 'adp-export' },
  { step: 10, label: 'ADP Reconciliation', icon: FileCheck, href: null, weekSub: 'adp-reconciliation' },
]

/* Map week status → suggested step number */
const statusToStep: Record<string, number> = {
  draft: 2,
  corrections_complete: 6,
  payroll_approved: 7,
  invoiced: 8,
  statement_sent: 9,
}

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  corrections_complete: 'Corrections Done',
  payroll_approved: 'Payroll Approved',
  invoiced: 'Invoiced',
  statement_sent: 'Statement Sent',
}

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { profile, signOut } = useAuth()
  const { weeks } = usePayrollWeeks()
  const [setupOpen, setSetupOpen] = useState(false)

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  // Active week = most recent non-completed week
  const activeWeek = useMemo(
    () => weeks.find(w => w.status !== 'statement_sent'),
    [weeks],
  )
  const activeWeekId = activeWeek?.id
  const currentStep = activeWeek ? (statusToStep[activeWeek.status] ?? 2) : undefined

  // Auto-open Setup section when viewing a setup page
  const viewingSetup = setupItems.some(i => isActive(i.href))
  const isSetupExpanded = setupOpen || viewingSetup

  const navLink = (
    href: string,
    label: string,
    Icon: LucideIcon,
    exact?: boolean,
    prefix?: string,
    isCurrent?: boolean,
    disabled?: boolean,
  ) => {
    const active = isActive(href, exact)
    if (disabled) {
      return (
        <span
          key={href}
          className="flex items-center gap-2.5 px-2 py-1.5 text-sm text-white/25 cursor-not-allowed mb-0.5"
        >
          {prefix && <span className="text-xs font-mono w-4 text-right shrink-0">{prefix}</span>}
          <Icon size={13} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      )
    }
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors duration-200 mb-0.5 ${
          active
            ? 'bg-white/15 text-white font-medium'
            : 'text-white/60 hover:text-white hover:bg-white/8'
        }`}
      >
        {prefix && <span className="text-xs font-mono w-4 text-right shrink-0 opacity-50">{prefix}</span>}
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
        {isCurrent && <Circle size={6} className="ml-auto fill-[var(--accent)] text-[var(--accent)] shrink-0" />}
        {!isCurrent && active && <ChevronRight size={12} className="ml-auto shrink-0" />}
      </Link>
    )
  }

  return (
    <div className="flex min-h-screen bg-[var(--paper)]">
      {/* Sidebar */}
      <aside className="w-60 bg-[var(--primary)] flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-white/10">
          <p className="text-xs text-white/50 uppercase tracking-widest font-medium mb-1">Stanton Management</p>
          <h1 className="font-serif text-white text-lg leading-tight">Payroll &amp; Invoicing</h1>
        </div>

        {/* Active week context strip */}
        {activeWeek && (
          <Link
            href={getStepHref(activeWeek.id, activeWeek.status)}
            className="px-4 py-2.5 bg-white/5 border-b border-white/10 hover:bg-white/10 transition-colors"
          >
            <p className="text-xs text-white/90 font-medium">
              Week of {format(new Date(activeWeek.week_start + 'T00:00:00'), 'MMM d')}–{format(new Date(activeWeek.week_end + 'T00:00:00'), 'd')}
            </p>
            <p className="text-xs text-white/40 mt-0.5">
              {statusLabel[activeWeek.status] ?? activeWeek.status}
            </p>
          </Link>
        )}

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {/* SETUP — collapsible */}
          <div className="px-3 mb-1">
            <button
              onClick={() => setSetupOpen(o => !o)}
              className="flex items-center justify-between w-full px-2 mb-1 group"
            >
              <p className="text-xs text-white/40 uppercase tracking-widest">Setup</p>
              <ChevronDown
                size={12}
                className={`text-white/30 transition-transform duration-200 ${isSetupExpanded ? '' : '-rotate-90'}`}
              />
            </button>
            {isSetupExpanded && setupItems.map((item) =>
              navLink(item.href, item.label, item.icon)
            )}
          </div>

          {/* THIS WEEK — numbered workflow */}
          <div className="px-3 mt-3">
            <p className="text-xs text-white/40 uppercase tracking-widest px-2 mb-1">This Week</p>
            {weeklySteps.map((s) => {
              let href: string
              let disabled = false
              if (s.href !== null) {
                href = s.href
              } else if (activeWeekId && s.weekSub) {
                href = `/payroll/${activeWeekId}/${s.weekSub}`
              } else {
                href = '/payroll'
                disabled = true
              }
              const isCurrent = currentStep === s.step
              return navLink(href, s.label, s.icon, s.exact, `${s.step}`, isCurrent, disabled)
            })}
          </div>

          {/* EXPENSES — standalone */}
          <div className="px-3 mt-3">
            {navLink('/payroll/expenses', 'Expenses', Receipt)}
          </div>

          {/* INTELLIGENCE */}
          <div className="px-3 mt-3">
            <p className="text-xs text-white/40 uppercase tracking-widest px-2 mb-1">Intelligence</p>
            {navLink('/payroll/analytics', 'Cost-Per-Unit', TrendingUp)}
          </div>

          {/* HISTORY — standalone */}
          <div className="px-3 mt-3">
            {navLink('/payroll/history', 'History', History)}
          </div>
        </nav>

        {/* User + logout */}
        <div className="px-4 py-4 border-t border-white/10">
          {profile && (
            <div className="flex items-center gap-2 mb-2">
              <UserCircle size={14} className="text-white/40 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/70 truncate">{profile.full_name ?? profile.email ?? 'User'}</p>
                <p className="text-xs text-white/30 capitalize">{profile.role}</p>
              </div>
              <button
                onClick={signOut}
                title="Sign out"
                className="text-white/30 hover:text-white/70 transition-colors shrink-0"
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
