import { test, expect } from "@playwright/test";
import pg from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Regression net for task #211 — the
 * `migrations/0018_backfill_reversal_company_stamps.sql` backfill that
 * stamps `{ field: 'companyId', to: <workspace_id> }` into
 * `audit_log.changes` for historical reversal rows whose
 * `reverseAutoPostedJournalEntry` predates the workspace-stamping
 * behaviour.
 *
 * Why a focused spec: the migration runner's idempotency net
 * (`migrations-runner.spec.ts`) already verifies that 0018 *applies*
 * cleanly on a scratch DB twice in a row, but doesn't peek inside the
 * `audit_log.changes` array to assert *what* the migration patches.
 * That is what this spec does: it stages a few legacy-shaped audit
 * rows, executes the migration's SQL directly against the live DB, and
 * asserts the stamp was added with the correct workspace id (and that
 * already-patched / unrelated rows are left alone).
 *
 * Executing the migration SQL directly (rather than re-running the
 * runner) is the right shape here because the runner is gated by the
 * `schema_migrations` ledger — the migration has already been applied
 * once in this DB, so a second runner pass would be a no-op and the
 * staged legacy rows would never be touched. The migration itself is
 * idempotent (every UPDATE is gated on `NOT EXISTS (... companyId ...)`)
 * so executing the SQL repeatedly is safe.
 *
 * The spec talks straight to Postgres via `pg.Client` and stages the
 * fixtures under `app.rls_bypass = 'on'` so the audit_log RLS policy
 * (installed by migration 0016) doesn't hide the staged rows. Each
 * stamped value is validated, then the staged rows are torn down.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "migrations",
  "0018_backfill_reversal_company_stamps.sql",
);

interface AuditChange {
  field: string;
  to?: unknown;
  from?: unknown;
}

async function pgConnect(): Promise<pg.Client> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  // Bypass workspace RLS for the lifetime of this client so the
  // staged audit_log writes (which we need to issue across two
  // hypothetical workspaces) and the ad-hoc selects against
  // payroll_runs / audit_log aren't filtered by `current_company_id()`.
  await client.query(`SET app.rls_bypass = 'on'`);
  return client;
}

async function readMigrationSql(): Promise<string> {
  return await fs.readFile(MIGRATION_FILE, "utf8");
}

interface StagedFixtures {
  companyAId: number;
  companyBId: number;
  payrollRunAId: number;
  /** legacy reversal audit row that joins back to a live source row */
  legacyWithLiveSourceId: number;
  /** legacy reversal audit row whose source row is gone (fallback path) */
  legacyOrphanReversalId: number;
  /** already-correctly-stamped row — must NOT be re-stamped */
  alreadyStampedId: number;
  /** plain JE update audit row — no `reversedBy`, must NOT be touched */
  unrelatedUpdateId: number;
}

async function stageFixtures(
  client: pg.Client,
  tag: string,
): Promise<StagedFixtures> {
  // Two scratch workspaces. Both must exist because audit_log.company_id
  // is NOT NULL since migration 0016 and the fallback path copies that
  // column verbatim.
  const compA = await client.query<{ id: number }>(
    `INSERT INTO companies (name, functional_currency, currency_symbol, is_default, is_active)
     VALUES ($1, 'USD', '$', false, true)
     RETURNING id`,
    [`Backfill Test A ${tag}`],
  );
  const compB = await client.query<{ id: number }>(
    `INSERT INTO companies (name, functional_currency, currency_symbol, is_default, is_active)
     VALUES ($1, 'USD', '$', false, true)
     RETURNING id`,
    [`Backfill Test B ${tag}`],
  );
  const companyAId = compA.rows[0].id;
  const companyBId = compB.rows[0].id;

  // Live source row in workspace A. The legacy "with live source" audit
  // row will reference this via `reversedBy: payroll_run#<id>`.
  const payRun = await client.query<{ id: number }>(
    `INSERT INTO payroll_runs
       (company_id, year, month, status, total_gross, total_net, journal_entry_id)
     VALUES ($1, 2099, 1, 'posted', '1000.00', '900.00', NULL)
     RETURNING id`,
    [companyAId],
  );
  const payrollRunAId = payRun.rows[0].id;

  // A high JE id that is guaranteed not to collide with anything real.
  // The audit rows reference it as the entity_id; we don't need a
  // matching row in journal_entries because the migration's joins are
  // (audit_log) -> (source-table), not (audit_log) -> (journal_entries).
  const fakeJeBase = 900_000_000 + (Date.now() & 0xffff);

  // 1. Legacy reversal audit row whose source row is still alive
  //    (workspace A). The migration's per-source UPDATE for
  //    payroll_runs should match this row by parsing
  //    `reversedBy = payroll_run#<payrollRunAId>` and copying
  //    `companies.id` from `payroll_runs.company_id`.
  const liveSrc = await client.query<{ id: number }>(
    `INSERT INTO audit_log
       (company_id, entity_type, entity_id, action, source, changes)
     VALUES ($1, 'journal_entry', $2, 'delete', 'system',
             jsonb_build_array(
               jsonb_build_object('field', 'description', 'from', 'Payroll', 'to', NULL),
               jsonb_build_object('field', 'reversedBy', 'to', $3::text)
             ))
     RETURNING id`,
    [companyAId, fakeJeBase + 1, `payroll_run#${payrollRunAId}`],
  );
  const legacyWithLiveSourceId = liveSrc.rows[0].id;

  // 2. Legacy reversal audit row whose source row is gone (workspace B).
  //    The per-source joins all miss because the referenced
  //    payroll_run id doesn't exist; the fallback step (final UPDATE
  //    in 0018) must copy `audit_log.company_id` into the stamp.
  const orphanSourceId = 999_999_999; // guaranteed not to exist in payroll_runs
  const orphan = await client.query<{ id: number }>(
    `INSERT INTO audit_log
       (company_id, entity_type, entity_id, action, source, changes)
     VALUES ($1, 'journal_entry', $2, 'delete', 'system',
             jsonb_build_array(
               jsonb_build_object('field', 'reversedBy', 'to', $3::text)
             ))
     RETURNING id`,
    [companyBId, fakeJeBase + 2, `payroll_run#${orphanSourceId}`],
  );
  const legacyOrphanReversalId = orphan.rows[0].id;

  // 3. Already-stamped reversal audit row in workspace A. The
  //    migration's NOT EXISTS guard must skip it — the existing stamp
  //    must be left exactly as-is and no second stamp must be appended.
  const alreadyStamped = await client.query<{ id: number }>(
    `INSERT INTO audit_log
       (company_id, entity_type, entity_id, action, source, changes)
     VALUES ($1, 'journal_entry', $2, 'delete', 'system',
             jsonb_build_array(
               jsonb_build_object('field', 'reversedBy', 'to', $3::text),
               jsonb_build_object('field', 'companyId', 'to', $1::integer)
             ))
     RETURNING id`,
    [companyAId, fakeJeBase + 3, `payroll_run#${payrollRunAId}`],
  );
  const alreadyStampedId = alreadyStamped.rows[0].id;

  // 4. Unrelated audit row — a plain JE update with no `reversedBy`.
  //    Must not be touched by any branch of the migration.
  const unrelated = await client.query<{ id: number }>(
    `INSERT INTO audit_log
       (company_id, entity_type, entity_id, action, source, changes)
     VALUES ($1, 'journal_entry', $2, 'update', 'user',
             jsonb_build_array(
               jsonb_build_object('field', 'description', 'from', 'old', 'to', 'new')
             ))
     RETURNING id`,
    [companyAId, fakeJeBase + 4],
  );
  const unrelatedUpdateId = unrelated.rows[0].id;

  return {
    companyAId,
    companyBId,
    payrollRunAId,
    legacyWithLiveSourceId,
    legacyOrphanReversalId,
    alreadyStampedId,
    unrelatedUpdateId,
  };
}

async function teardownFixtures(
  client: pg.Client,
  f: StagedFixtures,
): Promise<void> {
  // audit_log first (no FK back to companies but tidier this way), then
  // payroll_runs, then companies.
  await client.query(
    `DELETE FROM audit_log WHERE id = ANY($1::int[])`,
    [
      [
        f.legacyWithLiveSourceId,
        f.legacyOrphanReversalId,
        f.alreadyStampedId,
        f.unrelatedUpdateId,
      ],
    ],
  );
  await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [f.payrollRunAId]);
  await client.query(
    `DELETE FROM companies WHERE id = ANY($1::int[])`,
    [[f.companyAId, f.companyBId]],
  );
}

async function getChanges(
  client: pg.Client,
  auditId: number,
): Promise<AuditChange[]> {
  const r = await client.query<{ changes: AuditChange[] }>(
    `SELECT changes FROM audit_log WHERE id = $1`,
    [auditId],
  );
  if (r.rowCount === 0) throw new Error(`audit_log id ${auditId} not found`);
  return r.rows[0].changes ?? [];
}

function companyIdStamps(changes: AuditChange[]): AuditChange[] {
  return changes.filter((c) => c.field === "companyId");
}

test.describe("0018 backfills companyId stamps on legacy reversal audit rows @migrate", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — backfill spec needs Postgres access",
  );

  test("stamps live-source rows from the source table and orphan rows from audit_log.company_id", async () => {
    const client = await pgConnect();
    let fixtures: StagedFixtures | null = null;
    try {
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      fixtures = await stageFixtures(client, tag);

      // Sanity-check the staged shape — no legacy rows should carry a
      // `companyId` stamp before the migration runs.
      const beforeLive = await getChanges(client, fixtures.legacyWithLiveSourceId);
      const beforeOrphan = await getChanges(client, fixtures.legacyOrphanReversalId);
      expect(companyIdStamps(beforeLive)).toEqual([]);
      expect(companyIdStamps(beforeOrphan)).toEqual([]);

      // Apply the migration's SQL directly. The runner ledger has
      // already recorded 0018 from a prior boot, so re-invoking the
      // runner would be a no-op against the staged legacy rows.
      const sql = await readMigrationSql();
      await client.query(sql);

      // Assertion 1: live-source row stamped from payroll_runs.company_id
      // (not from audit_log.company_id) — both happen to equal companyAId
      // here, which is exactly what we want.
      const afterLive = await getChanges(client, fixtures.legacyWithLiveSourceId);
      const liveStamps = companyIdStamps(afterLive);
      expect(liveStamps, "live-source legacy row must gain exactly one companyId stamp")
        .toHaveLength(1);
      expect(liveStamps[0].to).toBe(fixtures.companyAId);
      // The original `reversedBy` and `description` fields must survive.
      expect(afterLive.find((c) => c.field === "reversedBy")?.to).toBe(
        `payroll_run#${fixtures.payrollRunAId}`,
      );
      expect(afterLive.find((c) => c.field === "description")).toBeTruthy();

      // Assertion 2: orphan row gets stamped from the fallback pass
      // (audit_log.company_id), which is companyBId.
      const afterOrphan = await getChanges(client, fixtures.legacyOrphanReversalId);
      const orphanStamps = companyIdStamps(afterOrphan);
      expect(orphanStamps, "orphan legacy row must gain exactly one companyId stamp")
        .toHaveLength(1);
      expect(orphanStamps[0].to).toBe(fixtures.companyBId);
      expect(afterOrphan.find((c) => c.field === "reversedBy")?.to).toBe(
        `payroll_run#999999999`,
      );

      // Assertion 3: already-stamped row is left alone — exactly one
      // companyId stamp must remain (the original), not two.
      const afterAlready = await getChanges(client, fixtures.alreadyStampedId);
      const alreadyStamps = companyIdStamps(afterAlready);
      expect(
        alreadyStamps,
        "already-stamped row must not gain a duplicate companyId stamp",
      ).toHaveLength(1);
      expect(alreadyStamps[0].to).toBe(fixtures.companyAId);

      // Assertion 4: an unrelated JE update audit row (no `reversedBy`)
      // must not be touched by any branch of the migration.
      const afterUnrelated = await getChanges(client, fixtures.unrelatedUpdateId);
      expect(companyIdStamps(afterUnrelated)).toEqual([]);
      expect(
        afterUnrelated.find((c) => c.field === "description")?.to,
        "unrelated audit row must be byte-identical after the migration runs",
      ).toBe("new");
    } finally {
      if (fixtures) await teardownFixtures(client, fixtures);
      await client.end();
    }
  });

  test("re-applying the migration is a no-op (idempotent)", async () => {
    const client = await pgConnect();
    let fixtures: StagedFixtures | null = null;
    try {
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      fixtures = await stageFixtures(client, tag);

      const sql = await readMigrationSql();
      await client.query(sql);
      const afterFirst = await getChanges(client, fixtures.legacyWithLiveSourceId);

      await client.query(sql);
      const afterSecond = await getChanges(client, fixtures.legacyWithLiveSourceId);

      // The change-set must be byte-identical between the first and the
      // second apply: the NOT EXISTS gate prevents a second stamp from
      // being appended.
      expect(afterSecond).toEqual(afterFirst);
      expect(companyIdStamps(afterSecond)).toHaveLength(1);
    } finally {
      if (fixtures) await teardownFixtures(client, fixtures);
      await client.end();
    }
  });
});
