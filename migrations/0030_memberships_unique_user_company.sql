-- 0030: enforce one membership row per (user, company).
--
-- SECURITY (scan finding, PRIVILEGE_ESCALATION): the authenticated
-- invitation-accept path does a non-atomic "getMembership then
-- createMembership if absent" check. Two concurrent accepts can both pass the
-- check and insert duplicate membership rows for the same (user, company).
-- Duplicates defeat member removal and role demotion (deleting/updating one
-- row leaves the other). A unique index makes the duplicate physically
-- impossible, so the race collapses into a harmless ON CONFLICT.
--
-- Step 1: collapse any pre-existing duplicates, keeping the oldest row per
-- (user_id, company_id). ctid is Postgres's physical row id — safe here as a
-- tiebreaker; we keep the earliest-created row and delete the rest.
DELETE FROM memberships m
USING memberships keep
WHERE m.user_id = keep.user_id
  AND m.company_id = keep.company_id
  AND m.ctid > keep.ctid;

-- Step 2: enforce uniqueness going forward. IF NOT EXISTS keeps this
-- migration (and the boot-time db:push) idempotent across re-runs.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_company_uq
  ON memberships (user_id, company_id);
