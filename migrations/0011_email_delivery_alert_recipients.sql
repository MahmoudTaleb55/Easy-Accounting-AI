-- Per-recipient outcome rows for the delivery-health alert evaluator.
-- Replaces the single integer `email_recipients` count on
-- `email_delivery_alerts` with an append-only attempt log so the evaluator
-- can:
--   1. Skip an address that already received the same alert reason
--      successfully within a configurable dedupe window (default 12h),
--      stopping a flapping provider from spamming the same owner with
--      near-identical alerts.
--   2. Re-attempt addresses whose previous attempt failed (within a small
--      retry window) without waiting for the next cooldown to expire.

CREATE TABLE IF NOT EXISTS "email_delivery_alert_recipients" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_id" varchar NOT NULL REFERENCES "email_delivery_alerts"("id") ON DELETE CASCADE,
  "company_id" integer NOT NULL,
  "email" varchar NOT NULL,
  -- Mirrors email_delivery_alerts.reason so dedupe stays a single index hit.
  "reason" text NOT NULL,
  -- 'sent' | 'failed'
  "status" text NOT NULL,
  "error" text,
  "attempted_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_alert_recipients_alert_idx"
  ON "email_delivery_alert_recipients" ("alert_id");
--> statement-breakpoint
-- Dedupe lookup: "did <email> in <company> get a successful <reason>
-- within the last N hours?" — covers the exact column order the evaluator
-- queries with.
CREATE INDEX IF NOT EXISTS "email_delivery_alert_recipients_dedupe_idx"
  ON "email_delivery_alert_recipients" ("company_id", "reason", "email", "attempted_at");
