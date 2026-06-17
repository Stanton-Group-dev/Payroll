'use client'

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
  Building2,
  Contact,
  LogOut,
  UserCircle,
  Target,
  Briefcase,
  SplitSquareVertical,
  Car,
  Receipt,
  Sparkles,
  CircleDollarSign,
  Laptop,
} from 'lucide-react'
import { useAuth } from '@/hooks/payroll/useAuth'

const navItems = [
  { href: '/payroll', label: 'Week Dashboard', icon: BarChart2, exact: true },
  { href: '/payroll/roster', label: 'Roster', icon: Contact },
  { href: '/payroll/employees', label: 'Employees & Rates', icon: Users },
  { href: '/payroll/rate-coverage', label: 'Rate Coverage', icon: CircleDollarSign },
  { href: '/payroll/import', label: 'Workyard Import', icon: Upload },
  { href: '/payroll/timesheets', label: 'Timesheet Adjustments', icon: ClipboardEdit },
  { href: '/payroll/expenses', label: 'Expenses', icon: Receipt },
  { href: '/payroll/mileage', label: 'Mileage', icon: Car },
  { href: '/payroll/adjustments', label: 'Adjustments', icon: DollarSign },
  { href: '/payroll/splits', label: 'Dept Splits', icon: SplitSquareVertical },
  { href: '/payroll/history', label: 'History', icon: History },
]

const analyticsItems = [
  { href: '/payroll/analytics', label: 'Cost-Per-Unit', icon: TrendingUp },
]

const adminItems = [
  { href: '/payroll/admin/mgmt-fee', label: 'Management Fee', icon: Settings },
  { href: '/payroll/admin/external-projects', label: 'External Projects', icon: Building2 },
  { href: '/payroll/admin/portfolios', label: 'Portfolios', icon: Briefcase },
  { href: '/payroll/admin/users', label: 'Users & Roles', icon: Users },
  { href: '/payroll/admin/thresholds', label: 'Budget Thresholds', icon: Target },
  { href: '/payroll/admin/travel-premiums', label: 'Travel Premiums', icon: Car },
  { href: '/payroll/admin/mileage-rate', label: 'Mileage Rate', icon: CircleDollarSign },
]

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { profile, signOut, isManager, isAnalyst } = useAuth()

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <div className="flex min-h-screen bg-[var(--paper)]">
      {/* Sidebar */}
      <aside className="w-56 bg-[var(--primary)] flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-white/10">
          <p className="text-xs text-white/50 uppercase tracking-widest font-medium mb-1">Stanton Management</p>
          <h1 className="font-serif text-white text-lg leading-tight">Payroll &amp; Invoicing</h1>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="px-3 mb-1">
            <p className="text-xs text-white/40 uppercase tracking-widest px-2 mb-2">Operations</p>
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href, item.exact)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-200 mb-0.5 ${
                    active
                      ? 'bg-white/15 text-white font-medium'
                      : 'text-white/60 hover:text-white hover:bg-white/8'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  {item.label}
                  {active && <ChevronRight size={12} className="ml-auto" />}
                </Link>
              )
            })}
          </div>

          <div className="px-3 mt-4">
            <p className="text-xs text-white/40 uppercase tracking-widest px-2 mb-2">Intelligence</p>
            {isManager && (
              <Link
                href="/payroll/console"
                className={`flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-200 mb-0.5 ${
                  isActive('/payroll/console')
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-white/60 hover:text-white hover:bg-white/8'
                }`}
              >
                <Sparkles size={14} className="shrink-0" />
                Console
                {isActive('/payroll/console') && <ChevronRight size={12} className="ml-auto" />}
              </Link>
            )}
            {analyticsItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-200 mb-0.5 ${
                    active
                      ? 'bg-white/15 text-white font-medium'
                      : 'text-white/60 hover:text-white hover:bg-white/8'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  {item.label}
                  {active && <ChevronRight size={12} className="ml-auto" />}
                </Link>
              )
            })}
          </div>

          {isAnalyst && (
            <div className="px-3 mt-4">
              <p className="text-xs text-white/40 uppercase tracking-widest px-2 mb-2">Remote</p>
              <Link
                href="/payroll/remote"
                className={`flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-200 mb-0.5 ${
                  isActive('/payroll/remote')
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-white/60 hover:text-white hover:bg-white/8'
                }`}
              >
                <Laptop size={14} className="shrink-0" />
                Remote Payroll
                {isActive('/payroll/remote') && <ChevronRight size={12} className="ml-auto" />}
              </Link>
            </div>
          )}

          <div className="px-3 mt-4">
            <p className="text-xs text-white/40 uppercase tracking-widest px-2 mb-2">Admin</p>
            {adminItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-200 mb-0.5 ${
                    active
                      ? 'bg-white/15 text-white font-medium'
                      : 'text-white/60 hover:text-white hover:bg-white/8'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  {item.label}
                  {active && <ChevronRight size={12} className="ml-auto" />}
                </Link>
              )
            })}
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
          <p className="text-xs text-white/20">Phase 6 — Expense Reimbursements</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
