/**
 * Defense-in-depth coverage for `ensureEmailDeliveryAlertTablesOnStartup`
 * (server/auth/storage.ts), the boot-time helper invoked from
 * server/index.ts under `withRlsBypass("bootstrap:email-delivery-alert-tables")`.
 *
 * The helper re-stages the alert-pipeline DDL on every boot so a fresh
 * dev DB — and any deploy that boots ahead of the SQL migration runner —
 * still ends up with:
 *   - migration 0009: `email_delivery_alert_settings`,
 *     `email_delivery_alerts` and the two per-company indexes
 *   - migration 0011: `email_delivery_alert_recipients` and its
 *     `(company_id, reason, email, attempted_at)` dedupe index
 *   - migration 0013: the `cooldown_cleared_at` re-arm column on
 *     `email_delivery_alert_settings` (the one the owner-facing
 *     "Re-arm" button writes to)
 *
 * Until this spec landed the helper was only validated implicitly by
 * sibling specs that exercised the running app. A regression that
 * dropped one of the DDL fragments from the helper would silently slip
 * past those — the on-disk DB created by the migration runner already
 * has every fragment, so an in-app smoke test can't tell which side
 * (the runner or the bootstrapper) is doing the work. This spec rips
 * each fragment out of the database directly and re-invokes the
 * helper, so a future edit that forgets one is caught the moment it
 * lands.
 *
 * Why we drop + re-create against the live DB rather than a scratch
 * one: the helper uses `db.execute(...)` against the global
 * `server/db.ts` pool, which is wired to `DATABASE_URL` at module load
 * time and cannot be redirected after import without a refactor that
 * would itself need test coverage. The drop + restore window is tight
 * (one CREATE TABLE + two CREATE INDEX statements per fragment) and
 * the spec is registered as its own Playwright project that lists
 * every other alert-pipeline project as a dependency, so it only
 * starts after they finish — no sibling spec can be mid-query against
 * the table while we have it dropped.
 */

import { test, expect } from "@playwright/test";
import pg from "pg";
import { ensureEmailDeliveryAlertTablesOnStartup } from "../../server/auth/storage";
import { withRlsBypass, pool } from "../../server/db";

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the email-delivery-alert bootstrap spec.",
    );
  }
  return url;
}

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface ColumnMeta {
  data_type: string;
  is_nullable: string;
}

async function readColumnMeta(
  client: pg.Client,
  table: string,
  column: string,
): Promise<ColumnMeta | null> {
  const { rows } = await client.query<ColumnMeta>(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = $1
        AND column_name  = $2`,
    [table, column],
  );
  return rows[0] ?? null;
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = $1
     ) AS exists`,
    [table],
  );
  return rows[0]?.exists === true;
}

async function readIndexNames(
  client: pg.Client,
  table: string,
): Promise<string[]> {
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = $1
      ORDER BY indexname`,
    [table],
  );
  return rows.map((r) => r.indexname);
}

async function bootstrap(): Promise<void> {
  await withRlsBypass("test:eda-bootstrap", () =>
    ensureEmailDeliveryAlertTablesOnStartup(),
  );
}

// Serial within the file so the second test never sees a half-restored
// state from the first one. Both tests also run inside their own
// Playwright project (see playwright.config.ts) so no sibling project
// can race the drop + restore window.
test.describe.configure({ mode: "serial" });

test.describe("ensureEmailDeliveryAlertTablesOnStartup defense-in-depth @bootstrap", () => {
  test.afterAll(async () => {
    // Best-effort: re-run the helper on teardown so a mid-test failure
    // can't leave the live DB without the column or table that the
    // sibling alert specs depend on. Wrapped in try/catch because the
    // worker may already be shutting down.
    try {
      await bootstrap();
    } catch {
      /* noop — already torn down */
    }
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  });

  test("re-stages the cooldown_cleared_at column from migration 0013", async () => {
    // Sanity check — the helper is supposed to ensure this column
    // exists. If the precondition already fails the rest of the test
    // is meaningless.
    await bootstrap();

    await withClient(async (c) => {
      const before = await readColumnMeta(
        c,
        "email_delivery_alert_settings",
        "cooldown_cleared_at",
      );
      expect(
        before,
        "precondition: helper must have ensured cooldown_cleared_at exists",
      ).not.toBeNull();

      // Yank the column directly. Once committed the rest of the
      // process — including the helper's pool clients — sees the
      // missing column.
      await c.query(
        `ALTER TABLE "email_delivery_alert_settings" DROP COLUMN "cooldown_cleared_at"`,
      );

      const dropped = await readColumnMeta(
        c,
        "email_delivery_alert_settings",
        "cooldown_cleared_at",
      );
      expect(
        dropped,
        "drop must have succeeded — column should be gone before re-bootstrap",
      ).toBeNull();
    });

    // Re-invoke the helper exactly the way server/index.ts does on
    // boot: inside `withRlsBypass`. The helper is the only contract
    // under test here.
    await bootstrap();

    await withClient(async (c) => {
      const restored = await readColumnMeta(
        c,
        "email_delivery_alert_settings",
        "cooldown_cleared_at",
      );
      expect(
        restored,
        "helper must re-stage migration 0013 — cooldown_cleared_at should exist after re-bootstrap",
      ).not.toBeNull();
      // Migration 0013 declares the column as nullable `timestamp`.
      // Pin both facets so a future edit that swaps the type can't
      // silently slip through (e.g. `timestamptz` would change how
      // the evaluator compares it against `fired_at`).
      expect(
        restored!.data_type,
        "cooldown_cleared_at must remain a plain timestamp (matches the evaluator's comparison with fired_at)",
      ).toBe("timestamp without time zone");
      expect(
        restored!.is_nullable,
        "cooldown_cleared_at must remain nullable — the evaluator only treats the cooldown as cleared when it's non-null",
      ).toBe("YES");
    });

    // Helper must remain idempotent on the now-restored DB — a second
    // call from the same process must not throw. This is the same
    // contract every other 000X bootstrapper holds and is what lets
    // the boot path re-run without any "already exists" noise.
    await bootstrap();
  });

  test("re-stages the email_delivery_alert_recipients table + indexes from migration 0011", async () => {
    await bootstrap();

    // Capture the post-bootstrap state once so we can assert the
    // restored table matches it exactly. Drop with CASCADE so the
    // 0017 FK from `email_delivery_alert_recipients.alert_id` to
    // `email_delivery_alerts(id)` doesn't block the drop.
    let expectedIndexes: string[] = [];
    await withClient(async (c) => {
      expect(
        await tableExists(c, "email_delivery_alert_recipients"),
        "precondition: helper must have ensured email_delivery_alert_recipients exists",
      ).toBe(true);
      expectedIndexes = await readIndexNames(
        c,
        "email_delivery_alert_recipients",
      );
      // Both 0011 indexes (the `_alert_idx` lookup and the
      // `_dedupe_idx` 4-column dedupe key) plus the implicit primary
      // key index must be present.
      expect(
        expectedIndexes,
        "precondition: 0011 indexes should be in place before drop",
      ).toEqual(
        expect.arrayContaining([
          "email_delivery_alert_recipients_alert_idx",
          "email_delivery_alert_recipients_dedupe_idx",
        ]),
      );

      await c.query(
        `DROP TABLE IF EXISTS "email_delivery_alert_recipients" CASCADE`,
      );
      expect(
        await tableExists(c, "email_delivery_alert_recipients"),
        "drop must have succeeded — table should be gone before re-bootstrap",
      ).toBe(false);
    });

    await bootstrap();

    await withClient(async (c) => {
      expect(
        await tableExists(c, "email_delivery_alert_recipients"),
        "helper must re-stage migration 0011 — table should exist after re-bootstrap",
      ).toBe(true);

      const restoredIndexes = await readIndexNames(
        c,
        "email_delivery_alert_recipients",
      );
      // Same index set as before the drop. Asserts the helper
      // re-creates the lookup index AND the dedupe index — without
      // the latter, the per-address dedupe gate's lookup degrades
      // to a sequential scan on every alert sweep.
      expect(
        restoredIndexes,
        "every index that existed before the drop must be back",
      ).toEqual(expect.arrayContaining(expectedIndexes));

      // Spot-check the columns the dedupe gate and the recipients
      // roll-up read, so a future edit that drops one of them in
      // the helper's CREATE TABLE statement is caught here.
      const expectedColumns: Record<string, string> = {
        id: "character varying",
        alert_id: "character varying",
        company_id: "integer",
        email: "character varying",
        reason: "text",
        status: "text",
        error: "text",
        attempted_at: "timestamp without time zone",
      };
      for (const [column, dataType] of Object.entries(expectedColumns)) {
        const meta = await readColumnMeta(
          c,
          "email_delivery_alert_recipients",
          column,
        );
        expect(
          meta,
          `helper must re-create the ${column} column on the recipients table`,
        ).not.toBeNull();
        expect(
          meta!.data_type,
          `helper must re-create ${column} with the same type the dedupe / roll-up SQL expects`,
        ).toBe(dataType);
      }
    });

    // Idempotent re-run, same as the column case above.
    await bootstrap();
  });

  test("re-stages the dedupe_hours + retry_minutes columns from migration 0022", async () => {
    // Sanity check — the helper is supposed to ensure both columns
    // exist. If the precondition already fails the rest of the test
    // is meaningless.
    await bootstrap();

    await withClient(async (c) => {
      for (const column of ["dedupe_hours", "retry_minutes"]) {
        const before = await readColumnMeta(
          c,
          "email_delivery_alert_settings",
          column,
        );
        expect(
          before,
          `precondition: helper must have ensured ${column} exists`,
        ).not.toBeNull();
      }

      // Yank both columns directly. Once committed, the rest of the
      // process — including the helper's pool clients — sees them
      // missing, the same way a fresh dev DB / pre-migration boot
      // would.
      await c.query(
        `ALTER TABLE "email_delivery_alert_settings" DROP COLUMN "dedupe_hours"`,
      );
      await c.query(
        `ALTER TABLE "email_delivery_alert_settings" DROP COLUMN "retry_minutes"`,
      );

      for (const column of ["dedupe_hours", "retry_minutes"]) {
        const dropped = await readColumnMeta(
          c,
          "email_delivery_alert_settings",
          column,
        );
        expect(
          dropped,
          `drop must have succeeded — ${column} should be gone before re-bootstrap`,
        ).toBeNull();
      }
    });

    // Re-invoke the helper exactly the way server/index.ts does on
    // boot: inside `withRlsBypass`. The helper is the only contract
    // under test here.
    await bootstrap();

    await withClient(async (c) => {
      for (const column of ["dedupe_hours", "retry_minutes"]) {
        const restored = await readColumnMeta(
          c,
          "email_delivery_alert_settings",
          column,
        );
        expect(
          restored,
          `helper must re-stage migration 0022 — ${column} should exist after re-bootstrap`,
        ).not.toBeNull();
        // Migration 0022 declares both columns as nullable `integer`.
        // Pin both facets so a future edit that swaps the type (e.g.
        // to `numeric`) or drops the nullability (which would force
        // every workspace onto the per-workspace value and break the
        // env-var fallback the evaluator relies on) is caught here.
        expect(
          restored!.data_type,
          `${column} must remain a plain integer (the evaluator parses it as Number(...))`,
        ).toBe("integer");
        expect(
          restored!.is_nullable,
          `${column} must remain nullable — the evaluator falls back to the env var only when it's null`,
        ).toBe("YES");
      }
    });

    // Idempotent re-run, same as the column / table cases above.
    await bootstrap();
  });
});
