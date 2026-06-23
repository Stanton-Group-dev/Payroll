# 06_PRP_New_Project_Wizard

**Status:** Draft — awaiting domain sign-off (geofence + property-identity gates) before release to build
**Owner:** StantonManagement
**Created:** 2026-06-23
**Estimated effort:** 4–6 days [Speculation — depends on the geofence and AppFolio-identity decisions and the LLC→customer map]
**Depends on:** `07_PRP_Travel_Premium_Engine` — the wizard's premium step writes a record that has **no pay/billing effect** until PRP-07 lands. The wizard may ship its config write first behind a "recorded, not yet applied" banner; the value is not real until 07. Also assumes the live RLS family-policy set from `01_PRP_RLS_Authz_Remediation` (already applied).
**Reads with:** `WESTEND_ONBOARDING_CHECKLIST.md`, `scripts/wy-onboard-buildings.mjs`, `scripts/wy-create-westend-costcodes.mjs`, `DECISIONS_LOG.md` §0.11, §0.13, §0.15–0.16, §0.20

---

## 1. Problem Statement

Onboarding one new building is a multi-system chore spread across a checklist, two `.mjs`
scripts, and three separate admin pages — with no developer-free path and an order that is easy
to get wrong.

1. **The Workyard half is terminal-only (P-1).** Creating the building's Workyard project and its
   per-building "Materials" cost code is done today by running `wy-onboard-buildings.mjs` /
   `wy-create-westend-costcodes.mjs` with the API key. A non-developer cannot do it.

2. **The payroll half is scattered (P-2).** The property record, the `payroll_property` billing
   overlay (`owner_llc`, `include_in_invoicing`), portfolio assignment, and an optional management
   fee each live on a different screen, performed in a sequence nobody has written down except as a
   checklist.

3. **The travel premium is a fourth, disconnected screen (P-3).** Off-site buildings need a travel
   premium set; today that is a separate admin page, unconnected to the rest of onboarding — and
   (see PRP-07) the value it writes is currently inert.

4. **Naming mistakes are unrecoverable in-place (P-4).** A Workyard project's name carries the
   S-code that the importer resolves buildings by, and the API cannot rename a project after
   creation (`PUT /projects` 404s, `DECISIONS_LOG` §0.16). A wrong name at create time becomes a
   manual Workyard-UI fix.

This PRP specifies a single admin **New Project Wizard** that runs the whole sequence — provisions
the Workyard project + cost code over the API, creates/links the payroll records, and sets the
travel premium — preview-first and idempotent.

---

## 2. Evidence Baseline

| ID | Claim | Location | Evidence | Status |
|----|-------|----------|----------|--------|
| W-1 | Project creation works via API | `scripts/wy-onboard-buildings.mjs:96` | `post('/orgs/${ORG}/projects', { name, org_customer_id, geofence_ids:[gid] })` → `res.j?.id` | Verified — onboarding script |
| W-2 | Cost-code creation works via API | `scripts/wy-create-westend-costcodes.mjs:86` | `post('/orgs/${ORG}/cost_codes', { name, code, project_ids, include_all_projects:false, cost_code_group_id:null })` → `id` | Verified — onboarding script |
| W-3 | Project rename via API 404s | `DECISIONS_LOG.md §0.16` | `PUT /orgs/{org}/projects/{id}` documented as unreliable; rename is a manual UI step | Verified — decision log (authoritative) |
| W-4 | Vendor-cluster project ids are copied from a template cost code | `scripts/wy-create-westend-costcodes.mjs:63-68` | The shared non-building project set is read from an existing "Materials" code (default `S0029`) | Verified — onboarding script |
| M-1 | No `workyard_project_id` column; building↔project mapping is implicit by S-code in the name | `src/lib/payroll/workyard-api.ts:128-150, 300-356` | Importer parses `^S\d+` from project/cost-code name → matches `properties.code` | Verified — subagent read |
| M-2 | `payroll_property` overlay auto-seeds from `properties`; `owner_llc`/`include_in_invoicing` curated there | `migrations/20260618_02_payroll_property.sql` (`payroll_property_reconcile()`) | RPC insert-missing; billing entity read from overlay | Verified — subagent read |
| P-A1 | `properties.appfolio_property_id` is required + unique (AppFolio-keyed) | `properties` schema | Canonical/AppFolio identity column | Verified — subagent read |
| T-1 | Travel-premium write path exists, keyed to `property_id`, add/delete only | `src/app/payroll/admin/travel-premiums/page.tsx`, `src/hooks/payroll/usePayrollTravelPremiums.ts` | Insert `{property_id, premium_type, amount, effective_date}`; no update path | Verified — subagent read |
| A-1 | Org default `25316`; rate limit 60 req/min | `WORKYARD_API_REFERENCE.md:7` | Bearer `WORKYARD_API_KEY`; backoff on 429 | Verified — subagent read |
| G-1 | Project create **requires** a `geofence_ids` value; whether a geofence can be created via API for a new location is unknown | `wy-onboard-buildings.mjs` (reuses pre-existing geofences) | Westend reused existing geofences; no create-geofence call observed | **Unverified — Phase-1 gate** |

---

## 3. Users and Roles

**In scope:**
- **Onboarding admin** (`isAdmin`) — runs the wizard; writes to Workyard and to billing-critical
  records. Highest gate, consistent with `mgmt-fee` / `portfolios` / `users`.

**Out of scope:**
- Field employees and managers (read-only to onboarding).
- Bulk/batch onboarding (the `.mjs` scripts remain for batch; this is the one-at-a-time path).
- External (non-building) projects — keep their own simpler page.

---

## 4. Core Features

**CF-1 — Wizard shell.** New route `/payroll/admin/onboard` ("New Project"), added to the sidebar
**Settings** group (the nav was reorganized this session — `settingsItems` in
`src/app/payroll/layout.tsx`). A 5-step stepper: **Building → Workyard → Travel premium → Payroll
wiring → Review & apply.** Nothing is written until **Apply** on step 5; steps 1–4 collect intent
and render "what will happen."

**CF-2 — Step 1: Building identity.** Select an existing property by S-code, or create one
(`code` validated `^S\d+$` + unique, `name`, `address`, `total_units` > 1, `portfolio_id`, owner
LLC). Surfaces the AppFolio dedup constraint (P-A1) — resolution per OD-2.

**CF-3 — Step 2: Workyard provisioning (preview + apply).** Compute the exact writes and show
**Create** vs **Already exists → skip** for each, using the same existence checks the scripts use
(project by name; cost code by `code`):
- **Project:** name `"{S-code} - {address}"`, `org_customer_id` from CF-6, `geofence_ids` from
  OD-1.
- **Materials cost code:** `code` = S-code, bilingual `name` `"{address} - Materials / Materiales"`,
  `project_ids` = new project id + the configured vendor-cluster project ids (CF-7).
- Naming is final at create (W-3) — the UI warns that a later rename is a manual Workyard step.

**CF-4 — Step 3: Travel premium.** Optional (default off; for off-site buildings). Fields mirror
the existing admin page (`premium_type`, `amount` > 0, `effective_date`); writes one
`payroll_travel_premiums` row on apply. Displays the PRP-07 status banner — states plainly the
premium is **recorded but not yet paid/billed** until engine support ships, and never implies it
is active.

**CF-5 — Step 4: Payroll wiring.** Run `payroll_property_reconcile()`, then set `owner_llc` and
`include_in_invoicing` on `payroll_property`; assign `portfolio_id` on both `properties` and
`payroll_property` if chosen; optional `payroll_management_fee_config` row.

**CF-6 — LLC → Workyard-customer map (config, not hardcode).** A project belongs to a Workyard
**customer** (`org_customer_id` — e.g. Westend used `317292` under org `25316`). Provide an
editable `payroll_workyard_customer_map` table + settings tab mapping `owner_llc` →
`org_customer_id` (per §0.13). An unmapped LLC blocks step 2 with a clear remedy link.

**CF-7 — Vendor-cluster template (config).** Promote the template cost-code id (today `S0029`) or
the explicit vendor-project list to the settings tab, so the cluster set survives the template
building being retired (W-4).

**CF-8 — Backend provisioning endpoint.** All Workyard writes run server-side
(`/api/workyard/provision-project`) — `WORKYARD_API_KEY` is a runtime Infisical secret and must
never reach the browser. Honors 60 req/min with exponential backoff on 429; idempotent
(re-checks existence before each create); returns `{action:'created'|'skipped', id}` per object;
writes an audit row (CF-9).

**CF-9 — Provision log + explicit project-id mapping.** Write `payroll_workyard_provision_log` per
run. Additively add a nullable `workyard_project_id` to `payroll_property` so the mapping is
explicit (audit + re-run idempotency), without disturbing the existing S-code resolution (M-1).

---

## 5. Data Model

**Touched (no schema change):** `properties` (insert/update), `payroll_property`
(reconcile + `owner_llc`, `include_in_invoicing`, `portfolio_id`), `payroll_travel_premiums`
(insert), `payroll_management_fee_config` (optional insert).

**New (additive migrations):**
- `payroll_workyard_customer_map` — `owner_llc` (PK text), `org_customer_id` (int), `is_active`,
  audit cols. Backs CF-6.
- `payroll_workyard_provision_log` — `id`, `property_code`, `workyard_project_id`,
  `workyard_cost_code_id`, `project_action`, `cost_code_action`, `created_by`, `created_at`.
- `payroll_property.workyard_project_id` (nullable text/int) — additive column, CF-9.

All new tables `ENABLE ROW LEVEL SECURITY` + the standard family (service_role full, scoped dev
role, `authenticated` read, manager/admin write) — Stanton doctrine, no bare-RLS tables.

---

## 6. Integration Points

| System | Hook | Direction | Change |
|--------|------|-----------|--------|
| Workyard API client | `src/lib/payroll/workyard-api.ts` (or new server module) | new writes | Add `createProject`, `createCostCode`, existence checks, backoff |
| Provision endpoint | `POST /api/workyard/provision-project` | new | Server-side; reads Infisical secret; idempotent |
| Property overlay | `payroll_property_reconcile()` RPC | called by CF-5 | None (reuse) |
| Portfolio/fee writes | `portfolios` page hooks, `payroll_management_fee_config` | reuse | Same inserts the portfolios page does |
| Travel premium | `usePayrollTravelPremiums` | reuse | Same insert as the admin page |
| Sidebar | `src/app/payroll/layout.tsx` (`settingsItems`) | new entry | Add the wizard route |

---

## 7. Affected Files

| File | Change | Type |
|------|--------|------|
| `src/app/payroll/admin/onboard/page.tsx` | Wizard shell + 5 steps | New |
| `src/app/api/workyard/provision-project/route.ts` | Server provisioning endpoint | New |
| `src/lib/payroll/workyard-provision.ts` | create/skip project + cost code, backoff, idempotency | New |
| `src/hooks/payroll/useWorkyardCustomerMap.ts` | LLC→customer map CRUD | New |
| `src/app/payroll/admin/settings/.../page.tsx` | settings tab for CF-6/CF-7 | New |
| `src/app/payroll/layout.tsx` | add wizard to `settingsItems` | Modified |
| `migrations/2026XXXX_workyard_customer_map.sql` | CF-6 table + RLS | New |
| `migrations/2026XXXX_workyard_provision_log.sql` | CF-9 table + RLS | New |
| `migrations/2026XXXX_payroll_property_workyard_id.sql` | additive column | New |

---

## 8. Implementation Phases

### Phase 1 — Confirm gates (no code)
1a. **Geofence (G-1):** confirm whether Workyard supports geofence creation via API, or the wizard
must require selecting an existing geofence. Resolve OD-1.
1b. **Property identity (P-A1):** confirm whether the app may insert a new `properties` row, or the
building must exist in AppFolio first and sync in. Resolve OD-2.
1c. **LLC→customer values:** collect the real `owner_llc → org_customer_id` pairs for current LLCs.
1d. **Template cost-code id:** confirm the current vendor-cluster template (`S0029`) and its project
list.
**Verification:** OD-1 and OD-2 resolved in this doc; LLC map values and template id recorded.

### Phase 2 — Config substrate
2a. Create `payroll_workyard_customer_map` (+ RLS) and seed from 1c. 2b. Build the settings tab
(CF-6/CF-7). **Verification:** an admin can view/edit the map; an unmapped LLC is queryable.

### Phase 3 — Provisioning endpoint (preview mode)
3a. `workyard-provision.ts`: `createProject` / `createCostCode` with existence checks + 429
backoff. 3b. `/api/workyard/provision-project` returns a **dry-run plan** (`create`/`skip` per
object) without writing when `apply:false`. **Verification:** unit test — given an existing
project name, plan returns `skip`; given a new name, `create`. Secret never serialized to client.

### Phase 4 — Wizard steps 1–2
4a. Shell + stepper (CF-1). 4b. Step 1 identity (CF-2) honoring OD-2. 4c. Step 2 preview wired to
the endpoint's dry-run (CF-3). **Verification:** preview matches the endpoint plan for a known
existing building (all skips) and a fresh S-code (creates).

### Phase 5 — Wizard steps 3–5 + apply
5a. Step 3 premium (CF-4) with the PRP-07 banner. 5b. Step 4 wiring (CF-5). 5c. Step 5 review +
ordered apply (Workyard first, then DB) with partial-failure handling; write the provision log
(CF-9). **Verification:** applying a fresh building creates project + cost code + property/overlay
+ premium, returns ids, logs the run; re-applying creates nothing.

### Phase 6 — Surface + harden
6a. Add the wizard to `settingsItems`. 6b. Confirm `workyard_project_id` is stored. **Verification:**
the wizard is reachable from the sidebar; the provision log + column reflect a real run.

---

## 9. Open Decisions

| ID | Question | Default (pending sign-off) | Label |
|----|----------|----------------------------|-------|
| OD-1 | How are geofences handled for a brand-new location? | Require selecting an existing geofence; defer API geofence-create until confirmed (G-1) | Open — Phase-1 gate |
| OD-2 | May the wizard insert a new `properties` row, or must AppFolio create it first? | Attach to an AppFolio-synced property; block raw inserts until dedup strategy agreed | Open — Phase-1 gate |
| OD-3 | Only the Materials cost code, or the fuller standard set (incl. the §0.21 Office split)? | Materials only in v1; standard set is a config list (§0.13) | Open |
| OD-4 | Template source for vendor clusters | Configurable id, default `S0029` | Open |

---

## 10. Out of Scope
- Applying the travel premium to pay/billing — **PRP-07** (this PRP only writes the config row).
- Batch onboarding of many buildings (scripts remain).
- External (non-building) projects.
- AppFolio property sync / identity authoring beyond OD-2.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Wrong project name at create (unrecoverable via API, W-3) | Medium | Name is computed from S-code + address and shown in preview before apply; UI warns rename is manual |
| Geofence dependency blocks new-location create (G-1) | Medium | OD-1 default requires an existing geofence; Phase-1 gate before promising create |
| App-inserted property collides with AppFolio identity (P-A1) | Medium | OD-2 default attaches to synced property; no raw insert until agreed |
| 429 rate-limit during multi-object apply | Low-Med | Endpoint backoff + idempotent re-run |
| Premium step read as "active" when PRP-07 unshipped | Medium | Mandatory banner (CF-4); DoD check |

---

## 12. Definition of Done

**Operator-observable:**
1. An admin takes a new building from nothing to billable/payable in one flow, no terminal.
2. Re-running the wizard for the same building creates nothing new (all skips).
3. A building whose LLC has no Workyard-customer mapping is blocked at step 2 with a clear remedy.
4. The travel-premium step never claims the premium is active while PRP-07 is unshipped.

**System/test-observable:**
5. Endpoint dry-run unit test: existing object → `skip`, new object → `create`.
6. Applying writes a `payroll_workyard_provision_log` row with the returned project + cost-code ids.
7. `payroll_property.workyard_project_id` is populated after a successful run.
8. `npx tsc --noEmit` and lint pass; new tables ship with the RLS family set.

---

## 13. Rollback

| Phase | Change | Rollback |
|-------|--------|----------|
| 2 | customer-map table + tab | drop table (additive); revert tab commit |
| 3 | provisioning module + endpoint | `git revert`; no writes in preview mode |
| 4–5 | wizard + apply | `git revert`; idempotent — no orphan writes since apply is ordered + logged |
| 6 | sidebar entry + column | `git revert`; drop nullable column (additive) |

No destructive operations; all migrations additive and reversible.

---

## 14. Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-23 | Split the wizard (06) from the premium engine wiring (07) | The engine change is a money-path edit to `calculatePayroll` with its own golden test and DoD; mixing it with UI/provisioning would couple two unlike risk profiles (mirrors how PRP-02 isolates the math engine) |
| 2026-06-23 | Premium step ships behind a "recorded, not yet applied" banner | Honest UI: writing a row that PRP-07 has not yet taught the engine to read must not read as active |
| 2026-06-23 | Name Workyard objects correctly at create; no rename path | API rename 404s (§0.16); the importer resolves by S-code in the name |

---

## 15. Spec Self-Score (nine-element Y/P/N)

| # | Element | Score | Note |
|---|---------|-------|------|
| 1 | Problem statement | Y | Four numbered gaps, each evidenced |
| 2 | Users and roles | Y | Admin in scope; employees/batch/external out |
| 3 | Numbered features | Y | CF-1…CF-9, each a named action/behavior |
| 4 | Data model | Y | Touched + new tables; all new RLS'd |
| 5 | Integration points | Y | Six systems named with direction |
| 6 | Ordered phases | Y | Six phases, each with steps + verification |
| 7 | Open decisions w/ defaults | P | Four decisions; OD-1/OD-2 are hard gates still open |
| 8 | Out of scope | Y | Engine wiring, batch, external, AppFolio sync |
| 9 | Definition of done | Y | Operator- + test-observable, eight checks |
