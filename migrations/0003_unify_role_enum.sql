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
-- The migration runner (`server/migrate.ts`) applies this file exactly once
-- per database via the `schema_migrations` ledger. Earlier revisions of this
-- project also re-ran the same UPDATEs from a `unifyRoleEnumOnStartup` boot
-- helper for belt-and-suspenders idempotency; that helper was retired in
-- task #165 once the runner had reliably superseded it. The UPDATEs above
-- remain idempotent on their own (a no-op once every legacy row has been
-- normalised), so re-running them by hand against an already-migrated DB is
-- safe.

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
