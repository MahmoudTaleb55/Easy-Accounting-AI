#!/usr/bin/env tsx
/**
 * Static check: every `migrations/*.sql` file starts with a unique
 * 4-digit `NNNN_` prefix (the migration runner keys on that prefix
 * to order applies — a missing or duplicated one silently drops a
 * file from the run plan).
 *
 * Wraps the same invariants as `tests/e2e/migrations-prefix.spec.ts`
 * but runs without Playwright so the pre-commit hook can call it.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
export const PREFIX_RE = /^(\d{4})_/;

export interface MigrationsPrefixReport {
  files: string[];
  unprefixed: string[];
  collisions: Array<{ prefix: string; files: string[] }>;
}

export function checkMigrationsPrefix(): MigrationsPrefixReport {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const unprefixed = files.filter((name) => !PREFIX_RE.test(name));

  const byPrefix = new Map<string, string[]>();
  for (const name of files) {
    const match = name.match(PREFIX_RE);
    if (!match) continue;
    const prefix = match[1];
    const bucket = byPrefix.get(prefix) ?? [];
    bucket.push(name);
    byPrefix.set(prefix, bucket);
  }

  const collisions = [...byPrefix.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([prefix, names]) => ({ prefix, files: names }));

  return { files, unprefixed, collisions };
}

function formatReport(report: MigrationsPrefixReport): string | null {
  const errors: string[] = [];
  if (report.files.length === 0) {
    errors.push("expected at least one migration file under migrations/");
  }
  if (report.unprefixed.length > 0) {
    errors.push(
      `migration files must start with a 4-digit prefix: ${report.unprefixed.join(", ")}`,
    );
  }
  if (report.collisions.length > 0) {
    errors.push(
      [
        "duplicate migration prefix(es) detected — the runner keys on the",
        "numeric prefix and will silently drop one of these files:",
        ...report.collisions.map(
          ({ prefix, files }) => `  - ${prefix}: ${files.join(", ")}`,
        ),
      ].join("\n"),
    );
  }
  return errors.length > 0 ? errors.join("\n\n") : null;
}

export function runCheck(): { ok: boolean; message: string } {
  const report = checkMigrationsPrefix();
  const error = formatReport(report);
  if (error === null) {
    return {
      ok: true,
      message: `migrations-prefix OK — ${report.files.length} migration(s) all carry a unique NNNN_ prefix`,
    };
  }
  return { ok: false, message: error };
}

function isMain(): boolean {
  const entry = process.argv[1] ?? "";
  return (
    entry.endsWith("check-migrations-prefix.ts") ||
    entry.endsWith("check-migrations-prefix.js")
  );
}

if (isMain()) {
  const { ok, message } = runCheck();
  // eslint-disable-next-line no-console
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
