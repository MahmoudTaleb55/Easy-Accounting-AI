/**
 * Idempotent re-apply of migrations/0010_accounts_code_per_workspace.sql
 * on every boot.
 *
 * Mirrors the pattern used for migrations 0003 / 0006 / 0007 / 0008
 * (see auth/storage.ts, db-bootstrap-composite-fks.ts, db-bootstrap-rls.ts):
 * dev databases and any deploy that boots ahead of the migration runner end
 * up in the same shape as the canonical schema.
 *
 * The accounts table previously carried a *global* UNIQUE on `code`, which
 * silently broke every workspace after the first -- the canonical chart of
 * accounts could only ever be seeded into one company, so payroll's
 * hard-coded code lookups (6100/6110/6120/1110/2140/2150/2160/2220) all
 * 23505'd in any other workspace. This bootstrap drops the legacy global
 * UNIQUE and installs the per-workspace `(company_id, code)` UNIQUE that
 * `shared/schema.ts` declares as `codeCompanyUq`.
 *
 * Every step is guarded so re-runs are no-ops.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

export async function applyAccountsCodePerWorkspaceOnStartup(): Promise<void> {
  // 1. Drop legacy global UNIQUE constraints on `accounts.code`. Drizzle's
  //    auto-generated name is `accounts_code_unique`; older snapshots may
  //    have used `accounts_code_key` (Postgres' default for inline UNIQUE).
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_unique') THEN
        ALTER TABLE "accounts" DROP CONSTRAINT "accounts_code_unique";
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_key') THEN
        ALTER TABLE "accounts" DROP CONSTRAINT "accounts_code_key";
      END IF;
    END $$;
  `);

  // 2. Drop any bare UNIQUE INDEX that isn't backed by a constraint (would
  //    otherwise still block per-workspace code re-use).
  await db.execute(sql`DROP INDEX IF EXISTS "accounts_code_unique"`);
  await db.execute(sql`DROP INDEX IF EXISTS "accounts_code_key"`);
  await db.execute(sql`DROP INDEX IF EXISTS "accounts_code_idx"`);

  // 3. Install the per-workspace UNIQUE if it isn't already there.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_company_uq') THEN
        ALTER TABLE "accounts"
          ADD CONSTRAINT "accounts_code_company_uq" UNIQUE ("company_id", "code");
      END IF;
    END $$;
  `);
}
