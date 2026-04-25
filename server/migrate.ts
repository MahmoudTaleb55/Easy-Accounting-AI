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
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pool } from "./db";

// `migrations/` always sits at the project root, and both `npm run dev`
// (`tsx server/index.ts`) and `npm start` (`node dist/index.cjs`) launch
// the process from there. We deliberately avoid `import.meta.url` /
// `__dirname` here because the production build is bundled to CommonJS
// (see `script/build.ts`), where `import.meta.url` is empty and
// `__dirname` would point inside `dist/`, not the repo root.
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

export async function runPendingMigrations(): Promise<void> {
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
