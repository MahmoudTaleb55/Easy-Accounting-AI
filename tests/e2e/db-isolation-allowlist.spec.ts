import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Static check that closes the loophole called out in task #138 — every
 * `db` import / direct `pool.connect()` call inside `server/` must run
 * under either `withCompanyScope(...)` (per-request workspace scope) or
 * `withRlsBypass(...)` (audited cross-tenant work). See
 * `docs/design/workspace-isolation-defense-in-depth.md`.
 *
 * The check has two halves:
 *
 *   1. The set of files that import `db` from `./db` or `../db` is pinned
 *      to the `DB_IMPORT_ALLOWLIST` below. Adding a new file to that set
 *      requires editing this test, which forces a code review on whether
 *      the new caller is reached only from a wrapped context.
 *
 *   2. Every top-level `await *OnStartup(` call in `server/index.ts` is
 *      either wrapped in `withCompanyScope(`/`withRlsBypass(` on the same
 *      block or invokes a function that wraps itself internally.
 *      Migration / bootstrap helpers are the most common way an
 *      unwrapped `db.` call sneaks in (because they run *outside* the
 *      `/api/*` request middleware) so the boot path is the highest-risk
 *      surface to lint.
 *
 *   3. `pool.connect()` is only allowed inside `server/db.ts` (where
 *      `withCompanyScope`/`withRlsBypass` themselves check out clients)
 *      and `server/migrate.ts` (which sets the bypass GUC inline because
 *      it has to bootstrap the migration ledger before the runner has
 *      ever applied a migration).
 *
 * If a future task introduces a cron job, a maintenance script, or any
 * other code path that talks to the database, the failing assertion will
 * point the author at this file and at the design doc.
 */

interface AllowlistEntry {
  /** Project-relative path of the file that imports `db`. */
  file: string;
  /**
   * Why this file's `db` usage is safe — i.e. how every code path that
   * reaches `db.X(...)` is reached only from inside a `withCompanyScope`
   * or `withRlsBypass` wrapper.
   */
  rationale: string;
}

/**
 * Hand-curated allowlist. Order doesn't matter; the test sorts before
 * comparing. Adding a new entry is the deliberate moment to re-read the
 * design doc.
 */
const DB_IMPORT_ALLOWLIST: AllowlistEntry[] = [
  {
    file: "server/storage.ts",
    rationale:
      "DatabaseStorage methods are invoked from the /api/* request " +
      "middleware in server/routes.ts, which wraps the whole handler in " +
      "withCompanyScope. The one cross-tenant code path " +
      "(createCompany) wraps itself in withWorkspaceCreation.",
  },
  {
    file: "server/insights.ts",
    rationale:
      "Pure read helpers (computeKPIs / computeBalances / etc.) called " +
      "from /api/insights/* route handlers, which run inside " +
      "withCompanyScope.",
  },
  {
    file: "server/payroll.ts",
    rationale:
      "Payroll preview / run helpers called from /api/payroll/* route " +
      "handlers, which run inside withCompanyScope.",
  },
  {
    file: "server/init-coa.ts",
    rationale:
      "Chart-of-accounts seeders. Two entry shapes: " +
      "(a) seedDefaultCoaInTx is invoked from createCompany (wrapped " +
      "in withRlsBypass at the storage layer) and from /api/init-coa " +
      "route handlers (wrapped in withCompanyScope by the request " +
      "middleware); " +
      "(b) ensureIfrsBootstrap runs at boot, wrapped in " +
      "withRlsBypass('bootstrap:ifrs-coa') in server/index.ts.",
  },
  {
    file: "server/routes.ts",
    rationale:
      "Owns the /api/* request middleware that sets up withCompanyScope " +
      "for every authenticated handler; its own direct `db.` calls are " +
      "inside route handlers and therefore inside that scope.",
  },
  {
    file: "server/auth/middleware.ts",
    rationale:
      "Cross-tenant membership lookup that runs *before* withCompanyScope " +
      "is attached. Reads only the auth tables (memberships, users, " +
      "companies), all of which are explicitly out of scope for the " +
      "workspace_isolation RLS policy (see design doc 'Tables " +
      "intentionally out of scope').",
  },
  {
    file: "server/auth/storage.ts",
    rationale:
      "authBizStorage methods cover the auth tables (intentionally not " +
      "RLS-protected). Methods called from inside the request middleware " +
      "inherit its withCompanyScope; the lone surviving boot helper " +
      "(`ensureEmailDeliveryAlertTablesOnStartup`) is wrapped in " +
      "withRlsBypass at its server/index.ts call site; " +
      "createCompanyForOwner wraps itself in withWorkspaceCreation.",
  },
  {
    file: "server/db-bootstrap-accounts-code-uq.ts",
    rationale:
      "applyAccountsCodePerWorkspaceOnStartup is called from " +
      "server/index.ts inside " +
      "withRlsBypass('bootstrap:accounts-code-uq').",
  },
  {
    file: "server/db-bootstrap-companyid-defaults.ts",
    rationale:
      "applyCompanyIdNoDefaultOnStartup is called from server/index.ts " +
      "inside withRlsBypass('bootstrap:companyid-defaults').",
  },
  {
    file: "server/db-bootstrap-audit-log-companyid.ts",
    rationale:
      "applyAuditLogCompanyIdOnStartup is called from server/index.ts " +
      "inside withRlsBypass('bootstrap:audit-log-companyid'). Adds + " +
      "backfills audit_log.company_id; the matching workspace_isolation " +
      "policy install on audit_log is performed by migration 0016 itself, " +
      "now applied by the SQL migration runner. See task #169 / " +
      "migration 0016.",
  },
  {
    file: "server/replit_integrations/auth/storage.ts",
    rationale:
      "Replit-OIDC user upsert. Runs from the OIDC callback before any " +
      "membership has been attached and only touches the cross-tenant " +
      "users table (intentionally out of RLS scope).",
  },
  {
    file: "server/replit_integrations/chat/storage.ts",
    rationale:
      "chatStorage methods are invoked from /api/chat/* route handlers, " +
      "which run inside withCompanyScope.",
  },
  {
    file: "server/auth/rls-policy-drift-alerts.ts",
    rationale:
      "Periodic production sweep (task #238) that runs the canonical " +
      "workspace_isolation policy-text query against the live DB. The " +
      "single entry point runRlsPolicyDriftSweep wraps itself in " +
      "withRlsBypass('cron:rls-policy-drift-sweep'); the read targets " +
      "system catalogs (pg_policy / pg_class / pg_namespace), which are " +
      "not RLS-protected anyway.",
  },
  {
    file: "server/__tests__/depreciation-run-delete-atomic-rollback.test.ts",
    rationale:
      "Vitest server-side integration test for task #275. Drives " +
      "storage.deleteDepreciationRun directly to assert the per-asset " +
      "accumDepreciation rollback commits/rolls back in lockstep with " +
      "the JE reversal. Every db. call is inside an explicit " +
      "withCompanyScope or withRlsBypass wrapper.",
  },
];

/**
 * Storage modules — the second backdoor the task asks us to gate. Every
 * one of these wraps `db` internally and is invoked through one of the
 * named exports below. A file that imports any of these names is reading
 * or writing through the database, so it is just as much a workspace-
 * isolation concern as a direct `db` import.
 *
 * Adding a new storage module: extend STORAGE_MODULE_PATHS *and*
 * STORAGE_MODULE_VALUE_EXPORTS so the importer scan recognises it.
 * Adding a new file that imports from one of them: extend
 * STORAGE_IMPORT_ALLOWLIST below with a rationale.
 *
 * Type-only imports (`import type { Foo }`) are exempt — they evaporate
 * at compile time and have no runtime db reach. The scanner explicitly
 * skips them.
 */
const STORAGE_MODULE_PATHS = [
  "./storage",
  "../storage",
  "./auth/storage",
  "../auth/storage",
  "../../auth/storage",
  "./replit_integrations/auth/storage",
  "../replit_integrations/auth/storage",
  "./replit_integrations/chat/storage",
  "../replit_integrations/chat/storage",
];

const STORAGE_MODULE_VALUE_EXPORTS = new Set<string>([
  "storage",
  "authStorage",
  "authBizStorage",
  "chatStorage",
]);

const STORAGE_IMPORT_ALLOWLIST: AllowlistEntry[] = [
  {
    file: "server/routes.ts",
    rationale:
      "Owns the /api/* request middleware that wraps every authenticated " +
      "handler in withCompanyScope; storage usage here is by definition " +
      "inside that scope.",
  },
  {
    file: "server/payroll.ts",
    rationale:
      "computePayrollPreview / runPayroll are invoked from /api/payroll/* " +
      "route handlers, which run inside withCompanyScope.",
  },
  {
    file: "server/insights.ts",
    rationale:
      "KPI / cash-forecast / simulator helpers invoked from /api/insights/* " +
      "route handlers, which run inside withCompanyScope. The lazy " +
      "`await import('./storage')` only pulls the storage value to read " +
      "settings; it inherits the same workspace scope as its caller.",
  },
  {
    file: "server/services/assistant-tools.ts",
    rationale:
      "AI assistant tool dispatcher invoked from /api/ai-assistant/* " +
      "route handlers, which run inside withCompanyScope.",
  },
  {
    file: "server/auth.ts",
    rationale:
      "rbacMiddleware reads users + memberships *before* withCompanyScope " +
      "is attached so /api/auth/me can answer for unauthenticated " +
      "requests too. Both tables are intentionally out of scope for the " +
      "workspace_isolation RLS policy (see design doc 'Tables " +
      "intentionally out of scope').",
  },
  {
    file: "server/auth/local-routes.ts",
    rationale:
      "Self-service auth routes (sign-in, sign-up, accept invite, password " +
      "reset). They run pre-membership and only touch the auth tables, " +
      "which are intentionally out of RLS scope.",
  },
  {
    file: "server/auth/email-delivery-alerts.ts",
    rationale:
      "Two entry shapes: " +
      "(a) the periodic sweep runEmailDeliveryAlertSweep wraps itself in " +
      "withRlsBypass('cron:email-delivery-alert-sweep'); " +
      "(b) per-row retry / evaluate helpers are invoked from /api/* route " +
      "handlers, which run inside withCompanyScope. The storage methods " +
      "themselves only touch the auth + alert tables (out of RLS scope).",
  },
  {
    file: "server/auth/rls-policy-drift-alerts.ts",
    rationale:
      "Periodic production sweep (task #238) that reads pg_policy via " +
      "db.execute(sql) to catch a tampered workspace_isolation policy in " +
      "the live DB. The single entry point runRlsPolicyDriftSweep wraps " +
      "itself in withRlsBypass('cron:rls-policy-drift-sweep'); the read " +
      "is against system catalogs (pg_policy / pg_class / pg_namespace), " +
      "which are not RLS-protected anyway, but the wrapper keeps this " +
      "module on the audited bypass path documented in the design doc.",
  },
  {
    file: "server/replit_integrations/auth/replitAuth.ts",
    rationale:
      "Replit OIDC verify / claims-upsert callback. Runs from passport " +
      "during sign-in (pre-membership) and only writes the cross-tenant " +
      "users table (out of RLS scope).",
  },
  {
    file: "server/replit_integrations/auth/routes.ts",
    rationale:
      "/api/login, /api/callback, /api/logout — pre-membership auth " +
      "routes that only touch the cross-tenant users table.",
  },
  {
    file: "server/replit_integrations/auth/index.ts",
    rationale:
      "Barrel re-export of authStorage and IAuthStorage; no runtime db " +
      "calls of its own.",
  },
  {
    file: "server/replit_integrations/chat/routes.ts",
    rationale:
      "/api/chat/* route handlers, which run inside withCompanyScope.",
  },
  {
    file: "server/replit_integrations/chat/index.ts",
    rationale:
      "Barrel re-export of chatStorage and IChatStorage; no runtime db " +
      "calls of its own.",
  },
  {
    file: "server/__tests__/depreciation-run-delete-atomic-rollback.test.ts",
    rationale:
      "Vitest server-side integration test for task #275. Imports " +
      "`storage` to call deleteDepreciationRun directly inside an " +
      "explicit withCompanyScope wrapper, asserting the JE/run/posting/" +
      "asset-balance writes commit/roll back as one unit.",
  },
];

/** Files allowed to call `pool.connect()` directly (rather than going
 *  through `withCompanyScope`/`withRlsBypass`). Both are themselves the
 *  primitives that establish workspace isolation. */
const POOL_CONNECT_ALLOWLIST = new Set([
  "server/db.ts",
  "server/migrate.ts",
]);

/**
 * Workspace-creation lint (task #167).
 *
 * Inserting into `companies` is the one moment when the active workspace
 * scope is about to change: the seed chart of accounts and the
 * per-workspace settings row are written under the *new* company's id,
 * which never matches the caller's `app.current_company_id`. The seed
 * inserts are therefore rejected by the `workspace_isolation` RLS policies
 * unless the whole flow runs inside `withWorkspaceCreation(...)` (the
 * named, grep-able helper that wraps `withRlsBypass("workspace:create")`).
 *
 * Two such code paths exist today (`POST /api/companies` →
 * `DatabaseStorage.createCompany`, and the signup-time bootstrap →
 * `authBizStorage.createCompanyForOwner`); plus the boot-time default
 * workspace creation in `ensureDefaultCompanyAndCategories`. A future
 * admin "clone workspace" tool, a bulk-import script, or a
 * teammate-onboarding flow would hit the same wall the moment it ran from
 * inside an existing workspace's scope.
 *
 * The lint enforces both halves of the convention:
 *
 *   1. The set of files that contain `*.insert(companies)` is pinned to
 *      the WORKSPACE_CREATE_ALLOWLIST below. Adding a fourth file is the
 *      deliberate moment to re-read the design doc and confirm the new
 *      caller funnels through the helper.
 *   2. Every `*.insert(companies)` *occurrence* must be lexically
 *      preceded — within a small backward window — by a
 *      `withWorkspaceCreation(` call in the same file. That catches the
 *      regression where someone keeps the file on the allowlist but
 *      drops the helper around a brand-new insert.
 */
const WORKSPACE_CREATE_ALLOWLIST: AllowlistEntry[] = [
  {
    file: "server/storage.ts",
    rationale:
      "DatabaseStorage.createCompany — the /api/companies handler. Wraps " +
      "the company write + chart-of-accounts seed in " +
      "withWorkspaceCreation(...) so the seed inserts under the new " +
      "company's id are not rejected by the workspace_isolation RLS " +
      "policies.",
  },
  {
    file: "server/auth/storage.ts",
    rationale:
      "authBizStorage.createCompanyForOwner — the signup-time bootstrap. " +
      "Wraps the company + settings + CoA seed in " +
      "withWorkspaceCreation(...) so the cross-workspace inserts are " +
      "accepted regardless of which workspace scope (if any) the caller " +
      "is currently in.",
  },
  {
    file: "server/init-coa.ts",
    rationale:
      "ensureDefaultCompanyAndCategories — boot-time creation of the " +
      "implicit \"Default Company\" workspace when the table is empty. " +
      "The insert sits inside withWorkspaceCreation(...) for uniformity " +
      "with the runtime paths, even though the surrounding boot helper " +
      "already runs under withRlsBypass('bootstrap:ifrs-coa').",
  },
];

const SERVER_ROOT = path.resolve(process.cwd(), "server");

async function walkServer(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && full.endsWith(".ts")) {
        out.push(full);
      }
    }
  }
  await walk(SERVER_ROOT);
  return out;
}

function projectRelative(absPath: string): string {
  return path.relative(process.cwd(), absPath).replace(/\\/g, "/");
}

/**
 * A file is considered to "import db" if it imports the `db` symbol from
 * the local db module. Permits both `import { db } from "./db"` and the
 * `import { db, withCompanyScope } from "./db"` shapes.
 */
function importsDb(text: string): boolean {
  const importRe =
    /import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["'](?:\.\.?\/)+db["']/g;
  if (importRe.test(text)) return true;
  // Also pick up `const { db } = await import("./db")` / `"../db"`.
  const dynRe =
    /import\s*\(\s*["'](?:\.\.?\/)+db["']\s*\)/g;
  if (!dynRe.test(text)) return false;
  return /\{\s*[^}]*\bdb\b[^}]*\}\s*=\s*await\s+import\s*\(\s*["'](?:\.\.?\/)+db["']\s*\)/.test(
    text,
  );
}

test.describe("workspace isolation lint", () => {
  test("every server/ file that imports `db` is on the audited allowlist", async () => {
    const all = await walkServer();
    const importing: string[] = [];
    for (const f of all) {
      const text = await fs.readFile(f, "utf8");
      if (importsDb(text)) importing.push(projectRelative(f));
    }
    const allowlistFiles = DB_IMPORT_ALLOWLIST.map((e) => e.file);

    const unexpected = importing
      .filter((f) => !allowlistFiles.includes(f))
      .sort();
    const missing = allowlistFiles
      .filter((f) => !importing.includes(f))
      .sort();

    expect(
      { unexpected, missing },
      `Files importing \`db\` from server/db.ts must be on the ` +
        `DB_IMPORT_ALLOWLIST in tests/e2e/db-isolation-allowlist.spec.ts. ` +
        `If you are adding a new file, add an entry that explains how its ` +
        `db usage is reached only from inside withCompanyScope or ` +
        `withRlsBypass. See docs/design/workspace-isolation-defense-in-depth.md.`,
    ).toEqual({ unexpected: [], missing: [] });
  });

  test("server/index.ts wraps every *OnStartup invocation in withRlsBypass", async () => {
    const text = await fs.readFile(
      path.resolve(SERVER_ROOT, "index.ts"),
      "utf8",
    );

    // Helpers that wrap themselves internally — they don't need an outer
    // wrapper at the call site. Keep this list short and obvious.
    // Currently empty: the only self-wrapping helper
    // (`applyWorkspaceRlsOnStartup`) was retired in task #165 once the
    // SQL migration runner had reliably superseded it.
    const SELF_WRAPPING = new Set<string>([]);

    const lines = text.split("\n");
    // For each `await fooOnStartup(` invocation, search backwards a few
    // lines for `withCompanyScope(` or `withRlsBypass(`. The bootstrap
    // blocks in server/index.ts follow a stable pattern:
    //
    //   const { withRlsBypass } = await import("./db");
    //   await withRlsBypass("bootstrap:foo", () => fooOnStartup());
    //
    // so a 3-line backward window is enough.
    const violations: { line: number; call: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\bawait\s+([A-Za-z_][A-Za-z0-9_]*OnStartup)\s*\(/);
      if (!m) continue;
      const callee = m[1];
      if (SELF_WRAPPING.has(callee)) continue;
      const window = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      const wrapped =
        /\bwithRlsBypass\s*\(/.test(window) ||
        /\bwithCompanyScope\s*\(/.test(window);
      if (!wrapped) {
        violations.push({ line: i + 1, call: callee });
      }
    }
    expect(
      violations,
      `Every await *OnStartup() invocation in server/index.ts must be ` +
        `wrapped in withRlsBypass(...) or withCompanyScope(...) so the ` +
        `helper's db. calls run with the workspace-isolation GUC set. ` +
        `Self-wrapping helpers are listed in SELF_WRAPPING; add new ones ` +
        `there if and only if they wrap their own body internally.`,
    ).toEqual([]);
  });

  test("every server/ file that imports a storage module is on the audited allowlist", async () => {
    const all = await walkServer();

    // Build one matcher per known storage path. We deliberately match the
    // *literal* path string used in the source (not a resolved absolute
    // path) because that is what an author types when adding a new
    // backdoor — and what reviewers will see in the diff.
    const pathAlts = STORAGE_MODULE_PATHS.map((p) =>
      p.replace(/[.\/]/g, (c) => "\\" + c),
    ).join("|");
    const valueAlts = [...STORAGE_MODULE_VALUE_EXPORTS].join("|");

    // Static `import { ... } from "<storage>"` where the named imports
    // include at least one of the runtime exports (storage / authStorage
    // / authBizStorage / chatStorage). `import type { ... }` is excluded
    // by the leading `\bimport\s+(?!type\b)` lookbehind-equivalent.
    const staticImportRe = new RegExp(
      String.raw`\bimport\s+(?!type\b)\{([^}]*)\}\s*from\s*["'](?:` +
        pathAlts +
        String.raw`)["']`,
      "g",
    );
    // Re-export form `export { ... } from "<storage>"` is just as much a
    // runtime backdoor — the re-exported binding is a live reference to
    // the storage value, so any consumer can call `.foo()` on it.
    const reExportRe = new RegExp(
      String.raw`\bexport\s+(?!type\b)\{([^}]*)\}\s*from\s*["'](?:` +
        pathAlts +
        String.raw`)["']`,
      "g",
    );
    // Dynamic `const { ... } = await import("<storage>")` — flag only if
    // one of the destructured names is a runtime storage value. Migration
    // / bootstrap helpers (e.g. `ensureEmailDeliveryAlertTablesOnStartup`)
    // live in the same module but are gated by the *OnStartup wrapper
    // test, not this one.
    const dynamicImportRe = new RegExp(
      String.raw`\{([^}]*)\}\s*=\s*await\s+import\s*\(\s*["'](?:` +
        pathAlts +
        String.raw`)["']\s*\)`,
      "g",
    );
    const valueRe = new RegExp(String.raw`\b(?:` + valueAlts + String.raw`)\b`);

    function namedListHasValueExport(named: string): boolean {
      const cleaned = named
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("type "))
        .join(",");
      return valueRe.test(cleaned);
    }

    const importing: string[] = [];
    for (const f of all) {
      const rel = projectRelative(f);
      // The storage modules themselves obviously "import" their own
      // value exports — skip them so the lint doesn't flag the source
      // of truth.
      if (
        rel === "server/storage.ts" ||
        rel === "server/auth/storage.ts" ||
        rel === "server/replit_integrations/auth/storage.ts" ||
        rel === "server/replit_integrations/chat/storage.ts"
      ) {
        continue;
      }
      const text = await fs.readFile(f, "utf8");
      let hit = false;
      for (const m of text.matchAll(staticImportRe)) {
        if (namedListHasValueExport(m[1])) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const m of text.matchAll(reExportRe)) {
          if (namedListHasValueExport(m[1])) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const m of text.matchAll(dynamicImportRe)) {
          if (namedListHasValueExport(m[1])) {
            hit = true;
            break;
          }
        }
      }
      if (hit) importing.push(rel);
    }

    const allowlistFiles = STORAGE_IMPORT_ALLOWLIST.map((e) => e.file);
    const unexpected = importing
      .filter((f) => !allowlistFiles.includes(f))
      .sort();
    const missing = allowlistFiles
      .filter((f) => !importing.includes(f))
      .sort();

    expect(
      { unexpected, missing },
      `Files importing a value export from a storage module (storage, ` +
        `authStorage, authBizStorage, chatStorage) must be on the ` +
        `STORAGE_IMPORT_ALLOWLIST in tests/e2e/db-isolation-allowlist.spec.ts. ` +
        `Storage modules wrap \`db\` internally, so calling them outside ` +
        `withCompanyScope/withRlsBypass bypasses the workspace-isolation ` +
        `RLS just as much as a direct \`db\` call. If you are adding a ` +
        `new file, add an entry that explains how the storage usage is ` +
        `reached only from inside an audited scope (or only touches ` +
        `auth/cross-tenant tables that are intentionally out of RLS scope). ` +
        `See docs/design/workspace-isolation-defense-in-depth.md.`,
    ).toEqual({ unexpected: [], missing: [] });
  });

  test("every `insert(companies)` is on the workspace-creation allowlist and uses withWorkspaceCreation", async () => {
    const all = await walkServer();

    // `*.insert(companies)` covers `db.insert(companies)`,
    // `tx.insert(companies)`, and any other receiver — the marker is the
    // table reference, not the binding it's called on. Whitespace inside
    // the parens is tolerated to match the prevailing prettier output.
    const insertRe = /\.insert\(\s*companies\s*\)/g;
    // The grep-able marker that must precede every insert. We deliberately
    // do NOT accept the bare `withRlsBypass("workspace:create", ...)` form
    // here: the whole point of task #167 is that the named helper is the
    // one true entry point, so a future hand-written bypass call would
    // (correctly) trip this lint and force the author to consolidate.
    const helperRe = /\bwithWorkspaceCreation\s*\(/g;

    const filesWithInsert: string[] = [];
    const occurrenceViolations: { file: string; line: number }[] = [];

    for (const f of all) {
      const rel = projectRelative(f);
      const text = await fs.readFile(f, "utf8");
      const lines = text.split("\n");

      // A line is a "comment line" if its trimmed start is `//`, `*`, or
      // `/*` — that is the prevailing style for both single-line and
      // JSDoc-style block comments in this codebase. Comment-only lines
      // are stripped from the insert scan so a docstring that mentions
      // `db.insert(companies)` (e.g. the rationale comment in
      // server/db.ts that introduces withWorkspaceCreation) does not
      // count as a real insert site.
      const isCommentLine = (line: string): boolean => {
        const t = line.trimStart();
        return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
      };

      const insertLineIdxs: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        // Reset lastIndex; we use .test() with a /g regex.
        insertRe.lastIndex = 0;
        if (insertRe.test(lines[i])) insertLineIdxs.push(i);
      }
      if (insertLineIdxs.length === 0) continue;
      filesWithInsert.push(rel);

      // For each `insert(companies)` line, look back up to 80 lines for a
      // `withWorkspaceCreation(` call. 80 lines is generous enough to
      // cover the longest current call site (createCompany has ~25 lines
      // of comment + dynamic import before the helper call) without
      // hiding inserts that live in a separate function from the
      // helper.
      for (const idx of insertLineIdxs) {
        const start = Math.max(0, idx - 80);
        const window = lines.slice(start, idx + 1).join("\n");
        helperRe.lastIndex = 0;
        if (!helperRe.test(window)) {
          occurrenceViolations.push({ file: rel, line: idx + 1 });
        }
      }
    }

    const allowlistFiles = WORKSPACE_CREATE_ALLOWLIST.map((e) => e.file);
    const unexpected = filesWithInsert
      .filter((f) => !allowlistFiles.includes(f))
      .sort();
    const missing = allowlistFiles
      .filter((f) => !filesWithInsert.includes(f))
      .sort();

    expect(
      { unexpected, missing },
      `Files containing \`*.insert(companies)\` must be on the ` +
        `WORKSPACE_CREATE_ALLOWLIST in tests/e2e/db-isolation-allowlist.spec.ts. ` +
        `Creating a workspace inserts the seed chart of accounts and the ` +
        `per-workspace settings row under the *new* company's id, which ` +
        `the workspace_isolation RLS policies reject unless the whole ` +
        `flow runs inside withWorkspaceCreation(...). If you are adding a ` +
        `new workspace-creation path (admin "clone workspace", bulk-import ` +
        `script, teammate-onboarding flow, etc.), wrap the insert in ` +
        `withWorkspaceCreation(...) and add an entry to the allowlist with ` +
        `a rationale. See ` +
        `docs/design/workspace-isolation-defense-in-depth.md → "Bypass paths".`,
    ).toEqual({ unexpected: [], missing: [] });

    expect(
      occurrenceViolations,
      `Every \`*.insert(companies)\` occurrence must be lexically ` +
        `preceded (within 80 lines) by a withWorkspaceCreation(...) call ` +
        `in the same file. Wrap the insert in withWorkspaceCreation(async ` +
        `() => { ... }) so the seed chart of accounts and per-workspace ` +
        `settings row can be written under the new company's id without ` +
        `tripping the workspace_isolation RLS policies. See ` +
        `docs/design/workspace-isolation-defense-in-depth.md → "Bypass paths".`,
    ).toEqual([]);
  });

  test("`pool.connect()` is only used by the workspace-isolation primitives", async () => {
    const all = await walkServer();
    const offenders: string[] = [];
    for (const f of all) {
      const rel = projectRelative(f);
      if (POOL_CONNECT_ALLOWLIST.has(rel)) continue;
      const text = await fs.readFile(f, "utf8");
      if (/\bpool\.connect\s*\(/.test(text)) offenders.push(rel);
    }
    expect(
      offenders.sort(),
      `pool.connect() is the primitive that withCompanyScope and ` +
        `withRlsBypass build on. Calling it directly elsewhere bypasses ` +
        `the workspace isolation layer — route through the wrappers ` +
        `instead. Allowed files: ${[...POOL_CONNECT_ALLOWLIST].join(", ")}.`,
    ).toEqual([]);
  });
});
