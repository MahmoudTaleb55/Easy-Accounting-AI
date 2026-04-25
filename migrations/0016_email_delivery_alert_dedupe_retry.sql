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

ALTER TABLE "email_delivery_alert_settings"
  ADD COLUMN IF NOT EXISTS "dedupe_hours" integer;

ALTER TABLE "email_delivery_alert_settings"
  ADD COLUMN IF NOT EXISTS "retry_minutes" integer;
