# Westend → Workyard Setup (S0042–S0067)

**Source of truth:** payroll DB `properties` table (pulled 2026-06-17). All 26 buildings bill to **SREP Westend LLC**.
**Why:** Workyard only has one consolidated `S0049 - West End Portfolio`, which mismaps — the app reads its S-code and dumps *all* Westend hours onto the single property `242-244 S Whitney`. Splitting into the real 26 buildings fixes attribution and unlocks per-building invoice itemization + dumpster analysis.
**Note:** the Workyard API **can** create projects (`POST /projects`) and cost codes (`POST /orgs/{org_id}/cost_codes`) — scriptable, or do it in the UI. Naming follows the existing convention (`S00xx - <building>` for projects, `<building> - Material Pickup` for codes) so the worker taps the building, never the S-code.

---

## Step 1 — Reuse / rename 2 existing projects (don't duplicate)

| Existing Workyard project | Rename to |
|---|---|
| `S0049 - West End Portfolio` | `S0049 - 242-244 S Whitney` |
| `28 Beacon st` *(already exists, un-coded)* | `S0065 - 28 Beacon` |

## Step 2 — Create 24 new projects

| S0042 - 150 S Whitney | S0052 - 250-252 S Whitney |
|---|---|
| S0043 - 154 S Whitney | S0053 - 251 S Whitney |
| S0044 - 155 S Whitney | S0054 - 254 S Whitney |
| S0045 - 159 S Whitney | S0055 - 224 S Whitney |
| S0046 - 163 S Whitney | S0056 - 226 S Whitney |
| S0047 - 178 S Whitney | S0057 - 63 Evergreen |
| S0048 - 240 S Whitney | S0058 - 159 Sisson |
| S0050 - 247 S Whitney | S0059 - 163-165 Sisson |
| S0051 - 246 S Whitney | S0060 - 167-169 Sisson |
| *(S0049 renamed in Step 1)* | S0061 - 9-11 Warrenton |
| | S0062 - 149 Sisson |
| | S0063 - 28 Kibbe |
| | S0064 - 1802-1804 Broad |
| *(S0065 renamed in Step 1)* | S0066 - 39-41 Oxford |
| | S0067 - 47 Oxford |

## Step 3 — Create 26 Material Pickup cost codes

Code = the S-code; name = building + " - Material Pickup". Attach each to **its own project** plus the **vendor projects** the existing pickup codes use (Park Hardware, Home Depot ×3, Lowes, Bender Plumbing, Express Kitchens, New England Gypsum, All Waste).

| Code | Cost-code name | | Code | Cost-code name |
|---|---|---|---|---|
| S0042 | 150 S Whitney - Material Pickup | | S0055 | 224 S Whitney - Material Pickup |
| S0043 | 154 S Whitney - Material Pickup | | S0056 | 226 S Whitney - Material Pickup |
| S0044 | 155 S Whitney - Material Pickup | | S0057 | 63 Evergreen - Material Pickup |
| S0045 | 159 S Whitney - Material Pickup | | S0058 | 159 Sisson - Material Pickup |
| S0046 | 163 S Whitney - Material Pickup | | S0059 | 163-165 Sisson - Material Pickup |
| S0047 | 178 S Whitney - Material Pickup | | S0060 | 167-169 Sisson - Material Pickup |
| S0048 | 240 S Whitney - Material Pickup | | S0061 | 9-11 Warrenton - Material Pickup |
| S0049 | 242-244 S Whitney - Material Pickup | | S0062 | 149 Sisson - Material Pickup |
| S0050 | 247 S Whitney - Material Pickup | | S0063 | 28 Kibbe - Material Pickup |
| S0051 | 246 S Whitney - Material Pickup | | S0064 | 1802-1804 Broad - Material Pickup |
| S0052 | 250-252 S Whitney - Material Pickup | | S0065 | 28 Beacon - Material Pickup |
| S0053 | 251 S Whitney - Material Pickup | | S0066 | 39-41 Oxford - Material Pickup |
| S0054 | 254 S Whitney - Material Pickup | | S0067 | 47 Oxford - Material Pickup |

**Effort-saver option:** Step 3 is 26 codes. If that's too much hand-entry, add **one** `Westend - Material Pickup` code instead — material runs still bill to SREP Westend LLC (the consolidated LLC), you just lose per-building material granularity. On-site time stays per-building via the Step 1–2 projects.
