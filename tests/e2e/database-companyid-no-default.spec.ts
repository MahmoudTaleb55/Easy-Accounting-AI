import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Generalised "missing-companyId fails closed" regression net.
 *
 * Tasks #70 and #91 added composite foreign keys that physically refuse
 * *cross*-workspace writes (a row in workspace A pointing at an id in
 * workspace B is rejected by the DB). They do not cover the *missing*-
 * companyId case: a route handler that simply forgets to set `companyId`
 * on a new row would still pass NOT NULL validation if the column had a
 * `DEFAULT 1`, and would silently land in workspace 1 — exactly the kind
 * of silent multi-tenant leak `database-fk-cross-workspace.spec.ts`
 * checks for the journal_lines case alone.
 *
 * This spec generalises that check. It walks every workspace-scoped
 * table programmatically by asking the database which public-schema
 * tables carry a `company_id` column, then asserts each one:
 *
 *   1. has `is_nullable = 'NO'`         (a missing value can't be NULL),
 *   2. has `column_default IS NULL`     (a missing value can't silently
 *                                        default to workspace 1).
 *
 * The two together force every insert site to supply `companyId`
 * explicitly. A forgetful route handler trips a NOT NULL violation
 * (SQLSTATE 23502) instead of leaking data into the wrong workspace.
 *
 * The spec also fences against scope drift in two directions:
 *
 *   - It explicitly anchors the well-known set of workspace-scoped
 *     tables (the ten tables migration 0014 hardened plus the eleven
 *     that were already default-free) so that if a future schema
 *     migration *renames* or *drops* `company_id` on one of them, the
 *     test fails loudly rather than silently passing on a smaller set.
 *
 *   - It treats any *new* table with a `company_id` column as in scope
 *     too. If someone adds a workspace-scoped table tomorrow without
 *     dropping the default, the test fails with that table named in the
 *     error message — without anyone having to update the allowlist.
 *
 * If this spec fails, the failure message lists exactly which tables
 * regressed on which rule, so the fix is unambiguous.
 *
 * Tagged @db so it can be filtered with the rest of the database-level
 * regression net.
 */

const DATABASE_URL = process.env.DATABASE_URL;

// The complete set of workspace-scoped tables we currently know about.
// Kept here as an anchor: if a future migration renames or drops
// `company_id` on one of these, the membership check below trips
// immediately rather than silently shrinking the test surface.
//
// Membership in this set is the single source of truth for "is this
// table workspace-scoped?" — keep it in sync with the schema. New
// workspace-scoped tables MUST be added here AND must satisfy the
// no-default + NOT NULL rule the test enforces.
const KNOWN_WORKSPACE_SCOPED = new Set<string>([
  // Hardened by migration 0014 (task #122):
  "accounts",
  "journal_entries",
  "transactions",
  "budgets",
  "settings",
  "employees",
  "attendance",
  "leaves",
  "payroll_runs",
  "chat_messages",
  // Already default-free before task #122:
  "journal_lines",
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
  "documents",
  // Hardened by migration 0016 (task #169) — gained a `company_id`
  // column and was brought under workspace_isolation RLS at the same
  // time. The migration adds the column nullably, backfills, then
  // SET NOT NULL — no DEFAULT, same shape as every other table above.
  "audit_log",
  // Auth / membership / invitations / email-delivery alerts. These
  // also carry `company_id` and have always been default-free.
  "memberships",
  "invitations",
  "email_delivery_alert_settings",
  "email_delivery_alerts",
  "email_delivery_alert_recipients",
]);

interface CompanyIdColumn {
  table_name: string;
  is_nullable: string; // 'YES' | 'NO'
  column_default: string | null;
}

test.describe("workspace-scoped tables require an explicit company_id @db", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — DB-level regression test cannot run",
  );

  let pool: pg.Pool;

  test.beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool?.end();
  });

  test("every public-schema table with a company_id column is NOT NULL with no default", async () => {
    const { rows } = await pool.query<CompanyIdColumn>(
      `SELECT c.table_name,
              c.is_nullable,
              c.column_default
         FROM information_schema.columns c
         JOIN information_schema.tables  t
           ON t.table_schema = c.table_schema
          AND t.table_name   = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name  = 'company_id'
          AND t.table_type   = 'BASE TABLE'
        ORDER BY c.table_name`,
    );

    // ----- (a) Discovery ----------------------------------------------------
    // The query must find at least the tables we know about. If it finds
    // fewer, a schema rename/drop has shrunk the protected surface.
    const discovered = new Set(rows.map((r) => r.table_name));
    const missingFromDiscovery = [...KNOWN_WORKSPACE_SCOPED].filter(
      (t) => !discovered.has(t),
    );
    expect(
      missingFromDiscovery,
      `These known workspace-scoped tables no longer expose a "company_id" ` +
        `column. Has the column been renamed or dropped? ` +
        `Missing: ${missingFromDiscovery.join(", ")}`,
    ).toEqual([]);

    // ----- (b) The actual rule ---------------------------------------------
    // For every discovered table (the well-known set + any new
    // workspace-scoped table someone adds tomorrow), the column must be
    // NOT NULL with no default. Collect failures into a readable list
    // rather than failing on the first one — the whole point of this
    // spec is to surface every regression at once.
    type Offender = { table: string; problem: string };
    const offenders: Offender[] = [];
    for (const row of rows) {
      if (row.is_nullable !== "NO") {
        offenders.push({
          table: row.table_name,
          problem: `is_nullable=${row.is_nullable} (must be NO)`,
        });
      }
      if (row.column_default !== null) {
        offenders.push({
          table: row.table_name,
          problem: `column_default=${row.column_default} (must be NULL — a ` +
            `default silently funnels missing-companyId writes into ` +
            `that workspace; see task #122)`,
        });
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : "Workspace-scoped tables that regress on the missing-" +
            "companyId rule (a missing value would silently default " +
            "instead of failing closed):\n" +
            offenders
              .map((o) => `  - ${o.table}: ${o.problem}`)
              .join("\n") +
            "\n\nFix: add `ALTER TABLE \"<table>\" ALTER COLUMN " +
            '"company_id" DROP DEFAULT` to a new migration and update ' +
            "`shared/schema.ts` to drop `.default(...)` from companyId.",
    ).toEqual([]);
  });

  // Behavioural sanity check: for a representative pair (one of the
  // tables migration 0014 hardened, plus one that's been default-free
  // since 0005), prove that omitting `company_id` actually trips a
  // not_null_violation (SQLSTATE 23502). The metadata-based check above
  // is the comprehensive net; this anchors the *meaning* of "no
  // default + NOT NULL" so the spec keeps its honest name even if
  // information_schema's contract ever changes under us.
  test("omitting company_id raises not_null_violation (representative behavioural anchor)", async () => {
    const client = await pool.connect();
    const tag = `db-noid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await client.query("BEGIN");
      // The spec writes across workspaces in setup, so explicitly
      // bypass the task-#93 RLS policies for the lifetime of this
      // transaction (mirrors the sibling DB-level FK spec).
      await client.query("SET LOCAL app.rls_bypass = 'on'");

      async function attempt(
        sql: string,
        params: unknown[],
      ): Promise<{ ok: true } | { ok: false; code: string }> {
        await client.query("SAVEPOINT s");
        try {
          await client.query(sql, params);
          await client.query("RELEASE SAVEPOINT s");
          return { ok: true };
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT s");
          const e = err as { code?: string };
          return { ok: false, code: e.code ?? "" };
        }
      }

      // -- accounts: hardened by migration 0014 (was DEFAULT 1 before) ------
      const r1 = await attempt(
        `INSERT INTO accounts (code, name_ar, name_en, type, subtype)
         VALUES ($1, 'a', 'a', 'asset', 'current_asset')`,
        [`A-${tag}`],
      );
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.code).toBe("23502");

      // -- journal_entries: hardened by migration 0014 (was DEFAULT 1) ------
      const r2 = await attempt(
        `INSERT INTO journal_entries (reference, description)
         VALUES ($1, 'no-cid')`,
        [`JE-${tag}`],
      );
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.code).toBe("23502");

      // -- documents: default-free since migration 0007 ---------------------
      const r3 = await attempt(
        `INSERT INTO documents (file_name, mime_type, size_bytes, storage_path, status)
         VALUES ('a.pdf', 'application/pdf', 1, '/p', 'extracting')`,
        [],
      );
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe("23502");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
