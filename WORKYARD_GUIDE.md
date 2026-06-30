# Workyard — Full Platform Guide (Stanton)

**What this is:** the complete picture of Workyard for Stanton — what it is, the data model, the features we use today, the features we could turn on, the exact API capability matrix (what works vs what doesn't, measured live), and how it all feeds payroll. For endpoint-level detail see `WORKYARD_API_REFERENCE.md`; for the live decisions/limits see `DECISIONS_LOG.md` §0.1–0.16.

**One-sentence frame:** Workyard is our **field time-capture system** — crews clock in/out on a phone with GPS, tag the work to a building and an activity, and we pull that into payroll to pay people and bill properties.

**Our org:** `25316` (Stanton Management), timezone `America/New_York`, location tracking required, breaks unpaid. API key lives in Infisical (`prod`, project `b974f539-…`), never in files.

---

## 1. The data model (and how each piece maps to payroll)

Workyard's objects, top to bottom, with the Stanton meaning:

| Workyard object | What it is | Stanton convention | Maps to (our DB) |
|---|---|---|---|
| **Org** | The company account | `25316` | — |
| **Customer** | Bill-to legal entity | the LLCs: `SREP Westend LLC`, `SREP Southend LLC`, `SREP Park 1–12 LLC`, `SREP Hartford 1 LLC`, `SREP Northend LLC`, `STANTON REP 90 PARK ST LLC`, plus external (Zimmerman) | invoice grouping / `portfolios` |
| **Project** | A job/place the crew clocks to | **Building** named `S00xx - <address>` (the S-code is the key). **Vendors** are also projects (Home Depot, Park Hardware…) with no S-code | `properties.code` (via the S-code) |
| **Geofence** | GPS boundary that auto-suggests the project on arrival | one per building or street-cluster; vendors have their own | not stored; drives clock-in only |
| **Cost code** (`job_code`) | The **activity** tag on time | two kinds: **activities** (`MAINT`/Mantenimiento, `CONST`, `DUMP`, etc.) **and** per-building **"Material Pickup"** codes whose `code` *is* the building S-code (`S0020` = 31 Park) — used on supply runs at a vendor | `payroll_time_entries.cost_code`; on supply runs the S-code in here resolves the building |
| **Time card** | One clock-in→out shift | GPS or manual; carries `cost_allocations[]` (one per project/activity segment) | `payroll_time_entries` (one row per allocation) |
| **Employee** | A worker | synced; `mobile`→phone, `pay_rate`, status | `payroll_employees` (`workyard_id`) |

**The resolution chain (how a clocked hour becomes paid + billed):**
`time card → cost_allocation → org_project_id → project name → S-code → properties.code → the building`. On supply runs the project is the *vendor* (no S-code), so the importer falls back to the **cost code's** S-code (e.g. `S0020`). No S-code anywhere = **unallocated** = held/unpaid until fixed.

**The approval lifecycle:** `working → submitted → approved → processed → deleted`. Today we import only `approved` cards; the manager approves in Workyard first.

---

## 2. Features we USE today

- **GPS time tracking** — clock in/out on the mobile app, GPS-stamped, geofence-aware. The core feed.
- **Cost allocation** — worker tags each segment to a project (building) + cost code (activity / building-for-materials). This is what makes per-property billing possible.
- **Projects** — the 26 Westend buildings + all other S-code buildings + vendor projects. (Created/maintained via API where possible — see matrix.)
- **Cost codes** — activity set (bilingual `EN / ES`) + per-building Material-Pickup codes. (Renamed via API; created only in the UI.) **Canonical standard (2026-06-23):** every building project carries the **12 bilingual activity codes** (`MAINT CONST TURN WASTE DUMP OFFICE PEST SHOW SNOW VEH LAWN APPL`) **+ its own per-building "Materials" code**; the legacy numeric/zero-padded duplicate codes were deleted org-wide on 2026-06-23 (`DECISIONS_LOG.md` §0.22). New buildings get the 12 auto-attached via `scripts/wy-onboard-buildings.mjs`.
- **Geofences** — per-building/street + vendor "clusters"; auto-suggest the project at the jobsite.
- **Employees** — roster + pay rate + mobile, synced into `payroll_employees`.
- **Manager approval** — review/correct/approve time cards before we pull them.
- **API pull into payroll** — weekly import of approved time cards → `payroll_time_entries` → pay + invoices.

**The 10 vendor "clusters"** (where supply runs are logged; per-building Material-Pickup codes attach here): Park Hardware · Home Depot ×3 (West Hartford / Bloomfield / Glastonbury) · Lowes-Bloomfield · Bender Plumbing · Express Kitchens · New England Gypsum · All Waste ×2.

---

## 3. Features we are NOT using but COULD

These exist in Workyard (visible in the app / API) and may be worth turning on:

| Feature | What it does | Possible value for us |
|---|---|---|
| **Clock-in photo** | Selfie/jobsite photo required at clock-in (`is_clock_in_photo_required` already true on cards) | Proof-of-presence; the "photo when they start work" you wanted from a custom app — Workyard already has it |
| **Scheduling / Tasks** (`/tasks`) | Assign work orders to employees/days with project + cost code + checklist | Dispatch crews in Workyard so the allocation is pre-set → fewer unallocated hours |
| **Project Forms / checklists** | Site-inspection / daily-report forms tied to clock-in | Turnover checklists, condition reports |
| **Expenses + Workyard Visa** | Field expense capture (receipt photo) + a debit card | Could replace/feed the `EXPENSE_REIMBURSEMENT_PRD` flow (materials, gas) |
| **Mileage** | Drive-time/mileage tracking allocated to projects | Feeds the mileage-reimbursement feature instead of manual CSV |
| **Live map / who's-on-site** | Real-time crew locations | Ops visibility |
| **Breaks** (`paid/unpaid_break_secs`) | Tracked per card; we currently take Workyard's net `regular_secs` | If we ever pay breaks, the data's already there |
| **Cost code groups** | Organize codes into groups (`cost_code_group_id`) | Tidy the code list; NOT a per-worker-language mechanism (see §5) |

---

## 4. API capability matrix (measured live, 2026-06-19)

This is the hard-won part — what the API will and won't let us do. **Read this before planning any automation.**

| Operation | Endpoint | Works? | Notes |
|---|---|---|---|
| List time cards | `GET /time_cards` | ✅ | Filter by status + date. **Date filter must be combined:** `start_dt_unix=gte:<a>+lt:<b>` (separate form 400s). Rate limit 60/min. |
| Create/approve/lock time card | — | ❌ | **No write API for time cards.** Approval/lock happens only in the Workyard UI. Pull is read-only. |
| List projects | `GET /projects` | ✅ | `include=cost_codes,geofences,managers,customer` |
| **Create project** | `POST /projects` | ✅ | Requires `name` + `org_customer_id` + **`geofence_ids`** (must reuse/attach a geofence). |
| Update/rename project | `PUT /projects/{id}` | ❌ | **404 — projects can't be updated via API.** Renames are UI-only. |
| List geofences | `GET /geofences` | ✅ | |
| Create geofence | `POST /geofences` | ⚠️ | Exists but needs an `ext_address_id` (geocoded) — effectively UI-only for net-new. |
| List cost codes | `GET /cost_codes` | ✅ | |
| **Create cost code** | `POST /orgs/{org_id}/cost_codes` | ❌ (API) / ✅ (UI CSV) | **No API create route — 404** (verified 2026-06-23: org-scoped, un-scoped, hyphen, singular, project-nested POSTs all `404 ResourceNotFound`; control `POST /projects` 400-validates). **But the UI has a fast bulk path: Project Hub → Cost Codes → "+ Cost Code" → Import Cost Codes → Spreadsheet (CSV).** Template headers are **`Cost_Code_Name,Cost_Code_Number`** (name first; the help-doc "Code,Name" is wrong). 26 Westend codes created this way 2026-06-23 (`scripts/westend-material-costcodes.csv`). |
| Rename cost code | `PUT /cost_codes/{id}` | ✅ | Used for the bilingual rename (53 codes). Body: `{name, code, include_all_projects:false}`. (`PATCH` 404s.) |
| Archive cost code | `PUT … {is_archived:true}` | ❌ | Accepted (200) but **silently ignored** — no archive via API. |
| Delete cost code | `DELETE /cost_codes/{id}` | ✅* | Works, but irreversible; *our agent harness gates it* (needs an explicit permission rule). |
| **Attach cost code ↔ project** | `PUT /orgs/{org_id}/cost_codes/{id}` w/ `project_ids` | ✅ | **Works — corrected 2026-06-23.** The cost-code PUT accepts a `project_ids` array and sets the associations (body: `{name, code, include_all_projects:false, project_ids:[…]}`). Verified by attaching all 26 Westend codes to 8 projects each (`scripts/wy-attach-westend-costcodes.mjs`). The old "effectively UI (since `PUT /projects` 404s)" was wrong — you set attachments from the **cost-code** side, not the project side. |
| List employees | `GET /employees.v2` | ✅ | `include=employee_groups`; `mobile`, `pay_rate`, `status` |
| Org settings | `GET /orgs/{id}` | ✅ | timezone, location-tracking, breaks-paid flags |

**Plain-English takeaway:** you can **read everything**, **create projects**, **rename/delete cost codes**, and **attach cost codes to projects** (`PUT …/cost_codes/{id}` with `project_ids`); you **cannot create cost codes or update projects or write time cards** via API. So onboarding a building is **mostly scripted** — the API creates the project and (once the code exists) attaches it; only the cost-code *creation itself* is UI (and the UI's **CSV bulk import** makes even that a one-shot for many buildings).

---

## 5. Hard limits & gotchas (don't relearn these)

- **No cost-code creation API** (`POST …/cost_codes` returns 404 on every path variant — verified 2026-06-23) → per-building Material-Pickup codes must be created in the **Workyard UI**. You *can* rename and delete existing codes via API, just not create. (An earlier doc claimed create worked; it never did — the route doesn't exist.)
- **No time-card write API** → "approve/close out in Workyard from our app" isn't possible; approval stays in Workyard or moves fully in-app (see `IN_APP_TIME_APPROVAL_PRD.md`).
- **No project update API** (`PUT` 404) → renames (e.g. `S0049- West End Portfolio` → `… 242-244 S Whitney`) are UI-only and cosmetic (the S-code prefix is what resolves).
- **No per-worker language.** Employees have no locale field; a cost code has one `name`; visibility is by project attachment, not language. So a mixed EN+ES crew shares **one bilingual** code set; true per-language dropdowns would require our own app.
- **Building lives in the cost code on supply runs.** The vendor is the project; the building S-code rides in the cost code. The importer must (and now does) parse it.
- **Date filter format** is the combined `gte:…+lt:…` form, or you get a 400.
- **Geofences are grouped by street** (e.g. "150 and 154 S Whitney") — multiple buildings per geofence is normal.

---

## 6. Onboarding a new building (the repeatable move)

1. **DB:** ensure a `properties` row with `code = <S-code>` (normal property onboarding).
2. **Project + 12 activity codes (API):** `node scripts/wy-onboard-buildings.mjs --scode <S> --name "<addr>" --customer <LLC_id> --geofence <id> --apply` → creates the Workyard project reusing an existing geofence **and auto-attaches the 12 canonical bilingual activity codes** (`MAINT CONST TURN WASTE DUMP OFFICE PEST SHOW SNOW VEH LAWN APPL`).
3. **Materials cost code (UI only — no API):** in Workyard, create `<addr> - Materials / Materiales`, code `<S>`, attached to its project + the shared vendor/Office clusters (**7** per the live convention — Office + Park Hardware, Home Depot-Glastonbury, Lowes-Bloomfield, Express Kitchens, New England Gypsum, All Waste — not the 10 the old checklist listed). (Only the per-building Materials code is manual now; the 12 activity codes ship via step 2.)
4. Done — supply runs and on-site time now resolve to the building.

See `MANUAL_TASKS_HANDOFF.md` for the current Westend to-do and `WESTEND_WORKYARD_SETUP.md` for the full building list.

---

## 7. Tooling we built (read-only unless noted)

`scripts/`: `wy-pull-timecards.mjs` (inspect raw cards) · `wy-list-costcodes.mjs` · `wy-costcode-usage.mjs` (usage + attachment) · `wy-westend-status.mjs` · `wy-probe-create.mjs` / `wy-probe-geofences.mjs` (capability probes) · `wy-find-customer.mjs` · `wy-rename-costcodes-bilingual.mjs` (write: rename) · `wy-onboard-buildings.mjs` (write: create projects) · `wy-archive-junk-costcodes.mjs` (write: delete, gated).

Run any via: `MSYS_NO_PATHCONV=1 infisical run --projectId=b974f539-54dc-4687-9afd-941d95d434c9 --env=prod --recursive -- node scripts/<name>.mjs`
