-- Scope account-code uniqueness per workspace so two companies can each
-- own the same canonical chart of accounts (cash "1110", salaries "6100",
-- etc.). The previous shape -- a global UNIQUE on `accounts.code` --
-- silently broke every workspace after the first: the auto-seed
-- (`seedDefaultCoaForCompany`) would 23505 on the first canonical code it
-- tried to insert, the e2e role-based payroll setup couldn't seed the
-- payroll account set into the shared workspace, and any real customer
-- with more than one company hit the same wall as soon as
-- they tried to use the canonical COA.
--
-- The schema in `shared/schema.ts` already declares this as
-- `codeCompanyUq UNIQUE (company_id, code)`. This migration brings
-- previously-deployed databases in line with that schema:
--
--   1. Drop the legacy global UNIQUE on `accounts.code` (whatever name it
--      was created under -- drizzle's default is `accounts_code_unique`,
--      but we also accept the index variants in case the constraint was
--      created out-of-band).
--   2. Add the per-workspace `accounts_code_company_uq` UNIQUE on
--      (company_id, code) if it isn't already there.
--
-- Both steps are idempotent so a fresh `drizzle-kit push` after this
-- migration is a no-op.

-- 1. Drop the legacy global UNIQUE if any database still carries it. The
-- constraint name drizzle would have auto-generated is
-- `accounts_code_unique`; some older snapshots used `accounts_code_key`
-- (Postgres' default for `UNIQUE` declared inline). Drop both shapes
-- defensively.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_unique') THEN
    ALTER TABLE "accounts" DROP CONSTRAINT "accounts_code_unique";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_key') THEN
    ALTER TABLE "accounts" DROP CONSTRAINT "accounts_code_key";
  END IF;
END $$;
--> statement-breakpoint

-- A bare UNIQUE INDEX (not a constraint) on `accounts.code` would also
-- block per-workspace re-use; drop it too if it exists. The composite
-- index introduced in step (2) covers single-column lookups on `code`
-- well enough for the chart-of-accounts queries we run.
DROP INDEX IF EXISTS "accounts_code_unique";
DROP INDEX IF EXISTS "accounts_code_key";
DROP INDEX IF EXISTS "accounts_code_idx";
--> statement-breakpoint

-- 2. Add the per-workspace UNIQUE on (company_id, code). Idempotent so
-- this migration co-exists cleanly with `drizzle-kit push` (which
-- materialises schema state from `shared/schema.ts`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_company_uq') THEN
    ALTER TABLE "accounts"
      ADD CONSTRAINT "accounts_code_company_uq" UNIQUE ("company_id", "code");
  END IF;
END $$;
