-- Adds a one-shot bypass timestamp for the email-delivery alert cooldown.
-- The owner-facing "Re-arm" action sets this to NOW(); the evaluator
-- treats the cooldown gate as cleared when this is newer than the most
-- recent alert's fired_at. Non-destructive — the audit log's fired_at
-- timestamps remain immutable.

ALTER TABLE "email_delivery_alert_settings"
  ADD COLUMN IF NOT EXISTS "cooldown_cleared_at" timestamp;
