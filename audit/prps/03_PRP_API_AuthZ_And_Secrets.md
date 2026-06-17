# 03_PRP_API_AuthZ_And_Secrets.md

**Status:** Ready for review — not yet released to build  
**Owner:** StantonManagement  
**Created:** 2026-06-13  
**Estimated effort:** ~4–6 hours (3 phases, each independently shippable) `[Speculation]`  
**Depends on:** None — self-contained; can ship before or after PRP-01  
**Reads with:** `audit/PAYROLL_RESPINE_AUDIT_2026-06-13.md` (findings S4, S5, S8, S9; gap G8)

---

## 1. Problem Statement

Four application-edge exposures exist today that make the deployed app unsafe to leave at a
publicly routable URL:

1. **Unauthenticated API routes proxying a secret token (S4, G8).** The middleware matcher
   `['/payroll/:path*']` covers only the browser UI. The two Workyard proxy routes —
   `GET /api/workyard/employees` and `GET /api/workyard/timecards` — run with zero auth
   check. Any caller on the public internet can retrieve the full employee roster (PII:
   name, email, status, title) and any week's timecard data, and in doing so forces the
   server to make an outbound call using `WORKYARD_API_KEY`, burning the org's Workyard
   API token budget toward exhaustion or triggering rate-limit lockout.

2. **Public storage bucket exposes receipt and signature PII (S5).** Migration
   `20260308_make_expense_bucket_public.sql` set `storage.buckets.public = true` on
   `expense-receipts`. Files are stored at the predictable path
   `receipts/{userId}/{timestamp}-{uuid}.{ext}`. Any URL-bearer can retrieve receipts and
   signatures without authentication. The Supabase advisor reports
   `public_bucket_allows_listing`.

3. **Hardcoded Supabase URL and publishable key committed to source (S8).** Lines 1–2 of
   `src/lib/supabase/config.ts` contain literal fallback values for the project URL and
   publishable key. The publishable key is not a secret (it is safe in browser JS), but
   the URL and key cannot be rotated without a code change and a deploy; the fallback also
   masks a missing env-var misconfiguration silently rather than failing fast.

4. **No server-side authorization on any API route (S9).** Role gates (`isAdmin`,
   `isManager`) exist only as client-side React state. No API route uses the Supabase
   server client to verify the caller's session or role. If the middleware gap above were
   closed by extending the matcher, a correctly-authenticated but unprivileged caller
   could still retrieve all employee and timecard data with no server-side role check.

---

## 2. Evidence Baseline

| ID | Claim | File:line / query | Status |
|----|-------|-------------------|--------|
| E1 | Middleware matcher is `['/payroll/:path*']` — does not match `/api/**` | `src/middleware.ts:76` | Verified |
| E2 | `/api/workyard/employees` has no session check; calls Workyard unconditionally | `src/app/api/workyard/employees/route.ts:22–55` — `export async function GET()` with no auth guard | Verified |
| E3 | `/api/workyard/timecards` has no session check; calls Workyard unconditionally | `src/app/api/workyard/timecards/route.ts:4–37` — `export async function GET(req)` with no auth guard | Verified |
| E4 | `WORKYARD_API_KEY` forwarded via `Authorization: Bearer` on every unauthenticated request | `src/app/api/workyard/employees/route.ts:34` | Verified |
| E5 | `expense-receipts` bucket set public | `supabase/migrations/20260308_make_expense_bucket_public.sql:3` — `UPDATE storage.buckets SET public = true WHERE id = 'expense-receipts'` | Verified |
| E6 | Receipt path pattern is predictable | `src/hooks/payroll/useExpenseSubmissions.ts` — path `receipts/{userId}/{ts}-{uuid}.{ext}` | Verified (pattern confirmed in audit) |
| E7 | Supabase URL hardcoded as fallback constant | `src/lib/supabase/config.ts:1` — `const FALLBACK_SUPABASE_URL = 'https://wkwmxxlfheywwbgdbzxe.supabase.co'` | Verified |
| E8 | Publishable key hardcoded as fallback constant | `src/lib/supabase/config.ts:2` — `const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_…<redacted>'` (live value in source, not reproduced here) | Verified |
| E9 | `createClient()` (server Supabase client) already exists and uses cookie-based session | `src/lib/supabase/server.ts:5–33` | Verified |
| E10 | `src/app/api/auth/login/route.ts` already calls `createClient()` — the pattern works | `src/app/api/auth/login/route.ts:12` | Verified |
| E11 | `expense-receipts` bucket public flag is `true` in the live DB | Confirmed via migration; live-DB flag `[Unverified — becomes Phase 1 gate]` | `[Unverified]` |
| E12 | No other `/api` routes exist beyond the three enumerated | Glob `src/app/api/**/*.ts` returned exactly: `auth/login/route.ts`, `workyard/employees/route.ts`, `workyard/timecards/route.ts` | Verified |
| E13 | No `SUPABASE_SERVICE_ROLE_KEY` present in repo | Confirmed by audit — no `.env*` file checked into git, no service-role key reference in `config.ts` | Verified (absence) |

---

## 3. Users and Roles

**In scope for this PRP:**

- **Payroll operators / managers** — authenticated Stanton staff who use the payroll UI; they
  should be the only callers of `/api/workyard/*` routes (via the browser-side data-fetching
  hooks).
- **System / deployment pipeline** — the Next.js server process that reads env vars at cold
  start; it must fail loudly when vars are absent.

**Out of scope for v1:**

- Role-differentiated access within `/api/workyard/*` (e.g., only managers can fetch
  employees). Phase 3 establishes the guard pattern; the caller is "any authenticated user".
  Restricting to a specific role is deferred to PRP-01 (RLS & AuthZ remediation) once the
  DB-side RBAC is fixed.
- Service accounts or machine-to-machine API consumers. No such use case exists today.
- Migrating all mutation paths to server-side authz. PRP-01 owns that scope.

---

## 4. Core Features

### F1 — Authenticated session gate on `/api/workyard/employees`

After this PRP, `GET /api/workyard/employees` calls `createClient()`, calls
`supabase.auth.getUser()`, and returns `401 { error: "Unauthorized" }` when no valid
session cookie is present. Only a caller with a live Supabase session (set by
`/api/auth/login`) receives the employee list.

Input: HTTP GET with a valid Supabase session cookie (set by the login flow).  
Output on auth success: `{ employees: WYEmployeeBasic[] }` — unchanged.  
Output on no/invalid session: `401 { error: "Unauthorized" }`.

### F2 — Authenticated session gate on `/api/workyard/timecards`

Same pattern as F1. `GET /api/workyard/timecards?weekStart=YYYY-MM-DD` checks the session
before forwarding to Workyard. Returns `401` when unauthenticated, unchanged response when
authenticated.

Input: HTTP GET with valid session cookie and `weekStart` query param.  
Output on auth success: timecard payload — unchanged.  
Output on no/invalid session: `401 { error: "Unauthorized" }`.

### F3 — Private `expense-receipts` bucket with signed-URL delivery

The `expense-receipts` bucket's `public` flag is set to `false`. Receipt and signature files
are no longer directly accessible by URL-bearer. The client retrieves them via short-lived
signed URLs (TTL: 60 seconds, sufficient for display and download, short enough to prevent
link-sharing abuse). The existing upload path (`useExpenseSubmissions`) requires no change —
uploads use the authenticated client and continue to work.

The signed-URL generation is added to the expense display hook. Wherever the UI currently
constructs a `storage.from('expense-receipts').getPublicUrl(path)` call, it is replaced with
`storage.from('expense-receipts').createSignedUrl(path, 60)`. `[Unverified — exact call site
to confirm in Phase 1]`

### F4 — Fail-fast env-var loading; no committed fallbacks

`src/lib/supabase/config.ts` is rewritten to remove the two hardcoded fallback constants.
`getSupabaseConfig()` reads only from environment variables. If either `NEXT_PUBLIC_SUPABASE_URL`
(or `SUPABASE_URL`) or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_PUBLISHABLE_KEY`
or `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_KEY`) is absent, the function throws a
descriptive error that names the missing variable. This causes the server to fail at
cold-start or at the first request rather than silently operating on stale credentials.

A `# Key rotation` comment block is added (not a code change) noting: "If you rotate the
publishable key or URL in Supabase, update the corresponding Vercel env var and trigger a
redeploy. No code change is needed."

---

## 5. Data Model

No new tables or columns. One SQL change (DDL):

```sql
-- Phase 2: make expense-receipts bucket private
UPDATE storage.buckets SET public = false WHERE id = 'expense-receipts';
```

This is a data-plane change (bucket metadata), not a schema migration. It must be run as an
authenticated Supabase SQL execution against the live project (`wkwmxxlfheywwbgdbzxe`). A
migration file is created for auditability even though Supabase storage bucket metadata
changes are not applied via the migrations table.

No TypeScript type changes. The `WYEmployeeBasic` interface in the employees route is
unchanged — it stays co-located in that file (or can be moved to a shared types file in a
future cleanup; out of scope here).

---

## 6. Integration Points

| System | Hook | Change |
|--------|------|--------|
| Supabase Auth | `createClient()` from `src/lib/supabase/server.ts` → `supabase.auth.getUser()` | Added to both Workyard route handlers before any Workyard call |
| Supabase Storage | `storage.buckets` metadata table | `public` flag set to `false` via SQL |
| Supabase Storage SDK | `storage.from('expense-receipts').createSignedUrl(path, 60)` | Replaces `getPublicUrl` wherever the UI renders expense receipts/signatures |
| `src/lib/supabase/config.ts` | `getSupabaseConfig()` | Hardcoded fallbacks removed; fail-fast on missing env |
| Workyard API (`https://api.workyard.com`) | No change to the outbound call logic — only the auth gate before it changes | `WORKYARD_API_KEY` usage unchanged |
| `src/middleware.ts` | No change in this PRP — the matcher remains `['/payroll/:path*']` | The per-route guard is the chosen fix (see Open Decisions §10) |

---

## 7. Affected Files

### Modified

| File | Change |
|------|--------|
| `src/app/api/workyard/employees/route.ts` | Add session guard (F1): import `createClient`, call `getUser`, return 401 on no session |
| `src/app/api/workyard/timecards/route.ts` | Add session guard (F2): same pattern |
| `src/lib/supabase/config.ts` | Remove `FALLBACK_SUPABASE_URL` and `FALLBACK_SUPABASE_PUBLISHABLE_KEY` constants; add rotation comment (F4) |
| `src/hooks/payroll/useExpenseSubmissions.ts` | Replace `getPublicUrl` with `createSignedUrl(path, 60)` on expense receipt/signature display paths (F3) `[Unverified — exact call site confirmed in Phase 1]` |

### New

| File | Purpose |
|------|---------|
| `supabase/migrations/20260613_make_expense_bucket_private.sql` | Records the `UPDATE storage.buckets SET public = false` for audit trail; applied manually or via Supabase CLI |

### Deleted

None.

---

## 8. Implementation Phases

### Phase 1 — Recon gates (verify all `[Unverified]` claims before writing code)

**Step 1.1 — Confirm live bucket public flag.**  
Run in Supabase SQL editor or via MCP `execute_sql`:
```sql
SELECT id, public FROM storage.buckets WHERE id = 'expense-receipts';
```
Expected: `public = true`. If `false`, the bucket is already private — skip Phase 2's SQL
step and verify signed-URL delivery is already in place.

**Step 1.2 — Confirm exact `getPublicUrl` call site(s) in `useExpenseSubmissions.ts`.**  
Grep: `grep -n "getPublicUrl\|createSignedUrl" src/hooks/payroll/useExpenseSubmissions.ts`  
Expected: one or more `getPublicUrl` calls, zero `createSignedUrl`. If `createSignedUrl` is
already present, Phase 3's hook change is already done — skip it.

**Step 1.3 — Confirm no additional `/api` routes have been added since the audit.**  
Glob: `src/app/api/**/*.ts` — expected files: `auth/login/route.ts`,
`workyard/employees/route.ts`, `workyard/timecards/route.ts`. Any additional file found
must be assessed for an equivalent auth guard before this PRP closes.

**Step 1.4 — Confirm no env vars already absent in the deployed environment.**  
Check Vercel (or `.env.local`) for presence of at least one of: `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_URL`; and at least one of: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_KEY`. If none of
either set is present, the fallback removal (Phase 4) will cause an immediate cold-start
error — set the env var first.

Verification check: all four steps pass (expected values confirmed or documented deviations
noted). Record findings in Decisions Log before proceeding.

---

### Phase 2 — Make the expense-receipts bucket private

**Step 2.1 — Create the migration file.**  
Create `supabase/migrations/20260613_make_expense_bucket_private.sql`:
```sql
-- Revert the public-bucket change from 20260308_make_expense_bucket_public.sql.
-- Receipts and signatures are now served via signed URLs (60 s TTL) from the app layer.
-- ROLLBACK: UPDATE storage.buckets SET public = true WHERE id = 'expense-receipts';
UPDATE storage.buckets SET public = false WHERE id = 'expense-receipts';
```

**Step 2.2 — Apply to the live project.**  
Execute the SQL against `wkwmxxlfheywwbgdbzxe` via Supabase MCP `execute_sql` or the SQL
editor. Do NOT use `apply_migration` via the CLI if schema migrations are not yet wired —
run the SQL directly and record it in the migration file for history.

**Step 2.3 — Verify.**  
```sql
SELECT id, public FROM storage.buckets WHERE id = 'expense-receipts';
```
Expected: `public = false`.

**Step 2.4 — Smoke-test: existing public URL returns 400/403.**  
Construct a known public URL for any existing receipt (from `useExpenseSubmissions`'s upload
path) and confirm it is no longer accessible without a signed URL. Expected: HTTP 400 or 403.

---

### Phase 3 — Add session guards to Workyard routes + replace `getPublicUrl` with signed URL

**Step 3.1 — Guard `GET /api/workyard/employees`.**  
Modify `src/app/api/workyard/employees/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ... existing API_KEY / ORG_ID check and fetch logic unchanged
}
```

**Step 3.2 — Guard `GET /api/workyard/timecards`.**  
Modify `src/app/api/workyard/timecards/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ... existing weekStart validation and fetchWorkyardTimecards call unchanged
}
```

**Step 3.3 — Replace `getPublicUrl` with `createSignedUrl` in `useExpenseSubmissions.ts`.**  
Locate the call site found in Phase 1 Step 1.2. Replace each
`storage.from('expense-receipts').getPublicUrl(path)` with:
```typescript
const { data: signedData, error: signedError } = await storage
  .from('expense-receipts')
  .createSignedUrl(path, 60)
if (signedError || !signedData?.signedUrl) {
  // handle: log + return empty string or placeholder
}
const url = signedData.signedUrl
```
Adjust surrounding code to handle the async nature if the call was previously synchronous.

**Step 3.4 — Verify route guards.**

Test without a session:
```
curl -i http://localhost:3000/api/workyard/employees
```
Expected: `HTTP/1.1 401`, body `{"error":"Unauthorized"}`.

```
curl -i "http://localhost:3000/api/workyard/timecards?weekStart=2026-06-09"
```
Expected: `HTTP/1.1 401`, body `{"error":"Unauthorized"}`.

Test with a valid session cookie (obtain from a logged-in browser DevTools > Application >
Cookies, copy the `sb-*-auth-token` cookie):
```
curl -i --cookie "sb-wkwmxxlfheywwbgdbzxe-auth-token=<token>" \
  http://localhost:3000/api/workyard/employees
```
Expected: `HTTP/1.1 200`, employee list returned.

**Step 3.5 — Verify signed URL delivery for expense receipts.**  
Open the expense-submissions view in the UI as a logged-in user. Confirm receipts and
signatures render without console errors. Confirm the image URL in the DOM contains
`/storage/v1/object/sign/` (the signed URL path) rather than
`/storage/v1/object/public/`.

---

### Phase 4 — Remove hardcoded fallbacks from `config.ts`

**Step 4.1 — Confirm env vars present (prerequisite from Phase 1 Step 1.4).**

**Step 4.2 — Rewrite `src/lib/supabase/config.ts`.**  
Remove `FALLBACK_SUPABASE_URL` and `FALLBACK_SUPABASE_PUBLISHABLE_KEY`. The function reads
only from process.env. Add the rotation comment. The full rewrite:
```typescript
// Key rotation: if NEXT_PUBLIC_SUPABASE_URL or publishable key are rotated in Supabase,
// update the corresponding Vercel environment variable and trigger a redeploy.
// No code change is needed — all credentials flow through env vars only.

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find(v => typeof v === 'string' && v.trim().length > 0)?.trim()
}

export function getSupabaseConfig() {
  const supabaseUrl = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL
  )
  const supabaseAnonKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_KEY
  )

  if (!supabaseUrl) {
    throw new Error(
      'Missing Supabase URL. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in your environment.'
    )
  }
  if (!supabaseAnonKey) {
    throw new Error(
      'Missing Supabase publishable key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in your environment.'
    )
  }

  return { supabaseUrl, supabaseAnonKey }
}
```

**Step 4.3 — Verify: no literal fallbacks remain in source.**  
```
grep -n "sb_publishable_\|wkwmxxlfheywwbgdbzxe\|FALLBACK_SUPABASE" src/lib/supabase/config.ts
```
Expected: zero matches.

**Step 4.4 — Verify: application boots cleanly.**  
Run `npm run dev` (or `npm run build`) with env vars set. Confirm login flow works.
Intentionally unset one env var and confirm the server throws a descriptive error at boot
(not a silent fallback). Restore the var.

---

## 9. Open Decisions

| # | Decision | Default | Rationale |
|---|----------|---------|-----------|
| OD1 | Fix the auth gap via **per-route guard** (this PRP) or via **extending the middleware matcher to `/api/**`** | Per-route guard (this PRP's approach) | Extending the matcher is a single-line change but it would also catch `/api/auth/login` (which must remain unauthenticated — the login endpoint itself). The matcher would need exclusions, making it more complex than adding two guard blocks. Per-route is explicit, auditable, and the pattern already used by `auth/login`. |
| OD2 | Signed URL TTL for expense receipts | 60 seconds | Short enough to prevent link-sharing; long enough for the UI to load and display the image. If users report rendering failures on slow connections, increase to 300 s. |
| OD3 | Should the employee/timecard routes require a specific role (e.g., manager) rather than any authenticated user? | Any authenticated user (session check only) for this PRP | Role-gated API access requires reliable server-side RBAC, which is deferred to PRP-01 (RLS & AuthZ remediation). The session check closes the unauthenticated-access hole now; role scoping is a follow-on. |
| OD4 | Should the old `FALLBACK_SUPABASE_PUBLISHABLE_KEY` value be rotated in Supabase after removal? | Rotation not required in this PRP — it is a publishable key (safe in browser JS) | The publishable key is not a secret. Its commit-history presence does not create a security debt. Document and move on. |

---

## 10. Out of Scope

- **Server-side role enforcement** beyond session presence (requires PRP-01 to fix DB RBAC first).
- **Extending middleware matcher to `/api/**`** — the per-route guard is chosen (see OD1); do not also change the matcher in this PRP.
- **Rotating `WORKYARD_API_KEY`** after the auth-gap remediation. The key is not exposed in source; the remediation closes the unauthenticated-proxy hole. Token rotation is an operational step, not a code change.
- **Migrating all other `getPublicUrl` calls** across the codebase to signed URLs (if any). This PRP targets only `expense-receipts`. Other buckets are out of scope.
- **Service-role key (`SUPABASE_SERVICE_ROLE_KEY`)** setup. S9 notes its absence; the server-side authz pattern introduced here uses the anon/publishable key with cookie-based sessions, which is sufficient for the read routes in scope. A service-role key is deferred to PRP-01 (write-path mutations).
- **Adding role-specific data filtering** (e.g., employees can only see their own timecards). Out of scope pending PRP-01.
- **`src/lib/supabase/server.ts` changes** — the existing `createClient()` is sufficient for this PRP and is not modified.
- **The `useAuth.ts` fail-open role default (S7)** — addressed in PRP-01.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Signing-URL change breaks expense-receipt rendering in the UI | Medium | High (expense approval workflow) | Phase 1 Step 1.2 confirms the exact call site before Phase 3 touches it. Phase 3 Step 3.5 verifies rendering before closing the phase. Rollback reverts bucket to public (2 minutes). |
| Removing fallbacks causes a cold-start boot failure in production | Low | High (full app down) | Phase 1 Step 1.4 explicitly gates on env var presence. Phase 4 only proceeds after that gate passes. Rollback restores the two constants (no redeploy needed if caught locally). |
| Session guard breaks a legitimate non-browser consumer of `/api/workyard/*` (e.g., a cron or a manual script) | Low `[Unverified]` | Medium | No non-browser consumers were found in the codebase audit (A2). If one exists, it must obtain a session token or be moved to a server-action / direct Workyard call. |
| `createClient()` in a route handler throws if cookies() is called outside a request context (Next.js edge case) | Low | Medium | `auth/login/route.ts` already calls `createClient()` successfully (E10), confirming the pattern works in this Next.js version. |
| Signed URLs for large images expire before download completes on slow connections | Low | Low | 60 s TTL is the safe default; OD2 allows increasing to 300 s without any other change. |

---

## 12. Definition of Done

A checker model can confirm all of the following from system/output alone, without reading
source code:

1. `GET /api/workyard/employees` without a session cookie returns `HTTP 401` with body
   `{"error":"Unauthorized"}`.

2. `GET /api/workyard/timecards?weekStart=2026-06-09` without a session cookie returns
   `HTTP 401` with body `{"error":"Unauthorized"}`.

3. `GET /api/workyard/employees` with a valid Supabase session cookie returns `HTTP 200`
   with an `employees` array.

4. The `expense-receipts` storage bucket public flag is `false`:
   ```sql
   SELECT public FROM storage.buckets WHERE id = 'expense-receipts';
   -- Expected: false
   ```

5. Expense receipts and signatures render correctly in the UI for an authenticated user (no
   broken images, no console auth errors).

6. The expense receipt URL in the DOM contains `/storage/v1/object/sign/` (signed URL), not
   `/storage/v1/object/public/`.

7. A direct HTTPS GET to a previously-known public receipt URL returns `HTTP 400` or `403`.

8. `grep` of `src/lib/supabase/config.ts` shows no literal `sb_publishable_`,
   `https://wkwmxxlfheywwbgdbzxe.supabase.co`, or `FALLBACK_SUPABASE` strings:
   ```
   grep -n "sb_publishable_\|wkwmxxlfheywwbgdbzxe\|FALLBACK_SUPABASE" src/lib/supabase/config.ts
   ```
   Expected: zero matches.

9. Application boots cleanly (no startup error) with env vars present; throws a descriptive
   error naming the missing variable when either Supabase env var is absent.

---

## 13. Rollback

Each phase is independently reversible. Rollback does not require redeploying from a
previous Git commit — all reversals are targeted.

| Phase | Rollback action | Time estimate |
|-------|----------------|---------------|
| Phase 1 (recon only) | No state changes made — nothing to roll back. | — |
| Phase 2 (bucket private) | `UPDATE storage.buckets SET public = true WHERE id = 'expense-receipts';` in Supabase SQL editor. Receipts return to public URL delivery immediately. | < 2 min |
| Phase 3 — route guards | Revert `src/app/api/workyard/employees/route.ts` and `src/app/api/workyard/timecards/route.ts` to the pre-guard versions; redeploy. Routes return to unauthenticated access. | ~5 min (git revert + deploy) |
| Phase 3 — signed URLs | Revert `src/hooks/payroll/useExpenseSubmissions.ts` to `getPublicUrl` calls; redeploy. Requires bucket to also be set public again (Phase 2 rollback) to restore display. | ~5 min + Phase 2 rollback |
| Phase 4 (fallback removal) | Re-add the two fallback constants to `src/lib/supabase/config.ts`; redeploy (or run locally without the const change). | ~5 min |

**Combined rollback** (full revert to pre-PRP state): revert all four file changes in Git
and apply the Phase 2 SQL rollback. One `git revert` commit + deploy + one SQL statement.

---

## 14. Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-13 | Per-route session guard chosen over extending middleware matcher | Login route (`/api/auth/login`) must remain unauthenticated; matcher exclusions add complexity; explicit per-route guards are auditable and match the existing `auth/login` pattern. |
| 2026-06-13 | Signed URL TTL set to 60 s | Balances anti-sharing with reliable image load; configurable upward without a PRP revision (see OD2). |
| 2026-06-13 | Publishable key rotation deferred | Publishable key is not a secret class credential; its presence in commit history is informational, not a security debt. |
| 2026-06-13 | Service-role key setup deferred to PRP-01 | The read routes addressed here do not require service-role access; cookie-session pattern (already working in `auth/login`) is sufficient. |

---

## §5 Spec Score

| Element | Score | Note |
|---------|-------|------|
| 1. Problem statement | Y | Four numbered concrete defects with file:line citations |
| 2. Users and roles | Y | Operators, deployment pipeline; out-of-scope consumers named |
| 3. Numbered features | Y | F1–F4, each with typed I/O |
| 4. Data model | Y | No new tables; SQL DDL for bucket change specified exactly |
| 5. Integration points | Y | All touched systems and hooks enumerated |
| 6. Ordered phases | Y | Four phases, each independently shippable and reversible |
| 7. Open decisions with defaults | Y | OD1–OD4, all with defensible defaults and rationale |
| 8. Out of scope | Y | Eleven explicit deferrals named |
| 9. Definition of done | Y | Nine checker-verifiable items, output-observable without reading source |
