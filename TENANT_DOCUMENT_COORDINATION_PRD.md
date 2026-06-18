# Tenant Document Coordination — Cost & Systems-ROI Report PRD
**Project:** Stanton Management Payroll & Invoicing System
**Version:** 1.0
**Status:** Draft — deferred (sibling to the dumpster analysis; build separately)

---

## Problem Statement

Field staff spend real, recurring labor **running tenants down for paperwork** — hand-delivering documents, chasing signatures, and re-visiting **unresponsive or elderly tenants** to get documents in front of them in time. Today this is logged imperfectly under the **`OFFICE` (Oficina)** cost code, which is a catch-all and, in the user's words, *"doesn't quite do it."*

This labor is a **hidden cost of not having better document systems / process / organization** — e-signature, proactive collection, scheduling, better tenant comms. Nobody can see how much it costs because it's buried in "Office" hours, so the case for investing in a fix is never quantified.

**This is the document-side analog of the dumpster report:** surface a recurring, structural cost so a one-time systems investment can be justified against it. (See `DUMPSTER_ANALYSIS_PRD.md`.)

---

## North Star

> "Chasing signatures and paperwork costs ~$X/yr in field labor, concentrated at buildings A/B/C. An e-sign + proactive-collection workflow costs $Y. X > Y → fix the process." — answerable on demand.

---

## Dependencies

1. **A cleaner cost code than `OFFICE`.** `OFFICE`/Oficina currently conflates tenant document-chasing with any genuine office/admin time. Options: rename/split into a dedicated **"Tenant Document Coordination"** code (keeping true admin separate), or sub-tag. Until then the signal is approximate.
2. **Cost-code persistence at import** — the shared prerequisite (cost code is dropped today). Same blocker as invoices + dumpster.

On the **invoice**, this activity already displays as **"Tenant Coordination"** (the `OFFICE` code mapped to a customer-appropriate label) — distinct from this internal cost report.

---

## Metrics & Outputs

1. **Document-coordination labor by property** (hours + $), ranked → where the chasing concentrates.
2. **Trend over time** — is it growing? seasonal (lease renewals, inspections)?
3. **ROI lever:** annual labor $ vs the cost of a better system (e-sign, tenant portal, scheduled collection, proactive outreach). Where labor > fix, invest.
4. *(Stretch)* by **tenant / document type** — which tenants and which documents are chronic. NOTE: tenant-level linkage lives in the leasing module (`guest_cards`, leasing tables), which is **out of payroll scope** — do not pull it into payroll work; if pursued, treat as a separate cross-module effort.

---

## Out of Scope (v1)

- Building the document systems themselves.
- Tenant-level attribution (requires leasing-module data — separate, cross-module).
- Reworking finalized payroll.

## Open Questions

- Split `OFFICE` into (a) tenant document coordination and (b) genuine admin, or sub-tag a single code?
- What's the unit of the "fix" we're comparing against (e-sign seats, a coordinator role, a portal)?
- Is the elderly/unresponsive subset worth flagging distinctly (it may justify a different intervention than general chasing)?

---

## Related

- `DUMPSTER_ANALYSIS_PRD.md` — same pattern (recurring cost → one-time fix ROI).
- [[workyard-cost-code-model]] — the cost-code cleanup this depends on.
