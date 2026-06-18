import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react'
import type { PayrollEmployee, PayrollTimeEntry } from '@/lib/supabase/types'

interface EmployeeSwitcherProps {
  employees: PayrollEmployee[]
  allEntries: PayrollTimeEntry[]
  selectedId: string | null
  onChange: (id: string) => void
}

type Status = 'unresolved' | 'pending' | 'clean'

interface EmployeeInfo {
  employee: PayrollEmployee
  status: Status
  /** unresolved blocks: entries with no property and not parked as pending */
  unresolvedCount: number
  /** entries parked as pending resolution */
  pendingCount: number
}

function getEmployeeInfo(emp: PayrollEmployee, entries: PayrollTimeEntry[]): EmployeeInfo {
  const empEntries = entries.filter(e => e.employee_id === emp.id)
  const unresolvedCount = empEntries.filter(e => !e.property_id && !e.pending_resolution).length
  const pendingCount = empEntries.filter(e => e.pending_resolution).length
  const status: Status = unresolvedCount > 0 ? 'unresolved' : pendingCount > 0 ? 'pending' : 'clean'
  return { employee: emp, status, unresolvedCount, pendingCount }
}

function EmployeeRow({
  info,
  isSelected,
  onChange,
}: {
  info: EmployeeInfo
  isSelected: boolean
  onChange: (id: string) => void
}) {
  const { employee: emp, status, unresolvedCount, pendingCount } = info
  return (
    <button
      type="button"
      onClick={() => onChange(emp.id)}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 border-l-2
        ${isSelected
          ? 'bg-[var(--primary)] text-white border-l-white/40'
          : status === 'unresolved'
          ? 'text-[var(--ink)] border-l-[var(--warning)] hover:bg-[var(--primary)]/8'
          : status === 'pending'
          ? 'text-[var(--ink)] border-l-blue-500 hover:bg-[var(--primary)]/8'
          : 'text-[var(--ink)] border-l-transparent hover:bg-[var(--primary)]/8'
        }`}
    >
      {/* Status icon */}
      {status === 'unresolved' ? (
        <AlertTriangle size={14} className={`shrink-0 ${isSelected ? 'text-amber-300' : 'text-[var(--warning)]'}`} />
      ) : status === 'pending' ? (
        <Clock size={14} className={`shrink-0 ${isSelected ? 'text-blue-300' : 'text-blue-500'}`} />
      ) : (
        <CheckCircle2 size={14} className={`shrink-0 ${isSelected ? 'text-green-300' : 'text-[var(--success)]/40'}`} />
      )}

      <span className={`truncate leading-tight flex-1 ${status !== 'clean' ? 'font-medium' : ''}`}>
        {emp.name}
      </span>

      {/* Count badge — how many things need attention */}
      {status !== 'clean' && (
        <span
          className={`shrink-0 text-[11px] font-semibold tabular-nums px-1.5 rounded-full
            ${isSelected
              ? 'bg-white/20 text-white'
              : status === 'unresolved'
              ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
              : 'bg-blue-500/15 text-blue-600'
            }`}
        >
          {status === 'unresolved' ? unresolvedCount : pendingCount}
        </span>
      )}
    </button>
  )
}

export function EmployeeSwitcher({ employees, allEntries, selectedId, onChange }: EmployeeSwitcherProps) {
  const infos = employees.map(emp => getEmployeeInfo(emp, allEntries))

  // Flagged employees float to the top: unresolved before pending. Within each
  // group the incoming (alphabetical) order is preserved so the list stays scannable.
  const flagged = infos
    .filter(i => i.status !== 'clean')
    .sort((a, b) => (a.status === 'unresolved' ? 0 : 1) - (b.status === 'unresolved' ? 0 : 1))
  const clean = infos.filter(i => i.status === 'clean')

  return (
    <aside className="w-48 shrink-0 border-r border-[var(--border)] bg-[var(--bg-section)] overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-[var(--border)]">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Employees</p>
      </div>

      {employees.length === 0 ? (
        <p className="px-3 py-4 text-xs text-[var(--muted)]">No active employees</p>
      ) : (
        <>
          {flagged.length > 0 && (
            <div className="py-1">
              <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                <AlertTriangle size={12} className="text-[var(--warning)] shrink-0" />
                <p className="text-[11px] font-semibold text-[var(--warning)] uppercase tracking-wide">
                  Needs attention · {flagged.length}
                </p>
              </div>
              {flagged.map(info => (
                <EmployeeRow
                  key={info.employee.id}
                  info={info}
                  isSelected={selectedId === info.employee.id}
                  onChange={onChange}
                />
              ))}
            </div>
          )}

          <div className="py-1 border-t border-[var(--border)]">
            {flagged.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wide">
                All clear · {clean.length}
              </p>
            )}
            {clean.map(info => (
              <EmployeeRow
                key={info.employee.id}
                info={info}
                isSelected={selectedId === info.employee.id}
                onChange={onChange}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
