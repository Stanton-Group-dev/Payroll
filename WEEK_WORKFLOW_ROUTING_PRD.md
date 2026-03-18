# Week Workflow & Smart Routing — PRD
**Project:** Stanton Management Payroll & Invoicing System
**Version:** 1.0
**Status:** Ready for Development
**Supersedes:** WIZARD_ROUTING_PRD.md

---

## Problem Statement

Creating a week immediately drops the user on Payroll Review — empty tables, a blocked gate, and nothing actionable. The system knows exactly what needs to happen next, but it doesn't say so or route accordingly.

The underlying cause is two things running together:

1. **Hardcoded links** — every entry point sends you to `/review` regardless of week status
2. **Review page has no awareness** — it blocks without explaining what's missing or linking to where you need to go

The fix is not a strict linear wizard. The weekly workflow at Stanton is non-linear by necessity — some steps happen Monday, some happen Thursday, some get skipped and caught up the next week. The system should provide structure without enforcing an order that doesn't reflect reality.

---

## Design Principle

**The system should always have a clear answer to: "what do I do now?"**

That answer changes as the week progresses. The UI should surface it without requiring the user to already know the workflow.

---

## The Week Has Two Phases

### Phase A — Open (status: `draft` or `corrections_complete`)

Work is in progress. Time entries are being imported and adjusted, adjustments are being added, dept splits are being confirmed. No strict order between these tasks. The week is "open" until someone deliberately approves the timesheet.

### Phase B — Sequential (status: `payroll_approved` → `invoiced` → `statement_sent`)

Once payroll is approved, the remaining steps are genuinely sequential and gated. Invoices require approved payroll. Statement requires approved invoices. ADP export requires an approved statement. These gates should be enforced.

---

## Part 1 — Smart Routing Helper

Create `src/lib/payroll/stepRouting.ts`:

```
getStepHref(weekId, status) → URL
```

| Status | Routes to | Rationale |
|---|---|---|
| `draft` | `/payroll/import` | Nothing has been imported yet — that's the starting action |
| `corrections_complete` | `/payroll/[weekId]/review` | Corrections done — review is the next gate |
| `payroll_approved` | `/payroll/[weekId]/invoices` | Payroll locked — generate invoices |
| `invoiced` | `/payroll/[weekId]/statement` | Invoices done — build statement |
| `statement_sent` | `/payroll/[weekId]/adp-export` | Statement out — export to ADP |

Apply this helper to:
- **Dashboard week cards** — replace hardcoded `/review` href
- **Sidebar active-week strip** — replace hardcoded `/review` href

---

## Part 2 — Payroll Review Page: Replace Empty State with Week Status Board

The Review page is currently a dead end for `draft` weeks. Instead, it becomes the **Week Status Board** — always useful, regardless of where the week stands.

### What the Status Board shows

A checklist of everything that needs to happen before payroll can be approved. Each item shows its current state and links directly to where you fix it.

```
Week of Mar 8 – Mar 14

BEFORE YOU CAN APPROVE PAYROLL:

[ ] Time cards imported          → Go to Import
[ ] Flagged entries resolved     4 unresolved  → Go to Timesheet Adjustments
[ ] Phone reimbursements seeded  → Go to Adjustments
[ ] Dept splits confirmed        → Go to Dept Splits

                                 [Approve Payroll]  ← disabled until all checked
```

**Checked / unchecked logic:**

| Item | Checked when |
|---|---|
| Time cards imported | At least one `payroll_time_entries` row exists for the week |
| Flagged entries resolved | No rows with `is_flagged = true` or `pending_resolution = true` |
| Phone reimbursements seeded | At least one `payroll_adjustments` row with `type = 'phone'` exists for the week |
| Dept splits confirmed | All active salaried employees have either a default split on file or a `payroll_dept_split_overrides` row for this week |

None of these block each other. All four can be done in any order. The Approve Payroll button unlocks only when all four are checked.

### Below the checklist

The existing Employee Pay Summary and Property Cost Summary tables remain on this page — they populate as data exists and update live. Even in a `draft` week with partial data, seeing partial calculations is useful. The "Timesheet Not Yet Approved" banner is removed; the checklist replaces it entirely.

---

## Part 3 — Tab Locking in `[weekId]/layout.tsx`

Phase B tabs (Invoices, Statement, ADP Export, ADP Reconciliation) are locked ahead of the current status.

**Rules:**

| Tab | Clickable when |
|---|---|
| Payroll Review | Always (it's the status board) |
| Invoices | `status` is `payroll_approved` or later |
| Statement | `status` is `invoiced` or later |
| ADP Export | `status` is `statement_sent` or later |
| ADP Reconciliation | `status` is `statement_sent` or later |

Locked tabs: dimmed, `cursor-not-allowed`, no href. A tooltip on hover: "Complete [previous step] first."

Completed tabs (behind the current step): fully clickable for review. Completed status indicated by a checkmark or muted gold underline.

---

## Part 4 — "Weeks" Breadcrumb

The `← Weeks` link at the top left of the week pipeline already exists. No change needed — it's the correct escape hatch back to the dashboard.

---

## What Does Not Change

- The per-week pipeline tab order (Review → Invoices → Statement → ADP Export → Reconciliation) is correct
- The underlying approval gate logic is unchanged — this PRD only changes what the UI surfaces and where links point
- Adjustments, Dept Splits, and Timesheet Adjustments remain accessible from the "THIS WEEK" utility bar at any time during Phase A

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/payroll/stepRouting.ts` | New helper: `getStepHref()` |
| `src/app/payroll/page.tsx` | Week card href → `getStepHref()` |
| `src/app/payroll/layout.tsx` | Sidebar strip href → `getStepHref()` |
| `src/app/payroll/[weekId]/layout.tsx` | Tab locking based on week status |
| `src/app/payroll/[weekId]/review/page.tsx` | Replace empty blocked state with Week Status Board checklist |

---

## Open Questions

None. The checklist item logic above is fully specified. Build as written.
