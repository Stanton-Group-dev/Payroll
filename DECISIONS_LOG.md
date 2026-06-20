# Payroll — Decisions Log

**Purpose.** One canonical place for decisions that have been *made*, so we stop re-litigating
settled questions. If a choice has been decided — in a meeting, in a conversation, or in a PRD —
it belongs here. Before re-asking a question, check here first.

**How to use.**
- Newest / most-contested decisions go in **§0 Recently settled** (top), with a date.
- Durable domain rules live in the categorized tables (§1+).
- Things *not* yet decided live in **§9 Open questions** — do not treat these as settled.
- When a decision changes, mark the old row `superseded` and add the new one with today's date. Never silently edit history.
- `status`: **active** (in force) · **proposed** (in a draft PRD, not shipped) · **parked**/**future** (deliberately deferred) · **superseded**.

> Seeded 2026-06-19 by harvesting all PRDs, the 5 audit PRPs, `src/lib/payroll/config.ts`, agent memory, and the last several working conversations. Sources are cited so any row can be traced.

---

## §0 Recently settled (the ones we keep re-answering)

These came out of working sessions on 2026-06-18/19 and were not previously written down — which is exactly why they kept resurfacing.

| # | Decision | Rationale | Source | Status |
|---|---|---|---|---|
| 0.1 | **On vendor/supply runs, the building is identified by the COST CODE, not the project.** The Workyard *project* is the vendor (Home Depot, Park Hardware, Lowes, All Waste…); the *cost code* is a per-building "Material Pickup"-type code that carries the destination building (S-code). "The employee has to select the cost code of the building." | This is how Stanton set up Workyard for supply runs; a worker taps a building name, never an S-code. | Conversation 2026-06-19; `WESTEND_WORKYARD_SETUP.md`; `types.ts:195`; `DUMPSTER_ANALYSIS_PRD.md:37-52` | **active** |
| 0.2 | **The importer must resolve property from the cost code when the project is a vendor/doesn't resolve.** Today it does not — property comes only from the project → vendor runs land "Property not found" → unallocated → unpaid. **CONFIRMED with live Workyard data (2026-06-19):** at the "Office Park Hardware Cluster" vendor project, employees correctly tap a per-building Material Pickup cost code whose `job_code.code` is the literal building S-code (e.g. `31 Park - Material Pickup` → `S0020`; `38 Whit - Material Pickup` → `S0008`). The importer reads property only from the vendor project (no S-code) and ignores the cost code → unallocated. **Fix is clean: when the project yields no S-code, use `job_code.code` if it matches `/^S\d+/`. No mapping table needed — the code IS the S-code.** | Live raw pull via `scripts/wy-pull-timecards.mjs`; verified in code (no path uses cost code for property; `workyard-api.ts:306`). | Conversation 2026-06-19 (adversarial verify + live data); `workyard-api.ts:306,327-346`; `import/page.tsx:67` | **active — fix SHIPPED 2026-06-19** in `workyard-api.ts` (recovers the S-code from `job_code.code`/name when the project is a vendor; typechecks clean) |
| 0.3 | **Supply-run hours are NOT overhead-spread.** They bill to the specific building the materials were for, via the cost code (0.1). (An earlier idea to treat "Office Park Hardware Cluster" like the `Office` overhead-spread was explicitly rejected.) | The building is knowable from the cost code, so the cost should land on that building, not be smeared across the portfolio. | Conversation 2026-06-19 | **active** |
| 0.4 | **`Office` time IS overhead-spread** — paid normally, spread across all billable properties by unit count, with management fee applying. (Distinct from 0.3.) | Office/admin time has no single billable building. | `config.ts:41-43`; agent memory `office-overhead-spread`; Conversation 2026-06-18 | **active** |
| 0.5 | **Unallocated hours (no building) are not paid — but this is a perception problem to fix with early, repeated, self-service notice, not a policy change.** Tell employees daily ("you have X unallocated hours, fix them in Workyard") before payday, not at payday. | Repeated all-hands have established the no-pay rule; the upset is from finding out too late with no record. | Conversation 2026-06-18; `UNALLOCATED_HOURS_NOTIFICATION_PRD.md`; `TIMESHEET_ADJUSTMENT_PRD.md:17` | **active** (policy); **proposed** (daily SMS) |
| 0.6 | **The Workyard time-cards API is read-only.** There is no approve / lock / "processed" / write endpoint for time cards. Any plan that depends on writing back to Workyard (e.g. "close out the week in Workyard") cannot use the documented API. | Confirmed against `WORKYARD_API_REFERENCE.md`; the client has zero write methods for time cards. | Conversation 2026-06-18; `WORKYARD_API_REFERENCE.md` (only `GET /time_cards`) | **active** |
| 0.7 | **Move the time-approval gate in-app; our app is the system of record, not Workyard.** Pull `submitted` (not only `approved`) cards and approve in-app, because of 0.6 the literal Workyard close-out is constrained — baseline is "in-app authoritative, no write-back, with re-pull drift detection." | Kills the "approved in Workyard ≠ what I was paid" disputes by having one authoritative number. | Conversation 2026-06-18; `IN_APP_TIME_APPROVAL_PRD.md` | **proposed** |
| 0.8 | **Manual hours added in our app are normal and expected; DB > Workyard-CSV is not an error.** For many field workers the adjustment screen is the *primary* entry tool, not a correction layer. Only DB **<** CSV (we captured less than Workyard) is a real under-capture to investigate. Do not flag manager-added hours as overpayment. | Managers reconstruct dispatched work that never made it into Workyard. | Agent memory `manual-hours-vs-workyard`; `TIMESHEET_ADJUSTMENT_PRD.md:13-16` | **active** |
| 0.9 | **Give employees a visible pay record (clocked → adjustments → paid).** The "missing hours" upset is largely an invisibility problem — the full audit trail exists but is manager-only, and there is no employee pay stub. | Converts "you shorted me" into a self-serve explanation. | Conversation 2026-06-18 | **proposed** (no PRD yet — see §9) |
| 0.10 | **Workyard cost-code names are BILINGUAL: `<building/prefix> - <English> / <Spanish>`.** e.g. `31 Park - Material Pickup / Recogida de Materiales`; activity keepers like `Maintenance / Mantenimiento`, `Turnover / Vacante`. The `code` field stays the machine key (per-building = the building S-code, e.g. `S0020`; activity keepers = EN mnemonic, e.g. `MAINT`). Spanish-speaking field crew and the English office/customer invoices both read one name; `activityOf()` already matches either language. **Supersedes** the earlier "name = Spanish only" rename in `scripts/cleanup-cost-codes.mts`. | One name serves the bilingual workforce + English billing. | Conversation 2026-06-19 (format: "`31 Park - <EN+ES>`") | **active — DONE 2026-06-19**: 53 codes renamed (41 building Material-Pickup → `… / Recogida de Materiales`; 12 keepers → `EN / ES`) via `scripts/wy-rename-costcodes-bilingual.mjs`. 15 legacy/duplicate codes left for separate cleanup. **Then ABBREVIATED 2026-06-19** (field crew is mixed EN+ES → bilingual stays, per 0.12; names were too long): buildings → `<building> - Materials / Materiales`, long keepers shortened (e.g. `Maint / Manten`, `Dumpster / Desborde`, `Bulky / Voluminoso`) — 49 renamed, 0 failed. |
| 0.11 | **New acquisitions are onboarded in BOTH places:** (a) a `properties` row whose `code` = the building S-code, and (b) a per-building "Material Pickup" cost code in Workyard whose `code` = that S-code, **bilingual name** (per 0.10), attached to the vendor projects. The import fix (0.2) is generic over S-codes, so no per-acquisition code change — but (b) is manual (Workyard API can't create cost codes). | Without (b), a new building can't be tagged on supply runs and its hours land unallocated. | Conversation 2026-06-19; `WESTEND_WORKYARD_SETUP.md` | **active** (onboarding checklist) |
| 0.12 | **Per-worker language dropdowns are NOT achievable in Workyard — confirmed by live API probe.** Employees carry no locale/language field; a cost code has a single `name` (no translations); `cost_code_group` is null/unused and the groups endpoint is inaccessible (401); the only used employee group is "Construction"; cost-code visibility is purely the project's `cost_code_ids` (identical list for everyone at that project). So "English group / Spanish group per worker" can't be done inside Workyard. **Decision: Workyard holds ONE set keyed by the stable `code`; language lives in app(s) we own** — our app maps `code → {en,es}` for display (generalize `activityOf()`), and true per-worker language dropdowns are an own-app feature (point for `WORKYARD_REPLACEMENT_FEASIBILITY.md`). | Live probe `scripts/wy-probe-groups.mjs` (2026-06-19). | Conversation 2026-06-19 (Workyard investigation) | **active** |
| 0.13 | **Standing standard: any business choice must be adjustable in a settings tab, not hardcoded.** New/changeable business values live in `payroll_global_config` (scalars) or a dedicated config table (lists), surfaced in the admin settings UI; defaults = the prior code constant. FLSA 1.5× OT multiplier stays a code constant (statutory, not a business choice). | The owner must be able to change a business rule without a deploy. | Conversation 2026-06-19 (user); the parallel hardening session already config-ified tax/WC/phone/OT-threshold | **active** (standard going forward) |
| 0.15 | **Workyard create API: `POST /projects` WORKS, `POST /cost_codes` 404s (live-probed 2026-06-19).** Corrects WESTEND_WORKYARD_SETUP's "API can't create projects." ⇒ onboarding a building: the DB `properties` row **and** the Workyard **project** are API-automatable; the per-building Material-Pickup **cost code is manual UI** (or skip it and have the worker tap the building **project** at the vendor — which the import fix also resolves). Westend (S0042–S0067): 25/26 projects missing (S0049 exists but mis-named "West End Portfolio"), 0 Material-Pickup codes. Clusters = 10 vendor projects: Park Hardware, Home Depot ×3 (W.Htfd/Bloomfield/Glastonbury), Lowes-Bloomfield, Bender Plumbing, Express Kitchens, New England Gypsum, All Waste ×2. | Live probes `scripts/wy-probe-create.mjs`, `scripts/wy-westend-status.mjs`. | Conversation 2026-06-19 | **active** (finding) |
| 0.16 | **Full Workyard onboarding API reality (live-probed 2026-06-19):** `POST /projects` works but **requires `geofence_id`**; `POST /geofences` works but needs an `ext_address_id` (geocoded) so net-new geofences are effectively manual; `POST /cost_codes` 404s (manual). **Westend geofences already exist** (15, grouped by street). ⇒ realistic "one move per acquisition" = command that (a) ensures the DB `properties` row, (b) creates the Workyard **project** reusing the address's existing geofence, (c) emits the **manual** cost-code step (code=S-code, name "`<bldg> - Materials / Materiales`", attach to own project + the 10 clusters). The **cost code is always the manual tail** — Workyard's API can't create it. Tool: `scripts/wy-onboard-buildings.mjs`. **RESULT 2026-06-19:** all 26 Westend projects now exist — 25 auto-created (ids 754218–754242, reusing street geofences); `S0049` rename failed (`PUT /projects` 404s — projects can't be updated via API; rename is cosmetic since it already resolves by S-code). 26 Material-Pickup cost codes remain a **manual UI** task → `WESTEND_ONBOARDING_CHECKLIST.md`. Also: duplicate DB `properties` row on code `S0042` (a "Westend Portfolio - Bookkeeping" aggregate shares the code) — needs dedupe so resolution isn't ambiguous. | Live probes `wy-probe-geofences.mjs`, `wy-onboard-buildings.mjs`. | Conversation 2026-06-19 | **active** (finding) |
| 0.14 | **Usage data flips the "legacy" assumption (35-day live pull):** the actively-tapped cost codes are the **numeric/English** ones, and the bilingual **mnemonic "keepers" are mostly dead**. Top workhorses: `001 Construction (General)` 739h/192 uses, `2 Construction & Major Repairs` 397h, `01 Work Order-Standard` 187h, `02 Work Order-Section 8` 114h, `03 Turnover` 31h, plus mnemonics `OFFICE`/`DUMP`/`SHOW` (143/137/85h). Near-dead: `CONST` 20h, `MAINT` 9.6h, `TURN` 3h; **zero use**: `SNOW`,`VEH`,`WASTE`,`3 Turnovers`,`5 Bulky Waste`. ⇒ (a) "get rid of legacy" must **not** delete the numeric codes — they're the live set; (b) the 0.10 bilingual rename mostly hit low-use codes, so the **active numeric codes are still English-only**; (c) **0-use ≠ dead for seasonal codes** (snow shows 0 in June — expected). | Live pull `scripts/wy-costcode-usage.mjs` (35d). | Conversation 2026-06-19 | **active** (finding) |
| 0.12 | **Off-cycle "quick bill" for missed hours is BILLING-ONLY and STANDALONE.** When hours get missed and pay is squared away separately (Excel/ADP), a one-off run bills the property/portfolio (labor × rate + 10% mgmt fee) as its own invoice — it does **not** pay the employee, create a payable time entry, touch ADP, or open/re-open a weekly run. Reuses unit-weighted spread + the `draft→approved→sent` flow. Needs a model change: `payroll_invoices.payroll_week_id` is currently `NOT NULL`, so off-cycle invoices need a `payroll_offcycle_runs` parent + an `invoice_type` discriminator with the week link relaxed. | The pay side gets handled ad hoc; the *charge* to the customer is what falls through. Xavier case 2026-06-19 (paid via Excel, never billed). | Conversation 2026-06-19; `OFFCYCLE_BILLING_RUN_PRD.md` | **proposed** (PRD drafted, not built) |

---

## §1 Payroll math

| Decision | Source | Status |
|---|---|---|
| Payroll tax rate = **8%** of gross (employer FICA/SUTA), applied only to employees with `pay_tax=true`. | `config.ts:9`; `PAYROLL_PRD.md:119` | active |
| Workers' comp rate = **3%** of gross, applied only to `wc=true`. | `config.ts:12`; `PAYROLL_PRD.md:120` | active |
| Phone reimbursement = **$8 / active employee / week**, added to gross AND spread unit-weighted across properties. Gated to employees with >0 hours that week (salaried always eligible). | `config.ts:15`; `PAYROLL_PRD.md:118,144`; `usePayrollAdjustments.ts` | active |
| **OT is recomputed weekly at a 40h threshold** for OT-eligible employees (W2 hourly, `ot_allowed`, non-construction): first 40 worked hrs = regular, 41+ = OT. The imported Workyard reg/OT split is overridden for these employees. Total hours are preserved. | `calculations.ts:218-238` | active |
| **Non-OT-eligible hours fold into regular** (contractors, construction, salaried, `ot_allowed=false`): OT column shows zero, all hours paid at straight time. Total hours preserved. | `calculations.ts:195-203` | active |
| OT hours are otherwise passed to ADP as **raw hours** — the 1.5× multiplier is applied by ADP, not this system. | `PAYROLL_PRD.md:72,165` | active |
| Gross pay = regular wages + OT wages + adjustments − deductions (advances). | `PAYROLL_PRD.md:180-190` | active |
| Advances/`deduction_other` reduce gross pay; employee-only allocation; reason required; running balance tracked. | `PAYROLL_PRD.md:146,150-151`; `calculations.ts:245` | active |
| Pre-fund cash estimate = Σ gross + Σ(gross×0.08) + Σ(gross×0.03); shown before ADP export. | `PAYROLL_PRD.md:193-197` | active |
| Salaried dept splits pre-fill weekly; employee overrides own with required reason; manager overrides anyone; all logged. (Option C.) | `PAYROLL_PRD.md:126-132` | active |
| Unallocated hours below **0.25h** (~15 min) are ignored (no hold/notify). | `unallocatedHolds.ts:14` | active |
| All money math rounds to 2 dp via `round2` (`Math.round(n*100)/100`). | `calculations.ts:483` | active |

## §2 Workyard import & allocation

| Decision | Source | Status |
|---|---|---|
| **Project = the building being billed (S-code, e.g. `S0024 - 10 Wolcott`). Cost code = the activity** (Construction, Maintenance, DUMP, MATL…) — **except** for vendor/supply runs where the cost code carries the building (see §0.1). | `DUMPSTER_ANALYSIS_PRD.md:37-38`; `WORKYARD_API_REFERENCE.md` | active |
| Property is resolved by extracting the S-code from the project name via `/^(S\d+)/` and matching `properties.code`. | `PAYROLL_PRD.md:61`; `import/page.tsx:67` | active |
| Multi-allocation time cards split into one row per allocation, hours distributed proportionally by `duration_secs`. **Each leg rounded independently at import (no largest-remainder) → small systematic loss on split cards.** (~93% of cards are multi-allocation.) | `workyard-api.ts:327-346` | active (rounding = known defect; PRP-02 Phase 6) |
| Only `status=approved` Workyard cards are imported today. (To be changed by §0.7.) | `PAYROLL_PRD.md:54-55`; `WORKYARD_API_REFERENCE.md:20` | active |
| `OVERHEAD_PROPERTY_NAMES = [unallocated, stanton management, stanton management llc]` → flagged for redistribution on import. | `config.ts:28-32` | active |
| `SPREAD_OVERHEAD_PROJECT_NAMES = [office]` → paid + unit-weighted spread + mgmt fee (whole-name match). | `config.ts:41-43` | active |
| Cost code is now persisted on import (`payroll_time_entries.cost_code` / `cost_code_name`) — additive; previously dropped. | `DUMPSTER_ANALYSIS_PRD.md:29`; commit `b8cc6a3` | active |
| Workyard org timezone = `America/New_York` for date boundaries. | `config.ts:46` | active |
| Workyard cannot create projects/cost codes via API (POST 404s) — setup is UI data entry only. | `WESTEND_WORKYARD_SETUP.md:5` | active |
| Dumpster history queries must use the **combined** date filter (`start_dt_unix=gte:<start>+lt:<end>`); the separate form 400s on the current token. | `DUMPSTER_ANALYSIS_PRD.md:61` | active |

## §3 Timesheet adjustment operations

| Decision | Source | Status |
|---|---|---|
| **Reassign**: net-zero per employee per day; original preserved; correction row links old→new property. | `TIMESHEET_ADJUSTMENT_PRD.md:53-61` | active |
| **Add**: net-new entry, `source=manual_manager`, reason required, no net-zero check. | `:64-72` | active |
| **Spread**: distribute hours evenly across selected portfolio properties; rows linked to a `payroll_spread_events` parent; reversible as a unit. | `:75-83` | active |
| **Remove**: `is_active=false` (never hard-deleted), reason + manager identity required; not allowed on approved weeks. | `:86-92` | active |
| Travel/daily bonus configured on the **property/project**, not the employee; per-day or flat-per-job; auto-applied when assigned. | `:99-105` | active |
| Carry-forward pays a prior-week underpayment in the **current** week, referencing the locked prior week; never unlock the prior week. | `:116-127` | active |
| Entry `source` ∈ {workyard, workyard_api, workyard_corrected, manual_manager, manual_spread, sms_employee(future), mileage_workyard(future)}. | `:166-178` | active |
| Adjustment UI target: resolve a typical unallocated block in **<30s**; week-grid-first, inline drawer, employee switcher with green/amber/blue status. | `TIMESHEET_ADJUSTMENT_UI_SPEC.md` | active |

## §4 Holds & notifications

| Decision | Source | Status |
|---|---|---|
| Unallocated employees over threshold can be **held** (pulled from run) and **SMS'd**; holds are per (week, employee); release requires a written reason; **waive** writes off only the no-property hours (keeps allocated pay). | `unallocatedHolds.ts`; `holds/route.ts` | active |
| SMS via Twilio with a **dry-run fallback** when creds absent — going live = adding `TWILIO_*` to Infisical, no code change. | `twilio-api.ts` | active |
| `payroll_notifications` is the send outbox (channels sms/email; email defined, unused). | `types.ts` | active |
| Current hold SMS says "come into the office with a written reason" — **to be replaced** by self-service "fix it in Workyard" + a daily cron cadence. | `UNALLOCATED_HOURS_NOTIFICATION_PRD.md` | proposed |

## §5 Billing, invoicing & reconciliation

| Decision | Source | Status |
|---|---|---|
| Management fee = **10%** of direct costs, per-portfolio effective-dated config, shown as an explicit auditable invoice line. | `PAYROLL_PRD.md:174-189` | active |
| Invoice = direct labor (hours×rate) + spread costs (unit-weighted reimbursements/tools) + mgmt fee line + per-property total. | `:205-210` | active |
| Unit-weighted allocation = cost ÷ total portfolio units × each property's unit count, across all active properties. | `:167-169` | active |
| Park Portfolio sub-LLCs are invoiced individually, each a line on the consolidated statement. | `:215,220` | active |
| Statement gate: reimbursements-only variance ⇒ proceed; any other non-zero variance ⇒ blocked pending investigation. | `:232-234` | active |
| ADP reconciliation auto-compares submitted vs actuals, flags variance, stores in `payroll_adp_reconciliation`. | `:247-251` | active |
| Invoice status flow: draft → approved → sent. | `:223` | active |
| Portfolio map: SREP Southend (S0002-09), Hartford 1 (S0010,S0019), Northend (S0011-18), Park 1-12 (per sub-LLC), Westend (S0049 + the 26-building split), 90 Park St (S0001), External (Zimmerman, New City/Dvoskin). | `:211-218`; `WESTEND_WORKYARD_SETUP.md` | active |
| On invoices, the `OFFICE` cost code maps to the customer-facing label "Tenant Coordination". | `TENANT_DOCUMENT_COORDINATION_PRD.md:29` | active |

## §6 Approvals & locking

| Decision | Source | Status |
|---|---|---|
| Sequential approval chain: timesheet corrections → payroll calc → invoices → statement → ADP export; each stage unlocks the next. | `PAYROLL_PRD.md:282-286` | active |
| Payroll cannot advance to calculation while any flagged or `pending_resolution` entries remain. | `:102`; `TIMESHEET_ADJUSTMENT_PRD.md:185-192` | active |
| Approved records are locked/read-only; approved weeks immutable; no silent post-approval changes. | `:289,295-301` | active |
| Each approval records user, timestamp, role; stages = timesheet/payroll/invoice/statement (`payroll_approvals`). | `:288` | active |

## §7 Data model, security & reliability

| Decision | Source | Status |
|---|---|---|
| All payroll tables `payroll_`-prefixed; read canonical tables only; never write AF-Authoritative columns. | `PAYROLL_PRD.md:307`; `DATABASE_ARCHITECTURE.md:52` | active |
| No hard deletes — soft `is_active=false`. Money = `NUMERIC(10,2)`; status = lowercase TEXT + CHECK. All tables carry created_at/updated_at/created_by. | `:455-458` | active |
| Employee rates use an effective-date history model (new row per change, never overwrite). | `:331` | active |
| RLS required on every payroll table; **current permissive `USING(true)` policies are a known CRITICAL hole** to be tightened to portfolio/role scope. | `PAYROLL_PRD.md:34-38`; `audit/prps/01_PRP_RLS_Authz_Remediation.md`; agent memory | active (remediation pending) |
| `anon` must have no write access; role-resolver functions must not fail-open to `manager`. | `audit/prps/01`, `03` | active (remediation pending) |
| Audit log is append-only (no UPDATE/DELETE), RLS-enabled, records actor/op/input/result/original NL prompt. | `HANDOFF.md:119-121` | active |
| Operation layer: Zod-validated, side-effect-free `plan()` preview + audited `commit()`; execute paths re-plan server-side, never trust client preview. | `HANDOFF.md:122-138` | active |
| NL agent model = `claude-sonnet-4-6`, override via `PAYROLL_AGENT_MODEL`. | `HANDOFF.md:142` | active |
| Single payroll math engine (`calculations.ts`) is the one source of truth for pay numbers. | `audit/prps/02_PRP_Payroll_Math_Single_Engine.md` | active |

## §8 Parked / future (deliberately not now)

| Item | Source | Status |
|---|---|---|
| Expense & reimbursement submission (no-receipt-no-submission; payment-method routing to Kathleen; gas allocation by visit-weighting). | `EXPENSE_REIMBURSEMENT_PRD.md` | proposed/future |
| Mileage reimbursement from Workyard data (source `mileage_workyard` reserved). | `TIMESHEET_ADJUSTMENT_PRD.md:148-154` | future |
| SMS employee confirmation of hours (source `sms_employee` reserved). | `:156-162` | future |
| Dumpster overflow analysis — build **after** cost-code cleanup lands. | `DUMPSTER_ANALYSIS_PRD.md:4` | parked |
| Tenant document coordination cost tracking — sibling of dumpster, build separately. | `TENANT_DOCUMENT_COORDINATION_PRD.md:4` | parked |
| Cost-per-unit dashboard UI (data structure only in Phase 1). | `PAYROLL_PRD.md:274` | parked |
| Budget threshold alerts — blocked on management-provided thresholds. | `PAYROLL_PRD.md:268` | parked |
| Build our own Workyard replacement (clock-in photo + geofence) — feasible but a serious ongoing mobile product; **fix approvals in-house first** instead. | `WORKYARD_REPLACEMENT_FEASIBILITY.md` | future / not recommended as a near-term fix |

## §9 Open questions (NOT yet decided)

| Question | Why it matters | How to settle |
|---|---|---|
| ~~On supply runs, are employees actually tapping the building cost code?~~ **RESOLVED 2026-06-19: YES.** Live data shows they tap "31 Park - Material Pickup" etc. So §0.2 is a pure **import bug**, not a compliance gap (for these hardware-cluster hours). | — | Confirmed via `scripts/wy-pull-timecards.mjs`. |
| ~~Is `job_code.code` the literal S-code or a code needing a mapping table?~~ **RESOLVED 2026-06-19: it is the literal S-code** (`S0020`, `S0008`). No mapping table needed. | — | Confirmed via raw pull. |
| Separately, **genuinely-untagged time also exists** (e.g. one card had a 5.95h allocation with no project, no geofence, no cost code). That portion is a real compliance gap → the unallocated SMS (§0.5) is the right tool for it. | Distinguishes the import-bug hours (fixable in code) from the truly-untagged hours (need employee action). | Same raw pull. |
| Should we build the **26 per-building Westend Material Pickup cost codes**, or one consolidated `Westend - Material Pickup`? | Per-building material granularity vs. less hand-entry. | Business call (`WESTEND_WORKYARD_SETUP.md:55`). |
| Does Workyard offer **any** write/approve/lock API (for §0.7 close-out)? | Decides Option A vs B/C/D in the in-app-approval PRD. | Ask the Workyard account owner. |
| Employee pay-transparency record (§0.9) — is it wanted, and where (portal)? | Addresses the root of "missing hours" upset. | Decision + a PRD if yes. |
| Confirm the Spanish for "Material Pickup" — used **`Recogida de Materiales`**. Is that crew-natural (vs `Compra de Materiales`)? | Field-crew clarity. | Re-run `scripts/wy-rename-costcodes-bilingual.mjs` with a different `MATERIAL_PICKUP_ES`. |
| 15 legacy/duplicate cost codes left untouched: numeric `001/01/02/03/05/1–9` (English dups of the keepers) + two **empty-code** codes "Garbage cleanup (Bulkywaste)" / "Construction (Waste and debris dumping)". Retire (archive) or bilingual-rename? **NB: several are actively tapped by the crew right now** (001, 03, 02, 1, both empty-code ones) — archiving blind would strand them mid-week. | The empty-code ones carry no S-code → they push hours unallocated when used without a building. | Decide a single canonical set; ensure the replacement is attached to the same projects before archiving the dup; archive path probed in `scripts/cleanup-cost-codes.mts`. |
| ~~Workyard single-set language: bilingual or Spanish-only?~~ **RESOLVED 2026-06-19: BILINGUAL.** The field crew is mixed EN+ES, so the one Workyard set must serve both; names abbreviated to keep length down (0.10). | — | Confirmed by user (crew is es and en). |
| Retiring junk cost codes: **Workyard's API ignores the archive flag** (`PUT is_archived:true` → 200 but no effect — verified). The only API removal is hard **DELETE** (irreversible; new id on re-create). User picked "retire obvious junk" = `3 Turnovers`, `5 Bulky Waste Cleanup`, `8 Vehchles` (each 0–1 use, live equivalent attached). | No reversible archive available via API. | Either delete those 3 in the **Workyard admin UI** (safe, ~30s), or authorize the API DELETE (`scripts/wy-archive-junk-costcodes.mjs --apply`). |
| **Cost-code consolidation direction (BUSINESS DECISION, see 0.14).** Two overlapping generations exist (numeric English vs mnemonic bilingual). Recommended: make the **active** codes canonical + bilingual, retire only true dead duplicates, **keep** real billing distinctions (`001` Construction General vs `2` Major Repairs; `01` WO-Standard vs `02` WO-Section 8), **don't** retire seasonal codes (snow) on summer 0-use, and fix the 2 empty-code codes (`Garbage cleanup` 18h, `Construction-waste` 3h → give a code + bilingual name). | Wrong direction deletes the crew's most-used codes or loses billing detail. | User picks direction → then safe execute (ensure canonical attached to same projects before archiving any dup). |
| Config-ify the Workyard/allocation business choices per 0.13: `OVERHEAD_PROPERTY_NAMES` + `SPREAD_OVERHEAD_PROJECT_NAMES` (lists → config table/JSON) and `UNALLOCATED_HOLD_THRESHOLD_HOURS` (scalar → `payroll_global_config`). | Currently hardcoded in `config.ts`/`unallocatedHolds.ts`. | Do with the settings-tab work (parallel session owns `payroll_global_config` + settings UI), not on the cost-code branch — avoids a merge conflict. |

---

### Changelog
- **2026-06-19** — Log created; seeded from all PRDs/PRPs/config/memory and the 2026-06-18/19 sessions (§0.1–0.9 newly recorded).
- **2026-06-19** — Added §0.12 (off-cycle billing-only quick bill); see `OFFCYCLE_BILLING_RUN_PRD.md`.
