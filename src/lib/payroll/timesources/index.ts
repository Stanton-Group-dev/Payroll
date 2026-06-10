/**
 * Time-source registry — the single place that knows which external trackers the
 * app can pull from. Add a provider here and the rest of the app can list it,
 * check whether it's configured, and route to its client.
 *
 * Each provider's actual fetch lives in its own client module (workyard-api.ts,
 * monitask-api.ts); this registry only carries metadata + a configured check so
 * UI/routes don't hard-code provider knowledge.
 */
import { isWorkyardMockEnabled } from '@/lib/payroll/workyard-mock'
import { isMonitaskMockEnabled } from '@/lib/payroll/monitask-mock'
import type { TimeSourceId, TimeSourceMeta } from './types'

export * from './types'

function workyardConfigured(): boolean {
  return isWorkyardMockEnabled() || (!!process.env.WORKYARD_API_KEY && !!process.env.WORKYARD_ORG_ID)
}

export function monitaskConfigured(): boolean {
  return (
    isMonitaskMockEnabled() ||
    (!!process.env.MONITASK_CLIENT_ID &&
      !!process.env.MONITASK_CLIENT_SECRET &&
      !!process.env.MONITASK_REFRESH_TOKEN)
  )
}

const REGISTRY: Record<TimeSourceId, TimeSourceMeta> = {
  workyard: {
    id: 'workyard',
    label: 'Workyard',
    kind: 'timecards',
    isConfigured: workyardConfigured,
  },
  monitask: {
    id: 'monitask',
    label: 'Monitask',
    kind: 'activity',
    isConfigured: monitaskConfigured,
  },
}

export function listTimeSources(): TimeSourceMeta[] {
  return Object.values(REGISTRY)
}

export function getTimeSource(id: TimeSourceId): TimeSourceMeta | null {
  return REGISTRY[id] ?? null
}
