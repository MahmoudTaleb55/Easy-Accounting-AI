-- Unify the two role systems used by the app onto a single canonical enum.
--
-- Before: the per-company `memberships.role` column stored values from the
-- legacy 4-role enum (admin | accountant | reviewer | readonly), while the
-- workspace-mirror `workspace_members.role` and the rest of the UI gating
-- already used the 3-role enum (owner | accountant | viewer).
--
-- This migration retags every membership and pending invitation to the
-- canonical 3-role enum so the database, server, and client all speak the
-- same vocabulary. The mapping is:
--
--   admin    -> owner
--   reviewer -> viewer
--   readonly -> viewer
--   accountant -> accountant   (unchanged)
--
-- The same fix-up is also re-run idempotently from the server on each boot
-- (see `unifyRoleEnumOnStartup` in `server/auth/storage.ts`) so workspaces
-- restored from older backups are normalised automatically.

UPDATE memberships
   SET role = 'owner'
 WHERE role IN ('admin');

UPDATE memberships
   SET role = 'viewer'
 WHERE role IN ('reviewer', 'readonly');

UPDATE invitations
   SET role = 'owner'
 WHERE role IN ('admin');

UPDATE invitations
   SET role = 'viewer'
 WHERE role IN ('reviewer', 'readonly');
