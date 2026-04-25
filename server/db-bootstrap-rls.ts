/**
 * Idempotent re-apply of migrations/0008_workspace_rls.sql on every boot.
 *
 * Mirrors the pattern used for migrations 0003 / 0006 / 0007: dev databases
 * and any deploy that boots ahead of the migration runner end up in the same
 * shape as the canonical schema. Every statement is `IF NOT EXISTS` /
 * `DROP POLICY IF EXISTS` / `CREATE OR REPLACE` so re-runs are no-ops.
 *
 * Runs inside `withRlsBypass` so its own DDL (which is exempt from RLS in
 * Postgres) and any ad-hoc `current_setting` lookups are unaffected by
 * whatever GUC happens to be on the connection it borrowed.
 *
 * Keep the table list in sync with `migrations/0008_workspace_rls.sql`.
 */
import { db, withRlsBypass } from "./db";
import { sql } from "drizzle-orm";

const RLS_TABLES = [
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
  // gained a `company_id` column. The matching boot helper at
  // `db-bootstrap-audit-log-companyid.ts` adds + backfills the column
  // BEFORE this list is iterated, so the policy install below succeeds
  // on the first boot after the migration too.
  "audit_log",
];

export async function applyWorkspaceRlsOnStartup(): Promise<void> {
  await withRlsBypass("bootstrap:rls", async () => {
    // 1. Non-superuser application role + grants. Superusers bypass RLS
    //    regardless of FORCE, so the request middleware temporarily SETs ROLE
    //    to this role for the duration of every /api/* request. Idempotent.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
          CREATE ROLE app_api NOLOGIN;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        EXECUTE format('GRANT app_api TO %I', current_user);
      END $$;
    `);
    await db.execute(sql`GRANT USAGE ON SCHEMA public TO app_api`);
    await db.execute(
      sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api`,
    );
    await db.execute(
      sql`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_api`,
    );
    await db.execute(sql`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
    `);
    await db.execute(sql`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_api;
    `);

    // 2. Helper functions ----------------------------------------------------
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION current_company_id() RETURNS integer
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.current_company_id', true), '')::integer;
      $$;
    `);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION rls_is_bypassed() RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT current_setting('app.rls_bypass', true) = 'on';
      $$;
    `);
    // Helpers belong to the connecting role; let app_api EXECUTE them so the
    // policy expressions evaluate after `SET ROLE app_api`.
    await db.execute(
      sql`GRANT EXECUTE ON FUNCTION current_company_id() TO app_api`,
    );
    await db.execute(
      sql`GRANT EXECUTE ON FUNCTION rls_is_bypassed() TO app_api`,
    );

    // 3. Per-table: enable + FORCE RLS, drop any prior policy, install ours.
    for (const t of RLS_TABLES) {
      await db.execute(sql.raw(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`));
      await db.execute(sql.raw(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`));
      await db.execute(
        sql.raw(`DROP POLICY IF EXISTS workspace_isolation ON "${t}"`),
      );
      await db.execute(
        sql.raw(
          `CREATE POLICY workspace_isolation ON "${t}"
             USING      (rls_is_bypassed() OR company_id = current_company_id())
             WITH CHECK (rls_is_bypassed() OR company_id = current_company_id())`,
        ),
      );
    }
  });
}
