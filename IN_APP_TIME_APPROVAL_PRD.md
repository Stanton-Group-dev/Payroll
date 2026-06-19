# In-App Time Approval (Workyard as Source, Our App as System of Record) — PRD

| Field | Value |
|---|---|
| **Project** | Stanton Management Payroll & Invoicing System |
| **Version** | 1.0 |
| **Status** | Draft — awaiting human release |
| **Owner** | StantonManagement |
| **Created** | 2026-06-18 |
| **Companion** | `UNALLOCATED_HOURS_NOTIFICATION_PRD.md` (employee-facing notices) |
| **Reads with** | `audit/prps/04_PRP_Approval_Locking_Enforcement.md` (existing week-level approval/locking), `WORKYARD_API_REFERENCE.md` |

---

## Problem Statement

Today the **approval gate lives in Workyard**. A manager approves each time card in Workyard (status → `approved`), and only then does our payroll system pull it in — the import filters `status=eq:approved` (`WORKYARD_API_REFERENCE.md:20,138`; `workyard-api.ts`). After import we re-allocate, correct, split, and reconcile. So in practice **the number that gets paid is decided in our app, but the thing employees were told to check is Workyard.**

That split is the source of the recurring dispute: *"It was approved in Workyard — why isn't that what I got paid?"* Approval in Workyard and the amount paid are two different events in two different systems, and the gap between them is where trust breaks down.

**This PRD makes our app the single system of record for approval.** Workyard becomes a pure time-*collection* tool (clock in/out, GPS, photos). Everything from "is this time card approved" onward happens in our app. After we pull a week's data, we **close it out in Workyard** so the data can't drift underneath us and so there is exactly one place where "approved" means something.

---

## ⚠️ Hard Constraint — Read This First

> **The Workyard time-cards API is read-only. There is no documented endpoint to approve, lock, finalize, or mark a time card `processed` from outside Workyard.**

Evidence: `WORKYARD_API_REFERENCE.md` documents only `GET /orgs/{org_id}/time_cards` (§Time Cards, lines 131-242). The only write endpoints in the reference are `POST /cost_codes`, `PATCH /tags`, and `POST /file_attachments` (lines 310-389). Workyard's own lifecycle (`working → submitted → approved → processed → deleted`) advances `processed` when *Workyard* exports to ADP — not on our command. Our client (`workyard-api.ts`) contains **zero** PUT/PATCH/POST methods against time cards.

**Consequence:** the "close it out in Workyard after we pull" step — the part that makes our app authoritative — **cannot be done via the current API.** This PRD cannot ship its core promise on the documented integration alone. Before engineering begins, one of the following must be resolved (see §Close-Out Options). **This is the top project risk and the first thing to settle with Workyard.**

A second consequence shapes the whole design: if we move the approval decision in-app, we must **pull `submitted` cards, not just `approved` ones** — otherwise we're still waiting on a Workyard approval we're trying to eliminate.

---

## Current State (what we're changing)

| Concern | Today | Source |
|---|---|---|
| Who approves a time card | A manager, **in Workyard** | `WORKYARD_API_REFERENCE.md:17,26` |
| What we pull | Only `status=eq:approved` cards | `WORKYARD_API_REFERENCE.md:138,454` |
| In-app approval state | **Week-level only** (`payroll_approvals`: stages `timesheet`/`payroll`/`invoice`/`statement`). No per-time-card approval exists. | `src/lib/supabase/types.ts` (`PayrollApproval`); `usePayrollWeekReview.ts:177` |
| Per-entry status | `is_flagged`, `flag_reason`, `pending_resolution`, `is_active` — correction/soft-delete flags, **not** an approval gate | `payroll_time_entries` schema |
| Import idempotency | **Not idempotent** — re-pulling a week `insert`s duplicate rows; no upsert on `workyard_timecardid` | `src/app/payroll/import/page.tsx` (insert, not upsert) |
| Write-back to Workyard | None | `workyard-api.ts` (read-only) |

Note the import-idempotency gap is a latent bug that this PRD must fix anyway, because moving the gate in-app means we'll pull earlier and more often.

---

## Goals & Non-Goals

**Goals**
- The **approval decision happens in our app**, per time card / per employee-week, by a manager, recorded with actor + timestamp.
- We pull `submitted` (and `approved`) cards so a card never has to be approved in Workyard first.
- After a week is pulled and approved in-app, the corresponding Workyard cards are **closed out** (locked / marked processed / archived) so the upstream data is frozen — *contingent on resolving the Hard Constraint*.
- Import becomes **idempotent** (upsert on `workyard_timecardid`), so re-pulling never duplicates and never silently clobbers in-app edits.
- One answer to "what was approved" — and it equals what's paid.

**Non-Goals**
- Replacing Workyard as the time-*collection* tool. (That's the separate feasibility memo, `WORKYARD_REPLACEMENT_FEASIBILITY.md`.)
- Re-implementing week-level milestone approvals — `04_PRP_Approval_Locking_Enforcement.md` already covers locking the week through its lifecycle. This PRD adds the **time-card-level** gate that feeds it.
- Employee self-approval. Approval stays a manager action.

---

## Close-Out Options (resolve the Hard Constraint)

"Close it out in Workyard" can mean several things; they differ wildly in feasibility. Pick one with Workyard before building:

| Option | What it is | Feasibility | Notes |
|---|---|---|---|
| **A — API write-back** | Workyard exposes an (undocumented?) endpoint to set a card to `approved`/`processed`/locked. We call it after pull. | **Unknown — must confirm with Workyard.** Not in the current reference. | Cleanest if it exists. Get it in writing + a test card. |
| **B — In-app "approved" overrides Workyard, no write-back** | We never change Workyard. Our app holds the authoritative approval; Workyard cards stay as-is and are simply ignored after pull. | **High — buildable today.** | Doesn't literally "close out" Workyard, but achieves the *intent* (our app is authoritative). Risk: Workyard data can still change after pull → mitigated by re-pull detection (§FR-5). |
| **C — Manual close-out in Workyard** | After in-app approval, a person marks the week done in the Workyard UI (bulk approve/lock if Workyard supports it). | **Medium — process, not code.** | Defeats much of the automation goal; reintroduces a manual Workyard step. |
| **D — Stop using Workyard approval entirely** | Treat Workyard purely as a clock feed; approval + lock live only with us; accept Workyard remains "open." | **High.** | Cleanest mentally; requires discipline that nobody acts on Workyard's own approval screens. |

**Recommendation:** Build for **Option B** (in-app authoritative, no write-back) as the shippable baseline, and **in parallel** ask Workyard whether Option A is possible. If A exists, layer it on as the literal close-out. B + the re-pull guard (FR-5) delivers "what's approved = what's paid" without depending on Workyard's API.

---

## Functional Requirements

### FR-1 — Pull `submitted` and `approved` cards
Change the import to fetch cards in `submitted` **and** `approved` status (today: approved-only). The import preview must show each card's **Workyard status** so a manager knows what they're approving and isn't surprised by un-reviewed time.
- `fetchWorkyardTimecards(weekStart, approvedOnly=false)` already accepts the flag (`workyard-api.ts`); wire the UI to pass `false` and surface the status column.

### FR-2 — Per-time-card approval state (new)
Add an approval gate at the time-card / employee-week grain. **Decision: employee-week grain** is recommended (a manager approves "Carlos's week," not 37 individual cards) — but it must roll down to the underlying entries.

Add to `payroll_time_entries` (or a sibling `payroll_time_entry_approvals` table):
- `approval_status` — `pending | approved | rejected` (default `pending`)
- `approved_by` (uuid, nullable), `approved_at` (timestamptz, nullable)
- `rejection_reason` (text, nullable)

A migration is required. Follow the RLS/authz patterns in `audit/prps/01_PRP_RLS_Authz_Remediation.md` and `03_PRP_API_AuthZ_And_Secrets.md` — the new column/table must not be writable by `anon`.

### FR-3 — In-app approval UI
A manager review surface (extend the existing `[weekId]/review` page) where a manager can, per employee-week:
- See pulled hours by day + property, Workyard status, and any flags (unallocated, missing rate, etc.).
- **Approve** (sets `approval_status='approved'`, stamps actor + time) or **Reject** (with reason → routes back to corrections / triggers an unallocated notice).
- Bulk-approve a clean employee-week in one click.

### FR-4 — Approval gates downstream processing
Nothing downstream of approval may consume an unapproved entry:
- Payroll math / ADP export / invoicing must read only `approval_status='approved'` (and `is_active=true`) entries.
- This composes with the **week-level** lock in `04_PRP_Approval_Locking_Enforcement.md`: per-card approval (this PRD) → week `payroll_approved` (existing) → locked.

### FR-5 — Idempotent import + drift detection
- **Upsert** time entries on `workyard_timecardid` (+ allocation index for multi-allocation cards) instead of `insert`. Re-pulling a week must update, never duplicate.
- **Never silently overwrite an in-app edit.** If a re-pull would change an entry that is already `approved` or has been corrected in-app, flag the conflict for a human rather than clobbering it. This is how we get the safety that Option B (no write-back) needs: even if Workyard data drifts after pull, we *detect* it instead of paying on stale numbers.

### FR-6 — Close-out (per chosen option)
- **If Option A:** after a week reaches in-app `payroll_approved`, call the Workyard write-back to lock/mark-processed the corresponding cards; log success/failure per card to an outbox (mirror `payroll_notifications` pattern).
- **If Option B/D:** no Workyard call; the week lock + FR-5 drift detection are the close-out. Document clearly that Workyard's own approval screens are **not** to be used.
- **If Option C:** generate a checklist/report of which Workyard cards to mark done.

---

## Data Model Summary

- **New:** per-card/employee-week approval state (FR-2) — column set on `payroll_time_entries` or a new `payroll_time_entry_approvals` table.
- **Reuse:** `payroll_approvals` (week-level milestones) — unchanged; per-card approval feeds the `payroll`-stage milestone.
- **Reuse:** `payroll_weeks.status` lifecycle + locking from `04_PRP`.
- **New (Option A only):** a write-back outbox table for Workyard close-out attempts.

---

## Risks

1. **The Hard Constraint (top risk).** If Option A doesn't exist and the business insists on a literal Workyard close-out, scope is blocked on a vendor capability we don't control. **Mitigation:** ship Option B; pursue A in parallel; don't let A block value.
2. **Pulling `submitted` cards means pulling un-reviewed time** — including clock errors Workyard managers used to catch. The in-app review UI (FR-3) must be good enough to be the *only* review, or quality drops. **Mitigation:** surface Workyard status + flags prominently; keep reject→corrections tight.
3. **Process confusion during cutover** — two approval screens (Workyard + ours) existing at once. **Mitigation:** explicit "do not approve in Workyard" comms; ideally disable/ignore Workyard approval in training.
4. **Idempotency migration on live data** — fixing the duplicate-insert bug touches the hot import path. **Mitigation:** upsert key + dedupe existing rows in a guarded migration; verify against a real week in a branch DB first.

---

## Acceptance Criteria

- [ ] Import pulls `submitted` + `approved` cards and shows Workyard status per card.
- [ ] A manager can approve/reject an employee-week in-app; the decision is stored with actor + timestamp.
- [ ] Payroll math, ADP export, and invoicing consume **only** in-app-approved entries.
- [ ] Re-pulling a week never creates duplicates and never silently overwrites an approved or corrected entry; conflicts are flagged.
- [ ] The chosen Close-Out Option is implemented and the team has one unambiguous place where "approved" lives.
- [ ] "What was approved" provably equals "what was paid" for a test week.

---

## Open Questions

1. **Does Workyard offer any write/approve/lock API?** (Owner: whoever holds the Workyard account.) This single answer decides Options A vs B/C/D and must be settled first.
2. **Approval grain** — per time card, or per employee-week? (Recommended: employee-week.)
3. **Who approves?** Same manager roles as today (`superadmin/admin/manager`, per `holds/route.ts:16`), or a dedicated approver role?
4. **What happens to a rejected card?** Back to corrections, an unallocated SMS (companion PRD), or a direct manager-employee conversation?
5. **Cutover plan** — do we run Workyard-approval and in-app-approval in parallel for a week to build trust, or hard-cut?
