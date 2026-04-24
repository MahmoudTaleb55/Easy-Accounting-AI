# Workspace isolation: defense-in-depth at the database layer

Status: Accepted — composite foreign keys (Option A)
Owner: Platform / Data
Related: task #52 (route-level guard), task #70 (this design)

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
