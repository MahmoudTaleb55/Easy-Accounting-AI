import { test, expect } from "@playwright/test";
import {
  db,
  withCompanyScope,
  withUnscopedDb,
  __resetUnscopedDbWarningsForTesting,
} from "../../server/db";

/**
 * Runtime companion to `db-isolation-allowlist.spec.ts` (task #138 →
 * task #193).
 *
 * The static lint there pins the *set of files* that may import the
 * shared `db` handle. It does not — and structurally cannot — catch a
 * regression where an already-allowlisted file (e.g. `server/storage.ts`,
 * `server/insights.ts`, `server/auth/middleware.ts`) gains a *new* `db.`
 * call site that runs without `withCompanyScope` / `withRlsBypass` in
 * flight. The runtime guard inside `server/db.ts` closes that gap: the
 * first time each such call site issues a `db.` access, it logs a
 * one-line stack-trace warning. Production is exempt (the legitimate
 * pre-membership lookups in `server/auth/middleware.ts` would otherwise
 * spam the log on every request, and the same paths are already wrapped
 * in `withUnscopedDb` for an audit marker).
 *
 * This spec exercises the four contractual properties of the guard:
 *
 *   1. An unscoped `db.` access fires exactly one warning per unique
 *      call site (the dedup key is the offending stack frame).
 *   2. A second access from the *same* call site does not re-warn.
 *   3. A `db.` access made inside `withCompanyScope(...)` does not warn
 *      (the workspace scope is set).
 *   4. A `db.` access made inside `withUnscopedDb(reason, fn)` does not
 *      warn (the deliberate-cross-tenant marker is set).
 *
 * The guard runs only when `process.env.NODE_ENV !== "production"`.
 * Playwright workers run with NODE_ENV unset (or `"test"`), so the
 * warning code path is live in this spec.
 */

test.describe("workspace isolation runtime guard", () => {
  let originalWarn: typeof console.warn;
  let warnings: string[];

  test.beforeEach(() => {
    __resetUnscopedDbWarningsForTesting();
    warnings = [];
    originalWarn = console.warn;
    // eslint-disable-next-line no-console
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
  });

  test.afterEach(() => {
    // eslint-disable-next-line no-console
    console.warn = originalWarn;
  });

  test("unscoped db. access warns exactly once per call site", async () => {
    // Touch `db.select` from the same source line three times. The dedup
    // key is the offending stack frame, so all three accesses should
    // collapse to a single warning.
    for (let i = 0; i < 3; i++) {
      void db.select;
    }
    // A second touch from a *different* line is a different call site
    // and must produce its own warning.
    void db.insert;

    expect(
      warnings.length,
      `expected exactly 2 warnings (one per unique call site), got:\n` +
        warnings.join("\n---\n"),
    ).toBe(2);
    for (const w of warnings) {
      expect(w).toContain("[workspace-isolation] Unscoped db. call detected");
      // The warning carries a stack trace that points at the offending
      // file, so reviewers can navigate straight to the regression.
      expect(w).toContain("db-unscoped-runtime-guard.spec.ts");
    }
  });

  test("db. access inside withCompanyScope does not warn", async () => {
    // Use the existing test workspace path: any positive integer is
    // accepted by withCompanyScope, the actual GUC value isn't read by
    // this guard. We only need the AsyncLocalStorage slot populated.
    await withCompanyScope(1, async () => {
      void db.select;
      void db.insert;
      void db.update;
    });
    expect(warnings, `unexpected warnings: ${warnings.join("\n---\n")}`).toEqual([]);
  });

  test("db. access inside withUnscopedDb does not warn", async () => {
    await withUnscopedDb("test:audited-cross-tenant", async () => {
      void db.select;
      void db.insert;
    });
    expect(warnings, `unexpected warnings: ${warnings.join("\n---\n")}`).toEqual([]);
  });

  test("withUnscopedDb requires a non-empty reason", async () => {
    await expect(
      withUnscopedDb("", async () => undefined),
    ).rejects.toThrow(/reason is required/);
  });

  test("withUnscopedDb nested inside withCompanyScope preserves the outer scope", async () => {
    // A defensive contract: an inner `withUnscopedDb(...)` inside a
    // pre-existing workspace scope must not silently drop the scope.
    // The marker turns into a no-op (the outer scope still wins inside
    // `activeDb()`), and no warning fires either way.
    await withCompanyScope(1, async () => {
      await withUnscopedDb("test:nested-marker", async () => {
        void db.select;
        void db.update;
      });
      // After the inner block, the outer scope is still in flight.
      void db.insert;
    });
    expect(warnings, `unexpected warnings: ${warnings.join("\n---\n")}`).toEqual([]);
  });
});
