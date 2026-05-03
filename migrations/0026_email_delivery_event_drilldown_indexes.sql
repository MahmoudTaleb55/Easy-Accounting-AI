-- Speed up the per-attempt event drilldown surfaced from the Members
-- page (and any future per-user password-reset history view).
--
-- Two storage helpers in `server/auth/storage.ts` walk every event row
-- for a parent and then sort by `created_at` in memory:
--
--   - `listInvitationEmailEvents(invitationId)` — backs
--     GET /api/auth/invitations/:id/events, which the Members UI hits
--     when an admin opens the "why did this fail?" drawer for an
--     invitation. A noisy invitation that picked up many resends and
--     dozens of webhook callbacks per resend can ship hundreds of rows
--     into that drawer, all of which the planner has to fetch by
--     `invitation_id` and then resort by `created_at DESC`.
--
--   - `listPasswordResetEmailEventsForUser(userId)` — fetches every
--     password-reset event for a single user across all of their
--     tokens, ORDER BY `created_at DESC`. Same shape as the invitation
--     case, same in-memory sort.
--
-- The single-column `*_inv_idx` / `*_user_idx` indexes already on
-- these tables only help the lookup half of the query; the planner
-- still has to materialise every matching row and resort it by
-- `created_at`. Adding (invitation_id, created_at DESC) and
-- (user_id, created_at DESC) composite indexes lets the planner
-- satisfy the ORDER BY directly off the index — the same trick the
-- (message_id, created_at) companion in migration 0012 played for the
-- unified email-delivery list query.
--
-- For clarity: the sibling `listEmailDeliveryEvents` (per-message
-- drilldown drawer on /settings/email-delivery) is *not* the function
-- this migration targets. That helper filters by `message_id` and is
-- already well-served by the `*_msg_created_idx` composite indexes
-- added in migration 0012.
--
-- Both indexes are also declared in shared/models/auth.ts so dev DBs
-- (which only see `drizzle-kit push` and never run this file) end up
-- with the same shape as production.

CREATE INDEX IF NOT EXISTS "invitation_email_events_inv_created_idx"
  ON "invitation_email_events" ("invitation_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "prt_email_events_user_created_idx"
  ON "password_reset_email_events" ("user_id", "created_at" DESC);
