# Workspace isolation: defense-in-depth at the database layer

Status: Accepted — composite foreign keys (Option A) for writes,
row-level security keyed on a per-request GUC (Option B) for reads
Owner: Platform / Data
Related: task #52 (route-level guard), task #70 (initial constraints),
task #91 (extension to HR + fixed-asset child tables + documents),
task #93 (read-side RLS layer)

## Background

Every workspace-scoped table in `shared/schema.ts` carries a `company_id`
column and the application is expected to filter every read and every write
by the active workspace. Today the only thing standing between a logged-in
user and another tenant's data is a route-level guard — `assertAllOwnedByCompany`
in `server/storage.ts`, called by hand from selected `POST/PATCH` handlers in
`server/routes.ts` (task #52).

That guard is the right first line, but it has a structural weakness: a
future route added without the guard would silently regress isolation.
Equivalently, any storage helper that takes a client-supplied
`accountId` / `categoryId` / `employeeId` / `journalEntryId` and writes it
without an additional `companyId` filter can be tricked into stitching a
row in workspace A to a foreign-key target in workspace B.

We want a lower layer that refuses cross-tenant writes regardless of the
route code on top.

## Options considered

### Option A — Composite foreign keys keyed on `(id, company_id)`

Make every workspace-scoped parent table expose a `UNIQUE (id, company_id)`
constraint, and rewrite every cross-table reference as a *composite* foreign
key over `(child.fk_id, child.company_id) → parent.(id, company_id)`. Postgres
then physically refuses any insert or update that pairs a foreign id with a
mismatched workspace.

Pros
- Zero application support needed: the constraint is enforced for every
  client of the database (the API server, ad-hoc psql sessions, future
  background workers, etc.).
- Works with the existing connection model — a single `pg.Pool` shared
  across requests with no role/GUC plumbing.
- Plays well with Drizzle: `foreignKey({ columns, foreignColumns })` is a
  first-class table-level builder.
- Errors are loud and immediate (`23503 foreign_key_violation`), which is
  exactly what we want for a defense-in-depth check that should never fire
  in a correct app.

Cons
- Some child tables that currently do not store `company_id` (most
  importantly `journal_lines`) need it added and back-filled. We treat
  `journal_lines.company_id` as a denormalisation of
  `journal_entries.company_id`; it is set on insert and never independently
  mutated.
- Adds `UNIQUE (id, company_id)` constraints to the parent tables. Since
  `id` is already unique, this is logically redundant but Postgres requires
  the exact column tuple to exist as a unique/PK constraint to be the target
  of a composite FK.
- Doesn't help reads — a buggy `SELECT` that forgets the `company_id`
  filter still leaks. Read-side isolation continues to be the storage
  layer's job (and is enforced consistently today via
  `where(eq(table.companyId, companyId))`).

### Option B — Postgres row-level security keyed on a session GUC

Set `app.current_company_id` per request (e.g. via `SET LOCAL` inside a
transaction or `SET` on a checked-out connection), grant the API role
non-bypassing access, and enable RLS on every workspace table with a
`USING / WITH CHECK (company_id = current_setting('app.current_company_id')::int)`
policy.

Pros
- Covers reads as well as writes — a forgotten `WHERE` clause silently
  filters down to the active workspace instead of leaking.
- Single mental model: the active workspace is implicit in the connection,
  not threaded through every storage call.

Cons
- Requires changing the connection model: the current shared `pg.Pool`
  hands out checked-out clients arbitrarily, so we'd need to pin a client
  per request and reset the GUC on release, or wrap every query in a
  `SET LOCAL`-bearing transaction. Both are a meaningful refactor with
  perf/observability follow-ups.
- Bootstrap paths (`ensureIfrsBootstrap`, IFRS COA seeding, the role-enum
  back-fill at startup, future migrations) all need a privileged path that
  bypasses RLS — which itself becomes a sharp edge if the wrong code calls
  it.
- The GUC is plain text inside the session: any `SET app.current_company_id`
  the application runs is trusted absolutely. The protection is real but
  is just as easy to mis-set as a `WHERE` clause is to forget.
- Higher operational surface area (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`,
  `FORCE ROW LEVEL SECURITY`, role separation, `bypassrls` audit, etc.).

## Decision

Adopt Option A — composite foreign keys — and ship it as migration
`0005_workspace_composite_fks.sql` covering the high-risk tables called out
in the task: `accounts`, `journal_entries`, `journal_lines`, `fixed_assets`,
`asset_categories`, `employees`, and `budgets`.

Option B remains a future possibility — it would extend defense-in-depth to
read paths — but requires a connection-handling refactor that is out of
scope for this task. Composite FKs are a strict superset of "writes can't
cross tenants" with none of that refactor cost, and they leave Option B
available later.

## Schema changes

Parent tables get a `UNIQUE (id, company_id)` constraint:

- `accounts`
- `journal_entries`
- `fixed_assets`
- `asset_categories`
- `employees`

`journal_lines` gains a denormalised `company_id` column (default 1 for
back-compat, back-filled from `journal_entries`, then set `NOT NULL`).

Composite foreign keys added (all `ON UPDATE NO ACTION ON DELETE NO ACTION`,
matching the implicit behaviour of the existing single-column-FK-less
references):

- `accounts.parent_id, accounts.company_id` → `accounts (id, company_id)`
  (a parent account must live in the same workspace as its child).
- `journal_lines.journal_entry_id, journal_lines.company_id`
  → `journal_entries (id, company_id)`.
- `journal_lines.account_id, journal_lines.company_id`
  → `accounts (id, company_id)`.
- `budgets.account_id, budgets.company_id` → `accounts (id, company_id)`.
- `fixed_assets.category_id, fixed_assets.company_id`
  → `asset_categories (id, company_id)`.
- For each of the seven account-id pointers on `asset_categories`
  (`asset_cost_account_id`, `accumulated_dep_account_id`,
  `dep_expense_account_id`, `accumulated_imp_account_id`,
  `imp_loss_account_id`, `reval_surplus_account_id`,
  `gain_loss_disposal_account_id`):
  `(<col>, company_id)` → `accounts (id, company_id)`.

## Migration plan & ordering

The migration is written to be safe to run on top of the existing dataset:

1. Add `journal_lines.company_id` with `DEFAULT 1` so the column is
   immediately writable for any in-flight inserts.
2. Back-fill `journal_lines.company_id` from `journal_entries.company_id`
   via a join.
3. `ALTER COLUMN company_id SET NOT NULL` once the back-fill is complete.
4. Drop the default so future inserts must supply it explicitly (the
   storage layer is updated to always set it).
5. Delete any orphan rows that would otherwise block the FK creation:
   `journal_lines` whose `journal_entry_id` no longer exists, `budgets`
   whose `account_id` no longer exists, etc. These should be empty in any
   well-behaved workspace; the deletes are a safety valve for data that
   pre-dates the constraint.
6. Add `UNIQUE (id, company_id)` to each parent table.
7. Add the composite foreign keys.

All `CREATE/ADD` statements use `IF NOT EXISTS` (or are wrapped in
`DO $$ … $$` blocks that probe `pg_constraint`) so the migration is
idempotent across re-runs and across the `db:push` workflow that
materialises schema changes from `shared/schema.ts`.

## Application-side follow-ups

Three call sites that insert into `journal_lines` are updated to set
`companyId`:

- `DatabaseStorage.autoPostFromTransaction` — copies the parent
  transaction's `companyId`.
- `DatabaseStorage.createJournalEntry` — copies the parent JE's
  `companyId`.
- `ensureIfrsBootstrap` in `server/init-coa.ts` — uses the journal
  entry's `companyId` field, since the bootstrap inserts entries for the
  default workspace.

The route-level `assertAllOwnedByCompany` guard from task #52 stays in
place. The composite FK is the floor; the route guard remains the friendly
`400 Bad Request` for the same scenario, so users see a sane error message
instead of a raw `23503 foreign_key_violation` bubbling up.

## What this does not cover

- **Reads.** A SELECT that forgets `WHERE company_id = …` still leaks
  data. This is unchanged from before; tightening reads is the natural
  Option B follow-up.
- **Tables not in scope for this migration** (e.g. `attendance`, `leaves`,
  `payroll_lines`, `depreciation_*`, `asset_components`, etc.). They can
  be brought under the same rule by following the recipe in this doc; the
  intent is to expand coverage incrementally rather than gate task #70 on
  every single workspace-scoped table at once.
- **Composite FKs do not replace tenant ownership checks at the route
  layer for ids that have no direct FK target** (e.g. settings ids derived
  from the request body). Those still need explicit guards.

## Task #91 extension — HR + fixed-asset children + documents

Task #70 left the back-fill bullet above ("tables not in scope") as future
work. Task #91 closes that gap for the remaining workspace-scoped tables
that hold cross-table references. Migration `0007_workspace_composite_fks_extension.sql`
follows the exact same recipe as `0005`:

1. `ADD COLUMN company_id … DEFAULT 1` on each child.
2. Back-fill from the parent (`employees`, `payroll_runs`, `fixed_assets`,
   `asset_components`, `depreciation_runs`, `journal_entries`).
3. `SET NOT NULL`, then `DROP DEFAULT` so future inserts must supply it.
4. Delete orphan rows whose parent no longer exists (safety valve for
   pre-existing bad data).
5. `UNIQUE (id, company_id)` on the parents that now need to be referenced
   by composite FK (`payroll_runs`, `asset_components`, `depreciation_runs`).
6. Add the composite FKs (in `DO $$` guards that probe `pg_constraint` so
   the migration is re-runnable).

New parent uniqueness:

- `payroll_runs (id, company_id)`
- `asset_components (id, company_id)`
- `depreciation_runs (id, company_id)`

New composite FKs:

- HR
  - `attendance.employee_id, attendance.company_id` → `employees`.
  - `leaves.employee_id, leaves.company_id` → `employees`.
  - `payroll_lines.run_id, payroll_lines.company_id` → `payroll_runs`.
  - `payroll_lines.employee_id, payroll_lines.company_id` → `employees`.
- Fixed-asset children
  - `asset_components.asset_id, asset_components.company_id`
    → `fixed_assets`.
  - `depreciation_schedule.asset_id, …` → `fixed_assets`.
  - `depreciation_schedule.component_id, …` → `asset_components`
    (nullable, MATCH SIMPLE).
  - `depreciation_postings.run_id, …` → `depreciation_runs`.
  - `asset_usage_periods.asset_id, …` → `fixed_assets`.
  - `impairment_events.asset_id, …` → `fixed_assets`.
  - `revaluation_events.asset_id, …` → `fixed_assets`.
  - `disposals.asset_id, …` → `fixed_assets`.
- Documents
  - `documents.journal_entry_id, documents.company_id`
    → `journal_entries` (nullable, MATCH SIMPLE).

All nullable child FK columns rely on Postgres' default `MATCH SIMPLE`
semantics: when *any* component of the composite key is `NULL`, the FK is
not checked. That is the desired behaviour for `depreciation_schedule.component_id`
(asset-level rows have `component_id IS NULL`) and `documents.journal_entry_id`
(documents that aren't tied to a JE).

### Application-side follow-ups (task #91)

Storage helpers and routes that insert into the newly-constrained child
tables now copy `companyId` from the request context (or the parent row)
on every write:

- `server/storage.ts`: `createAssetComponent`, `createDepreciationRun`
  (postings), `replaceSchedule`, `markScheduledPosted`,
  `createImpairmentEvent`, `createRevaluationEvent`, `createDisposal`.
- `server/payroll.ts`: `payrollLines` insert in the run-payroll path.
- `server/routes.ts`: every caller of the above is updated to pass
  `companyId` so the type-checker enforces it at the boundary.

The same `applyExtendedCompositeFksOnStartup` boot helper used for prior
migrations runs `0007` idempotently on app start, mirroring the
already-shipped pattern for `0003` / `0006`. As a defensive measure it
*also* re-applies migration `0005`'s parent uniques and composite FKs (no
boot helper had been written for `0005`, so dev databases that were
bootstrapped before that migration ran would otherwise be left without
the task #70 constraints — and without the back-filled
`journal_lines.company_id` column the application now writes to).

### Tables intentionally not extended

A handful of workspace-scoped tables are left without composite FKs in
this round because they have **no inbound FK columns to constrain**:

- `transactions`, `fx_rates`, `chat_messages`, `settings`. Each is a
  flat workspace-scoped table; there is nothing to point them at.
- `workspace_invites` was dropped in migration `0004` and is no longer
  part of the schema.

If any of these grow a cross-table reference later, the recipe above is
the template to follow.

## Task #93 extension — RLS on reads

Composite foreign keys close the *write* hole. Reads are still entirely the
application's responsibility: a `SELECT` that forgets `WHERE company_id = …`
silently returns another tenant's data. This section adopts Option B from the
list above and ships it as migration `0008_workspace_rls.sql`.

### Connection-handling decision

Option B requires the active workspace to be visible to Postgres on the
connection that runs the query. Two implementations are reasonable:

1. **Pinned client per request, session-level GUC.** Middleware checks out a
   `pg.Client` from the pool, runs `SET app.current_company_id = $1`, stores a
   request-scoped Drizzle instance bound to that client in
   `AsyncLocalStorage`, and on `res.finish` / `res.close` runs `RESET` and
   releases the client.
2. **Per-request transaction wrapper, `SET LOCAL` GUC.** Middleware opens a
   single transaction at the start of every request, runs
   `SET LOCAL app.current_company_id`, and commits / rolls back at the end.

We picked **Option 1 (pinned client + ALS)**. The transaction wrapper is
attractive because Postgres auto-resets `SET LOCAL` GUCs on commit/rollback,
but it would force every endpoint into a single top-level transaction:
- Endpoints that perform irreversible side effects (OpenAI calls, document
  uploads, sending emails) interleaved with multiple writes would either
  rollback partial DB state on a late failure (semantic surprise) or have to
  break out of the wrapping transaction (defeating the wrapper).
- Several existing storage helpers already call `db.transaction(...)` for
  their own atomicity. Nesting transactions inside a request-level outer
  transaction would either flatten into savepoints (changing rollback
  semantics) or fail outright.

Pinned-client-per-request keeps the transactional shape of every existing
handler unchanged. The single new invariant is "every request that has a
membership runs against a client whose `app.current_company_id` matches that
membership"; everything below it (Drizzle queries, sub-transactions, raw
SQL) keeps working untouched because the request-scoped Drizzle instance is
exposed via the same `db` import storage already uses.

### The non-superuser `app_api` role

Postgres exempts **superusers** from RLS unconditionally — `FORCE ROW LEVEL
SECURITY` only forces it on the table *owner*, not on superusers. The
`DATABASE_URL` role in this environment happens to be a superuser, which
would silently make every policy below a no-op.

The migration therefore creates a non-superuser role `app_api`, grants the
connecting role membership in it (so `SET ROLE app_api` succeeds), and
grants `app_api` `SELECT/INSERT/UPDATE/DELETE` on every public table plus
`USAGE/SELECT/UPDATE` on every sequence. `ALTER DEFAULT PRIVILEGES` keeps
future tables in sync.

`withCompanyScope` then `SET ROLE app_api`s on the checked-out client right
after setting the GUC, and `RESET ROLE`s on release. `withRlsBypass` does
**not** switch role — bootstrap helpers run DDL (`ALTER TABLE … FORCE ROW
LEVEL SECURITY`, `CREATE POLICY`, etc.) that requires owner privileges, and
staying on the connecting role is harmless because the `app.rls_bypass = on`
GUC short-circuits the policy expressions anyway.

This means RLS protection only applies to code paths that flow through
`withCompanyScope` (i.e. `/api/*` requests after `attachMembership`). Code
that uses `db` directly without either helper runs as the connecting role
and bypasses RLS — that is the existing behaviour for boot helpers and is
acceptable, but a future code path that needs RLS protection must wrap
itself in `withCompanyScope`.

### Schema changes (migration `0008_workspace_rls.sql`)

Two unqualified helper functions live in the `public` schema so policies
stay terse (the `app.*` GUC names are just settings, not a namespace):

- `current_company_id() RETURNS integer` —
  `NULLIF(current_setting('app.current_company_id', true), '')::integer`. The
  `true` second argument means missing-GUC returns `NULL` instead of raising,
  and `NULLIF` bridges the empty-string default cleanly.
- `rls_is_bypassed() RETURNS boolean` —
  `current_setting('app.rls_bypass', true) = 'on'`. Defaults to `false` when
  unset. Both helpers `GRANT EXECUTE` to `app_api`.

Each in-scope table receives:

```
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON <t>;
CREATE POLICY workspace_isolation ON <t>
  USING      (rls_is_bypassed() OR company_id = current_company_id())
  WITH CHECK (rls_is_bypassed() OR company_id = current_company_id());
```

`FORCE ROW LEVEL SECURITY` is mandatory because the API role is the table
owner in our deploy environment, and Postgres exempts owners from RLS by
default.

### Tables in scope

The full set of workspace-scoped business tables: `accounts`,
`journal_entries`, `journal_lines`, `transactions`, `budgets`, `settings`,
`employees`, `attendance`, `leaves`, `payroll_runs`, `payroll_lines`,
`fx_rates`, `asset_categories`, `fixed_assets`, `asset_components`,
`depreciation_runs`, `depreciation_schedule`, `depreciation_postings`,
`asset_usage_periods`, `impairment_events`, `revaluation_events`,
`disposals`, `chat_messages`, `documents`.

### Tables intentionally out of scope

- **Auth / membership tables** (`users`, `sessions`, `memberships`,
  `invitations`, `password_reset_*`, `invitation_email_events`,
  `email_delivery_alert_settings`, `email_delivery_alerts`). These are
  explicitly read across workspaces by `attachMembership`, the
  email-delivery alert sweep, and various owner-only admin routes — putting
  them under RLS would either force every auth lookup through bypass or
  reject legitimate cross-workspace reads.
- **`companies`**. The "workspace" itself; not workspace-scoped.
- **`audit_log`**. No `company_id` column; tenant ownership is implicit
  through the entity row it points at.

### Bypass paths (audited)

Any code path that legitimately needs to read or write across workspaces
must run inside `withRlsBypass(reason, fn)` from `server/db.ts`. The helper
checks out a fresh client, runs `SET app.rls_bypass = 'on'`, executes `fn`
against a request-scoped Drizzle bound to that client, and `RESET`s + releases
on completion. Audited bypass call sites (with `reason` strings):

- `bootstrap:ifrs-coa` — `ensureIfrsBootstrap` seeds the default chart of
  accounts and back-fills journal entries for legacy transactions across
  every workspace at boot.
- `bootstrap:role-enum` — `unifyRoleEnumOnStartup` re-runs the legacy →
  canonical role-enum data fix on the `memberships` / `invitations` tables.
- `bootstrap:drop-workspace-members-mirror` — re-runs migration 0006.
- `bootstrap:composite-fks` — re-runs migrations 0005 / 0007.
- `bootstrap:accounts-code-uq` — re-runs migration 0010.
- `bootstrap:companyid-defaults` — re-runs migration 0014.
- `bootstrap:rls` — re-runs migration 0008 itself.
- `bootstrap:email-delivery-alert-tables` —
  `ensureEmailDeliveryAlertTablesOnStartup` re-stages the parent
  `email_delivery_alert_settings` / `email_delivery_alerts` tables (auth
  surface, not RLS-protected, but wrapped for uniformity so the audit
  list below stays exhaustive).
- `bootstrap:email-delivery-alert-recipients` —
  `applyEmailDeliveryAlertRecipientsOnStartup` re-stages the per-recipient
  outcome table for the alert evaluator.
- `bootstrap:email-delivery-event-count-indexes` —
  `applyEmailDeliveryEventCountIndexesOnStartup` re-stages the
  `(message_id, created_at)` indexes the `/api/auth/email-deliveries/count`
  endpoint depends on.
- `cron:email-delivery-alert-sweep` — the periodic alert evaluator that
  iterates every workspace.
- `workspace:create` — `DatabaseStorage.createCompany` and
  `authBizStorage.createCompanyForOwner`. Creating a new workspace inserts
  the seed chart of accounts and a `settings` row under the *new* company's
  id. When the caller is already an owner of an existing workspace, the
  request runs inside `withCompanyScope(existingCompanyId)`, so the new
  rows would be rejected by the `workspace_isolation` policy
  (`new.company_id ≠ current_company_id()`). The bypass is the natural fit:
  workspace creation is by definition the moment when the active scope is
  about to change.

If a future code path needs bypass it is expected to wrap itself in
`withRlsBypass` with a fresh `reason` so the audit list stays grep-able.

### Lint: every `db` import is on the audited allowlist (task #138)

The bypass list above is only protective if every `db.X(...)` call in
`server/` actually flows through `withCompanyScope` or `withRlsBypass`.
Anything that imports `db` and runs outside the `/api/*` request middleware
(future cron jobs, ad-hoc maintenance scripts, additional boot helpers,
etc.) silently falls back to the connecting role and bypasses RLS.

`tests/e2e/db-isolation-allowlist.spec.ts` closes that hole with four
static assertions:

1. The set of files in `server/` that import `db` from `./db` (or
   `../db`) is pinned to a hand-curated allowlist with a per-file rationale
   explaining how its `db` calls are reached only from inside a wrapper.
   Adding a new file requires editing the allowlist, which forces a code
   review.
2. The set of files in `server/` that import a *storage value* (`storage`,
   `authStorage`, `authBizStorage`, `chatStorage`) from any storage module
   — `./storage`, `./auth/storage`, `./replit_integrations/auth/storage`,
   `./replit_integrations/chat/storage` — is pinned to a similar
   allowlist. Storage modules wrap `db` internally, so a fresh
   `import { storage } from "./storage"` in a non-request context is just
   as much an RLS bypass as a direct `db.` call. The check covers static
   imports, barrel `export { ... } from` re-exports, and the dynamic
   `const { storage } = await import("./storage")` form. Type-only imports
   (`import type { Foo }`) are deliberately exempt — they evaporate at
   compile time and have no runtime db reach.
3. Every `await *OnStartup(` invocation in `server/index.ts` must be
   wrapped in `withRlsBypass(...)` (or `withCompanyScope(...)`) on the
   same block, except for a small SELF_WRAPPING list of helpers that wrap
   their own body internally.
4. `pool.connect()` is only allowed in `server/db.ts` (where the wrappers
   themselves check out clients) and `server/migrate.ts` (which has to
   bootstrap the migration ledger before any migration has ever run).

Together these four checks make the property "every `db.` and storage
call site goes through the workspace-isolation layer" enforceable in CI
rather than by human grep.

### What this still does not cover

- Reads that go through SQL-injected `current_setting` calls or that
  intentionally `SET LOCAL app.current_company_id` to a different workspace
  inside a request. The protection is real but is just as easy to mis-use as
  the route-level guard it complements.
- Tables not in the in-scope list above. Bringing them under the same rule
  is a one-line addition to the in-scope table list in the migration and the
  boot helper.

