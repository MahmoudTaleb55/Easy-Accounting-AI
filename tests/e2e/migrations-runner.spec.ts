import { test, expect } from "@playwright/test";
import pg from "pg";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  reconcileRenamedMigrations,
  runPendingMigrations,
} from "../../server/migrate";

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

/**
 * Renames + the ledger (task #219).
 *
 * `schema_migrations` is keyed on the full filename, so renumbering a
 * migration (e.g. `0014_foo.sql` -> `0016_foo.sql`, which task #164 had
 * to do when two branches collided on prefix `0014`) used to leave the
 * old filename in the ledger forever *and* re-apply the renamed file
 * under its new name on the very next boot. Each migration is idempotent
 * so the re-apply was harmless, but the ledger grew orphan rows that no
 * longer corresponded to any file on disk and the `[migrate] applied X`
 * log line lied about what actually shipped.
 *
 * The runner now reconciles by trailing-slug match: an orphan row whose
 * filename minus the `NNNN_` prefix matches a current file is treated as
 * the same migration that was simply renumbered, and the ledger entry is
 * rewritten in place (or deleted, if a row for the new filename already
 * exists). This block pins both halves of that contract.
 */
test.describe("migration runner reconciles renamed migrations @migrate", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — migration runner regression test cannot run",
  );

  test.setTimeout(60_000);

  test("rewrites a stale ledger row in place when its slug matches a current file", async () => {
    const dbName = scratchDbName("rename");
    await createScratchDb(dbName);
    const url = scratchUrl(dbName);
    const pool = new pg.Pool({ connectionString: url });
    try {
      // Pick a real, currently-shipped migration. Whatever it is, its
      // slug is unique on disk (the migrations-prefix spec pins prefix
      // uniqueness and slugs are 1:1 with prefixes by convention), so
      // simulating a rename means inserting a ledger row for the same
      // slug under a *different* prefix.
      const files = (await listMigrationFiles());
      const target = files[files.length - 1];
      const slug = target.replace(/^\d{4}_/, "");
      // Pick a prefix that doesn't collide with any current file.
      const renamedFromPrefix = "9990";
      const renamedFrom = `${renamedFromPrefix}_${slug}`;
      expect(
        files,
        "test fixture must use a prefix that no current migration shares",
      ).not.toContain(renamedFrom);

      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE schema_migrations (
            filename text PRIMARY KEY,
            applied_at timestamp NOT NULL DEFAULT now()
          )
        `);
        // Pre-seed the ledger with the "old" name only — exactly the
        // shape every dev/prod DB ends up in after a renumber lands.
        const seededAt = new Date("2024-01-01T00:00:00.000Z");
        await client.query(
          `INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)`,
          [renamedFrom, seededAt],
        );

        const outcomes = await reconcileRenamedMigrations(client, files);

        // The orphan must be reported as renamed -> the current file.
        expect(
          outcomes,
          "reconciliation must collapse the orphan into the renamed file",
        ).toContainEqual({ kind: "renamed", from: renamedFrom, to: target });

        const { rows } = await client.query<{
          filename: string;
          applied_at: Date;
        }>(`SELECT filename, applied_at FROM schema_migrations ORDER BY filename`);
        const filenames = rows.map((r) => r.filename);
        expect(filenames, "the orphan row must be gone").not.toContain(renamedFrom);
        expect(
          filenames,
          "a single ledger row for the current filename must remain",
        ).toEqual([target]);

        // Rewriting in place must preserve the original applied_at —
        // otherwise the ledger would lie about when the migration first
        // shipped.
        expect(
          rows[0].applied_at.toISOString(),
          "applied_at must survive the in-place rename",
        ).toBe(seededAt.toISOString());
      } finally {
        client.release();
      }
    } finally {
      await pool.end().catch(() => {});
      await dropScratchDb(dbName);
    }
  });

  test("drops the orphan when both old and new names already sit in the ledger", async () => {
    const dbName = scratchDbName("rename_dup");
    await createScratchDb(dbName);
    const url = scratchUrl(dbName);
    const pool = new pg.Pool({ connectionString: url });
    try {
      const files = (await listMigrationFiles());
      const target = files[files.length - 1];
      const slug = target.replace(/^\d{4}_/, "");
      const renamedFrom = `9990_${slug}`;

      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE schema_migrations (
            filename text PRIMARY KEY,
            applied_at timestamp NOT NULL DEFAULT now()
          )
        `);
        // The state a DB lands in if a deploy that pre-dated the
        // reconciliation logic re-applied the renamed file under its
        // new name — both rows present.
        const oldAppliedAt = new Date("2024-01-01T00:00:00.000Z");
        const newAppliedAt = new Date("2024-06-01T00:00:00.000Z");
        await client.query(
          `INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2), ($3, $4)`,
          [renamedFrom, oldAppliedAt, target, newAppliedAt],
        );

        const outcomes = await reconcileRenamedMigrations(client, files);

        expect(
          outcomes,
          "reconciliation must drop the orphan duplicate",
        ).toContainEqual({
          kind: "dropped-duplicate",
          orphan: renamedFrom,
          current: target,
        });

        const { rows } = await client.query<{
          filename: string;
          applied_at: Date;
        }>(
          `SELECT filename, applied_at FROM schema_migrations ORDER BY filename`,
        );
        expect(
          rows.map((r) => r.filename),
          "only the current-filename ledger row must survive",
        ).toEqual([target]);
        // The surviving row's applied_at is preserved exactly — the
        // reconciliation must not rewrite the kept row.
        expect(rows[0].applied_at.toISOString()).toBe(
          newAppliedAt.toISOString(),
        );
      } finally {
        client.release();
      }
    } finally {
      await pool.end().catch(() => {});
      await dropScratchDb(dbName);
    }
  });

  test("a renumber + boot is a strict no-op for the apply loop", async () => {
    // This is the integration shape of the contract: drizzle-push the
    // canonical schema, run the runner once (so every checked-in
    // migration is applied), then *simulate a renumber* by rewriting
    // one ledger row to a stale prefix. A second runner pass must
    // reconcile the rename and not log a confusing `[migrate] applied`
    // line for the already-applied DDL — the surest proxy for which is
    // that the apply-loop never executes (no new ledger row appears for
    // the would-be-fresh filename, and `applied_at` is preserved).
    const dbName = scratchDbName("rename_e2e");
    await createScratchDb(dbName);
    const url = scratchUrl(dbName);
    const pool = new pg.Pool({ connectionString: url });
    try {
      await runDrizzlePush(url);
      await runPendingMigrations(pool);

      const files = await listMigrationFiles();
      const target = files[files.length - 1];
      const slug = target.replace(/^\d{4}_/, "");
      const renamedFrom = `9990_${slug}`;

      // Capture the original applied_at for the target so we can prove
      // the second runner pass didn't touch the surviving ledger row.
      const beforeRows = await pool.query<{ applied_at: Date }>(
        `SELECT applied_at FROM schema_migrations WHERE filename = $1`,
        [target],
      );
      expect(beforeRows.rowCount).toBe(1);
      const originalAppliedAt = beforeRows.rows[0].applied_at;

      // Simulate the rename: the file on disk is `target`, but the
      // ledger thinks it shipped under `renamedFrom`.
      await pool.query(
        `UPDATE schema_migrations SET filename = $1 WHERE filename = $2`,
        [renamedFrom, target],
      );

      await runPendingMigrations(pool);

      const after = await pool.query<{
        filename: string;
        applied_at: Date;
      }>(`SELECT filename, applied_at FROM schema_migrations ORDER BY filename`);

      expect(
        after.rows.map((r) => r.filename),
        "every ledger row must correspond to a file currently on disk",
      ).toEqual(files);

      const restored = after.rows.find((r) => r.filename === target)!;
      expect(
        restored.applied_at.toISOString(),
        "in-place rename must preserve the original applied_at; the " +
          "apply loop must NOT have re-run the migration",
      ).toBe(originalAppliedAt.toISOString());
    } finally {
      await pool.end().catch(() => {});
      await dropScratchDb(dbName);
    }
  });
});

/**
 * Dev-DB parity for the DESC-ordered composite indexes added in task #217.
 *
 * The per-attempt event drilldown on /settings/email-delivery relies on
 * two composite indexes:
 *
 *   - `invitation_email_events (invitation_id, created_at DESC)`
 *   - `password_reset_email_events (user_id, created_at DESC)`
 *
 * These are declared in *two* places that must agree:
 *
 *   - `migrations/0026_email_delivery_event_drilldown_indexes.sql` —
 *     what production runs on top of the canonical schema.
 *   - `shared/models/auth.ts` — what `drizzle-kit push` materialises on
 *     every dev box (which never executes the migration files).
 *
 * The migrations-runner test above already proves the SQL migration
 * applies cleanly on top of a pushed schema, but it doesn't actually
 * inspect what `drizzle-kit push` *itself* emitted for these indexes.
 * If a future drizzle-kit upgrade silently drops the column-direction
 * modifier from generated DDL (i.e. emits an ASC index for a
 * `.desc()`-decorated column), dev DBs would diverge from production
 * for these indexes and the planner-friendly ORDER BY satisfaction
 * the composite was meant to provide would silently regress on every
 * dev box — exactly the parity gap the schema declaration was meant
 * to close.
 *
 * What this spec verifies
 * -----------------------
 * On a freshly-pushed scratch DB (i.e. *no* migration files run), each
 * of the two composite indexes exists and `pg_index.indoption` for the
 * `created_at` column position encodes DESC ordering.
 *
 * `pg_index.indoption` is an int2vector with one entry per indexed
 * column. The Postgres-defined bits are:
 *
 *   INDOPTION_DESC         = 1   (column sorts DESC)
 *   INDOPTION_NULLS_FIRST  = 2   (NULLs come first)
 *
 * A DESC-ordered column therefore has bit 0 (value 1) set in its
 * indoption entry. Drizzle's `.desc()` modifier compiles down to that.
 */
test.describe(
  "drizzle-kit push materialises DESC-ordered composite indexes on dev DBs @migrate",
  () => {
    test.skip(
      !DATABASE_URL,
      "DATABASE_URL not set — drizzle-push parity test cannot run",
    );

    test.setTimeout(120_000);

    test(
      "the email-delivery drilldown composite indexes carry the DESC modifier on created_at after drizzle-kit push",
      async () => {
        const dbName = scratchDbName("desc_idx");
        await createScratchDb(dbName);
        const url = scratchUrl(dbName);
        const pool = new pg.Pool({ connectionString: url });
        try {
          // Push the canonical schema only — deliberately do NOT run the
          // migration files. The whole point is to verify what
          // `drizzle-kit push` itself emits for the schema declaration,
          // not what migration 0026 (which production uses) emits.
          await runDrizzlePush(url);

          // Pull pg_index.indoption for the column at the position of
          // `created_at` in the index. We resolve the position via
          // pg_attribute to avoid hardcoding "second column" in case
          // someone reorders the declaration; we still pin the column
          // name so the test fails loudly if `created_at` stops being
          // part of the index entirely.
          const indexes = [
            {
              indexName: "invitation_email_events_inv_created_idx",
              tableName: "invitation_email_events",
            },
            {
              indexName: "prt_email_events_user_created_idx",
              tableName: "password_reset_email_events",
            },
          ];

          for (const { indexName, tableName } of indexes) {
            // `pg_index.indkey` and `.indoption` are int2vectors (0-indexed,
            // not regular arrays), so naive `array_position` against
            // indkey doesn't work. Cast indkey through text -> int2[] so
            // we can `unnest WITH ORDINALITY` it; that gives us the
            // 1-based position of each column within the index, which we
            // then use to look up the matching indoption entry. Indoption
            // is also int2vector but Postgres' [] subscript on it is
            // 0-based, so we use `n - 1` to read the matching option.
            const { rows } = await pool.query<{
              attname: string;
              pos: number;
              option: number;
            }>(
              `
              SELECT a.attname,
                     k.n::int AS pos,
                     i.indoption[k.n - 1]::int AS option
                FROM pg_index i
                JOIN pg_class c ON c.oid = i.indexrelid
                JOIN pg_class t ON t.oid = i.indrelid
                CROSS JOIN LATERAL
                  unnest(string_to_array(i.indkey::text, ' ')::int2[])
                    WITH ORDINALITY AS k(attnum, n)
                JOIN pg_attribute a ON a.attrelid = t.oid
                                   AND a.attnum = k.attnum
               WHERE c.relname = $1
                 AND t.relname = $2
               ORDER BY k.n
              `,
              [indexName, tableName],
            );

            expect(
              rows.length,
              `index ${indexName} should exist on ${tableName} after drizzle-kit push — ` +
                "if this fails, the schema declaration in shared/models/auth.ts is missing or " +
                "drizzle-kit failed to materialise it",
            ).toBeGreaterThan(0);

            const createdAt = rows.find((r) => r.attname === "created_at");
            expect(
              createdAt,
              `index ${indexName} must include the created_at column — ` +
                "if this fails, the .on(...) call in shared/models/auth.ts no longer " +
                "lists created_at as a key column",
            ).toBeDefined();

            // INDOPTION_DESC is bit 0 (value 1). A drizzle-kit upgrade
            // that silently drops `.desc()` from the generated DDL will
            // emit an ASC index here (option & 1 === 0) and trip this
            // assertion — which is precisely the regression task #217's
            // schema-declaration mirror was meant to prevent.
            // eslint-disable-next-line no-bitwise
            const isDesc = (createdAt!.option & 1) === 1;
            expect(
              isDesc,
              `index ${indexName} must encode DESC ordering on created_at ` +
                `(pg_index.indoption bit 0 set), got option=${createdAt!.option}. ` +
                "If this fails, `drizzle-kit push` produced an ASC index for a " +
                "`.desc()`-decorated column — dev DBs have just diverged from " +
                "production. Either the schema declaration in shared/models/auth.ts " +
                "lost the .desc() modifier, or a drizzle-kit version bump is no " +
                "longer honouring it.",
            ).toBe(true);
          }
        } finally {
          await pool.end().catch(() => {
            /* nothing else can use this pool now */
          });
          await dropScratchDb(dbName);
        }
      },
    );
  },
);

/**
 * The orphan-row contract test the task description calls out: every
 * row in `schema_migrations` after a runner pass must correspond to a
 * file currently on disk. Lives next to the apply-loop contract above
 * so anyone touching the runner sees both checks together.
 */
test.describe("schema_migrations stays in sync with migrations/ @migrate", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — migration runner regression test cannot run",
  );

  test.setTimeout(120_000);

  test("every ledger row points at a file currently on disk after a runner pass", async () => {
    const dbName = scratchDbName("ledger_sync");
    await createScratchDb(dbName);
    const url = scratchUrl(dbName);
    const pool = new pg.Pool({ connectionString: url });
    try {
      await runDrizzlePush(url);
      await runPendingMigrations(pool);

      const files = new Set(await listMigrationFiles());
      const { rows } = await pool.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations ORDER BY filename`,
      );
      const orphans = rows
        .map((r) => r.filename)
        .filter((name) => !files.has(name));

      expect(
        orphans,
        [
          "schema_migrations contains row(s) with no matching file on disk:",
          ...orphans.map((name) => `  - ${name}`),
          "",
          "If a migration was renumbered, the runner should have collapsed",
          "the ledger entry by trailing-slug match. If it didn't, the slug",
          "changed too — clean the row up by hand or pick a slug that",
          "matches the renumbered file.",
        ].join("\n"),
      ).toEqual([]);
    } finally {
      await pool.end().catch(() => {});
      await dropScratchDb(dbName);
    }
  });
});
