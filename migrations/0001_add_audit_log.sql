CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "action" text NOT NULL,
  "actor" text,
  "source" text DEFAULT 'user' NOT NULL,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");
