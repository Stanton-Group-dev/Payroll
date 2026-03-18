import type { WeekStatus } from '@/lib/supabase/types'

/**
 * Given a week ID and its current status, return the most actionable URL.
 * Phase A (draft / corrections_complete) routes to the next useful action.
 * Phase B (payroll_approved → statement_sent) routes to the next sequential gate.
 */
export function getStepHref(weekId: string, status: WeekStatus): string {
  switch (status) {
    case 'draft':
      return '/payroll/import'
    case 'corrections_complete':
      return `/payroll/${weekId}/review`
    case 'payroll_approved':
      return `/payroll/${weekId}/invoices`
    case 'invoiced':
      return `/payroll/${weekId}/statement`
    case 'statement_sent':
      return `/payroll/${weekId}/adp-export`
    default:
      return `/payroll/${weekId}/review`
  }
}

/** Numeric ordering used for tab-locking comparisons */
export const statusOrder: Record<WeekStatus, number> = {
  draft: 0,
  corrections_complete: 1,
  payroll_approved: 2,
  invoiced: 3,
  statement_sent: 4,
}
