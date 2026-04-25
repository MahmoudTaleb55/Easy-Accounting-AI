import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Task #139 — catch new workspace-scoped tables that forget RLS.
 *
 * The RLS bootstrap helper (`server/db-bootstrap-rls.ts`) hard-codes the
 * list of in-scope tables. If a future migration adds a new table with a
 * `company_id` column but the engineer forgets to add it to that list,
 * the table will silently leak across workspaces with no warning until a
 * user notices.
 *
 * The sibling `database-rls-cross-workspace.spec.ts` proves the policies
 * *behave* correctly, but only for the handful of tables it touches by
 * name (accounts, journal_entries, transactions). It cannot catch a brand
 * new tenant table because it doesn't know that table exists.
 *
 * This spec closes that loop. It walks every public-schema table that
 * exposes a `company_id` column and asserts that — unless the table is
 * on the documented opt-out list — it has both:
 *
 *   1. Row-level security ENABLED *and* FORCED (`pg_class.relrowsecurity`
 *      and `relforcerowsecurity` both true; FORCE matters because the
 *      `app_api` role is the table owner in our deploy environment and
 *      Postgres exempts owners from RLS by default).
 *   2. A policy named `workspace_isolation` registered in `pg_policies`
 *      (the single policy `migrations/0008_workspace_rls.sql` installs
 *      and the `database-rls-cross-workspace.spec.ts` exercises).
 *
 * The spec also fences against scope drift in two directions:
 *
 *   - It explicitly anchors the well-known set of RLS-protected tables
 *     (the 24 tables migration 0008 hardened) so that if a future
 *     schema migration *renames* or *drops* `company_id` on one of them
 *     — or if someone accidentally pulls one off the bootstrap list —
 *     the test fails loudly rather than silently shrinking the surface
 *     it covers.
 *
 *   - It treats any *new* table with a `company_id` column as in scope
 *     too. If someone adds a workspace-scoped table tomorrow without
 *     also adding it to `RLS_TABLES` in `server/db-bootstrap-rls.ts`,
 *     this spec fails with that table named in the error message —
 *     without anyone having to update the allowlist.
 *
 * The intentional opt-out list mirrors the "Tables intentionally out of
 * scope" section of `docs/design/workspace-isolation-defense-in-depth.md`:
 * auth / membership / invitation / email-delivery-alert tables are
 * deliberately read across workspaces by `attachMembership`, the
 * email-delivery alert sweep, and various owner-only admin routes —
 * putting them under RLS would force every auth lookup through bypass.
 *
 * Tagged @db so it can be filtered with the rest of the database-level
 * regression net.
 */

const DATABASE_URL = process.env.DATABASE_URL;

// Source of truth: every public-schema table that the bootstrap helper
// MUST harden with RLS + the `workspace_isolation` policy. Mirrors the
// `RLS_TABLES` constant in `server/db-bootstrap-rls.ts` and the
// `FOREACH t IN ARRAY ARRAY[…]` block in
// `migrations/0008_workspace_rls.sql`. Keep all three in sync.
const KNOWN_RLS_PROTECTED = new Set<string>([
  "accounts",
  "journal_entries",
  "journal_lines",
  "transactions",
  "budgets",
  "settings",
  "employees",
  "attendance",
  "leaves",
  "payroll_runs",
  "payroll_lines",
  "fx_rates",
  "asset_categories",
  "fixed_assets",
  "asset_components",
  "depreciation_runs",
  "depreciation_schedule",
  "depreciation_postings",
  "asset_usage_periods",
  "impairment_events",
  "revaluation_events",
  "disposals",
  "chat_messages",
  "documents",
  // Brought under RLS by task #169 (migration 0016) once `audit_log`
  // gained a `company_id` column. See
  // `docs/design/workspace-isolation-defense-in-depth.md`.
  "audit_log",
]);

// Tables that carry `company_id` but are deliberately *not* under RLS,
// per `docs/design/workspace-isolation-defense-in-depth.md` ("Tables
// intentionally out of scope"). Each entry MUST come with a justification
// — adding a new table here without one will not stop the spec from
// passing, but the comment requirement keeps reviewers honest.
const INTENTIONALLY_EXEMPT = new Set<string>([
  // Auth/membership tables: `attachMembership` resolves which workspaces
  // a freshly authenticated user has access to *before* a workspace
  // scope exists on the connection. Putting these under RLS would force
  // every login + invitation accept + admin-screen list through
  // `withRlsBypass`, which defeats the point of the bypass-as-exception
  // discipline.
  "memberships",
  "invitations",

  // Email-delivery alert pipeline: the cron sweep
  // (`evaluateEmailDeliveryAlerts*`) iterates every workspace's settings
  // + recent alerts in a single pass; the dedupe lookup on
  // alert_recipients is keyed by (company_id, reason, email, attempted_at)
  // and runs from a system-level context with no active company scope.
  // Same rationale as auth: bypass on every read would be more risk than
  // it removes.
  "email_delivery_alert_settings",
  "email_delivery_alerts",
  "email_delivery_alert_recipients",
]);

interface RlsRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: string; // pg returns BIGINT as string
}

test.describe("workspace-scoped tables must be under RLS @db", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — DB-level RLS coverage test cannot run",
  );

  let pool: pg.Pool;

  test.beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool?.end();
  });

  test("every public-schema table with company_id has RLS + workspace_isolation policy", async () => {
    // Discover every workspace-scoped table by introspection, then in the
    // same query pull `pg_class.relrowsecurity` / `relforcerowsecurity`
    // and the count of `workspace_isolation` policies in `pg_policies`.
    // One query so a future engineer can read what's being checked at a
    // glance.
    const { rows } = await pool.query<RlsRow>(
      `SELECT c.table_name,
              cls.relrowsecurity        AS rls_enabled,
              cls.relforcerowsecurity   AS rls_forced,
              (SELECT COUNT(*) FROM pg_policies p
                 WHERE p.schemaname = 'public'
                   AND p.tablename  = c.table_name
                   AND p.policyname = 'workspace_isolation') AS policy_count
         FROM information_schema.columns c
         JOIN information_schema.tables  t
           ON t.table_schema = c.table_schema
          AND t.table_name   = c.table_name
         JOIN pg_namespace ns
           ON ns.nspname = c.table_schema
         JOIN pg_class cls
           ON cls.relname = c.table_name
          AND cls.relnamespace = ns.oid
        WHERE c.table_schema = 'public'
          AND c.column_name  = 'company_id'
          AND t.table_type   = 'BASE TABLE'
        ORDER BY c.table_name`,
    );

    // ----- (a) Discovery anchor --------------------------------------------
    // Every well-known RLS-protected table must still expose a
    // `company_id` column. If one doesn't, a schema rename/drop has
    // shrunk the protected surface from underneath us — the bootstrap
    // helper would then no-op on a missing table and the test below
    // would silently pass on a smaller set.
    const discovered = new Set(rows.map((r) => r.table_name));
    const missingFromDiscovery = [...KNOWN_RLS_PROTECTED].filter(
      (t) => !discovered.has(t),
    );
    expect(
      missingFromDiscovery,
      `These known RLS-protected tables no longer expose a "company_id" ` +
        `column. Has the column been renamed or dropped? ` +
        `Missing: ${missingFromDiscovery.join(", ")}`,
    ).toEqual([]);

    // ----- (b) The actual rule ---------------------------------------------
    // For every discovered table that isn't on the documented opt-out
    // list, RLS must be both enabled and forced, and the
    // `workspace_isolation` policy must exist. Collect every failure into
    // a single readable list rather than failing on the first one — the
    // whole point of this spec is to surface every regression at once.
    type Offender = { table: string; problems: string[] };
    const offenders: Offender[] = [];
    for (const row of rows) {
      if (INTENTIONALLY_EXEMPT.has(row.table_name)) continue;

      const problems: string[] = [];
      if (!row.rls_enabled) {
        problems.push(
          `relrowsecurity=false (run ALTER TABLE "${row.table_name}" ` +
            `ENABLE ROW LEVEL SECURITY)`,
        );
      }
      if (!row.rls_forced) {
        problems.push(
          `relforcerowsecurity=false (run ALTER TABLE ` +
            `"${row.table_name}" FORCE ROW LEVEL SECURITY — without ` +
            `FORCE, the table owner bypasses the policy)`,
        );
      }
      if (Number(row.policy_count) === 0) {
        problems.push(
          `no policy named "workspace_isolation" on this table ` +
            `(install it via migrations/0008_workspace_rls.sql or the ` +
            `RLS_TABLES list in server/db-bootstrap-rls.ts)`,
        );
      }
      if (problems.length > 0) {
        offenders.push({ table: row.table_name, problems });
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : "Workspace-scoped tables that are missing RLS coverage " +
            "(a SELECT/UPDATE/DELETE that forgets WHERE company_id=… " +
            "would silently leak across tenants):\n" +
            offenders
              .map(
                (o) =>
                  `  - ${o.table}:\n` +
                  o.problems.map((p) => `      • ${p}`).join("\n"),
              )
              .join("\n") +
            "\n\nFix: add the table name to the `RLS_TABLES` constant " +
            "in `server/db-bootstrap-rls.ts` AND to the matching " +
            "ARRAY[…] in `migrations/0008_workspace_rls.sql`. If the " +
            "new table is genuinely meant to be readable across " +
            "workspaces (auth/membership-style), document the rationale " +
            "in `docs/design/workspace-isolation-defense-in-depth.md` " +
            "and add it to `INTENTIONALLY_EXEMPT` in this spec.",
    ).toEqual([]);

    // ----- (c) Cross-check the opt-out list isn't stale --------------------
    // Every table in INTENTIONALLY_EXEMPT must actually exist *and*
    // carry `company_id`. If a documented opt-out has been dropped or
    // renamed, the comment justifying its exemption now misleads the
    // next reviewer and should be cleaned up.
    const staleExemptions = [...INTENTIONALLY_EXEMPT].filter(
      (t) => !discovered.has(t),
    );
    expect(
      staleExemptions,
      `These tables are listed as intentionally exempt from RLS but no ` +
        `longer exist (or have lost their company_id column). Remove ` +
        `the stale entries from INTENTIONALLY_EXEMPT: ${staleExemptions.join(", ")}`,
    ).toEqual([]);
  });
});
