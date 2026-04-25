-- Task #169: bring `audit_log` under the same workspace_isolation RLS
-- policy as every other workspace-scoped table.
--
-- Until now, `audit_log` rows had no `company_id` column. Tenant
-- ownership was implicit through the entity row each audit pointed at —
-- which works for live entities but breaks down on "delete" audits whose
-- entity is gone, and forced `getJournalEntryAuditWithReversal` to fall
-- back on a `companyId` stamp inside the `changes` JSON. Adding the
-- column lets the RLS policy hide cross-tenant audit rows the same way
-- it hides every other workspace table, and lets the deleted-entity
-- audit lookup become a single workspace-filtered SELECT.
--
-- Steps:
--   1. Add `company_id` as nullable so the migration is non-blocking.
--   2. Backfill from each live entity table (transactions, journal_entries,
--      accounts, fixed_assets, employees, attendance, leaves, payroll_runs).
--   3. Backfill from the legacy `companyId` change-set stamp written by
--      `reverseAutoPostedJournalEntry` for cascade-deleted JEs (these
--      audit rows survived past their entity row by design).
--   4. Delete any audit row that still has a NULL `company_id` — these
--      are unverifiable legacy rows whose owning entity has been deleted
--      and that pre-date per-row tenancy stamping. The
--      `getAuditLog` / `getJournalEntryAuditWithReversal` API would have
--      returned 404 for them already (no live owning entity, no stamp),
--      so this is not a customer-visible loss.
--   5. ALTER COLUMN SET NOT NULL.
--   6. Add the `(company_id, entity_type, entity_id)` lookup index that
--      the workspace-scoped audit-history endpoint scans by.
--   7. ENABLE + FORCE row-level security and install the standard
--      `workspace_isolation` policy. The matching boot helper at
--      `server/db-bootstrap-audit-log-companyid.ts` re-runs steps 1–6 on
--      every boot; step 7 is re-applied by `db-bootstrap-rls.ts` because
--      `audit_log` is now in its `RLS_TABLES` list.
--
-- See `docs/design/workspace-isolation-defense-in-depth.md` for the
-- decision record.

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "company_id" integer;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "transactions" t
 WHERE a."entity_type" = 'transaction'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "journal_entries" t
 WHERE a."entity_type" = 'journal_entry'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "accounts" t
 WHERE a."entity_type" = 'account'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "fixed_assets" t
 WHERE a."entity_type" = 'fixed_asset'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "employees" t
 WHERE a."entity_type" = 'employee'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "attendance" t
 WHERE a."entity_type" = 'attendance'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "leaves" t
 WHERE a."entity_type" = 'leave'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

UPDATE "audit_log" a
   SET "company_id" = t."company_id"
  FROM "payroll_runs" t
 WHERE a."entity_type" = 'payroll_run'
   AND a."entity_id"   = t."id"
   AND a."company_id" IS NULL;
--> statement-breakpoint

-- Recover the workspace from the legacy change-set stamp written by
-- `reverseAutoPostedJournalEntry` for JE rows the live-table backfill
-- above couldn't match (the JE row was cascade-deleted before this
-- column existed). The stamp is `{field: 'companyId', to: <int>}`.
--
-- A correlated sub-SELECT is used (rather than `UPDATE ... FROM
-- jsonb_array_elements(a.changes)`) because Postgres rejects an
-- implicit lateral reference from a set-returning function in
-- `UPDATE`'s FROM-list back to the target table — the planner can't
-- prove the join is well-formed without LATERAL, and even with
-- LATERAL the row-multiplication semantics are different from what
-- we want here.
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
       );
--> statement-breakpoint

-- Drop unverifiable legacy audit rows whose owning entity is gone and
-- which carry no `companyId` change-set stamp. The audit-history API
-- already returns 404 for them (no live entity, no stamp), so this is
-- not a customer-visible loss — it's the same outcome the API would
-- produce for those rows today, just made definitive.
DELETE FROM "audit_log" WHERE "company_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "audit_log" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint

-- A workspace-scoped lookup index for the audit-history endpoint, which
-- scans by entity_type + entity_id under an active workspace scope.
CREATE INDEX IF NOT EXISTS "audit_log_company_entity_idx"
  ON "audit_log" ("company_id", "entity_type", "entity_id");
--> statement-breakpoint

-- Row-level security. The same policy shape applied to every other
-- workspace-scoped table by `migrations/0008_workspace_rls.sql`. The
-- helpers `current_company_id()` and `rls_is_bypassed()` are installed
-- by that migration and the matching boot helper.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "workspace_isolation" ON "audit_log";
--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "audit_log"
  USING      (rls_is_bypassed() OR company_id = current_company_id())
  WITH CHECK (rls_is_bypassed() OR company_id = current_company_id());
