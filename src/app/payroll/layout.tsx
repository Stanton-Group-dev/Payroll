'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Users,
  Upload,
  ClipboardEdit,
  DollarSign,
  History,
  Settings,
  ChevronRight,
  ChevronDown,
  Building2,
  Contact,
  LogOut,
  UserCircle,
  Target,
  Briefcase,
  SplitSquareVertical,
  Car,
  Plane,
  Receipt,
  Sparkles,
  CircleDollarSign,
  Laptop,
  FileText,
  FileSpreadsheet,
  Archive,
  Download,
  Scale,
  ClipboardCheck,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  LayoutDashboard,
  Wand2,
  ClipboardList,
  MessageSquare,
  EyeOff,
  CalendarCheck,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/payroll/useAuth'
import { SelectedWeekProvider, useSelectedWeek } from '@/hooks/payroll/useSelectedWeek'

// ── Nav data ──────────────────────────────────────────────────────────────
// The sidebar is organized by how often you touch a screen, top to bottom:
// the weekly job first (open by default), setup/config last (collapsed).

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean }

// "Run the week" — the recurring weekly flow, in workflow order.
const weekInputs: Item[] = [
  { href: '/payroll', label: 'Week Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/payroll/daily', label: 'Daily Catch-up', icon: CalendarCheck },
  { href: '/payroll/import', label: 'Workyard Import', icon: Upload },
]
const weekAllocate: Item[] = [
  { href: '/payroll/timesheets', label: 'Timesheet Adjustments', icon: ClipboardEdit },
  { href: '/payroll/adjustments', label: 'Adjustments', icon: DollarSign },
  { href: '/payroll/splits', label: 'Dept Splits', icon: SplitSquareVertical },
  { href: '/payroll/mileage', label: 'Mileage', icon: Car },
  { href: '/payroll/expenses', label: 'Expenses', icon: Receipt },
]
// The close-out pipeline — these deep-link into the week you're working in.
const weekPipeline: { seg: string; label: string; icon: LucideIcon }[] = [
  { seg: 'review', label: 'Review & Approve', icon: ClipboardCheck },
  { seg: 'invoices', label: 'Invoices', icon: FileText },
  { seg: 'statement', label: 'Statement', icon: FileSpreadsheet },
  { seg: 'adp-export', label: 'ADP Export', icon: Download },
  { seg: 'adp-reconciliation', label: 'ADP Reconciliation', icon: Scale },
]

const peopleItems: Item[] = [
  { href: '/payroll/roster', label: 'Roster', icon: Contact },
  { href: '/payroll/employees', label: 'Employees & Rates', icon: Users },
  { href: '/payroll/rate-coverage', label: 'Rate Coverage', icon: CircleDollarSign },
]
const recordsItems: Item[] = [
  { href: '/payroll/billing', label: 'Invoice Archive', icon: Archive },
  { href: '/payroll/history', label: 'History', icon: History },
]
const insightsItems: Item[] = [
  { href: '/payroll/analytics', label: 'Cost-Per-Unit', icon: TrendingUp },
]
const settingsItems: Item[] = [
  { href: '/payroll/admin/onboard', label: 'New Project', icon: Wand2 },
  { href: '/payroll/admin/onboarding', label: 'Employee Onboarding', icon: ClipboardList },
  { href: '/payroll/admin/mgmt-fee', label: 'Management Fee', icon: Settings },
  { href: '/payroll/admin/portfolios', label: 'Portfolios', icon: Briefcase },
  { href: '/payroll/admin/invoicing', label: 'Billed Properties', icon: SlidersHorizontal },
  { href: '/payroll/admin/suppression', label: 'Hidden Items', icon: EyeOff },
  { href: '/payroll/admin/travel-premiums', label: 'Travel Premiums', icon: Plane },
  { href: '/payroll/admin/mileage-rate', label: 'Mileage Rate', icon: CircleDollarSign },
  { href: '/payroll/admin/thresholds', label: 'Budget Thresholds', icon: Target },
  { href: '/payroll/admin/external-projects', label: 'External Projects', icon: Building2 },
  { href: '/payroll/admin/workyard-customers', label: 'Workyard Customers', icon: Building2 },
  { href: '/payroll/admin/notifications', label: 'Employee SMS', icon: MessageSquare },
  { href: '/payroll/admin/users', label: 'Users & Roles', icon: Users },
]

// ── Shared styles ───────────────────────────────────────────────────────────
const linkBase =
  'flex items-center gap-2.5 px-2 py-2 text-sm transition-colors duration-200 mb-0.5'
const linkActive = 'bg-white/15 text-white font-medium'
const linkIdle = 'text-white/60 hover:text-white hover:bg-white/8'

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  dimmed,
  title,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
  dimmed?: boolean
  title?: string
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`${linkBase} ${active ? linkActive : linkIdle} ${dimmed ? 'opacity-40' : ''}`}
    >
      <Icon size={14} className="shrink-0" />
      {label}
      {active && <ChevronRight size={12} className="ml-auto" />}
    </Link>
  )
}

function NavSection({
  title,
  defaultOpen,
  forceOpen,
  children,
}: {
  title: string
  defaultOpen?: boolean
  forceOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const isOpen = open || !!forceOpen
  return (
    <div className="px-3 mt-4 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2 mb-2 text-white/40 hover:text-white/70 transition-colors"
      >
        <span className="text-xs uppercase tracking-widest">{title}</span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
        />
      </button>
      {isOpen && <div>{children}</div>}
    </div>
  )
}

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return (
    <SelectedWeekProvider>
      {/* Fixed-height app shell: the sidebar and main pane each fill the viewport
          and scroll their own content. Without h-screen + overflow-hidden the
          shell grows to the (often taller-than-viewport) sidebar, which drags the
          page past 100vh and leaves a dead scroll zone below it. For print we drop
          the flex shell to plain block flow (print:block) and restore natural,
          un-clipped height/overflow (print:h-auto print:overflow-visible) so
          multi-page statements/invoices paginate for server-side PDF rendering
          instead of cutting off. */}
      <div className="flex h-screen overflow-hidden bg-[var(--paper)] print:block print:h-auto print:overflow-visible">
        <Sidebar />
        <main className="flex-1 overflow-auto print:overflow-visible">{children}</main>
      </div>
    </SelectedWeekProvider>
  )
}

function Sidebar() {
  const pathname = usePathname()
  const { profile, signOut, isManager, isAnalyst } = useAuth()
  const { selectedWeekId, hydrated } = useSelectedWeek()

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  // A pipeline stage is active when the URL's third segment matches it,
  // i.e. /payroll/<weekId>/<seg>.
  const parts = pathname.split('/')
  const pipeActive = (seg: string) => parts[1] === 'payroll' && parts[3] === seg
  const hasWeek = hydrated && !!selectedWeekId
  const weekHref = (seg: string) => (hasWeek ? `/payroll/${selectedWeekId}/${seg}` : '/payroll')

  // Auto-expand the group the user is currently inside.
  const inAny = (items: Item[]) => items.some(i => isActive(i.href, i.exact))
  const subLabel = 'text-[10px] text-white/30 uppercase tracking-wider px-2 mt-3 mb-1'

  return (
    <aside className="w-56 bg-[var(--primary)] flex flex-col shrink-0 print:hidden">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/10">
        <p className="text-xs text-white/50 uppercase tracking-widest font-medium mb-1">
          Stanton Management
        </p>
        <h1 className="font-serif text-white text-lg leading-tight">Payroll &amp; Invoicing</h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {/* Run the week — the recurring job, open by default */}
        <NavSection title="Run the Week" defaultOpen>
          {weekInputs.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href, item.exact)}
            />
          ))}

          <p className={subLabel}>Allocate &amp; fix</p>
          {weekAllocate.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href, item.exact)}
            />
          ))}

          <p className={subLabel}>Close out{hasWeek ? ' · selected week' : ''}</p>
          {weekPipeline.map(stage => (
            <NavLink
              key={stage.seg}
              href={weekHref(stage.seg)}
              label={stage.label}
              icon={stage.icon}
              active={pipeActive(stage.seg)}
              dimmed={!hasWeek}
              title={hasWeek ? undefined : 'Open a week from the dashboard first'}
            />
          ))}
        </NavSection>

        {/* People & rates — setup/maintenance */}
        <NavSection title="People &amp; Rates" forceOpen={inAny(peopleItems)}>
          {peopleItems.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href, item.exact)}
            />
          ))}
        </NavSection>

        {/* Records — read-only reference */}
        <NavSection title="Records" forceOpen={inAny(recordsItems)}>
          {recordsItems.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href, item.exact)}
            />
          ))}
        </NavSection>

        {/* Insights */}
        <NavSection
          title="Insights"
          forceOpen={
            inAny(insightsItems) ||
            isActive('/payroll/console') ||
            isActive('/payroll/dumpsters')
          }
        >
          {isManager && (
            <NavLink
              href="/payroll/console"
              label="Console"
              icon={Sparkles}
              active={isActive('/payroll/console')}
            />
          )}
          {insightsItems.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href, item.exact)}
            />
          ))}
          {isManager && (
            <NavLink
              href="/payroll/dumpsters"
              label="Dumpster Sizing"
              icon={Trash2}
              active={isActive('/payroll/dumpsters')}
            />
          )}
        </NavSection>

        {/* Remote payroll — analyst only */}
        {isAnalyst && (
          <NavSection title="Remote" forceOpen={isActive('/payroll/remote')}>
            <NavLink
              href="/payroll/remote"
              label="Remote Payroll"
              icon={Laptop}
              active={isActive('/payroll/remote')}
            />
          </NavSection>
        )}

        {/* Settings — config/admin, collapsed by default */}
        <NavSection title="Settings" forceOpen={isActive('/payroll/admin')}>
          {settingsItems.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href, item.exact)}
            />
          ))}
        </NavSection>
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-white/10">
        {profile && (
          <div className="flex items-center gap-2 mb-2">
            <UserCircle size={14} className="text-white/40 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/70 truncate">
                {profile.full_name ?? profile.email ?? 'User'}
              </p>
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
  )
}
