/**
 * Idempotent re-apply of migrations/0007_workspace_composite_fks_extension.sql
 * on every boot.
 *
 * Mirrors the pattern used for migrations 0003 / 0006 (see auth/storage.ts):
 * dev databases and any deploy that boots ahead of the migration runner end
 * up in the same shape as the canonical schema. Every statement is guarded
 * so re-runs are a no-op.
 *
 * The recipe (per-table, identical to the journal_lines fix from 0005):
 *   1. ADD COLUMN ... DEFAULT 1 IF NOT EXISTS so back-fill can populate it.
 *   2. UPDATE child SET company_id = parent.company_id (back-fill).
 *   3. ALTER COLUMN ... SET NOT NULL.
 *   4. ALTER COLUMN ... DROP DEFAULT (so missing values fail loudly).
 *   5. Delete / null orphans whose parent is missing or in another workspace.
 *   6. UNIQUE (id, company_id) on parent tables that are FK targets.
 *   7. Add the composite FOREIGN KEY itself.
 *
 * See docs/design/workspace-isolation-defense-in-depth.md for the rationale.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

interface ChildSpec {
  child: string;
  parent: string;
  childFk: string; // FK column on child that points to parent
}

const COMPANY_ID_BACKFILLS: ChildSpec[] = [
  // Defensively re-add the journal_lines.company_id back-fill from migration
  // 0005 in case the dev DB was bootstrapped before it ran (we have no boot
  // helper for 0005). Same recipe as the rest of this file.
  { child: "journal_lines", parent: "journal_entries", childFk: "journal_entry_id" },
  { child: "payroll_lines", parent: "payroll_runs", childFk: "payroll_run_id" },
  { child: "asset_components", parent: "fixed_assets", childFk: "asset_id" },
  { child: "depreciation_schedule", parent: "fixed_assets", childFk: "asset_id" },
  { child: "depreciation_postings", parent: "depreciation_runs", childFk: "run_id" },
  { child: "asset_usage_periods", parent: "fixed_assets", childFk: "asset_id" },
  { child: "impairment_events", parent: "fixed_assets", childFk: "asset_id" },
  { child: "revaluation_events", parent: "fixed_assets", childFk: "asset_id" },
  { child: "disposals", parent: "fixed_assets", childFk: "asset_id" },
];

interface UniqueSpec {
  table: string;
  constraint: string;
}

const PARENT_UNIQUES: UniqueSpec[] = [
  // Defensively re-add the parent uniques from migration 0005 in case the
  // dev DB was bootstrapped before it ran (we have no boot helper for 0005).
  { table: "accounts", constraint: "accounts_id_company_uq" },
  { table: "journal_entries", constraint: "journal_entries_id_company_uq" },
  { table: "asset_categories", constraint: "asset_categories_id_company_uq" },
  { table: "fixed_assets", constraint: "fixed_assets_id_company_uq" },
  { table: "employees", constraint: "employees_id_company_uq" },
  // Parent uniques introduced by 0007 itself.
  { table: "payroll_runs", constraint: "payroll_runs_id_company_uq" },
  { table: "asset_components", constraint: "asset_components_id_company_uq" },
  { table: "depreciation_runs", constraint: "depreciation_runs_id_company_uq" },
];

interface FkSpec {
  child: string;
  childCols: [string, string];
  parent: string;
  parentCols: [string, string];
  constraint: string;
}

const COMPOSITE_FKS: FkSpec[] = [
  // Task #70 composite FKs (defensively re-applied here in case migration
  // 0005 was never run on this DB — same rationale as PARENT_UNIQUES above).
  // accounts.parent_id is nullable; MATCH SIMPLE skips the check when NULL.
  { child: "accounts", childCols: ["parent_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "accounts_parent_company_fk" },
  { child: "journal_lines", childCols: ["journal_entry_id", "company_id"], parent: "journal_entries", parentCols: ["id", "company_id"], constraint: "journal_lines_je_company_fk" },
  { child: "journal_lines", childCols: ["account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "journal_lines_account_company_fk" },
  { child: "budgets", childCols: ["account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "budgets_account_company_fk" },
  { child: "fixed_assets", childCols: ["category_id", "company_id"], parent: "asset_categories", parentCols: ["id", "company_id"], constraint: "fixed_assets_category_company_fk" },
  { child: "asset_categories", childCols: ["asset_cost_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_asset_cost_company_fk" },
  { child: "asset_categories", childCols: ["accumulated_dep_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_accum_dep_company_fk" },
  { child: "asset_categories", childCols: ["dep_expense_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_dep_expense_company_fk" },
  { child: "asset_categories", childCols: ["accumulated_imp_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_accum_imp_company_fk" },
  { child: "asset_categories", childCols: ["imp_loss_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_imp_loss_company_fk" },
  { child: "asset_categories", childCols: ["reval_surplus_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_reval_surplus_company_fk" },
  { child: "asset_categories", childCols: ["gain_loss_disposal_account_id", "company_id"], parent: "accounts", parentCols: ["id", "company_id"], constraint: "asset_categories_gain_loss_disposal_company_fk" },
  // HR -----------------------------------------------------------------------
  { child: "attendance", childCols: ["employee_id", "company_id"], parent: "employees", parentCols: ["id", "company_id"], constraint: "attendance_employee_company_fk" },
  { child: "leaves", childCols: ["employee_id", "company_id"], parent: "employees", parentCols: ["id", "company_id"], constraint: "leaves_employee_company_fk" },
  { child: "payroll_lines", childCols: ["payroll_run_id", "company_id"], parent: "payroll_runs", parentCols: ["id", "company_id"], constraint: "payroll_lines_run_company_fk" },
  { child: "payroll_lines", childCols: ["employee_id", "company_id"], parent: "employees", parentCols: ["id", "company_id"], constraint: "payroll_lines_employee_company_fk" },
  // Fixed-asset children -----------------------------------------------------
  { child: "asset_components", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "asset_components_asset_company_fk" },
  { child: "depreciation_schedule", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "depreciation_schedule_asset_company_fk" },
  { child: "depreciation_schedule", childCols: ["component_id", "company_id"], parent: "asset_components", parentCols: ["id", "company_id"], constraint: "depreciation_schedule_component_company_fk" },
  { child: "depreciation_schedule", childCols: ["run_id", "company_id"], parent: "depreciation_runs", parentCols: ["id", "company_id"], constraint: "depreciation_schedule_run_company_fk" },
  { child: "depreciation_postings", childCols: ["run_id", "company_id"], parent: "depreciation_runs", parentCols: ["id", "company_id"], constraint: "depreciation_postings_run_company_fk" },
  { child: "depreciation_postings", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "depreciation_postings_asset_company_fk" },
  { child: "depreciation_postings", childCols: ["component_id", "company_id"], parent: "asset_components", parentCols: ["id", "company_id"], constraint: "depreciation_postings_component_company_fk" },
  { child: "asset_usage_periods", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "asset_usage_periods_asset_company_fk" },
  { child: "asset_usage_periods", childCols: ["component_id", "company_id"], parent: "asset_components", parentCols: ["id", "company_id"], constraint: "asset_usage_periods_component_company_fk" },
  { child: "impairment_events", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "impairment_events_asset_company_fk" },
  { child: "impairment_events", childCols: ["component_id", "company_id"], parent: "asset_components", parentCols: ["id", "company_id"], constraint: "impairment_events_component_company_fk" },
  { child: "revaluation_events", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "revaluation_events_asset_company_fk" },
  { child: "revaluation_events", childCols: ["component_id", "company_id"], parent: "asset_components", parentCols: ["id", "company_id"], constraint: "revaluation_events_component_company_fk" },
  { child: "disposals", childCols: ["asset_id", "company_id"], parent: "fixed_assets", parentCols: ["id", "company_id"], constraint: "disposals_asset_company_fk" },
  // Documents ----------------------------------------------------------------
  // journalEntryId is nullable: MATCH SIMPLE (Postgres default) skips the
  // check while the FK column is NULL, so un-posted documents aren't blocked.
  { child: "documents", childCols: ["journal_entry_id", "company_id"], parent: "journal_entries", parentCols: ["id", "company_id"], constraint: "documents_journal_entry_company_fk" },
];

export async function applyExtendedCompositeFksOnStartup(): Promise<void> {
  // 1. Add company_id columns + back-fill from parent. -----------------------
  for (const spec of COMPANY_ID_BACKFILLS) {
    await db.execute(
      sql.raw(
        `ALTER TABLE "${spec.child}" ADD COLUMN IF NOT EXISTS "company_id" integer DEFAULT 1`,
      ),
    );
    await db.execute(
      sql.raw(
        `UPDATE "${spec.child}" c SET "company_id" = p."company_id"
           FROM "${spec.parent}" p
          WHERE c."${spec.childFk}" = p."id"
            AND (c."company_id" IS NULL OR c."company_id" <> p."company_id")`,
      ),
    );
    await db.execute(
      sql.raw(`ALTER TABLE "${spec.child}" ALTER COLUMN "company_id" SET NOT NULL`),
    );
    await db.execute(
      sql.raw(`ALTER TABLE "${spec.child}" ALTER COLUMN "company_id" DROP DEFAULT`),
    );
  }

  // 2. Clean up orphans / cross-workspace pointers ---------------------------
  // journal_lines + budgets: defensively from migration 0005 (no boot helper).
  await db.execute(sql`DELETE FROM "journal_lines" jl WHERE NOT EXISTS (SELECT 1 FROM "journal_entries" je WHERE je."id" = jl."journal_entry_id" AND je."company_id" = jl."company_id")`);
  await db.execute(sql`DELETE FROM "journal_lines" jl WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = jl."account_id" AND a."company_id" = jl."company_id")`);
  await db.execute(sql`DELETE FROM "budgets" b WHERE NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = b."account_id" AND a."company_id" = b."company_id")`);

  // attendance + leaves: employees parent
  await db.execute(sql`DELETE FROM "attendance" a WHERE NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."id" = a."employee_id" AND e."company_id" = a."company_id")`);
  await db.execute(sql`DELETE FROM "leaves" l WHERE NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."id" = l."employee_id" AND e."company_id" = l."company_id")`);

  // payroll_lines
  await db.execute(sql`DELETE FROM "payroll_lines" pl WHERE NOT EXISTS (SELECT 1 FROM "payroll_runs" pr WHERE pr."id" = pl."payroll_run_id" AND pr."company_id" = pl."company_id")`);
  await db.execute(sql`DELETE FROM "payroll_lines" pl WHERE NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."id" = pl."employee_id" AND e."company_id" = pl."company_id")`);

  // asset_components
  await db.execute(sql`DELETE FROM "asset_components" c WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = c."asset_id" AND fa."company_id" = c."company_id")`);

  // depreciation_schedule
  await db.execute(sql`UPDATE "depreciation_schedule" ds SET "component_id" = NULL WHERE ds."component_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "asset_components" c WHERE c."id" = ds."component_id" AND c."company_id" = ds."company_id")`);
  await db.execute(sql`UPDATE "depreciation_schedule" ds SET "run_id" = NULL WHERE ds."run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "depreciation_runs" dr WHERE dr."id" = ds."run_id" AND dr."company_id" = ds."company_id")`);
  await db.execute(sql`DELETE FROM "depreciation_schedule" ds WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = ds."asset_id" AND fa."company_id" = ds."company_id")`);

  // depreciation_postings
  await db.execute(sql`UPDATE "depreciation_postings" dp SET "component_id" = NULL WHERE dp."component_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "asset_components" c WHERE c."id" = dp."component_id" AND c."company_id" = dp."company_id")`);
  await db.execute(sql`DELETE FROM "depreciation_postings" dp WHERE NOT EXISTS (SELECT 1 FROM "depreciation_runs" dr WHERE dr."id" = dp."run_id" AND dr."company_id" = dp."company_id")`);
  await db.execute(sql`DELETE FROM "depreciation_postings" dp WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = dp."asset_id" AND fa."company_id" = dp."company_id")`);

  // asset_usage_periods
  await db.execute(sql`UPDATE "asset_usage_periods" aup SET "component_id" = NULL WHERE aup."component_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "asset_components" c WHERE c."id" = aup."component_id" AND c."company_id" = aup."company_id")`);
  await db.execute(sql`DELETE FROM "asset_usage_periods" aup WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = aup."asset_id" AND fa."company_id" = aup."company_id")`);

  // impairment_events / revaluation_events / disposals
  await db.execute(sql`UPDATE "impairment_events" ie SET "component_id" = NULL WHERE ie."component_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "asset_components" c WHERE c."id" = ie."component_id" AND c."company_id" = ie."company_id")`);
  await db.execute(sql`DELETE FROM "impairment_events" ie WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = ie."asset_id" AND fa."company_id" = ie."company_id")`);
  await db.execute(sql`UPDATE "revaluation_events" re SET "component_id" = NULL WHERE re."component_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "asset_components" c WHERE c."id" = re."component_id" AND c."company_id" = re."company_id")`);
  await db.execute(sql`DELETE FROM "revaluation_events" re WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = re."asset_id" AND fa."company_id" = re."company_id")`);
  await db.execute(sql`DELETE FROM "disposals" d WHERE NOT EXISTS (SELECT 1 FROM "fixed_assets" fa WHERE fa."id" = d."asset_id" AND fa."company_id" = d."company_id")`);

  // documents.journal_entry_id (nullable when un-posted)
  await db.execute(sql`UPDATE "documents" d SET "journal_entry_id" = NULL WHERE d."journal_entry_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "journal_entries" je WHERE je."id" = d."journal_entry_id" AND je."company_id" = d."company_id")`);

  // 3. UNIQUE (id, company_id) on parent tables that are FK targets ---------
  for (const u of PARENT_UNIQUES) {
    await db.execute(
      sql.raw(
        `DO $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${u.constraint}') THEN
             ALTER TABLE "${u.table}" ADD CONSTRAINT "${u.constraint}" UNIQUE ("id", "company_id");
           END IF;
         END $$`,
      ),
    );
  }

  // 4. Composite foreign keys ------------------------------------------------
  for (const fk of COMPOSITE_FKS) {
    await db.execute(
      sql.raw(
        `DO $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${fk.constraint}') THEN
             ALTER TABLE "${fk.child}" ADD CONSTRAINT "${fk.constraint}"
               FOREIGN KEY ("${fk.childCols[0]}", "${fk.childCols[1]}")
               REFERENCES "${fk.parent}" ("${fk.parentCols[0]}", "${fk.parentCols[1]}");
           END IF;
         END $$`,
      ),
    );
  }
}
