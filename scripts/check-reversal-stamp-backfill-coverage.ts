#!/usr/bin/env tsx
/**
 * Static check: every member of the `JournalEntrySourceKind` union in
 * `server/storage.ts` must either
 *
 *   (a) have a per-source UPDATE branch in some
 *       `migrations/*backfill_reversal_company_stamps*.sql` file, or
 *   (b) carry an inline `// reversal-backfill-opt-out: <reason>` comment
 *       on the same line of the union declaration.
 *
 * Why this exists (task #265)
 * ---------------------------
 * `migrations/0018_backfill_reversal_company_stamps.sql` enumerates the
 * six source kinds that could trigger a JE reversal at the time it was
 * authored (payroll_run, depreciation_run, impairment_event,
 * revaluation_event, disposal, document). If a future task adds a new
 * member to `JournalEntrySourceKind` and wires it through
 * `reverseAutoPostedJournalEntry`, that kind's historical reversal rows
 * will silently fall through to the migration's audit-log fallback.
 * The fallback IS correct in isolation, but it masks the missing
 * per-source coverage in any future backfill that ships — and a future
 * backfill that needs to fix up the audit log row by row (e.g. one that
 * has to peek at the source row to recover a different field) will be
 * one branch short without anyone noticing.
 *
 * The check enforces an up-front contract instead: a developer adding a
 * new source kind has to either ship a per-source backfill branch (in
 * a new migration with a matching filename) or annotate the kind as
 * intentionally opted out, so the reasoning is recorded next to the
 * declaration. The `audit-reversal-company-stamp-backfill.spec.ts`
 * regression net only proves that 0018 patches the rows it claims to;
 * this script is what proves the union and the backfill universe are
 * the same set.
 *
 * The script is intentionally dependency-free (no TS compiler API) so
 * it runs as a fast precommit / CI check.
 *
 * Run directly:   `tsx scripts/check-reversal-stamp-backfill-coverage.ts`
 * Run in CI via:  `tests/e2e/reversal-stamp-backfill-coverage.spec.ts`
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export const PROJECT_ROOT = process.cwd();
export const STORAGE_PATH = join(PROJECT_ROOT, "server/storage.ts");
export const MIGRATIONS_DIR = join(PROJECT_ROOT, "migrations");
export const UNION_NAME = "JournalEntrySourceKind";
export const BACKFILL_FILENAME_RE =
  /backfill_reversal_company_stamps.*\.sql$/i;
export const OPT_OUT_MARKER = "reversal-backfill-opt-out:";

export interface UnionMember {
  /** The literal value, e.g. `"payroll_run"`. */
  kind: string;
  /** 1-based line number in `server/storage.ts`. */
  line: number;
  /** Opt-out reason if the line carries the marker, else null. */
  optOutReason: string | null;
}

export interface BackfillBranch {
  /** Source kind the branch covers, e.g. `"payroll_run"`. */
  kind: string;
  /** Migration filename (relative to project root). */
  file: string;
}

export interface CoverageReport {
  members: UnionMember[];
  branches: BackfillBranch[];
  /** Backfill SQL filenames that were scanned (relative to project root). */
  backfillFiles: string[];
  /**
   * Members that have no per-source branch and no opt-out marker. These
   * are the failures the static check must surface.
   */
  uncovered: UnionMember[];
  /**
   * Per-source branches that point at a kind no longer present in the
   * union. Useful as a soft warning so renamed/retired kinds aren't
   * silently left behind in the SQL, but not currently treated as a
   * hard failure.
   */
  orphanBranches: BackfillBranch[];
}

/**
 * Parse the union declaration from `server/storage.ts`.
 *
 * Looks for the block
 *
 *   export type JournalEntrySourceKind =
 *     | "payroll_run"
 *     ...
 *     | "sales_invoice"; // reversal-backfill-opt-out: ...
 *
 * Each line is matched as: optional pipe + `"kind"` + optional comma /
 * semicolon + optional `// reversal-backfill-opt-out: <reason>` tail.
 * Throws if the union cannot be located so a structural rename of the
 * type is loud rather than silent.
 */
export function parseUnionMembers(source: string): UnionMember[] {
  const lines = source.split("\n");
  const startIdx = lines.findIndex((l) =>
    new RegExp(`^\\s*export\\s+type\\s+${UNION_NAME}\\s*=\\s*$`).test(l) ||
    new RegExp(`^\\s*export\\s+type\\s+${UNION_NAME}\\s*=`).test(l),
  );
  if (startIdx === -1) {
    throw new Error(
      `Could not locate \`export type ${UNION_NAME}\` in ${relative(
        PROJECT_ROOT,
        STORAGE_PATH,
      )}. Did the type get renamed? Update ` +
        `scripts/check-reversal-stamp-backfill-coverage.ts to match.`,
    );
  }

  const members: UnionMember[] = [];
  // Walk forward from the declaration line until we hit a line that
  // terminates the union (semicolon at end, possibly trailing a `"kind"`).
  // A line that is neither a member nor terminates is a structural
  // surprise — bail out so the failure is visible.
  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    // Strip trailing whitespace for matching, keep the original for the
    // opt-out tail extraction below.
    const memberMatch = raw.match(
      /^\s*(?:\|\s*)?"([^"\\]+)"\s*[,;]?\s*(\/\/.*)?\s*$/,
    );
    if (memberMatch) {
      const kind = memberMatch[1];
      const tail = memberMatch[2] ?? "";
      const optOutIdx = tail.indexOf(OPT_OUT_MARKER);
      const optOutReason =
        optOutIdx >= 0
          ? tail.slice(optOutIdx + OPT_OUT_MARKER.length).trim() || "(no reason given)"
          : null;
      members.push({ kind, line: i + 1, optOutReason });
      // The semicolon on a member line terminates the union.
      if (/;\s*(\/\/.*)?\s*$/.test(raw)) break;
      continue;
    }

    // The opening `export type ... =` line itself is allowed.
    if (i === startIdx) continue;

    // Blank line / comment line inside the union is OK; skip it.
    if (/^\s*(\/\/.*)?$/.test(raw)) continue;

    // Anything else inside the union is a parse failure — refuse to
    // guess what the developer meant.
    throw new Error(
      `Unexpected line inside ${UNION_NAME} declaration at ` +
        `${relative(PROJECT_ROOT, STORAGE_PATH)}:${i + 1}: ${raw}`,
    );
  }

  if (members.length === 0) {
    throw new Error(
      `Parsed ${UNION_NAME} but found zero union members. The check ` +
        `cannot run without a non-empty union — refusing to silently pass.`,
    );
  }
  return members;
}

/**
 * Discover every per-source UPDATE branch across all backfill SQL
 * files. A branch is identified by the literal `<kind>#` prefix that
 * the backfill compares `reversedBy` against (mirroring the runtime
 * stamp `reverseAutoPostedJournalEntry` writes:
 * `${source.kind}#${source.id}`). Matching on this exact substring is
 * tighter than matching on the table name alone — the table could
 * appear in the SQL for unrelated reasons, but the `'<kind>#'` literal
 * is unique to the per-source branch.
 */
export function findBackfillBranches(): {
  files: string[];
  branches: BackfillBranch[];
} {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => BACKFILL_FILENAME_RE.test(name))
    .sort();

  const branches: BackfillBranch[] = [];
  // Match `'<kind>#'` (with optional whitespace) — the literal
  // concatenated into `||` in the per-source branch.
  const branchRe = /'([a-z_][a-z0-9_]*)#'/gi;

  for (const filename of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    const seen = new Set<string>();
    for (const m of sql.matchAll(branchRe)) {
      const kind = m[1];
      if (seen.has(kind)) continue;
      seen.add(kind);
      branches.push({
        kind,
        file: relative(PROJECT_ROOT, join(MIGRATIONS_DIR, filename)),
      });
    }
  }

  return {
    files: files.map((f) =>
      relative(PROJECT_ROOT, join(MIGRATIONS_DIR, f)),
    ),
    branches,
  };
}

export function checkReversalStampBackfillCoverage(): CoverageReport {
  const source = readFileSync(STORAGE_PATH, "utf8");
  const members = parseUnionMembers(source);
  const { files: backfillFiles, branches } = findBackfillBranches();

  if (backfillFiles.length === 0) {
    throw new Error(
      `No migrations matched ${BACKFILL_FILENAME_RE} under ` +
        `${relative(PROJECT_ROOT, MIGRATIONS_DIR)}. The check needs at ` +
        `least one backfill file to validate against — refusing to ` +
        `silently pass.`,
    );
  }

  const branchKinds = new Set(branches.map((b) => b.kind));
  const memberKinds = new Set(members.map((m) => m.kind));

  const uncovered = members.filter(
    (m) => !branchKinds.has(m.kind) && m.optOutReason === null,
  );
  const orphanBranches = branches.filter((b) => !memberKinds.has(b.kind));

  return {
    members,
    branches,
    backfillFiles,
    uncovered,
    orphanBranches,
  };
}

export function formatFailure(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(
    `Found ${report.uncovered.length} ${UNION_NAME} member(s) without`,
    "per-source coverage in any backfill SQL file:",
    "",
  );
  for (const m of report.uncovered) {
    lines.push(
      `  • "${m.kind}" — server/storage.ts:${m.line}`,
      `      no per-source UPDATE branch matching '${m.kind}#' was found in:`,
      ...report.backfillFiles.map((f) => `        - ${f}`),
    );
  }
  lines.push(
    "",
    "To fix, do ONE of the following:",
    "",
    "  1. Ship a new migration whose filename matches",
    `     \`migrations/*backfill_reversal_company_stamps*.sql\` and includes`,
    "     a per-source UPDATE branch keyed on the new kind's source table",
    "     and `'<kind>#' || s.\"id\"::text` literal (mirror the existing",
    "     branches in 0018_backfill_reversal_company_stamps.sql).",
    "",
    "  2. Annotate the kind in `server/storage.ts` with an inline",
    `     \`// ${OPT_OUT_MARKER} <reason>\` comment on the same line as`,
    "     the union member, justifying why no historical unstamped",
    "     reversal rows exist for it (e.g. the kind was added after",
    "     `reverseAutoPostedJournalEntry`'s companyId-stamping was in",
    "     place, so there is nothing for a backfill to patch).",
  );
  return lines.join("\n");
}

function isMain(): boolean {
  const entry = process.argv[1] ?? "";
  return (
    entry.endsWith("check-reversal-stamp-backfill-coverage.ts") ||
    entry.endsWith("check-reversal-stamp-backfill-coverage.js")
  );
}

export function runCheck(): { ok: boolean; message: string } {
  const report = checkReversalStampBackfillCoverage();
  if (report.uncovered.length === 0) {
    const optedOut = report.members.filter((m) => m.optOutReason !== null);
    let message =
      `reversal-stamp backfill coverage OK — ${report.members.length} ` +
      `${UNION_NAME} member(s): ` +
      `${report.members.length - optedOut.length} covered by ` +
      `per-source branch(es), ${optedOut.length} opted out`;
    if (report.orphanBranches.length > 0) {
      message +=
        `\nnote: ${report.orphanBranches.length} backfill branch(es) point ` +
        `at kind(s) no longer in the union: ` +
        `${report.orphanBranches
          .map((b) => `${b.kind} (${b.file})`)
          .join(", ")}`;
    }
    return { ok: true, message };
  }
  return { ok: false, message: formatFailure(report) };
}

if (isMain()) {
  const { ok, message } = runCheck();
  // eslint-disable-next-line no-console
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
