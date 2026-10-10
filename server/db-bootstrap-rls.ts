/**
 * Single source of truth for the workspace_isolation RLS policy.
 *
 * Why this module exists (task #239)
 * ----------------------------------
 * Until this module landed, the canonical workspace-isolation policy
 * expression
 *
 *   (rls_is_bypassed() OR (company_id = current_company_id()))
 *
 * and the list of in-scope workspace-scoped tables were duplicated in
 * three places that had to be edited in lock-step:
 *
 *   - `migrations/0008_workspace_rls.sql` — the historical install:
 *     declared the role, helper functions, and a `FOREACH t IN ARRAY
 *     ARRAY[…]` block that hard-coded the 24 in-scope tables and ran
 *     ENABLE/FORCE/DROP/CREATE POLICY per table.
 *   - `migrations/0016_audit_log_company_id.sql` — added the 25th
 *     table (`audit_log`) with the same canonical clauses copy-pasted
 *     in by hand.
 *   - `tests/e2e/database-rls-policy-coverage.spec.ts` — re-declared
 *     `KNOWN_RLS_PROTECTED` and `CANONICAL_POLICY_EXPR` so the
 *     drift-detection test could check what the migrations had
 *     installed.
 *
 * If the canonical clause ever needed to change (a third predicate, a
 * different helper name, etc.) an engineer had to edit all three files
 * in the same commit or the spec would start failing on every table.
 *
 * This module collapses all three into one. The boot helper
 * `bootstrapWorkspaceRlsPolicies` re-applies the canonical policy from
 * `RLS_TABLES` on every restart. The two migrations above keep the
 * one-time DDL that the boot helper depends on (the `app_api` role,
 * the `current_company_id()` / `rls_is_bypassed()` helper functions,
 * the `audit_log.company_id` column + backfill) but no longer iterate
 * tables themselves — the per-table install is delegated here. The
 * coverage spec imports `RLS_TABLES`, `CANONICAL_RLS_USING_EXPR_PG`,
 * and `CANONICAL_RLS_WITH_CHECK_EXPR_PG` from this module instead of
 * redefining them.
 *
 * How to change the policy in future
 * ----------------------------------
 * One file edit:
 *
 *   1. Edit `CANONICAL_RLS_USING_SQL` and (if WITH CHECK should differ
 *      from USING, which it currently does not) `CANONICAL_RLS_WITH_CHECK_SQL`
 *      in this module to the new clause text.
 *   2. Edit `CANONICAL_RLS_USING_EXPR_PG` and `CANONICAL_RLS_WITH_CHECK_EXPR_PG`
 *      to match what `pg_get_expr` will round-trip the new clause to.
 *      (Postgres canonicalises by adding outer parens and parenthesising
 *      OR's right-hand `=` comparison — see the constants below.)
 *   3. Restart the app. The boot helper drops + re-creates the policy on
 *      every table in `RLS_TABLES` with the new clause; the coverage spec
 *      passes because it now reads the new constants from this module.
 *
 * To add a table to the in-scope set: append its name to `RLS_TABLES`
 * here. The boot helper installs RLS on it at the next restart, the
 * coverage spec treats it as required, and no migration edit is needed.
 *
 * If you want pre-existing databases to converge atomically rather than
 * on the next boot, write a *new* migration that DROP/CREATEs the policy
 * per table — the historical migrations 0008 and 0016 are immutable
 * records of how each database first reached its current state.
 */
import type { DbPoolClient as PoolClient } from "./db";

/**
 * Every workspace-scoped table that must have RLS enabled, FORCEd, and
 * the `workspace_isolation` policy installed. Mirrors the historical
 * `ARRAY[…]` block in `migrations/0008_workspace_rls.sql` plus the
 * `audit_log` addition from `migrations/0016_audit_log_company_id.sql`,
 * and is now the single source of truth for both.
 *
 * The companion design doc
 * `docs/design/workspace-isolation-defense-in-depth.md` ("Tables in
 * scope" + "Tables intentionally out of scope") spells out which tables
 * deliberately stay outside the set (auth/membership tables, the
 * email-delivery alert pipeline, the `companies` workspace registry).
 */
export const RLS_TABLES: readonly string[] = [
  "accounts",
  "journal_entries",
  "journal_lines",
  "transactions",
  "budgets",
  "settings",
  "employees",
  "attendance",
  "leaves",
  "payroll_runs",
  "payroll_lines",
  "fx_rates",
  "asset_categories",
  "fixed_assets",
  "asset_components",
  "depreciation_runs",
  "depreciation_schedule",
  "depreciation_postings",
  "asset_usage_periods",
  "impairment_events",
  "revaluation_events",
  "disposals",
  "chat_messages",
  "documents",
  // Brought under RLS by task #169 (migration 0016) once `audit_log`
  // gained a `company_id` column.
  "audit_log",
  // Sales Portal — added by task #301 (migration 0019).
  "customers",
  "products",
  "sales_invoices",
  "sales_invoice_lines",
  // Inventory & Costing Portal — added by task #346 (migration 0023).
  "inventory_categories",
  "inventory_locations",
  "inventory_stock_levels",
  "inventory_transactions",
  "inventory_transaction_lines",
  "inventory_cost_layers",
  // Purchase Portal — added by task #368 (migration 0025).
  "vendors",
  "purchase_invoices",
  "purchase_invoice_lines",
  "purchase_payments",
  "purchase_payment_allocations",
  // Customer Receipt Vouchers (سند قبض) — added by migration 0027.
  "sales_payments",
  "sales_payment_allocations",
  // Banking simulation + ZATCA e-invoicing — added by migration 0029.
  "bank_accounts",
  "bank_transactions",
  "zatca_configs",
] as const;

/**
 * The canonical USING clause text as written in SQL (without the outer
 * `(...)` that wraps a CREATE POLICY clause). The boot helper renders
 * this into `CREATE POLICY … USING (…) WITH CHECK (…)`.
 *
 * Both clauses are deliberately identical: the policy must apply the
 * same workspace check on read (USING) and on write (WITH CHECK) so a
 * row a user can't see is also a row they can't INSERT or UPDATE into.
 */
export const CANONICAL_RLS_USING_SQL =
  "rls_is_bypassed() OR company_id = current_company_id()";

/** See `CANONICAL_RLS_USING_SQL` — same clause, deliberately. */
export const CANONICAL_RLS_WITH_CHECK_SQL = CANONICAL_RLS_USING_SQL;

/**
 * The form Postgres re-emits via `pg_get_expr(polqual, polrelid)` after
 * parsing `CANONICAL_RLS_USING_SQL`. The parser canonicalises by adding
 * an outer `(...)` and wrapping the OR's right-hand `=` comparison in
 * its own `(...)`.
 *
 * The drift-detection test in
 * `tests/e2e/database-rls-policy-coverage.spec.ts` compares the
 * pg-side text against this constant, so a change to
 * `CANONICAL_RLS_USING_SQL` MUST also be reflected here. They are
 * deliberately coupled — the comment in the spec used to say so when
 * the constants lived there.
 */
export const CANONICAL_RLS_USING_EXPR_PG =
  "(rls_is_bypassed() OR (company_id = current_company_id()))";

/** See `CANONICAL_RLS_USING_EXPR_PG` — same canonicalised text. */
export const CANONICAL_RLS_WITH_CHECK_EXPR_PG = CANONICAL_RLS_USING_EXPR_PG;

/**
 * The CREATE POLICY statement for a single in-scope table. Pulled out
 * so the boot helper, any future maintenance script, and any
 * regression spec all build the SQL the same way.
 */
export function workspaceIsolationPolicySql(table: string): string {
  return (
    `CREATE POLICY workspace_isolation ON "${table}"\n` +
    `  USING      (${CANONICAL_RLS_USING_SQL})\n` +
    `  WITH CHECK (${CANONICAL_RLS_WITH_CHECK_SQL})`
  );
}

/**
 * Re-apply ENABLE/FORCE RLS + the canonical `workspace_isolation`
 * policy on every table in `RLS_TABLES`. Idempotent: ENABLE/FORCE are
 * no-ops when already set, and the policy is dropped + re-created so
 * the canonical expression always wins on boot — even if a hand-edit
 * in prod (or an older migration) installed a drifted version.
 *
 * Tables in `RLS_TABLES` that don't exist yet are silently skipped.
 * That is the right behaviour for a fresh dev database where
 * `drizzle-kit push` hasn't materialised the schema yet: the helper
 * shouldn't blow up the boot sequence on a missing table; the
 * coverage spec will fail loudly if a *known* table never receives the
 * policy. It also keeps the boot helper safe to run before the runtime
 * `audit_log.company_id` column is materialised — the SQL migration
 * runner installs that column via migration 0016 which runs first, but
 * the silent-skip is belt-and-braces.
 *
 * The caller is expected to wrap this in `withRlsBypass` (the
 * connecting role is the table owner so DDL works either way, but the
 * bypass GUC short-circuits the policy for any same-connection follow-up
 * reads/writes that happen during the bootstrap). The dependencies the
 * helper relies on — the `app_api` role, the `current_company_id()` and
 * `rls_is_bypassed()` helper functions — are installed by
 * `migrations/0008_workspace_rls.sql` which runs ahead of this helper
 * in `server/index.ts`.
 */
export async function bootstrapWorkspaceRlsPolicies(
  client: PoolClient,
): Promise<void> {
  // Discover which RLS_TABLES actually exist right now. A fresh dev DB
  // that hasn't run `drizzle-kit push` yet will return an empty set;
  // skipping is preferable to blowing up the boot sequence on the very
  // first ALTER TABLE.
  const { rows: existing } = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type   = 'BASE TABLE'
        AND table_name   = ANY($1::text[])`,
    [[...RLS_TABLES]],
  );
  const present = new Set(existing.map((r) => r.table_name));

  for (const table of RLS_TABLES) {
    if (!present.has(table)) continue;
    await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE "${table}" FORCE  ROW LEVEL SECURITY`);
    await client.query(
      `DROP POLICY IF EXISTS workspace_isolation ON "${table}"`,
    );
    await client.query(workspaceIsolationPolicySql(table));
  }
}
