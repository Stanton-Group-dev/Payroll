# Unallocated-Hours Daily Notification — PRD

| Field | Value |
|---|---|
| **Project** | Stanton Management Payroll & Invoicing System |
| **Version** | 1.0 |
| **Status** | Draft — awaiting human release |
| **Owner** | StantonManagement |
| **Created** | 2026-06-18 |
| **Builds on** | `src/lib/payroll/unallocatedHolds.ts`, `src/lib/payroll/twilio-api.ts`, tables `payroll_employee_holds` + `payroll_notifications` (migration `20260617_03_unallocated_holds.sql`) |
| **Companion** | `IN_APP_TIME_APPROVAL_PRD.md` (moves the approval gate in-house) |

---

## Problem Statement

On-site employees routinely leave hours **unallocated** — clocked time in Workyard with no project assigned. Per repeated all-hands decisions, **unallocated hours without a project are not paid.** That policy is correct, but the *experience* of it is broken:

- Employees don't find out until they walk into the office on payday, upset that hours are "missing."
- The conversation happens too late to fix anything — the week is already closed.
- It reads as the company shorting them, when in fact the time was never assigned to a property.

**This is a perception problem, not a pay-policy problem.** The fix is to tell employees *early and repeatedly*, in their own pocket, exactly how much time is unallocated and exactly what to do about it — **before** they show up expecting full pay.

The mechanism already exists in the codebase. Today it is **manual** (a manager clicks "Apply holds" on the review screen) and its message tells the employee to *"come into the office with a written reason."* This PRD does two things:

1. **Automates** detection + notification on a **daily (every-24h) cadence** so nobody can be surprised on payday.
2. **Rewrites the message** from "come explain yourself" to **"log into Workyard and fix it yourself"** — a self-service instruction, not a summons.

---

## What Already Exists (do not rebuild)

The hold-and-notify core is built and working today. This PRD extends it; it does not replace it.

| Capability | Where | Status |
|---|---|---|
| Detect unallocated employees for a week (sum no-`property_id` active hours, threshold 0.25h) | `detectUnallocatedEmployees()` — `unallocatedHolds.ts:42` | ✅ Built |
| Compose + send SMS, record an outbox row per attempt | `applyUnallocatedHolds()` — `unallocatedHolds.ts:111`; `sendSms()` — `twilio-api.ts:42` | ✅ Built |
| Twilio client with **dry-run fallback** when creds absent | `twilio-api.ts` (`isTwilioLive()`) | ✅ Built — live is just adding `TWILIO_*` to Infisical |
| Outbox / audit of every send (sent / dry_run / skipped / failed) | `payroll_notifications` table | ✅ Built |
| Pay hold per (week, employee), release + waive flows | `payroll_employee_holds` table; `releaseHold()`, `waiveUnallocated()` | ✅ Built |
| Manager review panel | `src/components/payroll/UnallocatedHoldsPanel.tsx` | ✅ Built |

**What is missing — the entire scope of this PRD:**

1. **No scheduler.** There is no cron, no background worker, no Vercel Cron config anywhere in the repo (confirmed: no `vercel.json`, no `.github/workflows`, no `scripts/` jobs). Every notification today requires a human to click.
2. **Wrong message.** `composeUnallocatedSms()` (`unallocatedHolds.ts:84`) says *"Your pay is on hold until this is resolved. Please come into the office with a written reason."* That is the opposite of self-service.
3. **No cadence / no de-dup.** Re-running `applyUnallocatedHolds` re-texts everyone every time. There is no "once per 24h," no stop-when-resolved, no send cap.

---

## Terminology Decision (must resolve before writing the SMS copy)

> ⚠️ **"Unallocated" in our system means *no project assigned*, not *no cost code*.**

The pay-gating field is `payroll_time_entries.property_id`. It is populated from the Workyard **project** (`cost_allocation.org_project_id` → S-code → `properties.code`), **not** from the Workyard **cost code** (`job_code`, e.g. "Construction"). The cost code is stored as informational `flag_reason` only and never affects pay (`WORKYARD_API_REFERENCE.md:404-405`; `unallocatedHolds.ts:51`).

So when an employee "fixes their hours" in Workyard, the action they must take is **assign their clocked time to the correct project/job site** — that is what produces a property allocation on our side.

**Decision needed:** the SMS must use the word the employee actually sees in the Workyard app for the field they need to fill. If Workyard labels it "job"/"project," the text should say that; if their crews colloquially call it "the cost code," matching that word may land better even if technically it's the project. **Recommendation:** say *"assign your hours to a property/job"* and avoid the bare phrase "cost code" unless field testing shows the crews expect it. Getting this wrong reintroduces the exact confusion this project exists to remove.

---

## Goals & Non-Goals

**Goals**
- Every employee with unallocated hours above threshold for an **open** payroll week gets an SMS **within 24h** of the time appearing, and **again every 24h** until it's resolved or the week closes.
- The message is **actionable and self-service**: how many hours, which week, and "fix it in Workyard."
- Zero new payday surprises: by the time a week closes, every affected employee has been told ≥1 time, with a logged, auditable record.
- Reuse the existing detection, outbox, and hold tables verbatim.

**Non-Goals**
- Changing the pay policy. Unallocated-without-project still isn't paid; this PRD only changes *communication*.
- Building the in-app approval gate — that's `IN_APP_TIME_APPROVAL_PRD.md`.
- Email/push channels. SMS only for v1 (the outbox already models `channel` for later).
- Auto-releasing holds. A manager still owns release/waive.

---

## Functional Requirements

### FR-1 — Daily scheduled run
A scheduler fires once every 24 hours (proposed: **07:00 America/New_York**, before the workday) and, for **every open week** (`payroll_weeks.status = 'draft'`), runs the unallocated detection and notification cycle.

- Platform: **Vercel Cron** (the app is deployed on Vercel — `.vercel/project.json` present). Add a `crons` entry pointing at a new protected route `GET /api/payroll/holds/cron`.
- The route must be **authenticated by a cron secret** (`CRON_SECRET` header check), not the user session, since no user is present. Reject anything without the secret with 401.
- Reuse `applyUnallocatedHolds()` per open week, with `userId: null` (system actor — already supported, `held_by` is nullable).

### FR-2 — Re-notify cadence (every 24h, not every run)
A given employee must not be texted more than **once per 24 hours** for the same open week, regardless of how often the job runs or whether a manager also clicks "Apply."

- Before sending, check `payroll_notifications` for a row with the same `(employee_id, payroll_week_id, channel='sms')` and `status IN ('sent','dry_run')` and `sent_at`/`created_at` within the last 24h. If found, **skip the send** but still refresh the hold's `unallocated_hours` snapshot.
- This makes the cron **idempotent within a day** and safe to run alongside manual "Apply."

### FR-3 — Stop when resolved
When an employee's unallocated hours drop **below threshold** (they fixed it in Workyard and the next import reflects it), the daily job must:
- Stop texting them (they fall out of `detectUnallocatedEmployees`).
- **Auto-clear the hold** if and only if it is still in `status='held'` with `reason='unallocated_hours'` and was applied by the system (`held_by IS NULL`). Set `status='released'`, `resolution_note='Auto-resolved: hours allocated in Workyard'`. Manager-applied or manually-released/waived holds are never touched by the job.
- Optionally send **one** "all set" confirmation SMS (see Open Questions).

### FR-4 — Message rewrite (self-service)
Replace the body produced by `composeUnallocatedSms()`. New copy (subject to the Terminology Decision above), kept under 160 GSM-7 chars where possible:

> *Stanton Payroll: {First}, you have {X} hours from the week of {week_start} not yet assigned to a property in Workyard. Unassigned hours can't be paid — please open Workyard and assign them. Questions? Call the office.*

Requirements:
- Lead with the number and the week, not the threat.
- Name the **action** ("assign them in Workyard"), not the **summons** ("come to the office").
- No "written reason" language — that belonged to the old in-office release flow.
- Singular/plural correct ("1 hour" vs "N hours") — already handled at `unallocatedHolds.ts:85`.

### FR-5 — Escalation cap & manager digest
- After **N consecutive daily notices** (proposed N=3) with no resolution, stop auto-texting that employee for that week and **flag them for a human**: surface in the `UnallocatedHoldsPanel` as "notified ×3, unresolved." Avoids harassing someone who genuinely needs help.
- Each cron run writes a one-line summary the office can see (counts: notified / skipped-no-phone / resolved / capped). Surface in the existing holds panel; a manager Slack/email digest is a stretch goal.

### FR-6 — No phone on file
Unchanged from today: if `phone IS NULL`, record a `status='skipped'` notification with `error='No phone on file'` (`unallocatedHolds.ts:154`) and surface the count so the office can chase the missing number. The cron must never crash on a missing phone.

---

## Data Model

**No new tables required.** The job runs entirely on existing schema:

- `payroll_employee_holds` — the hold per (week, employee). Already keyed `onConflict: 'payroll_week_id,employee_id'`.
- `payroll_notifications` — the send log, which **doubles as the 24h-cadence ledger** (FR-2) and the escalation counter (FR-5, count rows per employee/week).

**Optional hardening:** add a `notify_count` / `last_notified_at` to `payroll_employee_holds` if counting notification rows proves awkward. Prefer deriving from `payroll_notifications` first to avoid a migration.

---

## Security & Reliability

- **Cron auth:** the `/api/payroll/holds/cron` route must require a secret header and must not be reachable with the public anon key. (See `audit/prps/03_PRP_API_AuthZ_And_Secrets.md` for the house pattern.)
- **Idempotency:** FR-2's 24h window makes repeated invocations within a day safe.
- **Twilio stays dry-run until creds land.** Going live = adding `TWILIO_*` to Infisical; until then every "send" is logged as `dry_run` and nothing leaves the building, so the whole pipeline is testable in prod safely (`twilio-api.ts:8`).
- **Failure isolation:** one employee's send failure (FR-6, Twilio 4xx) must not abort the batch — already handled by the discriminated `SmsResult` (`twilio-api.ts:32`).

---

## Rollout

1. **Phase 0 — copy + cadence (no cron).** Rewrite the message (FR-4), add the 24h de-dup guard (FR-2) and auto-resolve (FR-3) inside `applyUnallocatedHolds`. Ship behind the existing manual button. Verify in dry-run.
2. **Phase 1 — scheduler.** Add the Vercel Cron route (FR-1) + cron secret. Run in dry-run for one full week; review the `payroll_notifications` log daily.
3. **Phase 2 — go live.** Add `TWILIO_*` to Infisical. Watch first live week closely; confirm resolved-employees stop getting texts.
4. **Phase 3 — escalation + digest** (FR-5).

---

## Acceptance Criteria

- [ ] A daily job runs unattended and notifies every over-threshold employee in every open week.
- [ ] No employee receives more than one SMS per 24h per week, even if the manual button is also used.
- [ ] When an employee assigns their hours in Workyard and the week re-imports, they stop being texted and their **system-applied** hold auto-releases.
- [ ] The SMS contains hours + week + a Workyard self-service instruction and **no** "come to the office" language.
- [ ] Employees with no phone are logged as skipped and surfaced to the office, never crash the run.
- [ ] All sends remain dry-run until `TWILIO_*` is configured; going live requires no code change.
- [ ] After N=3 unresolved daily notices, auto-texting stops and the employee is flagged for a human.

---

## Open Questions

1. **Send window & timezone** — 07:00 ET assumed. Confirm employees want a morning text vs end-of-day.
2. **Confirmation SMS** (FR-3) — do we send a "you're all set" when resolved, or stay silent? A positive confirmation may further reduce payday friction; it also costs a message and risks noise.
3. **Terminology** — final wording for the field employees must fill (see Terminology Decision). Needs one person who uses the Workyard mobile app to confirm the on-screen label.
4. **Weekend cadence** — does the 24h cron run Sat/Sun, or weekdays only?
5. **Escalation target** — who is the "human" an unresolved-×3 employee is flagged to? Their direct manager, or the payroll office?
