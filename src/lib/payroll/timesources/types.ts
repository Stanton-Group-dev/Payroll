/**
 * Provider-neutral time-source contracts.
 *
 * The app pulls worked time from external trackers. Today that's **Workyard**
 * (property-allocated time cards, the field run) and **Monitask** (per-worker
 * activity, reference for the remote run). Adding a third provider later should be
 * a one-file addition to the registry (timesources/index.ts) — code that lists or
 * checks providers depends only on this module, never on a specific client.
 */
import type { WorkyardRow } from '@/lib/payroll/csv-parser'

export type TimeSourceId = 'workyard' | 'monitask'

/**
 * Two kinds of providers:
 *  - 'timecards' yield property-allocated worked time (paid directly). Workyard.
 *  - 'activity'  yield productivity/active time used as reference (not auto-paid).
 *    Monitask.
 */
export type TimeSourceKind = 'timecards' | 'activity'

/** A property-allocated worked-time row. Aliased to the existing Workyard shape so
 *  the import pipeline (csv-parser, import page) consumes every provider the same way. */
export type ProviderTimeRow = WorkyardRow

/** One worker's activity for one day, from an 'activity' provider (Monitask). */
export interface MonitaskActivityRow {
  /** The provider's user id; matched to payroll_employees.monitask_id (or by name). */
  monitaskUserId: string
  employeeName: string
  /** YYYY-MM-DD in the org timezone. */
  entryDate: string
  /** Active (tracked) hours for the day. */
  activeHours: number
  /** Productivity ratio 0..1, if the provider reports it. */
  productivityPct: number | null
  /** Raw provider payload, retained for audit/debugging. */
  raw?: Record<string, unknown>
}

export interface TimeSourceMeta {
  id: TimeSourceId
  label: string
  kind: TimeSourceKind
  /** True when the provider has the credentials (or mock flag) it needs to run. */
  isConfigured: () => boolean
}
