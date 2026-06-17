/**
 * Payroll business constants.
 * These are intentionally separated from calculation logic so they can be
 * found and changed in one place. Long-term these should move to DB config
 * tables (like payroll_management_fee_config) so changes don't require a deploy.
 */

/** Employer payroll tax rate (FICA/SUTA burden applied to gross pay). */
export const PAYROLL_TAX_RATE = 0.08

/** Workers' compensation rate applied to gross pay. */
export const WORKERS_COMP_RATE = 0.03

/** Weekly phone reimbursement amount per active employee (USD). */
export const PHONE_REIMBURSEMENT_AMOUNT = 8

/**
 * Fallback mileage reimbursement rate (USD per mile) used only when no row exists in
 * payroll_mileage_rates. The live, effective-dated rate is stored in that table and
 * managed from Admin → Mileage Rate. Kept in sync with the migration seed (0.73).
 */
export const DEFAULT_MILEAGE_RATE = 0.73

/**
 * Workyard project name fragments that indicate unallocated / overhead time.
 * Entries matching these names are flagged for redistribution on import.
 */
export const OVERHEAD_PROPERTY_NAMES = [
  'unallocated',
  'stanton management',
  'stanton management llc',
]

/** IANA timezone for the Workyard org. Used for date boundary calculations. */
export const WORKYARD_ORG_TIMEZONE = 'America/New_York'

/**
 * Monitask (remote-worker activity tracking) OAuth endpoints. Monitask uses an
 * IdentityServer OAuth2 flow (Basic-auth client_id:client_secret, refresh-token
 * grant, ~1h access tokens, scope includes `ExternalApi`) — see monitask-api.ts.
 * The actual activity/report data endpoint is gated behind Monitask's manual
 * developer-portal grant and is isolated in a single adapter in monitask-api.ts.
 */
export const MONITASK_TOKEN_URL = 'https://app.monitask.com/identity/connect/token'
/** Override the data API base once the real report endpoint is documented. */
export const MONITASK_API_BASE = process.env.MONITASK_API_BASE ?? 'https://app.monitask.com/api'
/** Org timezone reused for Monitask day-boundary math (same org). */
export const MONITASK_ORG_TIMEZONE = WORKYARD_ORG_TIMEZONE
