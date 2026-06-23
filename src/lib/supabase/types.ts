export type EmployeeType = 'hourly' | 'salaried' | 'contractor'
/** Which payroll run an employee/week belongs to. 'field' is the default (Workyard);
 *  'remote' is the separate run driven by self-submitted hours + Monitask reference. */
export type PayGroup = 'field' | 'remote'
export type WeekStatus = 'draft' | 'corrections_complete' | 'payroll_approved' | 'invoiced' | 'statement_sent'
export type TimeEntrySource =
  | 'workyard'
  | 'workyard_api'
  | 'workyard_corrected'
  | 'manual_manager'
  | 'manual_spread'
  | 'sms_employee'
  | 'mileage_workyard'
  | 'monitask' // Monitask activity imported as a paid entry (rare; reference is preferred)
  | 'monitask_api' // Monitask activity pulled via API (reference)
  | 'remote_submitted' // remote worker's self-submitted hours (default paid)
  | 'manual' // legacy
export type AdjustmentType = 'phone' | 'tool' | 'advance' | 'deduction_other' | 'expense_reimbursement' | 'bonus'
export type AllocationMethod = 'employee_pay' | 'unit_weighted' | 'direct'
export type InvoiceStatus = 'draft' | 'approved' | 'sent'
export type CostType = 'labor' | 'spread' | 'mgmt_fee'
export type ApprovalStage = 'timesheet' | 'payroll' | 'invoice' | 'statement'
export type CorrectionOperation = 'reassign' | 'split' | 'add' | 'remove'
export type TravelPremiumType = 'per_day' | 'flat_per_job'
export type MileageStatus = 'pending' | 'approved' | 'denied'
export type ExpenseType = 'gas' | 'tolls' | 'parking' | 'materials' | 'tools' | 'food' | 'other' | 'mileage'
export type ExpensePaymentMethod = 'personal' | 'company_card' | 'company_account' | 'unknown'
export type ExpenseSubmissionStatus = 'pending' | 'approved' | 'rejected' | 'correction_requested' | 'bookkeeping_only'
export type ExpenseAllocationMethod = 'direct' | 'unit_weighted' | 'gas_auto'
export type ExpenseApprovalAction = 'approved' | 'rejected' | 'correction_requested' | 'routed_to_bookkeeping' | 'payment_method_resolved'

export interface GasAllocationEntry {
  property_id: string
  property_code?: string
  property_name?: string
  visits: number
  pct: number
  amount: number
}

export interface GasAllocationAudit {
  employee_id: string
  window_start: string
  window_end: string
  auto_allocation: GasAllocationEntry[]
  override_used: boolean
}

export interface PropertyOverride {
  item_id: string
  original_property_id: string | null
  new_property_id: string
}

export interface PayrollEmployee {
  id: string
  name: string
  workyard_id: string | null
  monitask_id: string | null
  type: EmployeeType
  pay_group: PayGroup
  hourly_rate: number | null
  weekly_rate: number | null
  trade: string | null
  is_active: boolean
  is_management: boolean
  ot_allowed: boolean
  pay_tax: boolean
  wc: boolean
  /** Roster flag: this employee generally receives mileage reimbursement. */
  mileage_eligible: boolean
  // --- Master roster / comp-sheet fields (the single source of truth, was Excel) ---
  /** Org department, e.g. "01 - Corporate". */
  department: string | null
  /** Job title / role from the roster (distinct from `trade`). */
  role: string | null
  phone: string | null
  email: string | null
  /** Department-sequence code, e.g. "01-003". Not unique (techs share "02-002"). */
  employee_code: string | null
  /** Flat pay amount (roster "Amount" column, distinct from hourly_rate "Rate"). */
  amount: number | null
  phone_reimbursement: number | null
  monthly_bonus: number | null
  bonus: number | null
  rent_adjustment: number | null
  /** Roster "Type" verbatim: "1099 reimbursement" / "W-2" / "Remote". */
  pay_classification: string | null
  hired_on: string | null
  /** Roster "Updated On" — manual comp-change date. */
  comp_updated_on: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

/** One row per changed field, written by the payroll_employees audit trigger. */
export interface PayrollEmployeeAudit {
  id: string
  employee_id: string
  field: string
  old_value: string | null
  new_value: string | null
  operation: 'insert' | 'update'
  changed_by: string | null
  changed_by_email: string | null
  changed_at: string
}

export interface PayrollEmployeeRate {
  id: string
  employee_id: string
  rate: number
  effective_date: string
  created_at: string
  created_by: string | null
}

/** Monitask activity for a remote worker on a given day. Reference only — used by
 *  the optional overpay check; never auto-paid. Paid hours come from time entries
 *  with source='remote_submitted'. */
export interface MonitaskActivity {
  id: string
  employee_id: string
  payroll_week_id: string | null
  entry_date: string
  active_hours: number
  productivity_pct: number | null
  raw: Record<string, unknown> | null
  created_at: string
  created_by: string | null
  employee?: PayrollEmployee
}

/** The standing bonus arrangement for a remote worker. Per-run bonus payouts are
 *  entered as payroll_adjustments with type='bonus'. */
export type RemoteBonusBasis = 'manual' | 'per_week' | 'per_hour' | 'pct_of_pay'

export interface RemoteBonusConfig {
  id: string
  employee_id: string
  structure_note: string
  target_amount: number | null
  basis: RemoteBonusBasis
  is_active: boolean
  effective_date: string
  created_at: string
  created_by: string | null
  employee?: PayrollEmployee
}

export interface PayrollEmployeeDeptSplit {
  id: string
  employee_id: string
  department: string
  allocation_pct: number
  effective_date: string
  created_at: string
  created_by: string | null
}

export interface PayrollWeek {
  id: string
  week_start: string
  week_end: string
  status: WeekStatus
  pay_group: PayGroup
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PayrollTimeEntry {
  id: string
  payroll_week_id: string
  employee_id: string
  property_id: string | null
  entry_date: string
  regular_hours: number
  ot_hours: number
  pto_hours: number
  /** Raw miles for this row, captured from the Workyard payroll export. Carries the row's property. */
  miles: number
  source: TimeEntrySource
  workyard_timecardid: string | null
  is_flagged: boolean
  flag_reason: string | null
  is_active: boolean
  pending_resolution: boolean
  pending_note: string | null
  pending_since: string | null
  /** When true: no single billable property — wages are spread across all billable
   *  properties by unit count (like salaried) and the row is excluded from unallocated holds. */
  is_overhead_spread?: boolean
  /** Workyard cost-code CODE (e.g. "S0020", "001"). For vendor/overhead projects an
   *  S-code here names the destination building the hours bill to. Null when unknown. */
  cost_code?: string | null
  /** Workyard cost-code human NAME (e.g. "31 Park - Material Pickup", "Work Order - Standard").
   *  Drives the customer-facing activity label. */
  cost_code_name?: string | null
  spread_event_id: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  employee?: PayrollEmployee
  property?: Property
}

export interface PayrollTimesheetCorrection {
  id: string
  time_entry_id: string
  from_property_id: string | null
  to_property_id: string
  hours: number
  reason: string
  operation: CorrectionOperation | null
  corrected_by: string
  corrected_at: string
}

export interface PayrollDeptSplitOverride {
  id: string
  payroll_week_id: string
  employee_id: string
  department: string
  allocation_pct: number
  reason: string
  submitted_by: string
  approved_by: string | null
  created_at: string
  updated_at: string
}

// 'held'   : whole employee pulled from the run (no pay, no billing) until released.
// 'waived' : only the employee's unallocated hours are written off — still paid for
//            allocated work, no notification, reversible.
export type HoldStatus = 'held' | 'released' | 'waived'
export type HoldReason = 'unallocated_hours'
export type NotificationChannel = 'sms' | 'email'
export type NotificationStatus = 'queued' | 'sent' | 'dry_run' | 'skipped' | 'failed'

/** A (week, employee) pay hold. A 'held' row pulls the employee out of the run
 *  entirely until they bring a written reason; 'released' carries that reason. */
export interface PayrollEmployeeHold {
  id: string
  payroll_week_id: string
  employee_id: string
  reason: HoldReason | string
  unallocated_hours: number
  status: HoldStatus
  held_by: string | null
  held_at: string
  resolution_note: string | null
  released_by: string | null
  released_at: string | null
  created_at: string
  updated_at: string
  employee?: PayrollEmployee
}

/** Outbox row for a message to an employee (SMS today). One row per send attempt,
 *  recorded whether it was actually sent, dry-run, skipped, or failed. */
export interface PayrollNotification {
  id: string
  payroll_week_id: string | null
  employee_id: string
  channel: NotificationChannel
  to_address: string | null
  body: string
  status: NotificationStatus
  provider: string | null
  provider_ref: string | null
  error: string | null
  created_by: string | null
  created_at: string
  sent_at: string | null
  employee?: PayrollEmployee
}

export interface PayrollAdjustment {
  id: string
  payroll_week_id: string
  employee_id: string
  type: AdjustmentType
  amount: number
  description: string
  allocation_method: AllocationMethod
  prior_week_id?: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  employee?: PayrollEmployee
  prior_week?: PayrollWeek
}

export interface PayrollManagementFeeConfig {
  id: string
  rate_pct: number
  portfolio_id: string | null
  effective_date: string
  created_at: string
  created_by: string | null
}

/** Effective-dated mileage reimbursement rate (USD per mile). Append-only history,
 *  most-recent effective row wins — mirrors PayrollManagementFeeConfig. */
export interface PayrollMileageRate {
  id: string
  rate_per_mile: number
  effective_date: string
  created_at: string
  created_by: string | null
}

/** Per-(week, employee) mileage reimbursement review. miles_approved is editable so a
 *  manager can trim miles; amount = miles_approved * rate_per_mile. Only status='approved'
 *  rows are paid and billed to properties. */
export interface PayrollMileageReimbursement {
  id: string
  payroll_week_id: string
  employee_id: string
  miles_raw: number
  miles_approved: number
  rate_per_mile: number
  amount: number
  status: MileageStatus
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  employee?: PayrollEmployee
}

export interface PayrollInvoice {
  id: string
  payroll_week_id: string
  owner_llc: string
  portfolio_id: string | null
  status: InvoiceStatus
  total_amount: number
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
  line_items?: PayrollInvoiceLineItem[]
}

export interface PayrollInvoiceLineItem {
  id: string
  invoice_id: string
  property_id: string
  description: string | null
  cost_type: CostType
  labor_amount: number
  spread_amount: number
  mgmt_fee_amount: number
  total_amount: number
  created_at: string
  property?: Property
}

export interface PayrollWeeklyPropertyCost {
  payroll_week_id: string
  property_id: string
  labor_cost: number
  spread_cost: number
  total_cost: number
  cost_per_unit: number
  property?: Property
}

export interface PayrollADPReconciliation {
  id: string
  payroll_week_id: string
  system_gross_total: number
  adp_gross_total: number
  variance: number
  resolved: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PayrollApproval {
  id: string
  payroll_week_id: string
  stage: ApprovalStage
  reference_id: string | null
  approved_by: string
  approved_at: string
  notes: string | null
}

export interface Property {
  id: string
  appfolio_property_id: string
  code: string
  name: string
  address: string | null
  total_units: number | null
  portfolio_id: string | null
  billing_llc: string | null
  is_active: boolean
  /** When false, skipped during invoice generation. Optional in the type because not
   *  every query selects it; absence is treated as included. See migration
   *  20260617_02_invoicing_inclusion_flags. */
  include_in_invoicing?: boolean
}

export interface Portfolio {
  id: string
  name: string
  is_active: boolean
  /** When false, every property in this portfolio is skipped during invoice generation. */
  include_in_invoicing?: boolean
}

/**
 * payroll_property — the payroll app's curated, AppFolio-proof property record. A 1:1 overlay
 * on `properties` keyed by `property_id` (= the shared properties.id). AppFolio only ever
 * writes `properties`; payroll only ever trusts this table. `owner_llc` is the billing entity
 * (replaces `properties.billing_llc`). See migration 20260618_02_payroll_property.sql and the
 * curatedToProperty() mapper in lib/payroll/properties.ts. */
export interface PayrollProperty {
  id: string
  property_id: string
  appfolio_property_id: string | null
  code: string | null
  name: string | null
  address: string | null
  total_units: number | null
  portfolio_id: string | null
  owner_llc: string | null
  include_in_invoicing: boolean
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface PayrollSpreadEvent {
  id: string
  payroll_week_id: string
  employee_id: string
  entry_date: string
  total_hours: number
  portfolio_id: string | null
  reason: string
  created_by: string | null
  created_at: string
  updated_at: string
  employee?: PayrollEmployee
}

export interface PayrollTravelPremium {
  id: string
  property_id: string
  premium_type: TravelPremiumType
  amount: number
  effective_date: string
  created_by: string | null
  created_at: string
  updated_at: string
  property?: Property
}

export interface PayrollGlobalConfig {
  id: string
  expense_cutoff_day: number | null
  expense_cutoff_time: string | null
  prefund_includes_mgmt_fee: boolean
  /** Employer FICA/SUTA burden rate (default 0.08). Editable in Admin → Settings. */
  payroll_tax_rate: number
  /** Workers-compensation rate (default 0.03). Editable in Admin → Settings. */
  workers_comp_rate: number
  /** Weekly phone-reimbursement amount per eligible employee, USD (default 8). Editable in Admin → Settings. */
  phone_reimbursement_amount: number
  /** Weekly hours threshold above which OT-eligible employees earn overtime (default 40). Editable in Admin → Settings. */
  ot_threshold_hours: number
  /** Master switch for the automated daily unallocated-hours SMS job. Off by default. */
  unallocated_notifications_enabled: boolean | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface PayrollExpenseSubmission {
  id: string
  payroll_week_id: string | null
  employee_id: string
  submitted_by: string
  submitted_at: string
  signature_url: string
  status: ExpenseSubmissionStatus
  total_amount: number | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  employee?: PayrollEmployee
  week?: PayrollWeek
  items?: PayrollExpenseItem[]
}

export interface PayrollExpenseItem {
  id: string
  submission_id: string
  expense_type: ExpenseType
  amount: number
  property_id: string | null
  payment_method: ExpensePaymentMethod
  receipt_image_url: string
  description: string | null
  prior_week_id: string | null
  allocation_method: ExpenseAllocationMethod
  allocation_detail: GasAllocationEntry[] | null
  created_at: string
  created_by: string | null
  property?: Property
  prior_week?: PayrollWeek
}

export interface PayrollExpenseApproval {
  id: string
  submission_id: string
  action: ExpenseApprovalAction
  actioned_by: string
  actioned_at: string
  notes: string | null
  gas_allocation_audit: GasAllocationAudit | null
  property_overrides: PropertyOverride[] | null
  created_at: string
  created_by: string | null
}

// ── New Project Wizard (PRP-06) ────────────────────────────────────────────
// Maps an owner LLC to its Workyard customer id, so the wizard can create a
// project under the right customer. Config, not hardcode (DECISIONS_LOG §0.13).
export interface PayrollWorkyardCustomerMap {
  id: string
  owner_llc: string
  org_customer_id: number
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

// Append-only audit of what the onboarding wizard provisioned in Workyard.
export interface PayrollWorkyardProvisionLog {
  id: string
  property_code: string
  workyard_project_id: string | null
  workyard_cost_code_id: string | null
  project_action: string
  cost_code_action: string
  created_by: string | null
  created_at: string
}
