-- Track delivery status for password-reset emails alongside invitations.

ALTER TABLE "password_reset_tokens"
  ADD COLUMN IF NOT EXISTS "last_message_id" varchar,
  ADD COLUMN IF NOT EXISTS "last_email_status" text,
  ADD COLUMN IF NOT EXISTS "last_email_error" text,
  ADD COLUMN IF NOT EXISTS "last_email_event_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prt_last_message_idx" ON "password_reset_tokens" ("last_message_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_email_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "message_id" varchar,
  "type" text NOT NULL,
  "error" text,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prt_email_events_token_idx" ON "password_reset_email_events" ("token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prt_email_events_user_idx" ON "password_reset_email_events" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prt_email_events_msg_idx" ON "password_reset_email_events" ("message_id");
