import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
const PREFIX_RE = /^(\d{4})_/;

test("every migrations/*.sql file has a unique NNNN_ prefix", () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  expect(files.length, "expected at least one migration file").toBeGreaterThan(0);

  const unprefixed = files.filter((name) => !PREFIX_RE.test(name));
  expect(
    unprefixed,
    `migration files must start with a 4-digit prefix: ${unprefixed.join(", ")}`,
  ).toEqual([]);

  const byPrefix = new Map<string, string[]>();
  for (const name of files) {
    const prefix = name.match(PREFIX_RE)![1];
    const bucket = byPrefix.get(prefix) ?? [];
    bucket.push(name);
    byPrefix.set(prefix, bucket);
  }

  const collisions = [...byPrefix.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([prefix, names]) => `${prefix}: ${names.join(", ")}`);

  expect(
    collisions,
    [
      "duplicate migration prefix(es) detected — the runner keys on the",
      "numeric prefix and will silently drop one of these files:",
      ...collisions.map((line) => `  - ${line}`),
    ].join("\n"),
  ).toEqual([]);
});
