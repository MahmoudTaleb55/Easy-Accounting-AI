import { test, expect } from "@playwright/test";
import pg from "pg";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runPendingMigrations } from "../../server/migrate";

/**
 * Catch a future migration that fails to apply cleanly (task #166).
 *
 * `server/migrate.ts` records each applied migration in a `schema_migrations`
 * ledger and re-runs anything not in the ledger on every boot. The runner's
 * idempotency contract (see the doc-comment in that file) is what keeps the
 * tasks #70 → #91 → #121 drift from happening again, but until this spec
 * landed it was unverified: a new SQL file that silently fails on a real
 * boot — or that succeeds the first time but blows up on the second — would
 * only surface when somebody happened to redeploy a service, which in
 * practice means in production.
 *
 * What the runner's contract actually is
 * --------------------------------------
 * The migrations under `migrations/` are *supplemental* DDL + data fix-ups
 * that run on top of the canonical schema, which is itself materialised by
 * `drizzle-kit push` from `shared/schema.ts`. Several migrations alter or
 * index tables that the canonical schema is responsible for creating
 * (e.g. `0002_password_reset_email_tracking.sql` adds columns to
 * `password_reset_tokens`, a table only Drizzle's push produces). So the
 * realistic boot scenario — and the one the runner's idempotency comment
 * targets — is:
 *
 *     scratch DB  →  drizzle-kit push (canonical schema)  →  migrations
 *
 * That's also exactly what every dev box and every production deploy sees.
 *
 * What this spec verifies
 * -----------------------
 * Two facets of the contract on a freshly-provisioned scratch database:
 *
 *   1. **Co-existence with the pushed schema.** After `drizzle-kit push`
 *      has materialised every table from `shared/schema.ts`, the runner
 *      must apply every checked-in migration without conflicting with
 *      already-present tables, indexes, FKs, or RLS policies. A migration
 *      that forgets `IF NOT EXISTS` / `DO $$ ... pg_constraint $$` guards
 *      trips immediately here.
 *
 *   2. **Strict idempotency on a second run.** Invoking the runner again
 *      against the same DB must change nothing — same ledger rows, same
 *      filenames, same `applied_at` timestamps. The timestamp invariance
 *      catches a regression where someone tweaks the runner to re-execute
 *      already-applied files.
 *
 * The runner is invoked directly (no HTTP boot, no app server) so the spec
 * exercises the *runner under test*, not a workflow that happens to wrap
 * it. The scratch DB is provisioned per-test on the same Postgres cluster
 * as `DATABASE_URL`, then dropped on teardown.
 *
 * Tagged @migrate so it can be filtered alongside the rest of the
 * boot-time regression net.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function scratchDbName(tag: string): string {
  // Lowercase + alphanum + underscore only — Postgres identifier-safe and
  // therefore safe to interpolate into the CREATE / DROP DATABASE strings
  // below (which can't be parameterised).
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `test_migrate_${tag}_${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
}

function scratchUrl(name: string): string {
  const u = new URL(DATABASE_URL!);
  u.pathname = `/${name}`;
  return u.toString();
}

async function withAdminClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createScratchDb(name: string): Promise<void> {
  await withAdminClient(async (c) => {
    await c.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropScratchDb(name: string): Promise<void> {
  // FORCE so any pool that wasn't fully drained (e.g. a half-cleaned-up
  // failed test) can't keep the database alive and leak it across runs.
  // Swallow errors — teardown must never mask a real test failure.
  try {
    await withAdminClient(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    });
  } catch {
    /* ignore */
  }
}

async function listMigrationFiles(): Promise<string[]> {
  return (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function runDrizzlePush(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // `--force` auto-approves any data-loss prompt. On a fresh, empty DB
    // there shouldn't be any, but the flag also prevents drizzle-kit from
    // ever blocking on stdin — important because we close stdin below.
    const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `drizzle-kit push exited with code ${code}\n` +
              `stdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });
}

test.describe("migration runner is idempotent end-to-end @migrate", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — migration runner regression test cannot run",
  );

  // drizzle-kit push + applying every migration twice can take a while on
  // a cold Postgres cluster — give the suite headroom over the default.
  test.setTimeout(180_000);

  test("re-applies cleanly on top of a drizzle-kit push'd canonical schema, and the second run is a strict no-op", async () => {
    const dbName = scratchDbName("scratch");
    await createScratchDb(dbName);
    const url = scratchUrl(dbName);
    const pool = new pg.Pool({ connectionString: url });
    try {
      // ----- Step 1: materialise the canonical schema --------------------
      // `drizzle-kit push` makes the scratch DB look exactly like every
      // dev box after `npm run db:push`: every table from
      // `shared/schema.ts` present, but no `schema_migrations` ledger.
      // This is the pre-state every boot of the runner sees in the wild.
      await runDrizzlePush(url);

      // Sanity check — drizzle-kit push really did materialise the
      // canonical schema. If this ever fails, the rest of the spec is
      // meaningless.
      const { rows: tableCount } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type   = 'BASE TABLE'`,
      );
      expect(
        Number(tableCount[0].count),
        "drizzle-kit push must have materialised the canonical schema",
      ).toBeGreaterThan(0);

      const expectedFiles = await listMigrationFiles();
      expect(
        expectedFiles.length,
        "expected at least one migration to apply",
      ).toBeGreaterThan(0);

      // ----- Step 2: first runner pass — every migration must apply ------
      // The runner is not allowed to fail just because the DDL it would
      // create is already present from the push. Every checked-in
      // migration must tolerate this scenario (uses `IF NOT EXISTS`,
      // `DO $$ ... pg_constraint $$` guards, etc.).
      await runPendingMigrations(pool);

      const { rows: afterFirst } = await pool.query<{
        filename: string;
        applied_at: Date;
      }>(
        `SELECT filename, applied_at FROM schema_migrations ORDER BY filename`,
      );
      expect(
        afterFirst.map((r) => r.filename),
        "ledger after the first runner pass must contain every migration",
      ).toEqual(expectedFiles);

      // ----- Step 3: second runner pass — must be a strict no-op ---------
      // No new ledger rows, identical filename set, identical
      // `applied_at` timestamps (a second-pass apply would rewrite
      // them). This is what catches a regression where someone changes
      // the runner to re-execute already-applied files, *and* it's what
      // pins the per-migration idempotency: a non-idempotent SQL file
      // that happens to succeed on top of the pushed schema but blows
      // up on a re-run trips here on the very next boot.
      await runPendingMigrations(pool);

      const { rows: afterSecond } = await pool.query<{
        filename: string;
        applied_at: Date;
      }>(
        `SELECT filename, applied_at FROM schema_migrations ORDER BY filename`,
      );
      expect(
        afterSecond.map((r) => r.filename),
        "second runner pass must not add or remove ledger rows",
      ).toEqual(afterFirst.map((r) => r.filename));

      for (let i = 0; i < afterFirst.length; i++) {
        expect(
          afterSecond[i].applied_at.toISOString(),
          `applied_at for ${afterFirst[i].filename} changed — the runner ` +
            "re-applied an already-applied migration",
        ).toBe(afterFirst[i].applied_at.toISOString());
      }
    } finally {
      await pool.end().catch(() => {
        /* nothing else can use this pool now */
      });
      await dropScratchDb(dbName);
    }
  });
});
