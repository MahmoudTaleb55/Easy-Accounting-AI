-- Defense-in-depth (continuation of migrations 0005 / 0007): drop the
-- legacy `DEFAULT 1` on `company_id` for every workspace-scoped table that
-- still carries one.
--
-- A column default of 1 silently funnels missing-companyId writes into
-- workspace 1, which is exactly the silent regression task #122 closes.
-- After this migration, every insert into a workspace-scoped table must
-- supply `company_id` explicitly — a forgetful route handler trips a
-- `not_null_violation` (SQLSTATE 23502) instead of leaking data into the
-- wrong workspace.
--
-- See `tests/e2e/database-companyid-no-default.spec.ts` for the regression
-- net that pins this in place.
--
-- All statements are idempotent (Postgres' `DROP DEFAULT` is a no-op when
-- there is no default), so this migration is safe alongside `drizzle-kit
-- push` and the matching boot helper at
-- `server/db-bootstrap-companyid-defaults.ts`.

ALTER TABLE "accounts" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "attendance" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "leaves" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "company_id" DROP DEFAULT;
