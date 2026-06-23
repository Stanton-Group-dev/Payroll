# New Project Wizard — PRD

| | |
|---|---|
| **Project** | Payroll & Invoicing |
| **Version** | 0.2 |
| **Status** | Draft — intent agreed; build specs carved into PRPs |
| **Owner** | Alex |
| **Created** | 2026-06-23 |
| **Carved into** | [`audit/prps/06_PRP_New_Project_Wizard.md`](audit/prps/06_PRP_New_Project_Wizard.md), [`audit/prps/07_PRP_Travel_Premium_Engine.md`](audit/prps/07_PRP_Travel_Premium_Engine.md) |
| **Builds on** | `WESTEND_ONBOARDING_CHECKLIST.md`, `scripts/wy-onboard-buildings.mjs`, `scripts/wy-create-westend-costcodes.mjs` |

> This is the product-intent PRD (the *what and why*). The build-ready specs — evidence baseline,
> phased steps with verification, definition of done — live in the two carved PRPs above.

---

## Problem

Bringing one new building online is a chore spread across a checklist, two terminal scripts, and
three separate admin pages, with an order nobody has written down except as a checklist. The
Workyard half (create the project + the per-building Materials cost code) requires a developer with
the API key; the payroll half (property record, billing overlay, portfolio, management fee) and the
travel premium are each a different screen. The whole thing is exactly the kind of UI friction that
has pushed work to the terminal.

## Intent

One guided admin **New Project Wizard** that runs the entire onboarding in order, preview-first and
idempotent:

1. **Building** — select or create the property (S-code, units, owner LLC, portfolio).
2. **Workyard** — create the project and the bilingual Materials cost code over the API, wired to
   the building and the standard vendor clusters. Shows create-vs-skip before writing; safe to
   re-run.
3. **Travel premium** — set the per-day or flat amount for off-site buildings.
4. **Payroll wiring** — billing overlay (`owner_llc`, included-in-invoicing), portfolio, optional
   management fee.
5. **Review & apply** — one screen listing every write, then apply (Workyard first, then the DB),
   with an auditable log of what was created vs. skipped.

It lands in the **Settings** group of the sidebar (per this session's nav reorganization).

## The load-bearing finding

**A travel premium today does nothing.** The table and the admin screen exist, but the pay engine
never reads them — verified by grep: the premium's identifiers appear only in the types, the hook,
and the admin page; `calculatePayroll` contains only the unrelated overtime premium. So "set the
travel premium" currently writes a value that pays no one and bills nothing.

That is why this carves into **two** PRPs, not one:
- **PRP-06 — New Project Wizard:** the UI, the server-side Workyard provisioning, and the
  onboarding records. It *writes* the premium row, behind an honest "recorded, not yet applied"
  banner.
- **PRP-07 — Travel Premium Engine:** the money-path change that teaches `calculatePayroll` to pay
  the employee and bill the property, with a golden-week test. This is what makes the premium real.

PRP-06 can ship first for the provisioning value; the premium is only real once PRP-07 lands.

## Primary open questions (full lists live in the PRPs)

1. **Geofences for new locations** — Workyard project creation needs a geofence; can one be created
   via API, or must the wizard select an existing one? (PRP-06 OD-1)
2. **Property identity vs AppFolio** — may the wizard insert a new property, or must AppFolio create
   it first? `properties` is AppFolio-keyed. (PRP-06 OD-2)
3. **Is a travel premium taxable** (bonus) or non-taxable (reimbursement)? (PRP-07 OD-1)
4. **What does "flat per job" mean** — once per week, per dispatch, per work order? (PRP-07 OD-2)

## Out of scope
- Batch onboarding of many buildings (the existing scripts remain for that).
- External (non-building) projects (keep their own page).
- Replacing AppFolio as the source of truth for property identity.
