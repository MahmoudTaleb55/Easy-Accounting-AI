-- 0008_workspace_rls.sql
--
-- Task #93: enable Postgres row-level security on every high-risk
-- workspace-scoped table so a SELECT / UPDATE / DELETE that "forgets"
-- WHERE company_id = … returns / touches zero rows of another tenant's data
-- instead of silently leaking.
--
-- The application puts the active workspace on the connection by running
--   SET app.current_company_id = $companyId
-- inside `withCompanyScope` (server/db.ts) for every authenticated request.
-- Boot helpers and periodic sweeps that legitimately need to read across
-- workspaces wrap themselves in `withRlsBypass(reason, …)`, which sets
--   SET app.rls_bypass = 'on'
-- on a fresh checked-out client. Both GUCs are RESET on release.
--
-- See docs/design/workspace-isolation-defense-in-depth.md for the full
-- decision record.

-- ---------------------------------------------------------------------------
-- Application role: a non-superuser role that the request middleware
-- temporarily switches into via `SET ROLE app_api` for the duration of every
-- /api/* request (see `withCompanyScope` in server/db.ts). Superusers bypass
-- RLS regardless of FORCE ROW LEVEL SECURITY, so without this role-drop the
-- policies below would never fire.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
END $$;

-- Let the connecting (superuser) role assume app_api on demand. GRANT is
-- idempotent for the same grantee so re-runs are safe.
DO $$
BEGIN
  EXECUTE format('GRANT app_api TO %I', current_user);
END $$;

-- DML on every existing table + sequence usage.
GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_api;

-- Future tables created by `db:push` / migrations inherit the same grants so
-- new schema additions don't silently lock the API role out.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_api;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Use NULLIF + the `missing_ok = true` second argument so that an unset GUC
-- evaluates to NULL (not an error) and an empty-string GUC also normalises
-- to NULL. The policies below treat NULL as "no active workspace" and hide
-- every row.
CREATE OR REPLACE FUNCTION current_company_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::integer;
$$;

CREATE OR REPLACE FUNCTION rls_is_bypassed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.rls_bypass', true) = 'on';
$$;

GRANT EXECUTE ON FUNCTION current_company_id() TO app_api;
GRANT EXECUTE ON FUNCTION rls_is_bypassed() TO app_api;

-- ---------------------------------------------------------------------------
-- Per-table policy: enable RLS, FORCE it (the API role is the table owner in
-- our deploy environment, and Postgres exempts owners from RLS by default),
-- then install a single workspace_isolation policy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts',
    'journal_entries',
    'journal_lines',
    'transactions',
    'budgets',
    'settings',
    'employees',
    'attendance',
    'leaves',
    'payroll_runs',
    'payroll_lines',
    'fx_rates',
    'asset_categories',
    'fixed_assets',
    'asset_components',
    'depreciation_runs',
    'depreciation_schedule',
    'depreciation_postings',
    'asset_usage_periods',
    'impairment_events',
    'revaluation_events',
    'disposals',
    'chat_messages',
    'documents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I
         USING      (rls_is_bypassed() OR company_id = current_company_id())
         WITH CHECK (rls_is_bypassed() OR company_id = current_company_id())',
      t
    );
  END LOOP;
END $$;
