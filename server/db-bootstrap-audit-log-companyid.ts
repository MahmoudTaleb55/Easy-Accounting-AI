/**
 * Idempotent re-apply of migrations/0016_audit_log_company_id.sql on every
 * boot.
 *
 * Mirrors the pattern used for the surviving boot helpers (migrations
 * 0005 / 0010 / 0014 — see auth/storage.ts,
 * db-bootstrap-accounts-code-uq.ts, db-bootstrap-companyid-defaults.ts):
 * dev databases and any deploy that boots ahead of the migration runner
 * end up in the same shape as the canonical schema. The legacy 0003 /
 * 0006 / 0007 / 0008 boot helpers were retired in task #165 once the SQL
 * migration runner had reliably superseded them.
 *
 * Background — task #169. The `audit_log` table predated per-row tenancy
 * and had no `company_id` column. Tenant ownership of an audit row was
 * implicit through the entity row each audit pointed at, which broke down
 * on "delete" audits whose entity was gone. Adding the column lets the
 * `workspace_isolation` RLS policy cover audit rows the same way it
 * covers every other workspace-scoped table.
 *
 * Scope: this helper re-stages only the column-bearing portion of
 * migration 0016 (ADD COLUMN, backfill, SET NOT NULL, lookup index). The
 * matching ENABLE / FORCE RLS + `workspace_isolation` policy install on
 * `audit_log` is performed by migration 0016 itself, now applied by the
 * SQL migration runner in `server/migrate.ts`. Wrapped by the caller in
 * `withRlsBypass` so the backfill UPDATEs across every workspace are not
 * rejected by the policy on a second boot pass.
 *
 * Every step is guarded so re-runs are no-ops:
 *   - `ADD COLUMN IF NOT EXISTS`
 *   - the backfill UPDATEs are scoped to `company_id IS NULL`
 *   - `SET NOT NULL` is a no-op on a column that is already NOT NULL
 *   - `CREATE INDEX IF NOT EXISTS`
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

const ENTITY_TABLES: ReadonlyArray<{ entityType: string; table: string }> = [
  { entityType: "transaction", table: "transactions" },
  { entityType: "journal_entry", table: "journal_entries" },
  { entityType: "account", table: "accounts" },
  { entityType: "fixed_asset", table: "fixed_assets" },
  { entityType: "employee", table: "employees" },
  { entityType: "attendance", table: "attendance" },
  { entityType: "leave", table: "leaves" },
  { entityType: "payroll_run", table: "payroll_runs" },
];

export async function applyAuditLogCompanyIdOnStartup(): Promise<void> {
  // 1. Add the column nullably so a database with existing audit rows
  //    can still take new INSERTs while the backfill runs.
  await db.execute(
    sql`ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "company_id" integer`,
  );

  // Skip the backfill + NOT NULL when the column is already NOT NULL —
  // every step below is idempotent on its own, but the join queries are
  // measurable on databases with millions of audit rows and the
  // `company_id IS NULL` predicate yields zero work after the first run.
  // Only the live-table joins are skipped on the early-out; the index
  // creation and the SET NOT NULL re-assertion still run because they
  // are cheap no-ops.
  const colMeta = await db.execute(sql`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'audit_log'
       AND column_name  = 'company_id'
  `);
  const alreadyNotNull =
    colMeta.rows.length > 0 &&
    (colMeta.rows[0] as { is_nullable: string }).is_nullable === "NO";

  if (!alreadyNotNull) {
    // 2. Backfill from each live entity table. Each entity_type maps to
    //    exactly one parent table; the join is on (entity_type,
    //    entity_id) → (id) and copies the parent's company_id.
    for (const { entityType, table } of ENTITY_TABLES) {
      await db.execute(
        sql.raw(
          `UPDATE "audit_log" a
              SET "company_id" = t."company_id"
             FROM "${table}" t
            WHERE a."entity_type" = '${entityType}'
              AND a."entity_id"   = t."id"
              AND a."company_id" IS NULL`,
        ),
      );
    }

    // 3. Recover the workspace from the legacy `companyId` change-set
    //    stamp written by `reverseAutoPostedJournalEntry` for JE rows
    //    the live-table backfill couldn't match. A correlated sub-SELECT
    //    is used because Postgres rejects implicit lateral references
    //    from a set-returning function in `UPDATE`'s FROM-list back to
    //    the target table — see the migration file for the long form.
    await db.execute(sql`
      UPDATE "audit_log" a
         SET "company_id" = (
               SELECT (c->>'to')::integer
                 FROM jsonb_array_elements(a."changes") AS c
                WHERE c->>'field' = 'companyId'
                  AND c->>'to' ~ '^[0-9]+$'
                LIMIT 1
             )
       WHERE a."company_id" IS NULL
         AND EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(a."changes") AS c
                WHERE c->>'field' = 'companyId'
                  AND c->>'to' ~ '^[0-9]+$'
             )
    `);

    // 4. Drop unverifiable legacy audit rows so the SET NOT NULL below
    //    succeeds. See the migration file for why this is not a
    //    customer-visible loss.
    await db.execute(
      sql`DELETE FROM "audit_log" WHERE "company_id" IS NULL`,
    );

    // 5. Pin the contract: every future INSERT must carry company_id.
    await db.execute(
      sql`ALTER TABLE "audit_log" ALTER COLUMN "company_id" SET NOT NULL`,
    );
  }

  // 6. Workspace-scoped lookup index (idempotent).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_log_company_entity_idx"
      ON "audit_log" ("company_id", "entity_type", "entity_id")
  `);
}
