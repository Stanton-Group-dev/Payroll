'use client'

import { PageHeader, InfoBlock } from '@/components/form'
import { useAuth } from '@/hooks/payroll/useAuth'
import { Console } from '@/components/payroll/Console'

/**
 * Natural-language payroll console. Cross-week and not tied to a locked week.
 * Super-admins get the full read + write console; managers/admins get a
 * read-only assistant for answering questions. Everyone below manager is denied.
 */
export default function ConsolePage() {
  const { loading, isManager, isSuperAdmin } = useAuth()

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading…</div>

  return (
    <div className="p-6">
      <PageHeader
        title={isSuperAdmin ? 'Payroll Console' : 'Payroll Assistant'}
        subtitle={
          isSuperAdmin
            ? 'Ask anything about payroll, or make changes in plain language — every change is previewed and audited.'
            : 'Read-only assistant — answer questions about pay, hours, and where people worked.'
        }
      />

      {!isManager ? (
        <InfoBlock variant="error">
          You do not have access to the payroll console.
        </InfoBlock>
      ) : (
        <Console mode={isSuperAdmin ? 'full' : 'report'} />
      )}
    </div>
  )
}
