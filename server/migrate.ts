/**
 * SQL migration runner.
 *
 * Applies every `migrations/*.sql` file in alphabetical order on app boot,
 * exactly once, tracking what has run in a `schema_migrations` ledger table.
 *
 * Why this exists
 * ---------------
 * Until task #121 the project had a folder of migrations but no runner: each
 * SQL file had to be re-staged by a hand-rolled `*OnStartup` helper in
 * server/auth/storage.ts (or a sibling `db-bootstrap-*.ts` file) so dev
 * databases — which only ever see `drizzle-kit push` materialising the latest
 * schema from `shared/schema.ts` — actually got the migration's data fix-ups
 * and constraints. When migration 0005 shipped without such a helper the dev
 * DB silently drifted (see the breakage chain in tasks #70 -> #91).
 *
 * With this runner in place adding a new SQL migration is a one-step affair:
 * drop the file in `migrations/`, ship. The runner picks it up on the next
 * boot, applies it inside a transaction, and records the filename so it
 * never runs again.
 *
 * Idempotency contract
 * --------------------
 * Existing dev / prod databases that pre-date the runner won't have the
 * `schema_migrations` ledger, so the first boot under the new code will see
 * every historical migration as "pending". Every checked-in migration is
 * already idempotent (uses `IF NOT EXISTS`, `DO $$ ... pg_constraint` guards,
 * `DROP ... IF EXISTS`, etc.) precisely because the per-migration boot
 * helpers re-ran them on every restart. Re-running them once more from the
 * runner is therefore a no-op.
 *
 * Going forward, new migrations should keep that contract: write them so a
 * second execution against an already-migrated DB succeeds without errors.
 *
 * Renames and the ledger
 * ----------------------
 * Migrations are keyed in `schema_migrations` by their full filename, so
 * renumbering a file (e.g. `0014_foo.sql` -> `0016_foo.sql`, which task #164
 * had to do when two branches collided on prefix `0014`) leaves an orphan
 * row pointing at a filename that no longer exists on disk *and* makes the
 * runner re-apply the renamed file under its new name. Each migration is
 * idempotent so the re-apply is harmless, but the noisy "[migrate] applied"
 * log line and the lingering orphan row make it impossible to audit which
 * migrations actually shipped.
 *
 * The reconciliation pass below collapses these by trailing-slug match: an
 * orphan whose slug (filename minus the `NNNN_` prefix and `.sql` suffix)
 * matches a current file is treated as the same migration that was simply
 * renumbered, and the ledger entry is rewritten in place. If both rows
 * already exist (the rename happened on a deploy that pre-dated this code,
 * so the new name was re-applied) the orphan is deleted instead. Slugs are
 * unique by convention and that invariant is pinned by the
 * `migrations-prefix` and `migrations-runner` Playwright specs.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { pool as defaultPool } from "./db";

// Filename shape every checked-in migration must follow. The
// `migrations-prefix` spec pins the prefix uniqueness; the slug capture
// here is what the rename reconciliation matches on.
const MIGRATION_FILENAME_RE = /^(\d{4})_(.+)\.sql$/;

function slugOf(filename: string): string | null {
  const m = filename.match(MIGRATION_FILENAME_RE);
  return m ? m[2] : null;
}

/**
 * Reconcile ledger rows whose filename is no longer present on disk with a
 * current file that shares the same trailing slug. Exported for tests.
 *
 * Returns the per-orphan outcome so callers (and the test suite) can assert
 * what happened without scraping the console.
 */
export type ReconciliationOutcome =
  | { kind: "renamed"; from: string; to: string }
  | { kind: "dropped-duplicate"; orphan: string; current: string }
  | { kind: "unmatched"; orphan: string };

export async function reconcileRenamedMigrations(
  client: PoolClient,
  filesOnDisk: readonly string[],
): Promise<ReconciliationOutcome[]> {
  const onDisk = new Set(filesOnDisk);
  const slugToCurrent = new Map<string, string>();
  for (const f of filesOnDisk) {
    const slug = slugOf(f);
    if (slug !== null) slugToCurrent.set(slug, f);
  }

  const { rows: appliedRows } = await client.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`,
  );

  const outcomes: ReconciliationOutcome[] = [];
  for (const { filename } of appliedRows) {
    if (onDisk.has(filename)) continue;
    const slug = slugOf(filename);
    const current = slug !== null ? slugToCurrent.get(slug) : undefined;
    if (current === undefined) {
      outcomes.push({ kind: "unmatched", orphan: filename });
      continue;
    }

    // Try to rewrite the orphan row in place. The NOT EXISTS guard makes
    // this safe even if the new filename was already re-applied under the
    // post-rename name (which would have created a second ledger row);
    // in that case the UPDATE becomes a no-op and we drop the orphan.
    const updated = await client.query(
      `UPDATE schema_migrations
          SET filename = $1
        WHERE filename = $2
          AND NOT EXISTS (
            SELECT 1 FROM schema_migrations WHERE filename = $1
          )`,
      [current, filename],
    );
    if ((updated.rowCount ?? 0) > 0) {
      outcomes.push({ kind: "renamed", from: filename, to: current });
      console.log(
        `[migrate] reconciled renamed migration ${filename} -> ${current}`,
      );
    } else {
      await client.query(
        `DELETE FROM schema_migrations WHERE filename = $1`,
        [filename],
      );
      outcomes.push({
        kind: "dropped-duplicate",
        orphan: filename,
        current,
      });
      console.log(
        `[migrate] dropped orphan ledger row ${filename} ` +
          `(already collapsed into ${current})`,
      );
    }
  }

  for (const outcome of outcomes) {
    if (outcome.kind === "unmatched") {
      // No current file shares this slug. Don't delete blindly — surface
      // it so a human can decide whether the migration was intentionally
      // removed or whether the rename used a fresh slug (in which case
      // the operator should clean up by hand).
      console.warn(
        `[migrate] schema_migrations row ${outcome.orphan} has no ` +
          "matching file on disk — leaving it for manual review",
      );
    }
  }

  return outcomes;
}

// `migrations/` always sits at the project root, and both `npm run dev`
// (`tsx server/index.ts`) and `npm start` (`node dist/index.cjs`) launch
// the process from there. We deliberately avoid `import.meta.url` /
// `__dirname` here because the production build is bundled to CommonJS
// (see `script/build.ts`), where `import.meta.url` is empty and
// `__dirname` would point inside `dist/`, not the repo root.
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

export async function runPendingMigrations(pool: Pool = defaultPool): Promise<void> {
  const client = await pool.connect();
  try {
    // Bypass workspace RLS for the lifetime of this client. Most migrations
    // are pure DDL (which the connecting role bypasses anyway as table
    // owner) but a few do data fix-ups on RLS-enabled tables, and the policy
    // expressions short-circuit to "row visible" when this GUC is on.
    await client.query(`SET app.rls_bypass = 'on'`);

    // Bootstrap the ledger. The migration runner can't use a migration to
    // create its own ledger, so this one DDL stays inline. Idempotent.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamp NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    // Collapse any orphan ledger rows left behind by a renumbered
    // migration *before* we decide what's pending. Without this step the
    // new filename would be treated as a fresh migration and re-applied
    // (idempotent but noisy), and the orphan row would never go away.
    await reconcileRenamedMigrations(client, files);

    const { rows: appliedRows } = await client.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations`,
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) continue;
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sqlText = await fs.readFile(fullPath, "utf8");

      // Each migration runs in its own transaction so a partial failure
      // doesn't leave the DB half-migrated and doesn't get recorded as
      // applied. The `--> statement-breakpoint` markers Drizzle's CLI emits
      // are SQL line comments, so the file can be sent as a single
      // multi-statement query over the simple query protocol.
      await client.query("BEGIN");
      try {
        if (sqlText.trim().length > 0) {
          await client.query(sqlText);
        }
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)
           ON CONFLICT (filename) DO NOTHING`,
          [file],
        );
        await client.query("COMMIT");
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
          /* connection may be unusable; release will recycle it */
        });
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to apply migration ${file}: ${cause}`, {
          cause: err,
        });
      }
    }
  } finally {
    try {
      await client.query(`RESET app.rls_bypass`);
    } catch {
      /* ignore — releasing the client recycles its session anyway */
    }
    client.release();
  }
}
