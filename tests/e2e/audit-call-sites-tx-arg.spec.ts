import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Static lint that closes the loophole called out in task #276 — every
 * `recordAudit(...)` and `recordPayrollRunAudit(...)` *invocation* under
 * `server/` must pass an open `db.transaction(async tx => …)` handle as
 * the first argument so the audit-row insert commits (or rolls back)
 * atomically with the entity write it describes.
 *
 * Background: task #222 hand-migrated ~20 audit call sites onto the new
 * `tx`-first-arg shape (see the `recordAudit` doc-comment in
 * `server/storage.ts` and the runtime regression in
 * `tests/e2e/audit-write-atomic-rollback.spec.ts`). That runtime spec
 * only exercises one route (`POST /api/transactions`); a future refactor
 * could re-introduce a non-transactional audit write on, say,
 * `createLeave` or `updateFixedAssetBalances` and the runtime spec
 * wouldn't catch it. This static lint catches it at compile/CI time
 * across every call site, mirroring the
 * `tests/e2e/db-isolation-allowlist.spec.ts` pattern.
 *
 * Mechanism:
 *
 *   1. Parse `server/storage.ts` and `server/payroll.ts` with the
 *      TypeScript compiler API and walk every `ts.CallExpression` whose
 *      callee resolves to one of `recordAudit` / `recordPayrollRunAudit`
 *      (bare reference, `this.X(...)`, `storage.X(...)`, or any other
 *      member chain). Function/method *declarations* are
 *      `FunctionDeclaration` / `MethodDeclaration` / `MethodSignature`
 *      nodes — not `CallExpression` — so they are excluded structurally
 *      rather than via a fragile `\bawait\b` heuristic. That means the
 *      lint also catches non-awaited call shapes:
 *      `void recordAudit(db, …)`, `return recordAudit(db, …)`,
 *      `recordAudit(db, …)`, `Promise.all([recordAudit(db, …)])`, etc.
 *
 *   2. Read the first positional argument off the call expression. The
 *      AST gives us the exact `Expression` node, so commas inside object
 *      literals / template strings / nested calls cannot fool us.
 *
 *   3. Assert the first arg is one of the canonical *transaction handle*
 *      identifiers (`tx`, `txn`). Any other expression — most importantly
 *      the global `db` handle imported from `./db` — is a regression that
 *      would re-open the split-transaction shape pre-#222.
 *
 * If a future call site genuinely needs a different name for its
 * transaction handle, add it to `ALLOWED_TX_HANDLE_NAMES` below — that
 * edit is the deliberate moment to confirm the new name really is the
 * variable bound by the surrounding `db.transaction(async (X) => …)`
 * block (and not, say, the global `db`).
 */

/**
 * The set of identifier names the lint accepts as a transaction handle.
 * Today the codebase uses `tx` almost everywhere; `txn` shows up in the
 * two methods (`recordTransaction`, `updateTransaction`) where the
 * outer parameter is already named `tx` and the inner
 * `db.transaction(async (txn) => …)` had to pick a different name to
 * avoid shadowing.
 *
 * Notably absent: `db`. That is the global handle imported from
 * `./db`; passing it would silently re-introduce the split-transaction
 * shape pre-#222 (the audit insert would commit on its own implicit
 * transaction, leaving the audit history out of sync with the parent
 * mutation when the audit write fails).
 */
const ALLOWED_TX_HANDLE_NAMES = new Set<string>(["tx", "txn"]);

/**
 * Files the lint scans. Limited to the two modules that own the audit
 * call sites today; if a third module starts emitting audit rows, add
 * it here so the new call sites are gated by this lint too.
 */
const AUDIT_CALL_SOURCE_FILES = [
  "server/storage.ts",
  "server/payroll.ts",
];

/**
 * Audit functions whose first arg must be a transaction handle. Both
 * `recordAudit` (the file-private writer) and `recordPayrollRunAudit`
 * (the public storage method) take `tx: AuditWriter` as their first
 * parameter — see the type and the doc-comments in `server/storage.ts`.
 */
const AUDIT_FN_NAMES = new Set<string>([
  "recordAudit",
  "recordPayrollRunAudit",
]);

interface AuditCallSite {
  file: string;
  line: number;
  column: number;
  fn: string;
  /** Source text of the first positional argument, exactly as written. */
  firstArg: string;
  /** The full source line, trimmed, for diagnostic output. */
  sourceLine: string;
  /** Set if the call has *no* positional arguments — also a violation. */
  noArgs: boolean;
}

/**
 * Returns the simple identifier name being called, or `null` if this
 * `CallExpression` doesn't end in one of the audit function names.
 *
 * Recognises:
 *   - bare reference: `recordAudit(...)` / `recordPayrollRunAudit(...)`
 *   - member access: `this.recordPayrollRunAudit(...)`,
 *     `storage.recordPayrollRunAudit(...)`, `someAlias.recordAudit(...)`
 *   - chained access: `foo.bar.recordAudit(...)`
 */
function calleeAuditFnName(call: ts.CallExpression): string | null {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) {
    return AUDIT_FN_NAMES.has(expr.text) ? expr.text : null;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.text;
    return AUDIT_FN_NAMES.has(name) ? name : null;
  }
  return null;
}

/**
 * Walk a TS source file and return every audit call site as a structured
 * record. Pure AST traversal — `FunctionDeclaration`, `MethodDeclaration`,
 * `MethodSignature`, `FunctionExpression`, `ArrowFunction`, etc. are
 * never classified as `CallExpression`, so declarations are excluded
 * structurally without relying on a leading-`await` heuristic.
 */
function collectAuditCallSites(
  file: string,
  source: ts.SourceFile,
): AuditCallSite[] {
  const sites: AuditCallSite[] = [];
  const sourceText = source.getFullText();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const fn = calleeAuditFnName(node);
      if (fn !== null) {
        const { line, character } =
          source.getLineAndCharacterOfPosition(node.getStart(source));
        // Reconstruct the source line for diagnostics. Use raw text
        // boundaries so we don't depend on `\r\n` vs `\n` quirks.
        const lineStart = sourceText.lastIndexOf(
          "\n",
          node.getStart(source) - 1,
        ) + 1;
        const lineEndIdx = sourceText.indexOf("\n", node.getStart(source));
        const lineEnd = lineEndIdx === -1 ? sourceText.length : lineEndIdx;
        const sourceLine = sourceText.slice(lineStart, lineEnd).trim();

        if (node.arguments.length === 0) {
          sites.push({
            file,
            line: line + 1,
            column: character + 1,
            fn,
            firstArg: "",
            sourceLine,
            noArgs: true,
          });
        } else {
          const first = node.arguments[0];
          sites.push({
            file,
            line: line + 1,
            column: character + 1,
            fn,
            firstArg: first.getText(source).trim(),
            sourceLine,
            noArgs: false,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}

interface Violation {
  site: AuditCallSite;
  reason: string;
}

function lintFirstArg(site: AuditCallSite): Violation | null {
  if (site.noArgs) {
    return {
      site,
      reason:
        `${site.fn} was invoked with zero arguments — expected a ` +
        `transaction-handle identifier (one of: ` +
        `${[...ALLOWED_TX_HANDLE_NAMES].join(", ")}) as the first ` +
        `argument so the audit-row insert commits atomically with the ` +
        `entity write it describes (task #222).`,
    };
  }
  const arg = site.firstArg;
  // Must be a bare identifier — anything else (object literal, member
  // access, the global `db`, a `db as any` cast, …) is a regression. A
  // bare identifier is the only shape that names a single transaction
  // handle bound by an enclosing `db.transaction(async (X) => …)`.
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) {
    return {
      site,
      reason:
        `first argument is \`${arg}\` — expected a bare transaction-handle ` +
        `identifier (one of: ${[...ALLOWED_TX_HANDLE_NAMES].join(", ")}). ` +
        `An object literal, member access, or cast cannot be the open ` +
        `db.transaction(async tx => …) handle that the audit row must ` +
        `commit through (task #222).`,
    };
  }
  if (arg === "db") {
    return {
      site,
      reason:
        "first argument is the global `db` handle. Audit writes must run " +
        "on the *open* db.transaction(async tx => …) handle so the audit " +
        "row commits atomically with the entity write it describes — see " +
        "task #222 and the runtime regression in " +
        "tests/e2e/audit-write-atomic-rollback.spec.ts.",
    };
  }
  if (!ALLOWED_TX_HANDLE_NAMES.has(arg)) {
    return {
      site,
      reason:
        `first argument is \`${arg}\`, which is not a recognised ` +
        `transaction-handle name. If this really is the variable bound by ` +
        `an enclosing db.transaction(async (${arg}) => …), add "${arg}" ` +
        `to ALLOWED_TX_HANDLE_NAMES in this spec — that edit is the ` +
        `deliberate moment to confirm it isn't the global \`db\` in disguise.`,
    };
  }
  return null;
}

function parseSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

test.describe("audit call sites pass a tx handle (task #276)", () => {
  test("every recordAudit / recordPayrollRunAudit call passes a tx handle, not the global db", async () => {
    const allSites: AuditCallSite[] = [];
    for (const rel of AUDIT_CALL_SOURCE_FILES) {
      const abs = path.resolve(process.cwd(), rel);
      const text = await fs.readFile(abs, "utf8");
      allSites.push(...collectAuditCallSites(rel, parseSource(rel, text)));
    }

    // Sanity check: if the AST walk finds *zero* call sites, the source
    // has been refactored (or AUDIT_FN_NAMES is wrong); fail loudly so a
    // future rewrite that renames `recordAudit` doesn't silently turn
    // this lint into a no-op.
    expect(
      allSites.length,
      `expected to find audit call sites in ${AUDIT_CALL_SOURCE_FILES.join(
        ", ",
      )} — found none. Did recordAudit / recordPayrollRunAudit get ` +
        `renamed? Update AUDIT_FN_NAMES / AUDIT_CALL_SOURCE_FILES in ` +
        `tests/e2e/audit-call-sites-tx-arg.spec.ts.`,
    ).toBeGreaterThan(0);

    const violations: Violation[] = [];
    for (const site of allSites) {
      const v = lintFirstArg(site);
      if (v) violations.push(v);
    }

    const lines = violations.map(
      (v) =>
        `  • ${v.site.file}:${v.site.line}:${v.site.column}\n` +
        `      ${v.site.sourceLine}\n` +
        `      ${v.reason}`,
    );

    expect(
      violations,
      [
        `Found ${violations.length} audit call site(s) that do not pass a`,
        "transaction handle as the first argument:",
        "",
        ...lines,
        "",
        "Every recordAudit(...) and recordPayrollRunAudit(...) call must",
        "be invoked from inside an open db.transaction(async tx => …)",
        "block, with that `tx` handle as the first arg — so the audit",
        "row insert and the entity write commit (or roll back) as a",
        "single unit. See the recordAudit doc-comment in",
        "server/storage.ts and the runtime regression in",
        "tests/e2e/audit-write-atomic-rollback.spec.ts (task #222).",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * Self-test: feed the linter a tiny synthetic source that exercises
   * every regression shape we care about (awaited, non-awaited,
   * `void`-prefixed, return-prefixed, member-access, declaration-only)
   * and assert it flags exactly the call sites and only those. This
   * proves the lint isn't quietly skipping non-`await` regressions —
   * the gap that caused this spec to be rewritten in the first place.
   *
   * Acts as a regression test on the regression test: if someone
   * weakens the AST walk to "only awaited calls" again, this test
   * fails before the production-source scan even runs.
   */
  test("lint detects regressions across every call shape, including non-awaited", () => {
    const fixture = `
      // Declarations — must be ignored by the AST walk.
      async function recordAudit(tx: any, input: any) {}
      class Foo {
        async recordPayrollRunAudit(tx: any, input: any) {}
      }
      interface IBar {
        recordPayrollRunAudit(tx: any, input: any): Promise<void>;
      }

      async function caller() {
        // 1. Awaited, bare reference, valid handle — OK.
        await recordAudit(tx, { entity: "x" });
        // 2. Non-awaited, bare reference, regressed to global db — VIOLATION.
        recordAudit(db, { entity: "x" });
        // 3. void-prefixed, valid handle — OK.
        void recordAudit(txn, { entity: "x" });
        // 4. return-prefixed, regressed to db — VIOLATION.
        return recordAudit(db, { entity: "x" });
        // 5. Member access through 'storage', valid handle — OK.
        await storage.recordPayrollRunAudit(tx, { runId: 1 });
        // 6. Member access through 'this', regressed to db — VIOLATION.
        this.recordPayrollRunAudit(db, { runId: 1 });
        // 7. Inside Promise.all, valid handle — OK.
        await Promise.all([recordAudit(tx, { entity: "x" })]);
        // 8. Object literal as first arg — VIOLATION (not a bare ident).
        await recordAudit({ tx } as any, { entity: "x" });
        // 9. Unknown handle name — VIOLATION (not in allowlist).
        await recordAudit(myHandle, { entity: "x" });
      }
    `;
    const sf = parseSource("__fixture__.ts", fixture);
    const sites = collectAuditCallSites("__fixture__.ts", sf);

    // Nine call sites, three of which are non-awaited. Declarations and
    // the interface signature are excluded structurally.
    expect(sites.length).toBe(9);

    const violations = sites.map(lintFirstArg).filter((v): v is Violation => v !== null);
    const violationLines = violations.map((v) => v.site.line).sort((a, b) => a - b);
    const violationArgs = violations.map((v) => v.site.firstArg).sort();

    // Sites 2, 4, 6, 8, 9 must be flagged — including all three of the
    // non-awaited shapes (2: bare, 4: return-prefixed, 6: this-member).
    expect(violations.length, JSON.stringify(violations, null, 2)).toBe(5);
    expect(violationArgs).toEqual([
      "myHandle",
      "{ tx } as any",
      "db",
      "db",
      "db",
    ].sort());

    // Confirm specifically that the non-awaited `db` calls were caught
    // (the gap the previous regex-only version missed).
    const nonAwaitedDbViolations = violations.filter(
      (v) =>
        v.site.firstArg === "db" &&
        !v.site.sourceLine.startsWith("await "),
    );
    expect(
      nonAwaitedDbViolations.length,
      "non-awaited recordAudit(db, …) / this.recordPayrollRunAudit(db, …) " +
        "must be caught — that's the loophole that motivates this lint.",
    ).toBeGreaterThanOrEqual(2);

    void violationLines;
  });
});
