import { test, expect } from "@playwright/test";
import {
  checkReversalStampBackfillCoverage,
  parseUnionMembers,
  findBackfillBranches,
  formatFailure,
  OPT_OUT_MARKER,
  UNION_NAME,
} from "../../scripts/check-reversal-stamp-backfill-coverage";

/**
 * CI wrapper for `scripts/check-reversal-stamp-backfill-coverage.ts`.
 *
 * The script is the source of truth for the static check (task #265):
 * every member of `JournalEntrySourceKind` in `server/storage.ts` must
 * either have a per-source UPDATE branch in some
 * `migrations/*backfill_reversal_company_stamps*.sql` file, or carry an
 * inline `// reversal-backfill-opt-out: <reason>` comment justifying
 * why no backfill is needed.
 *
 * Same shape as `tests/e2e/role-guard-coverage.spec.ts` and
 * `tests/e2e/migrations-prefix.spec.ts`: a Playwright spec wrapping a
 * pure-Node script, runnable under `PLAYWRIGHT_NO_WEBSERVER=1` so the
 * `reversal-stamp-backfill-coverage` workflow doesn't need the dev
 * server or a Postgres connection.
 *
 * In addition to the live coverage check, we also exercise the script's
 * parsing helpers against synthetic inputs so a regression in the regex
 * (e.g. a developer reformatting `JournalEntrySourceKind` and breaking
 * the parser) surfaces here instead of as a silent always-pass.
 */
test.describe("@migrate reversal-stamp backfill coverage", () => {
  test("every JournalEntrySourceKind member has per-source coverage or a documented opt-out", () => {
    const report = checkReversalStampBackfillCoverage();

    expect(
      report.members.length,
      `expected ${UNION_NAME} to have at least one member`,
    ).toBeGreaterThan(0);
    expect(
      report.backfillFiles.length,
      "expected at least one migrations/*backfill_reversal_company_stamps*.sql file",
    ).toBeGreaterThan(0);

    expect(
      report.uncovered,
      report.uncovered.length === 0
        ? ""
        : `\n${formatFailure(report)}\n`,
    ).toEqual([]);
  });

  test("parseUnionMembers extracts each kind and reads its inline opt-out marker", () => {
    const synthetic = [
      "// preamble",
      "export type JournalEntrySourceKind =",
      '  | "alpha"',
      '  | "beta" // reversal-backfill-opt-out: added after stamping was reliable',
      '  | "gamma";',
      "",
      "export const other = 1;",
    ].join("\n");

    const members = parseUnionMembers(synthetic);
    expect(members.map((m) => m.kind)).toEqual(["alpha", "beta", "gamma"]);

    const alpha = members.find((m) => m.kind === "alpha")!;
    const beta = members.find((m) => m.kind === "beta")!;
    const gamma = members.find((m) => m.kind === "gamma")!;
    expect(alpha.optOutReason).toBeNull();
    expect(beta.optOutReason).toContain("after stamping was reliable");
    expect(gamma.optOutReason).toBeNull();

    // The terminating semicolon must be on the last member's line.
    expect(gamma.line).toBeGreaterThan(beta.line);
  });

  test("parseUnionMembers throws when the union declaration is missing", () => {
    expect(() => parseUnionMembers("// nothing to see here\n")).toThrow(
      /JournalEntrySourceKind/,
    );
  });

  test("findBackfillBranches surfaces every shipped per-source branch", () => {
    const { files, branches } = findBackfillBranches();
    expect(files.length).toBeGreaterThan(0);
    // 0018 enumerates the original six kinds — the discovery pass must
    // see each one. Asserting on the set (not the count) so a future
    // backfill that re-stamps an existing kind doesn't false-positive.
    const branchKinds = new Set(branches.map((b) => b.kind));
    for (const expected of [
      "payroll_run",
      "depreciation_run",
      "impairment_event",
      "revaluation_event",
      "disposal",
      "document",
    ]) {
      expect(
        branchKinds.has(expected),
        `expected per-source backfill branch for "${expected}" in one of: ${files.join(
          ", ",
        )}`,
      ).toBe(true);
    }
  });

  test("formatFailure mentions the opt-out marker so the failure message is actionable", () => {
    const fakeReport = {
      members: [
        { kind: "newkind", line: 42, optOutReason: null },
      ],
      branches: [],
      backfillFiles: ["migrations/0018_backfill_reversal_company_stamps.sql"],
      uncovered: [{ kind: "newkind", line: 42, optOutReason: null }],
      orphanBranches: [],
    };
    const message = formatFailure(fakeReport);
    expect(message).toContain('"newkind"');
    expect(message).toContain("server/storage.ts:42");
    expect(message).toContain(OPT_OUT_MARKER);
    expect(message).toContain("0018_backfill_reversal_company_stamps.sql");
  });
});
