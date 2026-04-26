import { test, expect } from "@playwright/test";
import { checkRoleGuardCoverage } from "../../scripts/check-role-guard-coverage";

/**
 * CI wrapper for `scripts/check-role-guard-coverage.ts`. The script does
 * a static scan of `client/src/` for interactive test ids (button-, input-,
 * link-, select-, tab-) wrapped in <WriteGuard>, <OwnerGuard>, or
 * <OwnerOnly> and verifies each one is referenced by the role-based-buttons
 * spec for owner / accountant / viewer. Exposing it as a Playwright spec
 * lets the same `npx playwright test` command that runs the rest of the
 * e2e suite also enforce the coverage contract — same pattern as
 * `migrations-prefix.spec.ts`.
 *
 * No browser is required (the script reads files only), so the
 * `role-guard-coverage` workflow runs Playwright with
 * `PLAYWRIGHT_NO_WEBSERVER=1` and skips the global setup.
 */
test("every guarded interactive test id has owner/accountant/viewer spec coverage", () => {
  const { surfaces, missing } = checkRoleGuardCoverage();

  expect(
    surfaces.length,
    "expected at least one guarded interactive test id to be found in client/src/",
  ).toBeGreaterThan(0);

  const lines = missing.map((m) => {
    const tokens = m.surface.tokens.map((t) => `"${t}"`).join(", ");
    return [
      `  • ${m.surface.file}:${m.surface.line}`,
      `      <${m.surface.guard}> data-testid=${m.surface.testId}`,
      `      missing role coverage: ${m.missingRoles.join(", ")}`,
      `      spec must reference token(s): ${tokens}`,
    ].join("\n");
  });

  expect(
    missing,
    [
      `Found ${missing.length} guarded surface(s) without complete role`,
      "coverage in tests/e2e/role-based-buttons.spec.ts:",
      "",
      ...lines,
      "",
      "Add one assertion per role to tests/e2e/role-based-buttons.spec.ts so",
      "the new control is exercised under owner / accountant / viewer.",
    ].join("\n"),
  ).toEqual([]);
});
