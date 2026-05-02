import { test, expect } from "@playwright/test";
import { checkMigrationsPrefix } from "../../scripts/check-migrations-prefix";

// CI wrapper for `scripts/check-migrations-prefix.ts`. The script is
// also invoked directly by `.husky/pre-commit`.
test("every migrations/*.sql file has a unique NNNN_ prefix", () => {
  const { files, unprefixed, collisions } = checkMigrationsPrefix();

  expect(files.length, "expected at least one migration file").toBeGreaterThan(
    0,
  );

  expect(
    unprefixed,
    `migration files must start with a 4-digit prefix: ${unprefixed.join(", ")}`,
  ).toEqual([]);

  const collisionLines = collisions.map(
    ({ prefix, files: names }) => `${prefix}: ${names.join(", ")}`,
  );
  expect(
    collisionLines,
    [
      "duplicate migration prefix(es) detected — the runner keys on the",
      "numeric prefix and will silently drop one of these files:",
      ...collisionLines.map((line) => `  - ${line}`),
    ].join("\n"),
  ).toEqual([]);
});
