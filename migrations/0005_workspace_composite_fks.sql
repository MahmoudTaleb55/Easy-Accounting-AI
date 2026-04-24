-- Defense-in-depth: enforce workspace isolation at the database, not just at
-- the route layer. See docs/design/workspace-isolation-defense-in-depth.md
-- for the rationale and the alternative (RLS) that was considered.
--
-- This migration:
--   1. Adds a denormalised `company_id` to `journal_lines` so it can take
--      part in composite foreign keys.
--   2. Adds `UNIQUE (id, company_id)` constraints to every workspace-scoped
--      parent table (Postgres requires the exact column tuple to exist as
--      a unique/PK constraint to be the target of a composite FK).
--   3. Adds composite foreign keys on every cross-table reference among the
--      high-risk tables called out in task #70: accounts, journal_entries,
--      journal_lines, fixed_assets, asset_categories, employees, budgets.
--
-- Every step is idempotent so the migration is safe to re-run, and so
-- `drizzle-kit push` (which materialises schema state from
-- `shared/schema.ts`) doesn't double-create constraints when re-applied.

-- 1. journal_lines.company_id ------------------------------------------------

ALTER TABLE "journal_lines"
  ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint

UPDATE "journal_lines" jl
   SET "company_id" = je."company_id"
  FROM "journal_entries" je
 WHERE jl."journal_entry_id" = je."id"
   AND (jl."company_id" IS NULL OR jl."company_id" <> je."company_id");
--> statement-breakpoint

ALTER TABLE "journal_lines"
  ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint

-- Drop the column default so future inserts must supply company_id
-- explicitly. The storage layer is updated to always do so.
ALTER TABLE "journal_lines"
  ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- 2. Clean up orphans that would otherwise block FK creation -----------------
-- These should be empty in any well-behaved workspace; the deletes are a
-- safety valve for legacy rows whose parent has gone away.

DELETE FROM "journal_lines" jl
 WHERE NOT EXISTS (
   SELECT 1 FROM "journal_entries" je
    WHERE je."id" = jl."journal_entry_id"
      AND je."company_id" = jl."company_id"
 );
--> statement-breakpoint

DELETE FROM "journal_lines" jl
 WHERE NOT EXISTS (
   SELECT 1 FROM "accounts" a
    WHERE a."id" = jl."account_id"
      AND a."company_id" = jl."company_id"
 );
--> statement-breakpoint

DELETE FROM "budgets" b
 WHERE NOT EXISTS (
   SELECT 1 FROM "accounts" a
    WHERE a."id" = b."account_id"
      AND a."company_id" = b."company_id"
 );
--> statement-breakpoint

-- accounts.parent_id may legitimately be NULL (top-level accounts). When it
-- is set, the parent must be in the same workspace.
DELETE FROM "accounts" c
 WHERE c."parent_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" p
      WHERE p."id" = c."parent_id"
        AND p."company_id" = c."company_id"
   );
--> statement-breakpoint

DELETE FROM "fixed_assets" fa
 WHERE NOT EXISTS (
   SELECT 1 FROM "asset_categories" ac
    WHERE ac."id" = fa."category_id"
      AND ac."company_id" = fa."company_id"
 );
--> statement-breakpoint

-- asset_categories has eight account-id pointers (cost, accumulated dep,
-- depreciation expense, accumulated impairment, impairment loss, revaluation
-- surplus, gain/loss on disposal). Each must point to an account in the same
-- workspace. Null out any cross-workspace pointers (rather than deleting the
-- whole category, which could orphan fixed_assets) so the new FKs can be
-- created. The dataset is expected to be clean; this is a safety valve for
-- legacy drift.
UPDATE "asset_categories" ac
   SET "asset_cost_account_id" = NULL
 WHERE ac."asset_cost_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."asset_cost_account_id"
        AND a."company_id" = ac."company_id"
   );
UPDATE "asset_categories" ac
   SET "accumulated_dep_account_id" = NULL
 WHERE ac."accumulated_dep_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."accumulated_dep_account_id"
        AND a."company_id" = ac."company_id"
   );
UPDATE "asset_categories" ac
   SET "dep_expense_account_id" = NULL
 WHERE ac."dep_expense_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."dep_expense_account_id"
        AND a."company_id" = ac."company_id"
   );
UPDATE "asset_categories" ac
   SET "accumulated_imp_account_id" = NULL
 WHERE ac."accumulated_imp_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."accumulated_imp_account_id"
        AND a."company_id" = ac."company_id"
   );
UPDATE "asset_categories" ac
   SET "imp_loss_account_id" = NULL
 WHERE ac."imp_loss_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."imp_loss_account_id"
        AND a."company_id" = ac."company_id"
   );
UPDATE "asset_categories" ac
   SET "reval_surplus_account_id" = NULL
 WHERE ac."reval_surplus_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."reval_surplus_account_id"
        AND a."company_id" = ac."company_id"
   );
UPDATE "asset_categories" ac
   SET "gain_loss_disposal_account_id" = NULL
 WHERE ac."gain_loss_disposal_account_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "accounts" a
      WHERE a."id" = ac."gain_loss_disposal_account_id"
        AND a."company_id" = ac."company_id"
   );
--> statement-breakpoint

-- 3. Workspace-scoped UNIQUE constraints on parent tables --------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_id_company_uq') THEN
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_id_company_uq') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_id_company_uq') THEN
    ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_id_company_uq') THEN
    ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_id_company_uq') THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- 4. Composite foreign keys --------------------------------------------------

-- accounts.parent_id must point to an account in the same workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_parent_company_fk') THEN
    ALTER TABLE "accounts"
      ADD CONSTRAINT "accounts_parent_company_fk"
      FOREIGN KEY ("parent_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- journal_lines must reference a journal entry in the same workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_je_company_fk') THEN
    ALTER TABLE "journal_lines"
      ADD CONSTRAINT "journal_lines_je_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id")
      REFERENCES "journal_entries" ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- journal_lines must reference an account in the same workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_account_company_fk') THEN
    ALTER TABLE "journal_lines"
      ADD CONSTRAINT "journal_lines_account_company_fk"
      FOREIGN KEY ("account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- budgets must target an account in the same workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_account_company_fk') THEN
    ALTER TABLE "budgets"
      ADD CONSTRAINT "budgets_account_company_fk"
      FOREIGN KEY ("account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- fixed_assets must point to an asset_category in the same workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_category_company_fk') THEN
    ALTER TABLE "fixed_assets"
      ADD CONSTRAINT "fixed_assets_category_company_fk"
      FOREIGN KEY ("category_id", "company_id")
      REFERENCES "asset_categories" ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- Every account-id pointer on asset_categories must point to an account in
-- the same workspace. Seven separate composite FKs, one per pointer column.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_asset_cost_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_asset_cost_company_fk"
      FOREIGN KEY ("asset_cost_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_accum_dep_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_accum_dep_company_fk"
      FOREIGN KEY ("accumulated_dep_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_dep_expense_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_dep_expense_company_fk"
      FOREIGN KEY ("dep_expense_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_accum_imp_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_accum_imp_company_fk"
      FOREIGN KEY ("accumulated_imp_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_imp_loss_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_imp_loss_company_fk"
      FOREIGN KEY ("imp_loss_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_reval_surplus_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_reval_surplus_company_fk"
      FOREIGN KEY ("reval_surplus_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_gain_loss_disposal_company_fk') THEN
    ALTER TABLE "asset_categories"
      ADD CONSTRAINT "asset_categories_gain_loss_disposal_company_fk"
      FOREIGN KEY ("gain_loss_disposal_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id");
  END IF;
END $$;
