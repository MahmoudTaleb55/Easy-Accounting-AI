-- Drop the workspace_members mirror so identity lives in one place.
--
-- Until 2026-04 `workspace_members` was kept around as a read-only mirror of
-- the canonical `memberships` table. The rbac middleware in `server/auth.ts`
-- upserted a row here for the signed-in user on every request so legacy
-- `req.member` consumers (and the `/api/auth/me` identity probe) didn't
-- have to do a second lookup. That was wasted work and a footgun: two
-- places to keep in sync if either schema ever drifted.
--
-- `req.member` is now projected in memory from `users` + `memberships` (see
-- `resolveCurrentMember` in server/auth.ts), so the mirror has no
-- remaining readers and can be dropped entirely.

DROP TABLE IF EXISTS workspace_members;
