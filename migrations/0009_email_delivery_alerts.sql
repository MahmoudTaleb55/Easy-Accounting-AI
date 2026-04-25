-- Per-workspace alerting for email delivery failure spikes.
-- Backs the cron evaluator that watches `getEmailDeliveryFailureTrends` and
-- raises in-app banners (and optionally an email) when bounce / spam-report /
-- send-failed counts cross a configurable threshold.

CREATE TABLE IF NOT EXISTS "email_delivery_alert_settings" (
  "company_id" integer PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT true,
  "email_enabled" boolean NOT NULL DEFAULT false,
  "window_hours" integer NOT NULL DEFAULT 24,
  "absolute_threshold" integer NOT NULL DEFAULT 5,
  "ratio_threshold" numeric(5,4) NOT NULL DEFAULT 0.0200,
  "min_samples_for_ratio" integer NOT NULL DEFAULT 20,
  "cooldown_minutes" integer NOT NULL DEFAULT 360,
  "updated_at" timestamp DEFAULT now(),
  "updated_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_delivery_alerts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" integer NOT NULL,
  "fired_at" timestamp NOT NULL DEFAULT now(),
  "window_hours" integer NOT NULL,
  "failure_count" integer NOT NULL,
  "send_count" integer NOT NULL,
  "reason" text NOT NULL,
  "snapshot" jsonb,
  "email_sent" boolean NOT NULL DEFAULT false,
  "email_recipients" integer NOT NULL DEFAULT 0,
  "dismissed_at" timestamp,
  "dismissed_by_user_id" varchar
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_alerts_company_idx"
  ON "email_delivery_alerts" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_alerts_company_fired_idx"
  ON "email_delivery_alerts" ("company_id", "fired_at");
