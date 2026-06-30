# Payroll / Workyard — Manual Tasks Handoff

**Purpose:** the code + automation are done and merged. These are the remaining **manual** steps (mostly Workyard UI) needed to finish the rollout. Hand this to whoever owns Workyard data entry.

**Background (1 paragraph):** When a worker does a supply run (Home Depot, Park Hardware, etc.), Workyard records the **vendor** as the project, and the worker taps a per-building **cost code** to say which building the materials are for. The payroll importer was just fixed to read that cost code and bill the hours to the right building (it parses the building S-code, e.g. `S0020`, out of the cost code). For this to work for a building, that building needs **(a)** a Workyard project and **(b)** a per-building "Materials" cost code attached to the vendor "clusters." The projects are now created automatically; **the cost codes can be created via the Workyard API** (`POST /orgs/{org_id}/cost_codes`) or by hand in the UI.

---

## ✅ Already done (no action needed)
- **Cost-code consolidation complete 2026-06-23** — every building project now carries the **12 bilingual activity codes** (Maint / Manten, Construction / Obra, Turnover / Vacante, Bulky / Voluminoso, Dumpster / Desborde, Office / Oficina, Pest / Plagas, Showings / Muestra, Snow / Nieve, Vehicles / Vehículo, Landscape / Jardín, Appliance / Aparato) **+ its own per-building "Materials" code**; the legacy numeric/zero-padded/empty duplicate codes were deleted org-wide (see `DECISIONS_LOG.md` §0.22). ⚠️ **Field-crew heads-up:** the crew was mostly tapping the now-deleted numeric/English codes (e.g. "Construction (General)", "Maintenance- Work Orders", "Turnover…", "Garbage cleanup") — they must now tap the **bilingual survivors** (Construction / Obra, Maint / Manten, Turnover / Vacante, Bulky / Voluminoso, etc.) instead.
- Importer fix shipped + merged to `main` (supply-run hours resolve to the building via the cost code).
- Cost-code names standardized to short bilingual `EN / ES` (e.g. `31 Park - Materials / Materiales`, `Maint / Manten`).
- **All 26 Westend building projects created** in Workyard (S0042–S0067).
- DB `properties` rows + building geofences already existed.

---

## ⏳ TASK 1 — Create 26 Westend "Materials" cost codes  *(Workyard UI — highest priority)*

This is what makes Westend supply runs bill to the right building. In Workyard → Cost Codes → New, create each below.

- **Code** = the S-code (left column).
- **Name** = the middle column (bilingual).
- **Attach each** to its **own project** (right column) **+ all 10 vendor clusters** (listed under the table).

| Code | Name | Own project |
|---|---|---|
| S0042 | 150 S Whitney - Materials / Materiales | S0042 - 150 S Whitney |
| S0043 | 154 S Whitney - Materials / Materiales | S0043 - 154 S Whitney |
| S0044 | 155 S Whitney - Materials / Materiales | S0044 - 155 S Whitney |
| S0045 | 159 S Whitney - Materials / Materiales | S0045 - 159 S Whitney |
| S0046 | 163 S Whitney - Materials / Materiales | S0046 - 163 S Whitney |
| S0047 | 178 S Whitney - Materials / Materiales | S0047 - 178 S Whitney |
| S0048 | 240 S Whitney - Materials / Materiales | S0048 - 240 S Whitney |
| S0049 | 242-244 S Whitney - Materials / Materiales | S0049 - 242-244 S Whitney |
| S0050 | 247 S Whitney - Materials / Materiales | S0050 - 247 S Whitney |
| S0051 | 246 S Whitney - Materials / Materiales | S0051 - 246 S Whitney |
| S0052 | 250-252 S Whitney - Materials / Materiales | S0052 - 250-252 S Whitney |
| S0053 | 251 S Whitney - Materials / Materiales | S0053 - 251 S Whitney |
| S0054 | 254 S Whitney - Materials / Materiales | S0054 - 254 S Whitney |
| S0055 | 224 S Whitney - Materials / Materiales | S0055 - 224 S Whitney |
| S0056 | 226 S Whitney - Materials / Materiales | S0056 - 226 S Whitney |
| S0057 | 63 Evergreen - Materials / Materiales | S0057 - 63 Evergreen |
| S0058 | 159 Sisson - Materials / Materiales | S0058 - 159 Sisson |
| S0059 | 163-165 Sisson - Materials / Materiales | S0059 - 163-165 Sisson |
| S0060 | 167-169 Sisson - Materials / Materiales | S0060 - 167-169 Sisson |
| S0061 | 9-11 Warrenton - Materials / Materiales | S0061 - 9-11 Warrenton |
| S0062 | 149 Sisson - Materials / Materiales | S0062 - 149 Sisson |
| S0063 | 28 Kibbe - Materials / Materiales | S0063 - 28 Kibbe |
| S0064 | 1802-1804 Broad - Materials / Materiales | S0064 - 1802-1804 Broad |
| S0065 | 28 Beacon - Materials / Materiales | S0065 - 28 Beacon |
| S0066 | 39-41 Oxford - Materials / Materiales | S0066 - 39-41 Oxford |
| S0067 | 47 Oxford - Materials / Materiales | S0067 - 47 Oxford |

**The 10 vendor clusters to attach each code to:** Park Hardware · Home Depot - West Hartford · Home Depot - Bloomfield · Home Depot-Glastonbury · Lowes - Bloomfield · Bender Plumbing Supply - Hartford · Express Kitchens-Hardware store · New England Gypsum-Material pickup · All Waste- Garbage dumping · All Waste (Dumpyard)

> **Effort-saver (optional):** instead of 26 codes, you may create **one** `Westend - Materials / Materiales` code. Material runs then bill to the consolidated SREP Westend LLC (you lose per-building material detail; on-site labor still bills per-building via the projects). Pick one approach, not both.

---

## ⏳ TASK 2 — Rename one project  *(Workyard UI — cosmetic, low priority)*
Rename project **`S0049- West End Portfolio` → `S0049 - 242-244 S Whitney`**.
*Not required for billing (it already resolves correctly); just so the worker sees the right building name.*

---

## ✅ TASK 3 — Delete junk/duplicate cost codes  *(DONE — superseded 2026-06-23)*
Superseded by the org-wide cost-code consolidation on **2026-06-23**: **all 15 legacy duplicates** were deleted (not just the 3 listed here) — numeric `1 2 3 4 5 6 8 9`, zero-padded `01 02 03 05 001`, and the two empty-code ones ("Garbage cleanup (Bulkywaste)", "Construction (Waste and debris dumping)"). Every building project now sits at the clean **12 bilingual activity codes + its own Materials code** standard. See `DECISIONS_LOG.md` §0.22.

---

## ⏳ TASK 4 — Fix a duplicate property record  *(DB / dev — low priority)*
There are **two** `properties` rows with code `S0042`: the real `S0042 - 150 S Whitney` and a `S0042-67 - Westend Portfolio - Bookkeeping` aggregate. Re-code or remove the aggregate so S0042 resolution isn't ambiguous. (Ask a developer — this is a database edit, not Workyard.)

---

## How to verify it worked
After Task 1, on the **next weekly Workyard import**: a Westend supply run (worker at a vendor who tapped, e.g., `S0042` "150 S Whitney - Materials") should import as **allocated to that building**, not flagged "Property not found." Spot-check a few in the import preview.

## Reference (in the repo)
- `WESTEND_ONBOARDING_CHECKLIST.md` — same Task 1/2 detail.
- `DECISIONS_LOG.md` §0.10–0.16 — why it's set up this way + the Workyard API limits.
- `scripts/wy-onboard-buildings.mjs` — the "one move" tool for **future** acquisitions (creates the project; still leaves the one cost code to add by hand).

## Future acquisitions (one move)
For each new building, a developer runs:
```
MSYS_NO_PATHCONV=1 infisical run --projectId=b974f539-54dc-4687-9afd-941d95d434c9 --env=prod --recursive \
  -- node scripts/wy-onboard-buildings.mjs --scode <S-code> --name "<building>" --customer <LLC_id> --geofence <geofence_id> --apply
```
…then create that building's one "Materials" cost code in the Workyard UI (per Task 1). Make sure the DB `properties` row exists first (normal property onboarding).
