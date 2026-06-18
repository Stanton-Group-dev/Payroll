# Dumpster Sizing & Off-Site Labor Attribution — PRD
**Project:** Stanton Management Payroll & Invoicing System
**Version:** 1.0
**Status:** Draft — deferred (build after the cost-code cleanup lands)

---

## Problem Statement

Field crews spend real, recurring labor hauling **dumpster overflow** out of buildings — when a property's dumpster is too small for what it generates, someone (often Carlos) repeatedly hauls the excess. Dumpster rentals come in **fixed size tiers**, so this is a clean threshold decision: where the *annual labor cost of hauling a building's overflow* exceeds the *cost delta to the next dumpster size up*, upsize the dumpster.

Today that decision is made on gut feel because nobody can see overflow-hauling labor **by building**. The same blindness hides a second problem: off-site labor (material runs to Home Depot, dump runs to All Waste) that should bill to the property it was *for* sometimes lands on overhead or the vendor instead — so property LLCs are billed unfairly and we can't see it.

**This module surfaces off-site and overflow labor by property, so we can (a) right-size dumpsters and (b) catch billing leakage.**

---

## North Star

> "31 Park burns ~8.6 h/week hauling its own dumpster overflow = ~$X/yr of labor. A larger dumpster there costs $Y/yr. X > Y → upsize." — answerable per property, on demand.

---

## Dependencies (why this is deferred)

This build is blocked on the cost-code cleanup — see [[workyard-cost-code-model]] / `WORKYARD_API_REFERENCE.md`:

1. **A clean `DUMP` (Dumpster Overflow) cost code** must exist and be used consistently. Today overflow is logged under a blank-code "Garbage Cleanup (Dumpster overflow)" entry, inconsistently.
2. **The cost code must be persisted on import.** It is currently **dropped** — `payroll_time_entries` never stores it (insert writes `flag_reason`, not the cost code). Add an additive `cost_code` column + write it at import. This is the one prerequisite that should land regardless.

---

## The Attribution Model

The whole analysis rests on one rule, established during the cost-code cleanup:

- **Project = the property being billed** (S-code / asset id) → *where the cost lands*
- **Cost Code = the activity** (DUMP, MATL, MAINT, …) → *what was done*

Two recovery cases for off-site work, because the GPS geofence is the *vendor*, not the property:

- **Dumpster overflow** — the crew is physically *at the building* hauling it out, so the project already = the property. History is clean.
- **Material pickup** — the geofence is Home Depot / the dump, so historically the property was smuggled into the cost code as an `S00xx` "…- Material Pickup" code (the asset-id workaround). The property is **recoverable** by parsing that S-code back out.

`DUMP` (the building's own dumpster overflows) and `WASTE` (tenant dumped a couch) stay **separate** — that distinction is the entire point of the dumpster-sizing question.

### Overflow labor splits across two codes (key wrinkle)

The per-property "Material Pickup" codes (the asset-id scheme) double as a single-tap property tag for **all** off-site trips — including the **drive to the dump**. So a building's overflow labor splits:

- **Hauling the overflow *at the building*** → tagged `DUMP` (project = the property, since he's on-site).
- **Driving the full truck to All Waste** → tagged `S00xx` "…- Material Pickup" (project = the dump geofence; property carried in the cost code).

The report must **stitch both** to get true overflow cost per property: `DUMP` hours (by project) **+** dump-run Material-Pickup hours (by the S-code embedded in the cost code). Counting only `DUMP` undercounts. This is also why we are NOT collapsing the 41 Material-Pickup codes — they are a working, single-tap, per-property attribution mechanism (scoped so each property's picker shows only its own), and collapsing them to one `MATL` would make attribution a two-step manual action that can be forgotten.

---

## Data Source & Backfill

- **Source:** Workyard `GET /orgs/{org}/time_cards`, `include=cost_allocations,worker`, paginated.
- **Filter gotcha:** the date filter must be the **combined** form built via `URLSearchParams` — `start_dt_unix=gte:<start>+lt:<end>`. The *separate* `start_dt_unix`/`end_dt_unix` form returns HTTP 400 on the current token (contrary to the fallback in `workyard-api.ts`). Proven in `scripts/dumpster-history.mts`.
- **Backfill:** read-only, all available history (queryable back past Oct 2025). Safe to run **before** any Workyard cleanup — and should be, to snapshot history before old codes are retired.
- **Store:** either backfill the new `cost_code` column on existing `payroll_time_entries` rows (join by `workyard_timecardid` + property), or a dedicated `workyard_activity_history` snapshot table independent of finalized payroll. Snapshot table preferred — keeps finalized payroll untouched (no payroll redo).

---

## Metrics & Outputs

1. **Dumpster-overflow hours by property** (and $ = hours × loaded labor rate), ranked → the upsize shortlist.
2. **Upsize decision flag:** annual overflow-haul $ vs the fixed cost delta to the next dumpster tier (tier/price table is a manual input — supply current dumpster size + rental cost per property).
3. **Leakage report:** off-site/overflow hours allocated to a vendor/overhead project (Home Depot, Park Hardware, "no project") instead of a property — i.e. labor a property LLC should have been billed for.
4. **Confidence by period:** flag that the dumpster signal is only as deep as the `DUMP` code's adoption — heavy from ~2026, thin/fuzzy before (older overflow buried under Bulkywaste/untagged).

---

## Findings So Far (read-only pull, 2026-06-17)

- History queryable back to at least Oct 2025.
- Week of Jun 8 2026: **S0020 (31 Park) = 8.6 h** overflow hauling — the clear leader; Westend (S0049) 3.4 h, 228 Maple (S0010) 3.0 h next.
- ~2.5 h that week leaked onto Home Depot / Park Hardware instead of a billable property → live example of the billing miss.
- One week is not a trend — the backfill confirms whether 31 Park is chronic before any dumpster is changed.

---

## Out of Scope (for v1)

- Automating dumpster rental orders.
- Live dumpster tier/price ingestion (manual input for now).
- Reworking finalized historical payroll (analysis reads a snapshot; it does not re-run pay).

## Open Questions

- Where does the report live — a page under `/payroll`, or a periodic export?
- Source of truth for current dumpster size + rental cost per property (needed for the threshold).
- How far back is worth backfilling given the signal thins pre-2026.

---

## Related Artifacts

- `scripts/dumpster-history.mts` — read-only historical pull, dumpster hours by property (working).
- `scripts/dump-cost-codes.mts` — authoritative cost-code list.
- [[workyard-cost-code-model]], [[dumpster-sizing-analysis]] (memory).
