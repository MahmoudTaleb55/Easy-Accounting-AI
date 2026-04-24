-- Defense-in-depth (continuation of migration 0005): extend the
-- workspace-isolation composite-FK pattern to the remaining workspace-scoped
-- tables identified in task #91. See
-- docs/design/workspace-isolation-defense-in-depth.md for the recipe.
--
-- Tables covered:
--   * HR:        attendance, leaves, payroll_runs, payroll_lines
--   * Fixed assets children: asset_components, depreciation_schedule,
--     depreciation_runs, depreciation_postings, impairment_events,
--     revaluation_events, disposals, asset_usage_periods
--   * Documents (link to journal_entries)
--
-- For each child that lacks a `company_id`, we follow the journal_lines
-- recipe from 0005:
--   1. ADD COLUMN ... DEFAULT 1 (so the column can be added without a NOT
--      NULL violation on existing rows).
--   2. UPDATE ... SET company_id = parent.company_id  (back-fill).
--   3. ALTER COLUMN ... SET NOT NULL.
--   4. ALTER COLUMN ... DROP DEFAULT — every future insert must supply the
--      active workspace explicitly so missing values fail loudly.
--   5. DELETE any orphan rows whose parent is missing or in a different
--      workspace (safety valve for legacy drift).
--   6. Add UNIQUE (id, company_id) on parent tables that need to act as
--      composite-FK targets.
--   7. Add the composite FOREIGN KEY itself.
--
-- Every step is idempotent so the migration is safe to re-run alongside
-- `drizzle-kit push` (which materialises schema state from
-- `shared/schema.ts`).

-- ============================================================================
-- 1. Add denormalised company_id columns and back-fill from parent
-- ============================================================================

-- payroll_lines (parent: payroll_runs) -----------------------------------------
ALTER TABLE "payroll_lines" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "payroll_lines" pl
   SET "company_id" = pr."company_id"
  FROM "payroll_runs" pr
 WHERE pl."payroll_run_id" = pr."id"
   AND (pl."company_id" IS NULL OR pl."company_id" <> pr."company_id");
--> statement-breakpoint
ALTER TABLE "payroll_lines" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "payroll_lines" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- asset_components (parent: fixed_assets) -------------------------------------
ALTER TABLE "asset_components" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "asset_components" c
   SET "company_id" = fa."company_id"
  FROM "fixed_assets" fa
 WHERE c."asset_id" = fa."id"
   AND (c."company_id" IS NULL OR c."company_id" <> fa."company_id");
--> statement-breakpoint
ALTER TABLE "asset_components" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "asset_components" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- depreciation_schedule (parent: fixed_assets) --------------------------------
ALTER TABLE "depreciation_schedule" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "depreciation_schedule" ds
   SET "company_id" = fa."company_id"
  FROM "fixed_assets" fa
 WHERE ds."asset_id" = fa."id"
   AND (ds."company_id" IS NULL OR ds."company_id" <> fa."company_id");
--> statement-breakpoint
ALTER TABLE "depreciation_schedule" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "depreciation_schedule" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- depreciation_postings (parent: depreciation_runs) ---------------------------
ALTER TABLE "depreciation_postings" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "depreciation_postings" dp
   SET "company_id" = dr."company_id"
  FROM "depreciation_runs" dr
 WHERE dp."run_id" = dr."id"
   AND (dp."company_id" IS NULL OR dp."company_id" <> dr."company_id");
--> statement-breakpoint
ALTER TABLE "depreciation_postings" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "depreciation_postings" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- asset_usage_periods (parent: fixed_assets) ----------------------------------
ALTER TABLE "asset_usage_periods" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "asset_usage_periods" aup
   SET "company_id" = fa."company_id"
  FROM "fixed_assets" fa
 WHERE aup."asset_id" = fa."id"
   AND (aup."company_id" IS NULL OR aup."company_id" <> fa."company_id");
--> statement-breakpoint
ALTER TABLE "asset_usage_periods" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "asset_usage_periods" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- impairment_events (parent: fixed_assets) ------------------------------------
ALTER TABLE "impairment_events" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "impairment_events" ie
   SET "company_id" = fa."company_id"
  FROM "fixed_assets" fa
 WHERE ie."asset_id" = fa."id"
   AND (ie."company_id" IS NULL OR ie."company_id" <> fa."company_id");
--> statement-breakpoint
ALTER TABLE "impairment_events" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "impairment_events" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- revaluation_events (parent: fixed_assets) -----------------------------------
ALTER TABLE "revaluation_events" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "revaluation_events" re
   SET "company_id" = fa."company_id"
  FROM "fixed_assets" fa
 WHERE re."asset_id" = fa."id"
   AND (re."company_id" IS NULL OR re."company_id" <> fa."company_id");
--> statement-breakpoint
ALTER TABLE "revaluation_events" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "revaluation_events" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- disposals (parent: fixed_assets) --------------------------------------------
ALTER TABLE "disposals" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "disposals" d
   SET "company_id" = fa."company_id"
  FROM "fixed_assets" fa
 WHERE d."asset_id" = fa."id"
   AND (d."company_id" IS NULL OR d."company_id" <> fa."company_id");
--> statement-breakpoint
ALTER TABLE "disposals" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "disposals" ALTER COLUMN "company_id" DROP DEFAULT;
--> statement-breakpoint

-- ============================================================================
-- 2. Clean up orphans that would otherwise block FK creation
-- ============================================================================
-- These deletes target rows whose parent is missing or whose parent lives in
-- a different workspace. The dataset is expected to be clean; this is a
-- safety valve for legacy drift.

DELETE FROM "attendance" a
 WHERE NOT EXISTS (
   SELECT 1 FROM "employees" e
    WHERE e."id" = a."employee_id"
      AND e."company_id" = a."company_id"
 );
--> statement-breakpoint

DELETE FROM "leaves" l
 WHERE NOT EXISTS (
   SELECT 1 FROM "employees" e
    WHERE e."id" = l."employee_id"
      AND e."company_id" = l."company_id"
 );
--> statement-breakpoint

DELETE FROM "payroll_lines" pl
 WHERE NOT EXISTS (
   SELECT 1 FROM "payroll_runs" pr
    WHERE pr."id" = pl."payroll_run_id"
      AND pr."company_id" = pl."company_id"
 );
DELETE FROM "payroll_lines" pl
 WHERE NOT EXISTS (
   SELECT 1 FROM "employees" e
    WHERE e."id" = pl."employee_id"
      AND e."company_id" = pl."company_id"
 );
--> statement-breakpoint

DELETE FROM "asset_components" c
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = c."asset_id"
      AND fa."company_id" = c."company_id"
 );
--> statement-breakpoint

-- For child rows whose nullable componentId points outside the workspace,
-- null it out (rather than deleting the row) so the schedule/posting row
-- still exists at the asset level.
UPDATE "depreciation_schedule" ds
   SET "component_id" = NULL
 WHERE ds."component_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "asset_components" c
      WHERE c."id" = ds."component_id"
        AND c."company_id" = ds."company_id"
   );
DELETE FROM "depreciation_schedule" ds
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = ds."asset_id"
      AND fa."company_id" = ds."company_id"
 );
UPDATE "depreciation_schedule" ds
   SET "run_id" = NULL
 WHERE ds."run_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "depreciation_runs" dr
      WHERE dr."id" = ds."run_id"
        AND dr."company_id" = ds."company_id"
   );
--> statement-breakpoint

UPDATE "depreciation_postings" dp
   SET "component_id" = NULL
 WHERE dp."component_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "asset_components" c
      WHERE c."id" = dp."component_id"
        AND c."company_id" = dp."company_id"
   );
DELETE FROM "depreciation_postings" dp
 WHERE NOT EXISTS (
   SELECT 1 FROM "depreciation_runs" dr
    WHERE dr."id" = dp."run_id"
      AND dr."company_id" = dp."company_id"
 );
DELETE FROM "depreciation_postings" dp
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = dp."asset_id"
      AND fa."company_id" = dp."company_id"
 );
--> statement-breakpoint

UPDATE "asset_usage_periods" aup
   SET "component_id" = NULL
 WHERE aup."component_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "asset_components" c
      WHERE c."id" = aup."component_id"
        AND c."company_id" = aup."company_id"
   );
DELETE FROM "asset_usage_periods" aup
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = aup."asset_id"
      AND fa."company_id" = aup."company_id"
 );
--> statement-breakpoint

UPDATE "impairment_events" ie
   SET "component_id" = NULL
 WHERE ie."component_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "asset_components" c
      WHERE c."id" = ie."component_id"
        AND c."company_id" = ie."company_id"
   );
DELETE FROM "impairment_events" ie
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = ie."asset_id"
      AND fa."company_id" = ie."company_id"
 );
--> statement-breakpoint

UPDATE "revaluation_events" re
   SET "component_id" = NULL
 WHERE re."component_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "asset_components" c
      WHERE c."id" = re."component_id"
        AND c."company_id" = re."company_id"
   );
DELETE FROM "revaluation_events" re
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = re."asset_id"
      AND fa."company_id" = re."company_id"
 );
--> statement-breakpoint

DELETE FROM "disposals" d
 WHERE NOT EXISTS (
   SELECT 1 FROM "fixed_assets" fa
    WHERE fa."id" = d."asset_id"
      AND fa."company_id" = d."company_id"
 );
--> statement-breakpoint

-- documents.journal_entry_id may legitimately be NULL (un-posted documents).
-- When set, the linked JE must live in the same workspace.
UPDATE "documents" d
   SET "journal_entry_id" = NULL
 WHERE d."journal_entry_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "journal_entries" je
      WHERE je."id" = d."journal_entry_id"
        AND je."company_id" = d."company_id"
   );
--> statement-breakpoint

-- ============================================================================
-- 3. UNIQUE (id, company_id) on parent tables that need to be FK targets
-- ============================================================================

-- Defensively re-add the parent uniques from migration 0005 in case this
-- migration runs against a DB that pre-dates 0005's manual application.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_id_company_uq') THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_id_company_uq" UNIQUE ("id", "company_id");
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_id_company_uq') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_id_company_uq') THEN
    ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_components_id_company_uq') THEN
    ALTER TABLE "asset_components" ADD CONSTRAINT "asset_components_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_runs_id_company_uq') THEN
    ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- ============================================================================
-- 4. Composite foreign keys
-- ============================================================================

-- attendance.(employee_id, company_id) -> employees(id, company_id) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_employee_company_fk') THEN
    ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_company_fk"
      FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- leaves.(employee_id, company_id) -> employees(id, company_id) --------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leaves_employee_company_fk') THEN
    ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_company_fk"
      FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- payroll_lines.(payroll_run_id, company_id) -> payroll_runs(id, company_id)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_lines_run_company_fk') THEN
    ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_company_fk"
      FOREIGN KEY ("payroll_run_id", "company_id") REFERENCES "payroll_runs"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- payroll_lines.(employee_id, company_id) -> employees(id, company_id) -------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_lines_employee_company_fk') THEN
    ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_company_fk"
      FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- asset_components.(asset_id, company_id) -> fixed_assets(id, company_id) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_components_asset_company_fk') THEN
    ALTER TABLE "asset_components" ADD CONSTRAINT "asset_components_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- depreciation_schedule.(asset_id, company_id) -> fixed_assets ---------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_schedule_asset_company_fk') THEN
    ALTER TABLE "depreciation_schedule" ADD CONSTRAINT "depreciation_schedule_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- depreciation_schedule.(component_id, company_id) -> asset_components -------
-- componentId is nullable; MATCH SIMPLE skips the check for NULL components.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_schedule_component_company_fk') THEN
    ALTER TABLE "depreciation_schedule" ADD CONSTRAINT "depreciation_schedule_component_company_fk"
      FOREIGN KEY ("component_id", "company_id") REFERENCES "asset_components"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- depreciation_schedule.(run_id, company_id) -> depreciation_runs ------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_schedule_run_company_fk') THEN
    ALTER TABLE "depreciation_schedule" ADD CONSTRAINT "depreciation_schedule_run_company_fk"
      FOREIGN KEY ("run_id", "company_id") REFERENCES "depreciation_runs"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- depreciation_postings.(run_id, company_id) -> depreciation_runs ------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_postings_run_company_fk') THEN
    ALTER TABLE "depreciation_postings" ADD CONSTRAINT "depreciation_postings_run_company_fk"
      FOREIGN KEY ("run_id", "company_id") REFERENCES "depreciation_runs"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- depreciation_postings.(asset_id, company_id) -> fixed_assets ---------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_postings_asset_company_fk') THEN
    ALTER TABLE "depreciation_postings" ADD CONSTRAINT "depreciation_postings_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- depreciation_postings.(component_id, company_id) -> asset_components -------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_postings_component_company_fk') THEN
    ALTER TABLE "depreciation_postings" ADD CONSTRAINT "depreciation_postings_component_company_fk"
      FOREIGN KEY ("component_id", "company_id") REFERENCES "asset_components"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- asset_usage_periods.(asset_id, company_id) -> fixed_assets -----------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_usage_periods_asset_company_fk') THEN
    ALTER TABLE "asset_usage_periods" ADD CONSTRAINT "asset_usage_periods_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- asset_usage_periods.(component_id, company_id) -> asset_components ---------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_usage_periods_component_company_fk') THEN
    ALTER TABLE "asset_usage_periods" ADD CONSTRAINT "asset_usage_periods_component_company_fk"
      FOREIGN KEY ("component_id", "company_id") REFERENCES "asset_components"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- impairment_events.(asset_id, company_id) -> fixed_assets -------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'impairment_events_asset_company_fk') THEN
    ALTER TABLE "impairment_events" ADD CONSTRAINT "impairment_events_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- impairment_events.(component_id, company_id) -> asset_components -----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'impairment_events_component_company_fk') THEN
    ALTER TABLE "impairment_events" ADD CONSTRAINT "impairment_events_component_company_fk"
      FOREIGN KEY ("component_id", "company_id") REFERENCES "asset_components"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- revaluation_events.(asset_id, company_id) -> fixed_assets ------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revaluation_events_asset_company_fk') THEN
    ALTER TABLE "revaluation_events" ADD CONSTRAINT "revaluation_events_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- revaluation_events.(component_id, company_id) -> asset_components ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revaluation_events_component_company_fk') THEN
    ALTER TABLE "revaluation_events" ADD CONSTRAINT "revaluation_events_component_company_fk"
      FOREIGN KEY ("component_id", "company_id") REFERENCES "asset_components"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- disposals.(asset_id, company_id) -> fixed_assets ---------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disposals_asset_company_fk') THEN
    ALTER TABLE "disposals" ADD CONSTRAINT "disposals_asset_company_fk"
      FOREIGN KEY ("asset_id", "company_id") REFERENCES "fixed_assets"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- documents.(journal_entry_id, company_id) -> journal_entries ----------------
-- journalEntryId is nullable for un-posted documents; MATCH SIMPLE skips the
-- check while it remains NULL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_journal_entry_company_fk') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_journal_entry_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

-- ============================================================================
-- Notes on tables explicitly reviewed but NOT given new constraints here
-- ============================================================================
-- * transactions, fx_rates, chat_messages, settings, workspace_invites:
--   Either no other workspace-scoped table currently has a foreign-key-style
--   pointer back to them, or the table has been dropped (workspace_invites
--   was removed in 0004). They retain their own `company_id` column; if a
--   future migration adds a child table that references them, add
--   UNIQUE (id, company_id) at that point and follow the same pattern.
--   In particular journal_entries.source_transaction_id is currently set
--   only by server-side bookkeeping that already scopes to companyId, so
--   adding a composite FK there is deferred until/unless the column is
--   exposed to user input.
