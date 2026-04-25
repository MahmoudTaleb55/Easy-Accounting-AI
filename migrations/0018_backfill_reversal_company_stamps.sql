-- Task #211: backfill the `companyId` change-set stamp on historical
-- reversal audit rows that pre-date `reverseAutoPostedJournalEntry`'s
-- workspace-stamping behaviour.
--
-- Background
-- ----------
-- When a payroll run / depreciation run / fixed-asset event / inbox
-- document is deleted, `reverseAutoPostedJournalEntry`
-- (server/storage.ts) cascade-deletes the auto-posted journal entry and
-- writes a final audit row with `entity_type='journal_entry'`,
-- `action='delete'`, and a `changes` array carrying:
--     { field: 'reversedBy', to: '<source_kind>#<source_id>' }
--     { field: 'companyId',  to: <workspace_id> }
--
-- The `companyId` stamp is the self-documenting trail of which
-- workspace owned the now-deleted JE — required by the History drawer's
-- reversal tombstone fallback (see history-drawer.tsx) and a defence
-- against any future audit lookup that needs to attribute a deleted-JE
-- row to its workspace without relying on the live JE table.
--
-- Audit rows written before that stamping was introduced carry the
-- `reversedBy` field but NOT the `companyId` field, so a JE that was
-- reversed back then now appears as "not found" in the tombstone
-- dialog. This migration walks those rows and patches the
-- `companyId` stamp into `changes` in place.
--
-- Sourcing the workspace id
-- -------------------------
-- For each known source kind we parse `reversedBy` into
-- `(kind, source_id)` and attempt to recover the workspace from the
-- source row in its own table. The reversal flow deletes the source
-- row in the same transaction as the JE, so for most historical rows
-- the source row is also gone; the live-table join will miss those.
-- A final fallback pass copies the workspace from the audit row's own
-- `audit_log.company_id` column (NOT NULL since migration 0016 — see
-- `0016_audit_log_company_id.sql` and the matching boot helper). The
-- column was itself backfilled from the journal-entry table and from
-- whatever `companyId` change-set stamps already existed, so it is
-- the closest authoritative source of truth available for rows whose
-- source entity is no longer present.
--
-- Idempotency
-- -----------
-- Every UPDATE is gated on `NOT EXISTS (... field='companyId' ...)`
-- in the existing `changes` array, so re-running this migration on a
-- database that has already been patched is a no-op. The migration
-- runner (server/migrate.ts) records this file in the
-- `schema_migrations` ledger after the first successful apply, but
-- the gate is the real correctness guarantee — dev DBs that
-- short-circuit through `drizzle-kit push` will still execute the
-- file at least once.
--
-- The append uses `changes || jsonb_build_array(...)` rather than
-- jsonb_set so a non-array `changes` value (which the application
-- never writes — the column defaults to `'[]'::jsonb` and every code
-- path only ever appends to it — but which would crash
-- jsonb_array_elements outright) would skip cleanly via the
-- `jsonb_typeof = 'array'` guard below.

-- 1. payroll_run -----------------------------------------------------------
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', s."company_id")
                   )
  FROM "payroll_runs" s
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
            AND c->>'to'    = 'payroll_run#' || s."id"::text
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
--> statement-breakpoint

-- 2. depreciation_run ------------------------------------------------------
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', s."company_id")
                   )
  FROM "depreciation_runs" s
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
            AND c->>'to'    = 'depreciation_run#' || s."id"::text
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
--> statement-breakpoint

-- 3. impairment_event ------------------------------------------------------
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', s."company_id")
                   )
  FROM "impairment_events" s
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
            AND c->>'to'    = 'impairment_event#' || s."id"::text
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
--> statement-breakpoint

-- 4. revaluation_event -----------------------------------------------------
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', s."company_id")
                   )
  FROM "revaluation_events" s
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
            AND c->>'to'    = 'revaluation_event#' || s."id"::text
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
--> statement-breakpoint

-- 5. disposal --------------------------------------------------------------
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', s."company_id")
                   )
  FROM "disposals" s
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
            AND c->>'to'    = 'disposal#' || s."id"::text
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
--> statement-breakpoint

-- 6. document --------------------------------------------------------------
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', s."company_id")
                   )
  FROM "documents" s
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
            AND c->>'to'    = 'document#' || s."id"::text
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
--> statement-breakpoint

-- 7. Fallback for rows whose source entity is also gone --------------------
-- The reversal flow deletes the source row in the same transaction as the
-- JE, so for the bulk of historical rows the live-table joins above will
-- have missed. The audit row's own `audit_log.company_id` column has been
-- NOT NULL since migration 0016 (backfilled from `journal_entries.company_id`
-- and from any pre-existing `companyId` change-set stamps), so it is the
-- closest authoritative workspace value available. Stamping it into
-- `changes` brings the row into shape for the History drawer's tombstone
-- fallback even though the originating source row no longer exists.
UPDATE "audit_log" a
   SET "changes" = a."changes"
                || jsonb_build_array(
                     jsonb_build_object('field', 'companyId', 'to', a."company_id")
                   )
 WHERE a."entity_type" = 'journal_entry'
   AND jsonb_typeof(a."changes") = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'reversedBy'
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(a."changes") AS c
          WHERE c->>'field' = 'companyId'
       );
