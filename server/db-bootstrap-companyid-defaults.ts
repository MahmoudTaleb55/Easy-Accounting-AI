/**
 * Idempotent re-apply of migrations/0014_drop_company_id_defaults.sql on
 * every boot.
 *
 * Mirrors the pattern used for migration 0010 (see
 * db-bootstrap-accounts-code-uq.ts): dev databases and any deploy that
 * boots ahead of the migration runner end up in the same shape as the
 * canonical schema. The original 0003 / 0006 / 0007 / 0008 boot helpers
 * were retired in task #165 once the SQL migration runner had reliably
 * superseded them.
 *
 * Background — task #122. Previously, ten workspace-scoped tables
 * (accounts, journal_entries, transactions, budgets, settings, employees,
 * attendance, leaves, payroll_runs, chat_messages) declared their
 * `company_id` column as `NOT NULL DEFAULT 1`. That default silently
 * funnels missing-companyId writes into workspace 1 — a route handler that
 * forgets to scope an insert by workspace would land the new row in the
 * wrong workspace and pass NOT NULL validation. Tasks #70 / #91 added
 * composite FKs that catch *cross*-workspace writes; this bootstrap closes
 * the *missing*-workspace gap by making the column require an explicit
 * value on every insert.
 *
 * `tests/e2e/database-companyid-no-default.spec.ts` is the regression net
 * that pins this in place — it walks every public-schema table that has a
 * `company_id` column and asserts the column has no default.
 *
 * Postgres' `ALTER COLUMN ... DROP DEFAULT` is idempotent (it's a no-op
 * when there is no default), so re-runs are safe.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

// Tables whose `company_id` column previously carried `DEFAULT 1`. Kept
// in sync with `shared/schema.ts` and migration 0014.
const TABLES = [
  "accounts",
  "journal_entries",
  "transactions",
  "budgets",
  "settings",
  "employees",
  "attendance",
  "leaves",
  "payroll_runs",
  "chat_messages",
] as const;

export async function applyCompanyIdNoDefaultOnStartup(): Promise<void> {
  for (const table of TABLES) {
    // `format(%I)` quotes the identifier; the table list is a static
    // allowlist above so there is no user-supplied input here.
    await db.execute(
      sql.raw(
        `ALTER TABLE "${table}" ALTER COLUMN "company_id" DROP DEFAULT`,
      ),
    );
  }
}
