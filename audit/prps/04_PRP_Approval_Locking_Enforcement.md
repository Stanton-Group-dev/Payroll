# 04_PRP_Approval_Locking_Enforcement

| Field | Value |
|---|---|
| **Status** | Draft — awaiting human release |
| **Owner** | StantonManagement |
| **Created** | 2026-06-13 |
| **Estimated effort** | 5–8 dev-days (M) — DB trigger/enum work is self-contained; actor-column sweep is broad but mechanical |
| **Depends on** | `01_PRP_RLS_Authz_Remediation` — the write-path must be authenticated and role-gated before a lock trigger is meaningful |
| **Reads with** | `PAYROLL_RESPINE_AUDIT_2026-06-13.md` (findings ST2, ST5, S3, schema hooks D1/D2, gaps G6/G7); `STANTON-spec-standard.md` §3 skeleton |

---

## 1. Problem Statement

1. **Locking is a React boolean.** `timesheets/page.tsx:55` derives `isLocked` from `selectedWeek.status` at render time: `const isLocked = !!selectedWeek && ['payroll_approved', 'invoiced', 'statement_sent'].includes(selectedWeek.status)`. This flag gates UI gestures only. No DB trigger, RLS `WITH CHECK` predicate, or stored function rejects mutations on child rows of a locked week. With S1/S2 in play (closed by PRP-01) a "locked" week is writable by any caller who bypasses the UI entirely.

2. **The four approval stages are independent, unordered hook writes.** `usePayrollWeekReview.approvePayroll`, `usePayrollWeekInvoices.generateInvoices`/`approveAll`, and `usePayrollStatement.approveStatement` each write directly to `payroll_approvals` and update `payroll_weeks.status` without verifying the preceding stage was completed. Nothing in the DB prevents issuing a `statement` approval before a `payroll` approval exists.

3. **No actor/role column on mutation tables.** `payroll_time_entries`, `payroll_adjustments`, `payroll_timesheet_corrections`, `payroll_invoice_line_items`, `payroll_weekly_property_costs`, and `payroll_approvals` carry at most a `created_by uuid` (not uniformly populated); no `actor_role`, no `updated_by`. Actor attribution is absent or voluntary.

4. **`payroll_audit_log` is app-written and forgeable.** Live-DB policy: authenticated `INSERT WITH CHECK true` + `SELECT USING true`, no actor binding (verified: `pg_policies`). Any authenticated user can insert fabricated rows. The table does not exist in `src/lib/supabase/types.ts`, confirming it is written ad-hoc from non-type-checked paths. (The one saving grace: no `UPDATE`/`DELETE` policy, so existing rows cannot be changed.)

5. **The auditable, approval-gated value proposition is not demonstrable.** A week marked `statement_sent` can have its time entries mutated. The audit trail can be seeded with arbitrary data. These two facts together make the system's primary differentiator from the Excel baseline unverifiable.

---

## 2. Evidence Baseline

| ID | Claim | Verified | Source |
|---|---|---|---|
| E1 | `isLocked` is a client-only boolean; no DB object enforces immutability | **Verified** | `src/app/payroll/timesheets/page.tsx:55` (read) |
| E2 | `approvePayroll` writes `payroll_approvals` + `payroll_weeks.status` without checking prior stage exists | **Verified** | `src/hooks/payroll/usePayrollWeekReview.ts:86-93` (read) |
| E3 | `generateInvoices` writes `payroll_weeks.status = 'invoiced'` without checking `payroll_approved` approval row exists | **Verified** | `src/hooks/payroll/usePayrollWeekInvoices.ts:139` (read) |
| E4 | `approveStatement` writes `payroll_approvals(stage='statement')` without checking `invoice` approval row | **Verified** | `src/hooks/payroll/usePayrollStatement.ts:46-55` (read) |
| E5 | `WeekStatus` type is already a union: `'draft' \| 'corrections_complete' \| 'payroll_approved' \| 'invoiced' \| 'statement_sent'` — a DB enum promotion has a TS equivalent to align against | **Verified** | `src/lib/supabase/types.ts:2` (read) |
| E6 | `payroll_audit_log` policies: authenticated INSERT `WITH CHECK true` + SELECT `USING true`; no actor binding | **Verified** | live `pg_policies` introspection (audit report S3) |
| E7 | `payroll_audit_log` has no corresponding TypeScript interface in `src/lib/supabase/types.ts` | **Verified** | full read of types.ts — no `PayrollAuditLog` type found |
| E8 | Zero `.rpc()` calls in the codebase; all approval mutations are direct table writes from hooks | **Verified** | `grep -r '\.rpc(' src/` → no matches (audit A1) |
| E9 | `payroll_approvals.approved_by` is present but `actor_role` column does not exist on any payroll table | **Verified** | `src/lib/supabase/types.ts:219-227` — `PayrollApproval` has no role field; `PayrollTimeEntry:94-117` has `created_by` only |
| E10 | `payroll_weeks` has no DB-level enum constraint; `status` column is a free text field backed only by the TS union | `[Unverified — Phase 1 gate]` | Must confirm via `information_schema.columns` + `pg_type` on the live DB |
| E11 | No DB trigger on `payroll_time_entries`, `payroll_adjustments`, or related child tables performs a lock check | `[Unverified — Phase 1 gate]` | Must confirm via `pg_trigger` on the live DB |

---

## 3. Users and Roles

| Role | Interaction with this PRP |
|---|---|
| **Payroll Manager** | Drives the approval chain (timesheet → payroll → invoices → statement); only one whose actions advance `payroll_weeks.status` |
| **Payroll Admin** | Same as manager; additionally may perform carry-forward post-lock (the one permitted post-lock mutation path) |
| **Authenticated viewer / other Stanton staff** | Reads only; after PRP-01 lands, write grants will be narrowed — lock enforcement adds a second backstop |
| **DB migration author / DBA** | Applies schema migrations; DROP of a trigger is a rollback action available only to this role |
| **Anon / unauthenticated** | Must be blocked at the authz layer (PRP-01); lock trigger is a defence-in-depth backstop |
| **Out of scope v1** | Per-employee approval sub-stage; ADP export gating; portfolio-level approval chain |

---

## 4. Core Features

Each feature is stated as a named action with measurable post-condition.

**F1 — `enforce_week_lock` DB trigger (or RLS `WITH CHECK` predicate)**
A trigger (or policy) fires `BEFORE INSERT OR UPDATE OR DELETE` on every child table belonging to a payroll week:
- `payroll_time_entries`
- `payroll_adjustments`
- `payroll_timesheet_corrections`
- `payroll_weekly_property_costs`
- `payroll_invoices`
- `payroll_invoice_line_items`
- `payroll_spread_events`

When the referenced `payroll_weeks.status` is `payroll_approved`, `invoiced`, or `statement_sent`, the trigger raises `SQLSTATE 'P0001'` with message `'payroll_week.locked: mutations not permitted after approval'`. Carry-forward entries (those inserting into the *current* open week, not the locked week) are unaffected because they write to a different `payroll_week_id`.

**F2 — `payroll_weeks.status` promoted to a Postgres enum**
Create a `payroll_week_status` domain (or `CREATE TYPE … AS ENUM`) and alter `payroll_weeks.status` to use it. The five values match the current TS union: `draft`, `corrections_complete`, `payroll_approved`, `invoiced`, `statement_sent`. Any direct SQL `UPDATE payroll_weeks SET status = 'bogus_value'` is rejected by the type system, not just by application logic.

**F3 — `enforce_approval_sequence` DB function called at each stage transition**
A stored function `payroll_advance_status(week_id uuid, target_status payroll_week_status, actor_id uuid, actor_role text)` checks the prerequisite approval stage exists before writing the new status. The prerequisite chain:
- `corrections_complete` → no prerequisite (any manager/admin may advance)
- `payroll_approved` → a `payroll_approvals(stage='timesheet')` row must exist for the week, OR the system may auto-create a `timesheet` row as part of the same transaction (configurable via open decision OD-1)
- `invoiced` → a `payroll_approvals(stage='payroll')` row must exist
- `statement_sent` → a `payroll_approvals(stage='invoice')` row must exist

The function raises `SQLSTATE 'P0002'` with a descriptive message if the prerequisite is absent. App hooks are refactored to call this function via `.rpc('payroll_advance_status', {...})` instead of writing directly to `payroll_weeks`.

**F4 — Actor columns added to mutation-bearing tables**
Add `actor_id uuid REFERENCES auth.users(id)` and `actor_role text` to:
- `payroll_time_entries` (alongside existing `created_by`)
- `payroll_adjustments`
- `payroll_timesheet_corrections`
- `payroll_approvals`
- `payroll_weekly_property_costs`
- `payroll_invoice_line_items`

Both columns are nullable in the migration (no NOT NULL constraint at add-time) to avoid breaking existing rows. A separate phase backfills `actor_id` from `created_by`/`approved_by` where available. After backfill, `actor_id` is set NOT NULL on new inserts via a trigger default.

**F5 — `payroll_events` append-only event table**
Create one table:

```sql
CREATE TABLE payroll_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    text NOT NULL,              -- e.g. 'time_entry.created', 'week.status_advanced'
  entity        text NOT NULL,              -- table name / domain noun
  entity_id     uuid NOT NULL,
  actor_id      uuid REFERENCES auth.users(id),
  actor_role    text,
  payload       jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
```

Append-only enforced by:
- REVOKE UPDATE, DELETE ON payroll_events FROM authenticated, anon (no update/delete grant)
- A `BEFORE UPDATE OR DELETE` trigger raises `SQLSTATE 'P0003'` `'payroll_events.immutable: rows cannot be modified or deleted'`
- RLS: INSERT policy `WITH CHECK (actor_id = auth.uid())` (actor must be the caller); SELECT policy scoped to payroll roles (aligned with PRP-01 role definitions).

DB triggers on the above child tables (F1's trigger set) also write one row to `payroll_events` per mutation, carrying the `OLD`/`NEW` delta as `payload`. This is the real audit spine.

**F6 — `payroll_audit_log` actor-binding or migration to `payroll_events`**
Bind the existing `payroll_audit_log` INSERT policy to `WITH CHECK (actor_id = auth.uid())` (renaming or adding an `actor_id` column if absent). If the table schema permits it without a breaking migration, prefer this surgical fix. If the table structure is incompatible, migrate all app-layer `payroll_audit_log` writes to `payroll_events` and deprecate `payroll_audit_log`. The choice is resolved in Phase 1 after live inspection (open decision OD-2).

**F7 — Hook refactor to use `payroll_advance_status` RPC**
The four approval hooks (`usePayrollWeekReview.approvePayroll`, `usePayrollWeekInvoices.generateInvoices`/`approveAll`, `usePayrollStatement.approveStatement`) are updated to:
1. Call `.rpc('payroll_advance_status', { week_id, target_status, actor_id, actor_role })` instead of writing directly to `payroll_weeks`.
2. Surface the RPC error (including lock/sequence violations) to the UI via the existing `setError` pattern.
3. Remove the duplicate `payroll_weeks.update(...)` and `payroll_approvals.insert(...)` calls that were doing the same work.

**F8 — TypeScript types aligned**
- Add `PayrollEvent` interface to `src/lib/supabase/types.ts` mirroring the `payroll_events` table.
- Add `actor_id: string | null` and `actor_role: string | null` to `PayrollTimeEntry`, `PayrollAdjustment`, `PayrollTimesheetCorrection`, `PayrollApproval`, `PayrollWeeklyPropertyCost`, `PayrollInvoiceLineItem`.
- Regenerate or manually update types to include `payroll_week_status` as a named type replacing the inline `WeekStatus` union (or alias the union to match the DB enum).

---

## 5. Data Model

### 5a. Hooks now — changes applied in this PRP

**New Postgres type:**
```sql
CREATE TYPE payroll_week_status AS ENUM (
  'draft',
  'corrections_complete',
  'payroll_approved',
  'invoiced',
  'statement_sent'
);

ALTER TABLE payroll_weeks
  ALTER COLUMN status TYPE payroll_week_status
    USING status::payroll_week_status;
```

**Actor columns (added nullable; backfilled in Phase 3):**
```sql
ALTER TABLE payroll_time_entries
  ADD COLUMN actor_id uuid REFERENCES auth.users(id),
  ADD COLUMN actor_role text;

ALTER TABLE payroll_adjustments
  ADD COLUMN actor_id uuid REFERENCES auth.users(id),
  ADD COLUMN actor_role text;

ALTER TABLE payroll_timesheet_corrections
  ADD COLUMN actor_id uuid REFERENCES auth.users(id),
  ADD COLUMN actor_role text;

ALTER TABLE payroll_approvals
  ADD COLUMN actor_role text;
-- Note: payroll_approvals.approved_by already exists; actor_id aliases it.

ALTER TABLE payroll_weekly_property_costs
  ADD COLUMN actor_id uuid REFERENCES auth.users(id),
  ADD COLUMN actor_role text;

ALTER TABLE payroll_invoice_line_items
  ADD COLUMN actor_id uuid REFERENCES auth.users(id),
  ADD COLUMN actor_role text;
```

**New table — `payroll_events`:**
```sql
CREATE TABLE payroll_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,
  entity      text        NOT NULL,
  entity_id   uuid        NOT NULL,
  actor_id    uuid        REFERENCES auth.users(id),
  actor_role  text,
  payload     jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only: no UPDATE/DELETE grants
REVOKE UPDATE, DELETE ON payroll_events FROM authenticated;
REVOKE UPDATE, DELETE ON payroll_events FROM anon;

-- Immutability trigger (belt-and-suspenders)
CREATE OR REPLACE FUNCTION payroll_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payroll_events.immutable: rows cannot be modified or deleted'
    USING ERRCODE = 'P0003';
END;
$$;

CREATE TRIGGER trg_payroll_events_immutable
  BEFORE UPDATE OR DELETE ON payroll_events
  FOR EACH ROW EXECUTE FUNCTION payroll_events_immutable();

-- RLS
ALTER TABLE payroll_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_events_insert ON payroll_events
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE POLICY payroll_events_select ON payroll_events
  FOR SELECT TO authenticated
  USING (payroll_is_manager_or_above());   -- aligned with PRP-01 role functions
```

**Lock-enforcement trigger function:**
```sql
CREATE OR REPLACE FUNCTION payroll_enforce_week_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status payroll_week_status;
  v_week_id uuid;
BEGIN
  -- Resolve the week_id from the row being mutated
  v_week_id := COALESCE(NEW.payroll_week_id, OLD.payroll_week_id);
  IF v_week_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status
  FROM payroll_weeks
  WHERE id = v_week_id;

  IF v_status IN ('payroll_approved', 'invoiced', 'statement_sent') THEN
    RAISE EXCEPTION 'payroll_week.locked: mutations not permitted on week % after approval (status: %)',
      v_week_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
```

(Trigger registrations on child tables — see §9 Phase 2.)

**`payroll_advance_status` stored function:**
```sql
CREATE OR REPLACE FUNCTION payroll_advance_status(
  p_week_id     uuid,
  p_target      payroll_week_status,
  p_actor_id    uuid,
  p_actor_role  text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_current payroll_week_status;
  v_prereq  text;
BEGIN
  SELECT status INTO v_current FROM payroll_weeks WHERE id = p_week_id FOR UPDATE;

  -- Validate target is a legal forward transition
  IF (v_current = 'draft'                AND p_target = 'corrections_complete') OR
     (v_current = 'corrections_complete' AND p_target = 'payroll_approved')     OR
     (v_current = 'payroll_approved'     AND p_target = 'invoiced')             OR
     (v_current = 'invoiced'             AND p_target = 'statement_sent')
  THEN NULL; -- valid
  ELSE
    RAISE EXCEPTION 'payroll_advance_status: invalid transition % -> % for week %',
      v_current, p_target, p_week_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Check prerequisite approval stage exists
  v_prereq := CASE p_target
    WHEN 'payroll_approved' THEN 'timesheet'
    WHEN 'invoiced'         THEN 'payroll'
    WHEN 'statement_sent'   THEN 'invoice'
    ELSE NULL
  END;
  IF v_prereq IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payroll_approvals
    WHERE payroll_week_id = p_week_id AND stage = v_prereq
  ) THEN
    RAISE EXCEPTION 'payroll_advance_status: prerequisite stage "%" not approved for week %',
      v_prereq, p_week_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Write status and audit event
  UPDATE payroll_weeks SET status = p_target, updated_at = now() WHERE id = p_week_id;

  INSERT INTO payroll_events (event_type, entity, entity_id, actor_id, actor_role, payload)
  VALUES (
    'week.status_advanced',
    'payroll_weeks',
    p_week_id,
    p_actor_id,
    p_actor_role,
    jsonb_build_object('from', v_current, 'to', p_target)
  );
END;
$$;
```

### 5b. Deferred aggregates — named, not built in this PRP

| Aggregate | Description | Trigger for build |
|---|---|---|
| `payroll_events` per-domain views | Materialised or live views over `payroll_events` filtered by `entity` (e.g. `v_timesheet_events`, `v_approval_events`) | When audit UI or reporting is built |
| `payroll_week_audit_summary` | Rolled-up approval history per week for the statement view | When statement UI shows audit tab |
| Per-employee event timeline | Query over `payroll_events WHERE payload->>'employee_id' = $1` | When employee history view is built |
| `payroll_audit_log` retirement migration | Drop or archive the old table once `payroll_events` is the confirmed sole spine | After PRP-05 error-handling sweep confirms no remaining app-layer writes to it |

---

## 6. Integration Points

| System | Hook used | Direction | Notes |
|---|---|---|---|
| `payroll_weeks` table | `ALTER COLUMN status`, new `payroll_advance_status` RPC | Schema + write | Lock trigger reads this table on every child mutation |
| `payroll_approvals` table | Read-only from trigger; existing insert path replaced by RPC | Structural shift | RPC writes both `payroll_weeks` and `payroll_approvals` atomically |
| `usePayrollWeekReview` | `.rpc('payroll_advance_status', …)` replaces direct writes | Client hook refactor | Surfaces RPC error via existing `setError` |
| `usePayrollWeekInvoices` | Same | Client hook refactor | `generateInvoices` must check `payroll_approved` status or let RPC enforce it |
| `usePayrollStatement` | Same | Client hook refactor | `approveStatement` call chain simplified |
| `payroll_audit_log` | Either actor-bind INSERT policy or migrate writes to `payroll_events` | Policy / migration | Resolved by Phase 1 live inspection (OD-2) |
| Supabase Auth (`auth.users`) | `actor_id` FKs reference this | DB-level | No code change in auth path; columns are nullable initially |
| PRP-01 role functions (`payroll_is_manager_or_above`, `payroll_get_role`) | Used in `payroll_events` SELECT policy + `payroll_advance_status` caller check | Policy | PRP-01 must land first; these functions must exist and be hardened |

---

## 7. Affected Files

### New files
| File | Type | Purpose |
|---|---|---|
| `supabase/migrations/YYYYMMDD_payroll_week_status_enum.sql` | DB migration | Create `payroll_week_status` enum, alter `payroll_weeks.status` |
| `supabase/migrations/YYYYMMDD_actor_columns.sql` | DB migration | Add `actor_id`/`actor_role` to 6 tables (nullable) |
| `supabase/migrations/YYYYMMDD_payroll_events.sql` | DB migration | Create `payroll_events` table, immutability trigger, RLS |
| `supabase/migrations/YYYYMMDD_lock_enforcement.sql` | DB migration | `payroll_enforce_week_lock()` function + trigger registrations on 7 child tables |
| `supabase/migrations/YYYYMMDD_advance_status_rpc.sql` | DB migration | `payroll_advance_status()` stored function + GRANT EXECUTE |
| `supabase/migrations/YYYYMMDD_audit_log_actor_bind.sql` | DB migration | Bind `payroll_audit_log` INSERT policy to `actor_id = auth.uid()` (or, if OD-2 = migrate, deprecation note) |

### Modified files
| File | Change |
|---|---|
| `src/lib/supabase/types.ts` | Add `PayrollEvent` interface; add `actor_id`/`actor_role` fields to 6 existing interfaces; align `WeekStatus` to match enum values |
| `src/hooks/payroll/usePayrollWeekReview.ts` | Replace direct `payroll_weeks.update` + `payroll_approvals.insert` in `approvePayroll` with `.rpc('payroll_advance_status', …)` |
| `src/hooks/payroll/usePayrollWeekInvoices.ts` | Replace `payroll_weeks.update({ status: 'invoiced' })` in `generateInvoices` with RPC; remove duplicate `payroll_approvals.insert` in `approveAll` |
| `src/hooks/payroll/usePayrollStatement.ts` | Replace direct writes in `approveStatement` with RPC |

### Deleted files
None in this PRP. `payroll_audit_log` deprecation deferred to PRP-05.

---

## 8. Implementation Phases

### Phase 1 — Verify `[Unverified]` evidence against the live DB (gate before any migration)

**Step 1.1** — Confirm `payroll_weeks.status` is currently an unconstrained text column:
```sql
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'payroll_weeks' AND column_name = 'status';
```
Expected: `data_type = 'text'` (or `character varying`) with no enum type. If already an enum, skip Phase 2 step 2.1.

**Step 1.2** — Confirm no lock-enforcement triggers exist on child tables:
```sql
SELECT tgname, relname
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE relname IN (
  'payroll_time_entries','payroll_adjustments','payroll_timesheet_corrections',
  'payroll_weekly_property_costs','payroll_invoices','payroll_invoice_line_items','payroll_spread_events'
) AND tgname ILIKE '%lock%';
```
Expected: zero rows. If rows found, document and adapt trigger names to avoid collision.

**Step 1.3** — Inspect `payroll_audit_log` schema for OD-2 resolution:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'payroll_audit_log'
ORDER BY ordinal_position;
```
Record columns. Decide OD-2 (actor-bind vs migrate) based on whether an `actor_id`/`user_id` column already exists.

**Step 1.4** — Verify `payroll_events` table does not already exist:
```sql
SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_events';
```
Expected: zero rows.

Rollback: nothing to roll back — Phase 1 is read-only.

---

### Phase 2 — Schema: enum + events table + actor columns

Deploy migrations in this order (each is independently `DROP`/`ALTER` reversible):

**Step 2.1** — Enum migration (`YYYYMMDD_payroll_week_status_enum.sql`)
```sql
CREATE TYPE payroll_week_status AS ENUM (
  'draft','corrections_complete','payroll_approved','invoiced','statement_sent'
);
ALTER TABLE payroll_weeks
  ALTER COLUMN status TYPE payroll_week_status USING status::payroll_week_status;
```
Verify:
```sql
SELECT udt_name FROM information_schema.columns
WHERE table_name = 'payroll_weeks' AND column_name = 'status';
-- expected: payroll_week_status
```

**Step 2.2** — Actor columns migration (`YYYYMMDD_actor_columns.sql`)
Apply all `ALTER TABLE … ADD COLUMN` statements from §5a. All nullable, no default.
Verify:
```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name = 'actor_role'
  AND table_name IN ('payroll_time_entries','payroll_adjustments','payroll_approvals',
                     'payroll_timesheet_corrections','payroll_weekly_property_costs','payroll_invoice_line_items');
-- expected: 6 rows
```

**Step 2.3** — `payroll_events` table migration (`YYYYMMDD_payroll_events.sql`)
Apply CREATE TABLE, REVOKE, trigger, RLS statements from §5a.
Verify:
```sql
SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_payroll_events_immutable';
-- expected: 1
SELECT policyname FROM pg_policies WHERE tablename = 'payroll_events';
-- expected: payroll_events_insert, payroll_events_select
```

**Step 2.4** — `payroll_audit_log` actor-bind migration (`YYYYMMDD_audit_log_actor_bind.sql`)
Outcome depends on OD-2 resolution from Phase 1.
Verify (if actor-bind path):
```sql
SELECT polwithcheck FROM pg_policies
WHERE tablename = 'payroll_audit_log' AND polcmd = 'a';
-- should contain 'actor_id = auth.uid()' or equivalent
```

Rollback Phase 2:
```sql
-- 2.4: restore old policy (DROP POLICY; recreate with WITH CHECK true)
-- 2.3: DROP TABLE payroll_events CASCADE;
-- 2.2: ALTER TABLE payroll_time_entries DROP COLUMN actor_id, DROP COLUMN actor_role; (repeat for all 6)
-- 2.1: ALTER TABLE payroll_weeks ALTER COLUMN status TYPE text USING status::text; DROP TYPE payroll_week_status;
```
Each step is independently reversible in reverse order.

---

### Phase 3 — Lock-enforcement trigger + `payroll_advance_status` RPC

**Step 3.1** — Deploy lock enforcement migration (`YYYYMMDD_lock_enforcement.sql`)
Create `payroll_enforce_week_lock()` function and register it on 7 tables:
```sql
-- (same CREATE FUNCTION as §5a)
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_time_entries','payroll_adjustments','payroll_timesheet_corrections',
    'payroll_weekly_property_costs','payroll_invoices','payroll_invoice_line_items','payroll_spread_events'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_lock_check
       BEFORE INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION payroll_enforce_week_lock()',
      t, t
    );
  END LOOP;
END $$;
```
Verify with a direct psql probe (checker step in Definition of Done §13):
```sql
-- Attempt a direct UPDATE on a time entry in a week with status = 'payroll_approved'
UPDATE payroll_time_entries
SET regular_hours = 99
WHERE payroll_week_id = (
  SELECT id FROM payroll_weeks WHERE status = 'payroll_approved' LIMIT 1
);
-- Expected: ERROR:  payroll_week.locked: mutations not permitted ...
```
If no `payroll_approved` week exists in the test environment, create one:
```sql
INSERT INTO payroll_weeks (week_start, week_end, status, created_at, updated_at)
VALUES (current_date - 7, current_date, 'payroll_approved', now(), now());
```

**Step 3.2** — Deploy `payroll_advance_status` RPC (`YYYYMMDD_advance_status_rpc.sql`)
Create the function from §5a. Grant execute to `authenticated`:
```sql
GRANT EXECUTE ON FUNCTION payroll_advance_status(uuid, payroll_week_status, uuid, text) TO authenticated;
```
Verify sequence enforcement:
```sql
-- Try to advance a 'draft' week directly to 'statement_sent'
SELECT payroll_advance_status(
  (SELECT id FROM payroll_weeks WHERE status = 'draft' LIMIT 1),
  'statement_sent',
  auth.uid(),
  'manager'
);
-- Expected: ERROR P0002 invalid transition
```

Rollback Phase 3:
```sql
-- 3.2: DROP FUNCTION payroll_advance_status(uuid, payroll_week_status, uuid, text);
-- 3.1: DROP TRIGGER trg_payroll_time_entries_lock_check ON payroll_time_entries; (repeat for all 7)
--       DROP FUNCTION payroll_enforce_week_lock();
```

---

### Phase 4 — Hook refactor + TypeScript types

**Step 4.1** — Update `src/lib/supabase/types.ts` per §7 (modified files list).

**Step 4.2** — Refactor `usePayrollWeekReview.approvePayroll`:
Replace:
```ts
await supabase.from('payroll_approvals').insert({ … stage: 'payroll' … })
await supabase.from('payroll_weeks').update({ status: 'payroll_approved' }).eq('id', weekId)
```
With:
```ts
const { error } = await supabase.rpc('payroll_advance_status', {
  p_week_id: weekId,
  p_target: 'payroll_approved',
  p_actor_id: userId,
  p_actor_role: currentUserRole,  // from useAuth()
})
if (error) throw new Error(error.message)
```
The `payroll_approvals.insert` for stage `'timesheet'` is still written by the UI (or by the RPC if OD-1 = auto-create).

**Step 4.3** — Same pattern for `usePayrollWeekInvoices.generateInvoices` (target `'invoiced'`) and `usePayrollStatement.approveStatement` (target `'statement_sent'`).

**Step 4.4** — Verify with `npm run build` (no TS errors) and `npm run lint`.

Verify (E2E):
1. Open a `payroll_approved` week in the timesheets UI — the `isLocked` guard still shows. Attempt a carry-forward to the *same* week → should fail with a DB error surfaced in the UI.
2. Carry-forward to the current open week → succeeds (writes to a different `payroll_week_id`).
3. Attempt to skip approval stages (invoke `approveStatement` without a `payroll` approval row) → UI surfaces `'payroll_advance_status: prerequisite stage "invoice" not approved'`.

Rollback Phase 4:
- `git revert` the hook and types changes. The DB schema introduced in Phases 2–3 is additive; removing the hook changes does not require a DB rollback. The `.rpc()` calls simply stop being made; pre-existing direct-write paths can be temporarily restored.

---

### Phase 5 — Actor column backfill + NOT NULL hardening

**Step 5.1** — Backfill `actor_id` from existing columns where possible:
```sql
UPDATE payroll_time_entries     SET actor_id = created_by::uuid WHERE actor_id IS NULL AND created_by IS NOT NULL;
UPDATE payroll_adjustments      SET actor_id = created_by::uuid WHERE actor_id IS NULL AND created_by IS NOT NULL;
UPDATE payroll_approvals        SET actor_id = approved_by::uuid WHERE actor_id IS NULL;
-- (remaining tables: leave NULL for historical rows; new rows are populated by hook refactor)
```

**Step 5.2** — Add trigger defaults so new inserts populate `actor_id` from `auth.uid()` when the application does not supply it:
```sql
CREATE OR REPLACE FUNCTION payroll_set_actor_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_id IS NULL THEN
    NEW.actor_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
-- Register on all 6 tables (BEFORE INSERT)
```

**Step 5.3** — Verify:
```sql
SELECT COUNT(*) FROM payroll_time_entries WHERE actor_id IS NULL AND created_at < now() - interval '1 day';
-- After backfill: count should equal rows with NULL created_by (historic data only)
SELECT COUNT(*) FROM payroll_time_entries WHERE actor_id IS NULL AND created_at > now() - interval '1 hour';
-- After hook refactor lands: 0
```

Rollback Phase 5:
```sql
-- Drop all payroll_set_actor_id triggers
-- ALTER TABLE payroll_time_entries DROP COLUMN actor_id, DROP COLUMN actor_role;
-- (etc. — same as Phase 2 rollback, which drops these columns)
```

---

## 9. Open Decisions

| # | Question | Defensible default |
|---|---|---|
| OD-1 | Should advancing to `payroll_approved` auto-create a `timesheet` approval row in the same transaction (i.e., the payroll manager's approval covers both stages), or must a separate `timesheet` approval row already exist? | **Default: auto-create.** The current codebase has no separate "approve timesheet" step in the hooks; requiring a pre-existing `timesheet` row would break today's workflow. The `payroll_advance_status` function inserts both rows in one transaction when `target = 'payroll_approved'`. Revisit when a distinct timesheet-approval UI step is built. |
| OD-2 | `payroll_audit_log`: actor-bind the existing INSERT policy, or migrate all app writes to `payroll_events` and deprecate? | **Default: actor-bind.** Safer in this PRP; migration to `payroll_events` is a separate surgical step in PRP-05. Resolve definitively in Phase 1 after inspecting the live table schema. |
| OD-3 | Should `payroll_events` writes from the lock-enforcement trigger include the full row delta (`OLD.*`/`NEW.*` in payload), or just key identifiers? | **Default: key identifiers only** (`entity_id`, status change, `actor_id`). Full-row deltas can be large for `payroll_time_entries` with many columns; add them only when a forensic audit UI requires it. |
| OD-4 | Should `payroll_advance_status` also accept an optional `notes text` parameter (stored on the `payroll_approvals` row)? | **Default: yes** — add `p_notes text DEFAULT NULL`; the `PayrollApproval.notes` column already exists. Zero cost to add now, expensive to retrofit later. |

---

## 10. Out of Scope

The following are named, deferred, and must not be built in this PRP:

- **Per-employee timesheet sub-approval.** A distinct `timesheet` approval step where an individual employee (or supervisor) signs off before the payroll manager approves. Named in PLAN.md; not built here.
- **ADP export gating.** Blocking `payroll_export` until `statement_sent` status is confirmed. A separate actuator once the export path is a real server action (tracked in PRP-05 / G5).
- **Portfolio-level approval chain.** Multi-portfolio parallel approval tracks. Reserved via `portfolio_id` schema hooks but not enforced here.
- **`payroll_events` per-domain views / aggregates.** Named in §5b; not built until audit UI or reporting needs them.
- **`payroll_audit_log` retirement migration.** Deferred to PRP-05 error-handling sweep to ensure no remaining app-layer writes are orphaned.
- **Backwards-unlock / reopen workflow.** A manager-initiated status rollback (e.g. `statement_sent → invoiced`). Requires a separate privileged function and a separate UI gate. Not in scope here; the lock trigger must be DROP-able as a rollback path for this PRP, not as a permanent unlock feature.
- **Lock bypass for admin carry-forward.** Carry-forward writes to the current open week by design (different `payroll_week_id`). No special bypass is needed or built.

---

## 11. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Existing data contains `payroll_weeks.status` values not in the enum set — `ALTER COLUMN … USING status::payroll_week_status` fails | Low — `WeekStatus` TS union has been stable; but any ad-hoc SQL string values in production will cause a hard failure | High — blocks Phase 2 | Phase 1 pre-check: `SELECT DISTINCT status FROM payroll_weeks WHERE status NOT IN ('draft','corrections_complete','payroll_approved','invoiced','statement_sent');` — must return zero rows before running the migration |
| R2 | `payroll_enforce_week_lock` fires during a legitimate carry-forward if the carry-forward hook mistakenly writes to the locked week's ID instead of the new week's ID | Medium — the carry-forward paths were not fully audited against this PRP | High — blocks the carry-forward feature | Audit `useTimesheetAdjustments.addCarryForward` before Phase 3 to confirm it always writes `payroll_week_id = currentOpenWeekId`, not the source locked week |
| R3 | `payroll_advance_status` RPC requires `actor_role` but PRP-01 may not have landed yet; `payroll_get_role()` may still return the fail-open `'manager'` default | High if PRP-01 is delayed | Medium — logs wrong role, does not block; correctness gap | Accept as known debt while PRP-01 is in flight; the RPC stores whatever role is passed; tighten once PRP-01 hardens the role function |
| R4 | Hook refactor (Phase 4) introduces a regression where `payroll_approvals` rows are no longer written for the `timesheet` / `invoice` stages that previously had explicit inserts | Medium | Medium — approval chain appears broken in the UI | Verify Phase 4 step by step: check `payroll_approvals` row counts before and after each hook change; add assertions to the refactored hooks |
| R5 | `payroll_events` INSERT policy (`actor_id = auth.uid()`) blocks trigger-written rows because DB triggers run with the session's `auth.uid()` — which may be NULL for service-role calls | Medium | Medium — event rows silently dropped or policy error | Set the lock/event trigger function as `SECURITY DEFINER` (already included in §5a); confirm `auth.uid()` is non-null in authenticated-user sessions; for service-role writes, grant INSERT without the RLS check via a separate `SERVICE` role policy |

---

## 12. Definition of Done

### What the user can do
- A Payroll Manager can advance a week through `draft → corrections_complete → payroll_approved → invoiced → statement_sent` using the existing approval UI, with each step issuing a single RPC call.
- Attempting to skip a stage (e.g. go from `draft` directly to `statement_sent`) produces a visible error in the UI: `'payroll_advance_status: prerequisite stage "…" not approved'`.
- Carry-forward from a locked week into the current open week succeeds.

### What the system/DB must reflect (checker-verifiable)

1. **Lock enforcement active:** a direct SQL `UPDATE payroll_time_entries SET regular_hours = 99 WHERE payroll_week_id = <any week with status 'payroll_approved'>` raises `SQLSTATE P0001` and the row is not modified. Verify: run the UPDATE, confirm the exception message, confirm `regular_hours` is unchanged.

2. **Enum constraint active:** `UPDATE payroll_weeks SET status = 'bogus' WHERE id = <any id>` raises a type-mismatch error and the row is unchanged.

3. **Sequence enforcement active:** calling `SELECT payroll_advance_status(<week_id_in_draft>, 'statement_sent', <actor>, 'manager')` raises `SQLSTATE P0002` with message containing `'invalid transition'`.

4. **`payroll_events` is append-only:** `DELETE FROM payroll_events` raises `SQLSTATE P0003` with message `'payroll_events.immutable'`. `UPDATE payroll_events SET event_type = 'tampered'` raises the same.

5. **Every new mutation row has a non-null `actor_id`:** after Phase 4 hook refactor, insert one `payroll_time_entry` row via the UI and confirm: `SELECT actor_id FROM payroll_time_entries ORDER BY created_at DESC LIMIT 1` returns a non-null UUID.

6. **`payroll_events` receives a row on status advance:** after calling `payroll_advance_status` successfully, `SELECT * FROM payroll_events WHERE event_type = 'week.status_advanced' ORDER BY occurred_at DESC LIMIT 1` returns a row with matching `entity_id`, `actor_id`, and `payload->'to'`.

7. **`payroll_audit_log` INSERT is actor-bound:** attempt an INSERT to `payroll_audit_log` without including a valid `actor_id = auth.uid()` value → `WITH CHECK` violation / policy rejection.

8. **TypeScript build passes:** `npm run build` exits 0 with no new type errors after Phase 4.

---

## 13. Rollback

| Phase | How to roll back |
|---|---|
| Phase 1 | Read-only — nothing to roll back |
| Phase 2.1 (enum) | `ALTER TABLE payroll_weeks ALTER COLUMN status TYPE text USING status::text; DROP TYPE payroll_week_status;` — restores the unconstrained text column |
| Phase 2.2 (actor cols) | `ALTER TABLE <each table> DROP COLUMN actor_id, DROP COLUMN actor_role;` — columns are nullable; no data loss on rows that were NULL |
| Phase 2.3 (events table) | `DROP TABLE payroll_events CASCADE;` — table is new, no downstream dependencies yet |
| Phase 2.4 (audit_log bind) | Drop the new policy and recreate the original `WITH CHECK true` policy on `payroll_audit_log` |
| Phase 3.1 (lock trigger) | `DROP TRIGGER trg_<table>_lock_check ON <table>;` on each of the 7 child tables; then `DROP FUNCTION payroll_enforce_week_lock();` — restores the open-table state |
| Phase 3.2 (advance_status RPC) | `DROP FUNCTION payroll_advance_status(uuid, payroll_week_status, uuid, text);` — hooks fall back to direct writes (Phase 4 revert handles the app side) |
| Phase 4 (hook refactor) | `git revert` the four hook/types files; direct-write paths are restored; DB schema from Phases 2–3 is benign (additive columns, unused trigger is live but harmless once hooks write correctly) |
| Phase 5 (actor backfill) | Backfill data in `actor_id` columns is non-destructive; rollback is to drop the `payroll_set_actor_id` triggers; column data stays (nullable, no harm) |

---

## 14. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-13 | Use a DB trigger on child tables (not an RLS `WITH CHECK` predicate) for lock enforcement | An RLS predicate would require a correlated subquery on every row-level check and cannot be applied uniformly across tables with different FK column names. A single SECURITY DEFINER trigger function is easier to test, easier to drop, and produces a clear error message. |
| 2026-06-13 | Use a stored function (`payroll_advance_status`) rather than a trigger on `payroll_weeks.status` | A status-change trigger cannot easily validate the prerequisite approval stage exists in the same transaction without re-entering the trigger. A named function is explicit, callable via `.rpc()`, and gives the app layer a typed error to surface. |
| 2026-06-13 | `payroll_events` is the single append-only spine; `payroll_audit_log` actor-bind is a temporary measure | Building a second audit table (`payroll_audit_log` + `payroll_events`) is technically redundant, but deprecating `payroll_audit_log` in this PRP risks orphaning unknown app-layer writes. The actor-bind is a safe interim; retirement moves to PRP-05 after the write inventory is complete. |
| 2026-06-13 | Dependency on PRP-01 is hard | The lock trigger is a defence-in-depth backstop. While PRP-01 is not landed, the unauthenticated write path (S1/S2) means the trigger can be bypassed via the anon key. PRP-04 must not be released to production before PRP-01 closes S1/S2. |

---

## 15. Self-Score (§5 of STANTON-spec-standard.md)

| Element | Score | Notes |
|---|---|---|
| 1. Problem statement | **Y** | Five numbered, concrete defects; each cites file:line or live-DB policy |
| 2. Users and roles | **Y** | Five roles named; out-of-scope roles called out |
| 3. Numbered features | **Y** | F1–F8, each stated as a named action with measurable post-condition |
| 4. Data model | **Y** | Hooks-now vs deferred-aggregates split; full DDL for all objects; no schema invented without evidence |
| 5. Integration points | **Y** | Six integration points named with exact hook/seam |
| 6. Ordered phases | **Y** | Five phases, each independently shippable, each step paired with a verification query |
| 7. Open decisions with defaults | **Y** | Four decisions (OD-1–OD-4), each with a defensible default and rationale |
| 8. Out of scope | **Y** | Seven deferred items explicitly named |
| 9. Definition of done | **Y** | Eight checker-verifiable conditions; dual (user-observable + DB-level) |
