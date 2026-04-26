-- Promote the per-address dedupe/retry windows from env-only knobs
-- (`EMAIL_DELIVERY_ALERT_DEDUPE_HOURS`, `EMAIL_DELIVERY_ALERT_RETRY_MINUTES`)
-- to per-workspace columns so owners can tune them alongside the existing
-- threshold / cooldown / window knobs in the settings UI.
--
-- Columns are nullable on purpose: the evaluator reads the per-workspace
-- value first and falls back to the env var only when the column is null,
-- so existing rows (and environments that prefer to keep the env-var knobs
-- as the source of truth) continue to behave exactly as they did before
-- this change. The settings UI seeds new saves with the env defaults
-- (12h / 60m), so a workspace that opens and re-saves the settings page
-- will have non-null values from then on.
--
-- Renumber note (task #264)
-- -------------------------
-- This migration originally shipped as `0016_email_delivery_alert_dedupe_retry.sql`,
-- which collided with `0016_audit_log_company_id.sql` on the `0016_` prefix.
-- The runner keys `schema_migrations` on the full filename so both files
-- did apply in practice, but the `migrations-prefix` regression spec
-- refuses to start the boot if any duplicate prefix exists (a future
-- runner change that switched to keying on the numeric prefix would
-- silently drop one of the two files). The audit-log migration is
-- cross-referenced from many code sites, so the dedupe-retry one was
-- moved to a free later slot (`0022_`).
--
-- The runner's own rename-reconciliation pass (see
-- `reconcileRenamedMigrations` in `server/migrate.ts`) collapses the
-- pre-existing `0016_email_delivery_alert_dedupe_retry.sql` ledger row
-- into this new filename by trailing-slug match on the next boot, so a
-- prod DB that already applied the original filename will not re-run
-- this migration. The inline INSERT below is a belt-and-suspenders
-- safety net for that reconciliation: if the apply loop ever does run
-- this file's body on a prod DB that already saw the original filename
-- (e.g. someone reverts the reconciliation logic), we still record both
-- the old and new filenames in `schema_migrations` so neither gets
-- re-applied.

ALTER TABLE "email_delivery_alert_settings"
  ADD COLUMN IF NOT EXISTS "dedupe_hours" integer;

ALTER TABLE "email_delivery_alert_settings"
  ADD COLUMN IF NOT EXISTS "retry_minutes" integer;

-- Belt-and-suspenders: if a prod DB already applied this migration
-- under its old `0016_` filename, also record the new `0022_` filename
-- so the runner won't treat the renumbered file as a fresh migration.
-- The guard ensures we never invent a ledger row on a fresh DB that
-- legitimately needs the apply loop to do its work.
INSERT INTO "schema_migrations" ("filename")
  SELECT '0022_email_delivery_alert_dedupe_retry.sql'
   WHERE EXISTS (
     SELECT 1 FROM "schema_migrations"
      WHERE "filename" = '0016_email_delivery_alert_dedupe_retry.sql'
   )
  ON CONFLICT ("filename") DO NOTHING;
