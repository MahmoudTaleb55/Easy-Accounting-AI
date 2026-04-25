-- Speed up the unified email-delivery feed's count endpoint.
--
-- /api/auth/email-deliveries/count runs the same UNION + DISTINCT ON
-- CTE as the list query on every (debounced) keystroke in the
-- recipient filter. On workspaces with months of history this can do
-- tens of thousands of row reads per call.
--
-- The dominant cost is the DISTINCT ON (transport, dedup_key) ORDER
-- BY transport, dedup_key, created_at DESC step. dedup_key is
-- COALESCE(message_id, 'attempt:'||id), so for the bulk of events
-- (those with a non-null provider message_id) a composite
-- (message_id, created_at) index lets the planner satisfy the
-- ordering directly instead of resorting the whole UNION.
--
-- A short server-side TTL cache in `countEmailDeliveriesForCompany`
-- collapses repeated probes for the same filter combo; this index
-- keeps the cold path (first probe per combo) under the ~50ms target
-- on a workspace with 100k+ events.

CREATE INDEX IF NOT EXISTS "invitation_email_events_msg_created_idx"
  ON "invitation_email_events" ("message_id", "created_at");

CREATE INDEX IF NOT EXISTS "prt_email_events_msg_created_idx"
  ON "password_reset_email_events" ("message_id", "created_at");
