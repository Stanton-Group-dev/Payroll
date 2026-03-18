# Navigation Restructure & External Project Matching — PRD
**Project:** Stanton Management Payroll & Invoicing System
**Version:** 1.0
**Status:** Ready for Development
**Addresses:** Nav structure confusion, external project Workyard matching, import unmatched project handling

---

## Problem Statement

Two compounding problems make the system hard to use without documentation:

**1. The nav doesn't reflect how the system is actually used.** Operations, Intelligence, and Admin are organized by category, not by workflow. Setup items (Employees & Rates, External Projects, Management Fee) live in the same tier as weekly operational steps, so there's no signal about what's setup-once vs. do-every-week. The weekly sequence — import → adjustments → review → export — isn't visible. A user opening the app for the first time has no idea what to click first, second, or third.

**2. External projects can't be matched to Workyard data.** The External Projects form has no field for the Workyard customer name. Import has no mechanism to match a raw Workyard string like "zimmerman stupid house" to the Zimmerman Personal project record. Unmatched non-S-code projects are silently dropped or errored. There's also no way to give a project a clean display name separate from what Workyard calls it — the two have to be the same, and they shouldn't have to be.

---

## Users Affected

Everyone, but especially Managers running weekly payroll. The system was written by the person who uses it most and it's still unclear where to click second. That's the bar this needs to clear.

---

## Part 1 — Nav Restructure

### Design Principle

The nav should be organized by *when* you use something, not by what category it falls into. A user who has never read documentation should be able to infer the correct order of operations from the nav structure alone.

### Proposed Structure

**SETUP** — do once, revisit occasionally

| Item | Current location |
|---|---|
| Employees & Rates | OPERATIONS |
| Portfolios & Properties | ADMIN |
| External Projects | ADMIN |
| Management Fee | ADMIN |
| Travel Premiums | ADMIN |
| Users & Roles | ADMIN |
| Budget Thresholds | ADMIN |

Setup items are not hidden — they need to be findable — but they're visually de-emphasized relative to the weekly workflow. Collapsed by default once a user has completed initial setup, expandable on demand.

---

**THIS WEEK** — the weekly workflow, in order

The weekly workflow section replaces the freestanding Operations items. It is structured as a numbered sequence so the order is self-evident.

| Step | Screen | Replaces |
|---|---|---|
| 1. Select / Create Week | Week Dashboard | Week Dashboard (OPERATIONS) |
| 2. Import Time Cards | Workyard Import | Workyard Import (OPERATIONS) |
| 3. Adjust Timesheets | Timesheet Adjustments | Timesheet Adjustments (OPERATIONS) |
| 4. Adjustments | Adjustments | Adjustments (OPERATIONS) |
| 5. Dept Splits | Dept Splits | Dept Splits (OPERATIONS) |
| 6. Review & Approve | Payroll Review (week tab) | — |
| 7. Invoices | Invoices (week tab) | — |
| 8. Statement | Statement (week tab) | — |
| 9. ADP Export | ADP Export (week tab) | — |
| 10. ADP Reconciliation | ADP Reconciliation (week tab) | — |

Steps 6–10 currently live inside the week-tab pipeline, which is fine, but the nav should make clear that they exist and where they fit in the sequence. When a week is in progress, the active step should be highlighted in the nav automatically based on `payroll_weeks.status`.

**Expenses** fits between step 4 and 5 — it's a weekly operational item, not setup and not intelligence.

---

**INTELLIGENCE** — unchanged in concept, renamed for clarity

| Item | Notes |
|---|---|
| Cost-Per-Unit | Requires completed weeks before useful output |

---

**Active week context strip**

When a week is in progress, a persistent strip above the nav (or at the top of the content area) shows:

> **Week of Mar 3–9** · Corrections in progress · 4 unresolved entries

This replaces the need to navigate back to the Week Dashboard to know where things stand. Clicking it takes you to the active week.

---

## Part 2 — External Project Workyard Matching

### Problem in Detail

Workyard identifies work by "Project Name" (S-codes for properties) and "Customer Name" (LLC/client name). When an employee logs time against an external project in Workyard, import sees a customer name string — not an S-code. Currently there's no match key on the external project record, so that string hits import and either errors or gets dropped.

Additionally, Workyard names are informal and internal. "Zimmerman Personal" might be "zimmerman house" or "zim personal" or "zim job" in Workyard depending on who set it up. What shows on the invoice ("Zimmerman Personal") and what Workyard calls it should be maintained separately.

### Data Model Change

Add `workyard_customer_names` to external projects — an array, not a single string, because the same project may appear under multiple Workyard names if it was set up inconsistently.

```sql
ALTER TABLE payroll_external_projects
  ADD COLUMN workyard_customer_names TEXT[] DEFAULT '{}';
-- One project can match against multiple Workyard customer name strings.
-- Match is case-insensitive, trimmed.
```

The display name on the record (`name`) is what appears on invoices and in the UI. `workyard_customer_names` is the match key, invisible to invoice recipients.

### Form Change — External Projects

Add a "Workyard Names" field to the Add/Edit form:

- Label: **Workyard Project Name(s)**
- Helper text: *What does this project get called in Workyard? Can add multiple if it varies.*
- Input: tag-style multi-entry (type a name, press Enter to add, click × to remove)
- Optional — projects can exist without a Workyard name (for manually-entered hours only)

### Import Change — Unmatched Project Handling

Currently: unmatched non-S-code customer names are dropped or error.

New behavior: unmatched customer name strings surface as **Unrecognized Projects** in the import preview, same visual tier as flagged/unmatched employees. For each unrecognized project string:

**Option A — Link to existing external project**
Dropdown of existing external projects. Selecting one adds the Workyard string to that project's `workyard_customer_names` array automatically.

**Option B — Create new external project**
Inline form: Display Name (required), Client Name, Billed To. The Workyard string pre-fills as the first entry in `workyard_customer_names`. User can rename the display name without touching the match key.

**Option C — Ignore**
Hours attached to this project are dropped from import. Requires explicit confirmation. Logged as a discarded import entry with the original string and user who dismissed it.

Import does not complete while unrecognized projects are in state A or B (unresolved). State C (ignored) counts as resolved.

### Edit Flow — Existing External Projects

The External Projects admin page gains an Edit action per record that opens the same slide-out form, now including the Workyard Names field. Managers can add, remove, or correct Workyard name strings at any time without affecting past matched records.

---

## What Does Not Change

- The per-week pipeline tab structure (Payroll Review → Invoices → Statement → ADP Export → Reconciliation) is correct. The issue is it's not visible from the nav before you're inside a week.
- External project invoice format is unchanged — they remain first-class entities with the same invoice structure as LLC portfolios.
- S-code matching logic is unchanged — properties still match by `asset_id`.

---

## Implementation Notes

- `workyard_customer_names` match should be case-insensitive and trim whitespace before comparison
- The nav restructure is a UI-only change — no data model impact
- The active week context strip requires reading `payroll_weeks` for the most recent non-completed week
- "Unrecognized Projects" in import preview should use the same visual pattern as unmatched employees (yellow/flagged row with inline action)
- Add/Edit external project form should be triggerable from the import screen, not just from the admin page

---

## Resolved Questions

| # | Decision |
|---|---|
| 1 | **Expenses** — standalone item outside the numbered sequence. Not every week has expenses; forcing it into the step numbering creates noise. Lives in the nav between the weekly workflow section and Intelligence. |
| 2 | **Active week context strip** — shows on all pages. Only one week is in progress at a time so there's no ambiguity about which week it refers to. |
| 3 | **History** — standalone nav item. Not part of the weekly workflow, not Setup. Sits below Intelligence. |
