-- Restore the missing alert_id -> email_delivery_alerts(id) ON DELETE CASCADE
-- foreign key on email_delivery_alert_recipients.
--
-- The original migration (0011_email_delivery_alert_recipients.sql) declared
-- the column as
--   "alert_id" varchar NOT NULL REFERENCES "email_delivery_alerts"("id")
--                                ON DELETE CASCADE
-- but the deployed database is missing the constraint entirely (pg_constraint
-- only carries the table's primary key). The leading theory is that the
-- pre-runner bootstrap path created the table without the inline REFERENCES
-- clause; whatever the cause, the result is the same: deleting an alert
-- leaves its per-recipient delivery rows behind as orphans, which then
-- distort the dedupe gate's per-workspace recipient lookup and forced an
-- in-test `DELETE FROM email_delivery_alert_recipients` workaround in the
-- dedupe + retry e2e block (see tests/e2e/email-delivery-alerts.spec.ts).
--
-- This migration:
--   1. Deletes any pre-existing orphan recipient rows so the FK can be
--      added cleanly. These rows are unreachable through the normal app
--      surface anyway (the alert they reference no longer exists), so the
--      delete is data-preserving from the user's point of view.
--   2. Adds the missing FK with ON DELETE CASCADE, guarded by a
--      pg_constraint check so this migration is idempotent and so dev
--      databases that already happen to carry the constraint (because
--      `drizzle-kit push` re-derived it from shared/schema.ts) don't
--      double-create it.

-- 1. Clean up orphans -------------------------------------------------------

DELETE FROM "email_delivery_alert_recipients" r
 WHERE NOT EXISTS (
   SELECT 1 FROM "email_delivery_alerts" a
    WHERE a."id" = r."alert_id"
 );
--> statement-breakpoint

-- 2. Add the missing FK -----------------------------------------------------
-- The guard is scoped to `email_delivery_alert_recipients` (via `conrelid`)
-- and matches both the explicit constraint name we add here
-- (`*_alert_id_fk`) and the auto-generated name the inline REFERENCES
-- clause in 0011 would have produced if it had ever reached the deployed
-- DB (`*_alert_id_fkey`). Either being present on this table is treated
-- as "constraint already present" so we don't double-create on dev DBs
-- where `drizzle-kit push` has already materialised the FK from
-- shared/models/auth.ts. Restricting by `conrelid` avoids any theoretical
-- false positive from a same-named constraint on an unrelated table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"email_delivery_alert_recipients"'::regclass
       AND contype = 'f'
       AND conname IN (
         'email_delivery_alert_recipients_alert_id_fk',
         'email_delivery_alert_recipients_alert_id_fkey'
       )
  ) THEN
    ALTER TABLE "email_delivery_alert_recipients"
      ADD CONSTRAINT "email_delivery_alert_recipients_alert_id_fk"
      FOREIGN KEY ("alert_id")
      REFERENCES "email_delivery_alerts" ("id")
      ON DELETE CASCADE;
  END IF;
END $$;
