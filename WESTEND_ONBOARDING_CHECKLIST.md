# Westend Onboarding — Remaining Manual Steps

**Status (2026-06-19):** The automatable parts are **done**.
- ✅ DB `properties` rows for S0042–S0067 already existed.
- ✅ All 26 Workyard **projects** exist — 25 auto-created via API (ids 754218–754242), reusing the existing street geofences; `S0049` already existed.
- ⏳ **26 Material-Pickup cost codes** — must be created in the Workyard **UI** (the API can't create cost codes — `POST /cost_codes` 404s).
- ⏳ **`S0049` project rename** — cosmetic, manual (`PUT /projects` 404s; can't rename via API).

Once the cost codes exist, a supply run at any vendor → tap the building's cost code → the merged importer (OD-2) bills the hours to that building automatically.

---

## Step A — Rename one project (cosmetic, optional)
In Workyard, rename project **`S0049- West End Portfolio` → `S0049 - 242-244 S Whitney`**.
*(Not required for billing — the importer already resolves it by the `S0049` prefix. Just so the worker sees the right building name.)*

## Step B — Create 26 Material-Pickup cost codes
For each row: **Code = the S-code**, **Name = "`<building> - Materials / Materiales`"**. Attach each to **its own project** *plus* the **10 vendor clusters** listed below (so it's tappable on a supply run at any of them).

**The 10 vendor clusters:** Park Hardware · Home Depot - West Hartford · Home Depot - Bloomfield · Home Depot-Glastonbury · Lowes - Bloomfield · Bender Plumbing Supply - Hartford · Express Kitchens-Hardware store · New England Gypsum-Material pickup · All Waste- Garbage dumping · All Waste (Dumpyard)

| Code | Cost-code name | Own project |
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

*(Effort-saver alternative from WESTEND_WORKYARD_SETUP.md: one `Westend - Materials / Materiales` code instead of 26 — material runs then bill to consolidated SREP Westend LLC, losing per-building material granularity. On-site time stays per-building via the projects either way.)*

---

## New acquisitions — the one move
```
MSYS_NO_PATHCONV=1 infisical run --projectId=b974f539-54dc-4687-9afd-941d95d434c9 --env=prod --recursive \
  -- node scripts/wy-onboard-buildings.mjs --scode S0068 --name "12 Foo St" --customer <LLC_id> --geofence <geofence_id> --apply
```
That creates the Workyard project (reusing the geofence you pass) and prints the one manual cost-code line to add in the UI. Ensure the DB `properties` row exists first (normal property onboarding).

## Data nit to fix
There are **two** `properties` rows with code `S0042` (one is a "Westend Portfolio - Bookkeeping" aggregate). Dedupe/recode the aggregate so S0042 resolution isn't ambiguous.
