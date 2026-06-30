# Workyard API Reference
## Stanton Management — Payroll System Integration

**API Base URL:** `https://api.workyard.com`  
**Org ID:** `25316` (Stanton Management)  
**Auth:** `Authorization: Bearer <WORKYARD_API_KEY>` header  
**Rate Limit:** 60 requests/minute — implement exponential backoff on 429  

---

## Payroll Import Workflow

This documents the **two-stage adjustment process** used for weekly payroll:

| Stage | System | What Happens |
|---|---|---|
| **1 — Time Tracking & Initial Approval** | **Workyard** | Employees clock in/out (GPS or manual). Managers review, make clock corrections and time adjustments, and give **initial approval** inside Workyard. |
| **2 — Allocation & Final Processing** | **Payroll System** | Pull approved time cards via API. Adjust property allocation, apply timesheet corrections, run dept splits, reconcile against ADP, and generate final invoices. |

**Key rule:** Only time cards with `status = approved` are imported into the payroll system.  
The lifecycle is: `working → submitted → approved → processed → deleted`

### Weekly Import Steps
1. Employees clock in/out throughout the week in Workyard
2. Manager reviews time cards in Workyard — makes any clock corrections / edits
3. Manager approves each time card in Workyard (status → `approved`)
4. Admin opens **Payroll → Import → Pull from API** and selects the target week
5. System fetches all approved cards for the week date range
6. Preview: match employees and properties, flag overheads and unknowns
7. Import → corrections queue for flagged entries → Review → ADP export

---

## Authentication

```
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

Generate token: Workyard Dashboard → Integrations → API Token → Generate API Token

The token is a JWT. The current token for Stanton Management is stored in `WORKYARD_API_KEY` (`.env.local`).

---

## Endpoints Reference

### Organization

#### `GET /orgs`
Returns the organization details for the authenticated user.

**Response:**
```json
{
  "id": 25316,
  "name": "Stanton Management",
  "state": "ct",
  "country_code": "us",
  "timezone": "America/New_York",
  "time_round_minutes": 1,
  "requires_cost_allocation": false,
  "requires_location_tracking": true,
  "is_split_tc_enabled": false,
  "is_breaks_paid": false,
  "subscription_status": "activated"
}
```

---

### Employees

#### `GET /orgs/{org_id}/employees.v2`
List employees with optional filters.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | string | Filter: `eq:active`, `eq:removed`, `eq:saas_disabled`, or comma-separated |
| `employee_id` | string | Filter by employee ID: `eq:12345` |
| `email` | string | Filter by email: `eq:john@test.com` |
| `employee_display_name` | string | Filter by name: `like:carlos%` |
| `include` | string | `employee_groups` to include team membership |
| `limit` | int | Page size (default 100, 0 = all) |
| `page` | int | Page number |
| `sort_by` | string | `asc:employee_display_name`, `desc:created_at` |

**Response schema (`BasicEmployeeResource`):**
```json
{
  "employee_id": 155283,
  "org_id": 25316,
  "first_name": "Carlos",
  "last_name": "Ramirez",
  "display_name": "Carlos Ramirez",
  "email": "carlos@example.com",
  "mobile": "+1...",
  "title": "Maintenance",
  "photo_url": "https://...",
  "is_time_tracking_enabled": true,
  "is_breaks_paid": false,
  "requires_cost_allocation": false,
  "status": "active",
  "pay_type": "hourly",
  "pay_rate": 22.50,
  "role": { "id": 3, "name": "worker", "display_name": "Worker" },
  "remuneration": {
    "id": 123,
    "effective_dt_unix": 1700000000,
    "pay_rate": 22.50,
    "pay_type": "hourly",
    "is_breaks_paid": false,
    "exemption_status": "non-exempt"
  }
}
```

**Payroll mapping:** `employee_id` → `payroll_employees.workyard_id`

---

#### `GET /orgs/{org_id}/time_approvers`
List employees who can approve time cards.

---

### Time Cards

#### `GET /orgs/{org_id}/time_cards`
List time cards with filters. **This is the primary endpoint for payroll import.**

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | string | **Required for import:** `eq:approved` |
| `start_dt_unix` | string | Filter by start date: `gte:1700000000` |
| `end_dt_unix` | string | Filter by end date: `lt:1700604800` |
| `employee_ids` | string | Comma-separated employee IDs |
| `include` | string | `cost_allocations,worker,notes,breaks` |
| `limit` | int | Page size (default 2, max 100) |
| `page` | int | Page number |

**Time card statuses:**
- `working` — currently clocked in
- `submitted` — employee submitted, awaiting approval
- `approved` — **manager approved in Workyard** ← we import these
- `processed` — exported to ADP / finalized
- `deleted` — voided

**Response schema (`TimeCardFullResource`):**
```json
{
  "id": 4521337,
  "type": "gps",
  "employee_id": 155283,
  "start_dt_unix": 1772456520,
  "end_dt_unix": 1772481600,
  "status": "approved",
  "timezone": "America/New_York",
  "organization_id": 25316,
  "organization_name": "Stanton Management",
  "time_summary": {
    "duration": 8.75,
    "regular": 8.0,
    "over_time": 0.75,
    "double_time": 0.0,
    "paid_break_time": 0.0
  },
  "time_summary_v2": {
    "duration_secs": 31500,
    "regular_secs": 28800,
    "over_time_secs": 2700,
    "double_time_secs": 0,
    "paid_break_secs": 0,
    "unpaid_break_secs": 0
  },
  "breaks": [
    {
      "id": 123,
      "start_dt_unix": 1772467200,
      "end_dt_unix": 1772469000,
      "duration_secs": 1800,
      "is_paid": false
    }
  ],
  "cost_allocations": [
    {
      "org_project_id": 402725,
      "geofence_id": 578908,
      "geofence": {
        "id": 578908,
        "name": "159, 163, 167 Sisson",
        "place": { "latitude": 41.76, "longitude": -72.70 },
        "type": "client_project",
        "geofence_type": "polygon"
      },
      "job_code_id": 100480,
      "job_code": { "id": 100480, "name": "Construction", "code": "001" },
      "duration_secs": 31500
    }
  ],
  "cost_allocations_source": "auto",
  "worker": {
    "employee_id": 155283,
    "display_name": "Carlos Ramirez",
    "first_name": "Carlos",
    "last_name": "Ramirez",
    "org_id": 25316
  },
  "alerts": [],
  "is_sample_data": false,
  "details": {
    "is_auto_clockin": false,
    "is_auto_trim_clockout": false,
    "is_auto_hours_limit": false,
    "is_restricted_clockin": true,
    "is_clock_in_photo_required": true
  }
}
```

**Response also includes aggregate `time_summary` and `meta` pagination:**
```json
{
  "data": [...],
  "meta": {
    "current_page": 1,
    "last_page": 10,
    "total": 200,
    "per_page": 20
  },
  "time_summary": {
    "duration": 823585,
    "regular": 634570,
    "over_time": 188890
  }
}
```

---

### Projects

#### `GET /orgs/{org_id}/projects`
List all projects. Projects at Stanton Management are named with S-codes: `"S0024 - 10 Wolcott"`.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `limit` | int | Page size |
| `page` | int | Page number |
| `archived` | bool | Include archived projects |
| `include` | string | `cost_codes,geofences,managers` |

**Response schema (`OrgProjectResource`):**
```json
{
  "id": 402725,
  "name": "S0024 - 10 Wolcott",
  "org_id": 25316,
  "org_customer_id": 204968,
  "is_auto_create": false,
  "geofence_ids": [578908],
  "cost_code_ids": [100480],
  "manager_ids": [],
  "customer": { "id": 204968, "name": "Stanton Maple LLC" },
  "is_archived": false,
  "archived_dt_unix": null
}
```

**S-code extraction:** `name.match(/^(S\d+)/)?.[1]` → `"S0024"`

---

### Geofences (Work Sites)

#### `GET /orgs/{org_id}/geofences`
List all work sites / geofences.

**Response schema (`WorkSiteResource`):**
```json
{
  "id": 578908,
  "name": "159, 163, 167 Sisson and 9 Warrenton",
  "place": {
    "place_id": "ChIJyXzZfUtT5okR0ZixT7_Opaw",
    "formatted_place_name": "163-165 Sisson Ave, Hartford, CT",
    "latitude": 41.762789594575,
    "longitude": -72.707198261849
  },
  "enabled": true,
  "geofence_type": "polygon",
  "geofence_radius_meters": 0,
  "polygon_geofence": "{\"type\":\"Polygon\",...}",
  "org_id": 25316,
  "type": "client_project",
  "last_active_dt_unix": 1772550221
}
```

---

### Cost Codes

#### `POST /orgs/{org_id}/cost_codes` — ⚠️ DOES NOT EXIST (404)
**This route is not implemented by Workyard.** Verified 2026-06-23: this and every other path
variant (`/cost_codes`, `/cost-codes`, `/cost_code`, project-nested) return `404 ResourceNotFound`.
Cost codes can only be **created in the Workyard UI**. The API supports read (`GET`), rename
(`PUT /cost_codes/{id}`), and delete (`DELETE /cost_codes/{id}`) of cost codes — but not create.
The request/response shape below is left for reference only; it was never a working endpoint.

**Request body:**
```json
{
  "name": "Maintenance",
  "code": "002",
  "project_ids": [402725, 402726],
  "include_all_projects": false,
  "cost_code_group_id": null
}
```

**Response schema (`CostCodeResource`):**
```json
{
  "id": 100480,
  "name": "Construction",
  "code": "001",
  "org_id": 25316,
  "include_all_projects": false
}
```

---

### Tasks & Scheduling

#### `GET /orgs/{org_id}/tasks`
List tasks / scheduled work orders.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `display_dt_unix` | string | Tasks for a day or range: `1625642649+1625725049` |
| `status` | string | `eq:incomplete` or `eq:complete` |
| `employee_ids` | string | Filter by assignee |
| `project_work_site_ids` | string | Filter by geofence |
| `tag_ids` | string | Filter by tag |
| `limit` | int | Page size |
| `include_counts` | bool | Include note/checklist counts |

**Response schema (`TaskResource`):**
```json
{
  "id": 12345,
  "title": "Unit 3 HVAC Repair",
  "status": "incomplete",
  "start_dt_unix": 1625642649,
  "due_dt_unix": 1625725049,
  "timezone": "America/New_York",
  "assignees": [{ "employee_id": 155283, "display_name": "Carlos Ramirez" }],
  "org_project": { "id": 402725, "name": "S0024 - 10 Wolcott" },
  "geofence": { "id": 578908, "name": "159 Sisson" },
  "cost_code": { "id": 100480, "name": "Construction", "code": "001" },
  "tags": [{ "id": 1, "label": "Urgent", "color": "FF4444" }]
}
```

---

### Tags

#### `GET /orgs/{org_id}/tags`
List tags (labels used on tasks).

#### `PATCH /orgs/{org_id}/tags`
Bulk create/update/delete tags.

---

### File Attachments

#### `POST /orgs/{org_id}/file_attachments/link`
Create attachment from URL.

#### `POST /orgs/{org_id}/file_attachments/multipart`
Upload a file directly.

---

## Payroll-Relevant Field Mappings

How Workyard API fields map to `payroll_time_entries` columns:

| Workyard Field | Path | `payroll_time_entries` Column |
|---|---|---|
| Time card ID | `time_card.id` | `workyard_timecardid` |
| Employee | `time_card.worker.employee_id` | → match `payroll_employees.workyard_id` |
| Entry date | `time_card.start_dt_unix` → format `YYYY-MM-DD` (America/New_York) | `entry_date` |
| Regular hours | `time_card.time_summary_v2.regular_secs / 3600` | `regular_hours` |
| OT hours | `time_card.time_summary_v2.over_time_secs / 3600` | `ot_hours` |
| Property | `cost_allocation.org_project_id` → project name → extract S-code | → match `properties.code` |
| Cost code | `cost_allocation.job_code.name` | `flag_reason` (informational) |
| Source | literal `'workyard_api'` | `source` |

### Multi-allocation time cards

A single time card can have multiple `cost_allocations` (employee worked at multiple properties). Hours are split proportionally:

```
total_secs = sum(allocation.duration_secs)
allocation_reg_hours = (regular_secs × allocation.duration_secs / total_secs) / 3600
allocation_ot_hours  = (over_time_secs × allocation.duration_secs / total_secs) / 3600
```

Each allocation becomes a separate `WorkyardRow` and ultimately a separate `payroll_time_entries` row.

---

## Org Info (Stanton Management)

| Field | Value |
|---|---|
| Org ID | `25316` |
| Name | Stanton Management |
| State | CT |
| Timezone | `America/New_York` |
| Time rounding | 1 minute |
| Location tracking | Required |
| Breaks paid | No |

---

## Error Codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | — | Bad request / validation error |
| 401 | 401000 | Authentication failed — check token |
| 403 | — | Access denied — insufficient permissions |
| 404 | — | Resource not found |
| 429 | — | Rate limit exceeded (60 req/min) — use exponential backoff |

---

## Notes for Developers

- All timestamps are **Unix seconds (UTC)**. Convert to `America/New_York` for display/date grouping.
- Project names follow `"S0024 - 10 Wolcott"` format — use `/^(S\d+)/` regex to extract S-code.
- The `WORKYARD_API_KEY` and `WORKYARD_ORG_ID` env vars are server-side only (not `NEXT_PUBLIC_`).
- The payroll system proxy route is at `/api/workyard/timecards?weekStart=YYYY-MM-DD`.
- Only `status=eq:approved` cards are imported — cards in `working/submitted` stay in Workyard.
- PTO hours are not available directly from the time cards API — the API import path sets `pto_hours: 0`. PTO can still enter via CSV import (the export carries PTO columns) or a manual entry (pay-type `pto`), and the pay engine handles it.
  - A separate endpoint **exists** for capture: `GET /orgs/{org}/time_off_requests` (returns `{data, meta, links}`, paginated like other list endpoints; `status=eq:approved` filter works). As of 2026-06-23 it returns **empty** for org 25316, so the record schema is unverified — wire capture into `fetchWorkyardTimecards` once a real request exists to read field names against. Until then PTO is shown but not auto-pulled.
