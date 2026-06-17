# Lessons — Payroll

Append-only. Each entry: what the standard assumed, what the real system did, what the next loop should do differently. Written as it happens, because chat is not memory.

---

## 2026-06-13 — Re-spine audit (recon + code-review + security-review)

**L1 — The RLS hole was invisible to a code-only / migration-file audit.** The granular role policies (`payroll_is_manager_or_above()` on insert/update) *look* correct in isolation. The vulnerability only appears when you read the **combined live policy set** against the **live grants**: a blanket `*_auth (ALL, authenticated, USING true, WITH CHECK true)` policy ORs with the role policies and defeats them. → Next loop: never conclude "RBAC exists" from the presence of role policies. Introspect `pg_policies` + `information_schema.role_table_grants` + `pg_get_functiondef` together, and reason about *policy combination*, not individual policies.

**L2 — Postgres PERMISSIVE policies combine with OR.** One blanket `true` policy silently neutralizes every sibling policy on that table. Grep the live policy set for `qual='true'`/`with_check='true'` on `ALL`/`authenticated` and treat each as "RBAC off for this table" regardless of what else is defined.

**L3 — Fail-open privilege defaults are a recurring pattern here, in BOTH layers.** `payroll_get_role()` does `COALESCE((SELECT role FROM profiles WHERE id=auth.uid()), 'manager')`, and `useAuth.ts:44-56` independently defaults a profile-less user to `role:'manager'`. A null/absent identity resolving to a *privileged* role (and `auth.uid()` is null for anon) is the root of the unauthenticated-write path. → Flag any `COALESCE(role, <privileged>)` or "default to manager/admin" on sight; the safe default is deny / least-privilege.

**L4 — Schema & policies living only in the live DB (1 migration file vs 29 tables) is the meta-gap, not a tooling nit.** It is *why* L1–L3 reached production unseen: a policy change had no diff to review. Treat "no migrations / schema not in version control" as a structural finding that gates the others.

**L5 — When the same number is computed in N places, the divergence is the bug.** Gross pay is implemented 3× (engine, ADP export, ADP reconciliation). No single copy is "the" bug; the on-screen / sent-to-ADP / reconciled-against-ADP values silently disagree on OT, advances, and `is_active` filtering. → For any money figure, build the divergence matrix across every implementation before judging correctness; then collapse to one engine.

**L6 — Judge the territory, not the map.** PLAN.md says the Cost Allocation Engine is "planned"; it is actually the best-built unit in the repo, while the genuinely-missing trunk piece (enforced approval/locking + audit integrity) is the one PLAN treats as merely "Known Debt." Stale status lines in the plan are themselves a finding.

**L7 — Live-DB read-only introspection is high-leverage and safe; a write probe is not needed to prove an authz hole.** The policy + grant + function evidence was conclusive on its own; both Critical claims survived adversarial refutation by Postgres semantics alone. Never run a write/exploit against the production payroll DB to "confirm" — reason from the policy/grant evidence and label residual uncertainty.
