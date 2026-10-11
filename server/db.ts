// node-postgres (`pg`) driver. We deliberately use pg (NOT
// @neondatabase/serverless) because this app's row-level-security model pins
// ONE physical client per request in withCompanyScope/withRlsBypass and sets
// session GUCs on it (SET app.current_company_id / SET app.rls_bypass /
// SET ROLE app_api). pg's checked-out client is a single dedicated physical
// connection, so that session state reliably applies to every subsequent query
// in the scope. The @neondatabase/serverless WebSocket pool did NOT reliably
// preserve per-client session state across the SET statements and the following
// queries, so writes intermittently ran with no app.current_company_id and the
// RLS WITH CHECK rejected INSERT/UPDATE (SQLSTATE 42501). Neon free-tier cold
// starts are instead handled below without touching the session model, via TCP
// keepalive, an idle-client error handler, and a small bounded retry on
// transient connection failures when acquiring a client (connectWithRetry).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// SECURITY (scan finding, UNRESTRICTED_RESOURCE_CONSUMPTION): withCompanyScope
// pins a pooled client for the whole request lifetime (it holds the GUC that
// RLS consults). With pg's defaults (max: 10, NO acquire timeout), the 11th
// concurrent request would block FOREVER waiting for a client — an all-tenant
// denial of service — and a handler that needs a second client while 10 are
// held would deadlock. We therefore:
//   - size the pool from DB_POOL_MAX (default 20, up from pg's 10), and
//   - set connectionTimeoutMillis so a client acquire REJECTS after a bound
//     instead of hanging indefinitely (the rejection surfaces as a clean 500
//     for that one request via the async-middleware guard, task H-4).
// This is a mitigation, not the full connection-model refactor the design doc
// defers; it removes the indefinite-hang DoS without changing request shape.
const DB_POOL_MAX = Number(process.env.DB_POOL_MAX) || 20;
const DB_ACQUIRE_TIMEOUT_MS = Number(process.env.DB_ACQUIRE_TIMEOUT_MS) || 10_000;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: DB_POOL_MAX,
  connectionTimeoutMillis: DB_ACQUIRE_TIMEOUT_MS,
  // Neon free-tier cold-start hardening (does NOT change the RLS/session model):
  //  - keepAlive keeps the TCP connection from being silently dropped while idle.
  //  - idleTimeoutMillis recycles pooled clients that have gone stale (e.g. a
  //    compute suspend) rather than handing out a dead connection on the next
  //    request.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

// node-postgres emits 'error' on IDLE clients (e.g. when Neon drops a suspended
// connection in the background). Without a listener that event is unhandled and
// can crash the process. Log and swallow it — the pool will recycle the dead
// client and connectWithRetry() re-acquires a fresh one on the next request.
pool.on("error", (err) => {
  console.error(
    "[db] idle client error (ignored, pool will recycle):",
    (err as { message?: string } | undefined)?.message ?? err,
  );
});

/**
 * Acquire a pooled client, retrying a SMALL, BOUNDED number of times ONLY on
 * transient Neon cold-start connection failures. Each attempt acquires a FRESH
 * client, so the SET session GUCs that follow always run on a live connection.
 *
 * This deliberately does NOT retry application/SQL errors (e.g. RLS 42501) —
 * those are real and must surface. It only exists so a Neon cold start turns a
 * hard "Connection terminated" into a brief delay + a successful retry, while
 * every query within a scope still runs on ONE pinned pg client with the GUCs
 * reliably set.
 */
const CONNECT_RETRY_BACKOFF_MS = [250, 750, 1500];

function isTransientConnectError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code;
  if (code === "57P01" || code === "ECONNRESET" || code === "ETIMEDOUT") {
    return true;
  }
  const message = (e?.message ?? "").toLowerCase();
  return (
    message.includes("connection terminated") ||
    message.includes("terminated unexpectedly") ||
    message.includes("timeout")
  );
}

async function connectWithRetry(): Promise<pg.PoolClient> {
  let lastErr: unknown;
  // One initial attempt + up to CONNECT_RETRY_BACKOFF_MS.length retries.
  for (let attempt = 0; attempt <= CONNECT_RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await pool.connect();
    } catch (err) {
      lastErr = err;
      // Only retry transient connection errors; surface everything else at once.
      if (
        attempt >= CONNECT_RETRY_BACKOFF_MS.length ||
        !isTransientConnectError(err)
      ) {
        throw err;
      }
      const delay = CONNECT_RETRY_BACKOFF_MS[attempt];
      console.warn(
        `[db] transient connection error acquiring client (attempt ${attempt + 1}), ` +
          `retrying in ${delay}ms:`,
        (err as { message?: string } | undefined)?.message ?? err,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

type Schema = typeof schema;
type Drizzle = NodePgDatabase<Schema>;

const baseDb = drizzle(pool, { schema });

/**
 * Per-request DB context.
 *
 * Task #93 (see docs/design/workspace-isolation-defense-in-depth.md): the
 * exported `db` is a Proxy that, when an `AsyncLocalStorage` slot has been
 * populated by `withCompanyScope` or `withRlsBypass`, delegates every
 * Drizzle method call to the request-scoped instance instead of the default
 * pool-backed one. The scoped instance is bound to a single `pg.Client`
 * checked out from the pool with `app.current_company_id` (or
 * `app.rls_bypass`) set, which is what the row-level security policies on
 * the workspace-scoped tables consult.
 *
 * The Proxy keeps the `db` import contract untouched: every call site that
 * already does `db.select()`, `db.insert()`, `db.transaction()`, or
 * `db.execute()` continues to work, and automatically picks up the active
 * scope when one is in flight.
 *
 * Task #193: the AsyncLocalStorage store also carries an optional
 * `unscoped: { reason }` slot, populated by `withUnscopedDb(reason, fn)`.
 * That slot is the explicit "I know this `db.` call is intentionally
 * outside the workspace scope, here's why" marker used by the legitimate
 * pre-membership lookups in `server/auth/middleware.ts` (and any other
 * audited cross-tenant auth path). When neither `scoped` nor `unscoped` is
 * set, `activeDb()` logs a one-line stack-trace warning the first time
 * each call site is observed in the process — caught early enough that a
 * regression in a pre-existing allowlisted file doesn't have to wait for
 * the static lint at `tests/e2e/db-isolation-allowlist.spec.ts` to fire.
 */
type DbContextStore = {
  scoped?: Drizzle;
  unscoped?: { reason: string };
};
const dbContext = new AsyncLocalStorage<DbContextStore>();

/**
 * Per-process dedup key set for the runtime "unscoped db. call" warning.
 * Keyed on a stack-frame string so each unique call site is reported
 * exactly once and a hot path (e.g. a tight loop) doesn't spam the log.
 */
const warnedUnscopedCallSites = new Set<string>();

/** Test-only: clear the dedup set so a spec can deterministically observe
 *  the "first warning per call site" behaviour without spawning a fresh
 *  process. Not part of the public API; the leading underscore is the
 *  convention. */
export function __resetUnscopedDbWarningsForTesting(): void {
  warnedUnscopedCallSites.clear();
}

function extractCallSiteFromStack(stack: string): string {
  // Pick the first stack frame that lives outside this file and outside
  // the warning machinery itself. That frame is the offending caller —
  // the one a future author needs to wrap (or mark with withUnscopedDb).
  const lines = stack.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    if (line.includes("/server/db.ts") || line.includes("\\server\\db.ts")) continue;
    if (line.includes("activeDb")) continue;
    if (line.includes("warnUnscopedDbAccess")) continue;
    if (line.includes("extractCallSiteFromStack")) continue;
    if (line.includes("Object.get") && line.includes("Proxy")) continue;
    return line;
  }
  return lines[1]?.trim() ?? "<unknown>";
}

function warnUnscopedDbAccess(): void {
  // Build the stack trace once and reuse for both the dedup key and the
  // warning payload. `Error.captureStackTrace` would also work but `new
  // Error().stack` is portable and is fine in the warm path because we
  // dedupe on the result.
  const stack = new Error("Unscoped db. call").stack ?? "";
  const callSite = extractCallSiteFromStack(stack);
  if (warnedUnscopedCallSites.has(callSite)) return;
  warnedUnscopedCallSites.add(callSite);

  const message =
    `[workspace-isolation] Unscoped db. call detected at ${callSite}. ` +
    `Wrap the caller in withCompanyScope(...) or withRlsBypass(...), or — ` +
    `if it is a deliberate pre-membership / cross-tenant auth lookup — ` +
    `mark it with withUnscopedDb(reason, fn). See ` +
    `docs/design/workspace-isolation-defense-in-depth.md.\n${stack}`;

  if (process.env.WORKSPACE_ISOLATION_GUARD === "throw") {
    // Opt-in CI escalation: turn the warning into a hard error. Keeps the
    // dedup add above so a single throw is enough — no point re-throwing
    // for every subsequent access from the same site.
    throw new Error(message);
  }
  // eslint-disable-next-line no-console
  console.warn(message);
}

function activeDb(): Drizzle {
  const store = dbContext.getStore();
  if (store?.scoped) return store.scoped;
  // Production: skip the warning entirely. The legitimate pre-membership
  // lookups in server/auth/middleware.ts run *every* request, and even
  // with dedup we don't want production noise around a code path the
  // static lint already audits at CI time.
  if (process.env.NODE_ENV !== "production" && !store?.unscoped) {
    warnUnscopedDbAccess();
  }
  return baseDb;
}

/**
 * Mark a region of code as deliberately running against the unscoped pool.
 *
 * The runtime guard in `activeDb()` warns the first time each call site
 * issues a `db.` call with no `withCompanyScope` / `withRlsBypass` in
 * flight. The legitimate pre-membership / cross-tenant auth lookups in
 * `server/auth/middleware.ts` (and anything else listed in the design doc
 * under "Tables intentionally out of scope") would trip that warning on
 * every request, so they wrap themselves in `withUnscopedDb(reason, fn)`
 * to silence the guard while keeping a grep-able audit marker.
 *
 * `reason` doubles as a search term — a future reviewer can grep for
 * `withUnscopedDb(` and see every audited unscoped path at a glance.
 *
 * The wrapped function continues to read/write through the unscoped pool
 * (no client check-out, no GUC change) — this helper does *not* establish
 * RLS bypass. Use `withRlsBypass` for that. The helper exists purely to
 * tell the runtime guard "we know what we're doing here".
 */
export async function withUnscopedDb<T>(
  reason: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!reason) throw new Error("withUnscopedDb: reason is required for audit");
  // Preserve any active workspace scope from an outer
  // `withCompanyScope`/`withRlsBypass` so a nested `withUnscopedDb` does
  // not silently drop the workspace pin. `activeDb()` checks `scoped`
  // first, so this turns the marker into a no-op when an outer scope is
  // already in flight (the right behaviour: there is nothing to suppress
  // and nothing to forget). The `unscoped` slot is still set so that an
  // inner caller without a scope keeps the audit-marker semantics.
  const existing = dbContext.getStore();
  return dbContext.run(
    { scoped: existing?.scoped, unscoped: { reason } },
    fn,
  );
}

export const db: Drizzle = new Proxy(baseDb, {
  get(target, prop, _receiver) {
    const actual = activeDb();
    const value = (actual as unknown as Record<string | symbol, unknown>)[
      prop as string | symbol
    ];
    // Bind methods to the actual underlying Drizzle instance so internal
    // `this`-references (session, dialect, query builders) stay coherent.
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(actual);
    }
    return value ?? (target as unknown as Record<string | symbol, unknown>)[
      prop as string | symbol
    ];
  },
}) as Drizzle;

/**
 * Run `fn` against a request-scoped Drizzle instance pinned to a single
 * pooled client whose `app.current_company_id` GUC matches `companyId`.
 *
 * The PG row-level-security policies on every workspace-scoped table consult
 * this GUC, so a query that "forgets" `WHERE company_id = …` automatically
 * returns zero rows for the wrong tenant instead of leaking data.
 *
 * The client is `RESET` and released even on thrown errors. We use
 * session-level `SET` (not `SET LOCAL`) so the GUC survives across the many
 * sub-transactions that a single request may open via `db.transaction(...)`.
 */
export async function withCompanyScope<T>(
  companyId: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error(`withCompanyScope: invalid companyId ${companyId}`);
  }
  const client = await connectWithRetry();
  try {
    // Escape: pg-node does not parameterise SET. companyId is a positive
    // integer at this point so the literal interpolation is safe.
    await client.query(`SET app.current_company_id = '${companyId}'`);
    await client.query(`SET app.rls_bypass = 'off'`);
    // Drop superuser privileges for the lifetime of this request — superusers
    // bypass RLS regardless of FORCE ROW LEVEL SECURITY, so without the role
    // switch the workspace_isolation policies would never fire. The role is
    // created by `migrations/0008_workspace_rls.sql` and granted to the
    // connecting role so SET ROLE succeeds. RESET ROLE on cleanup, below.
    await client.query(`SET ROLE app_api`);
    const scoped = drizzle(client, { schema });
    return await dbContext.run({ scoped }, fn);
  } finally {
    try {
      await client.query(
        `RESET ROLE; RESET app.current_company_id; RESET app.rls_bypass;`,
      );
    } catch {
      /* connection may already be unusable; release anyway */
    }
    client.release();
  }
}

/**
 * Run `fn` against a request-scoped Drizzle instance pinned to a single
 * pooled client whose `app.rls_bypass` GUC is `'on'`. The RLS policies on
 * workspace-scoped tables short-circuit to "row visible" in that mode.
 *
 * Bypass is the explicit, narrowly-scoped escape hatch for code that
 * legitimately reads or writes across workspaces (boot helpers, periodic
 * sweeps). Every call site is listed in
 * `docs/design/workspace-isolation-defense-in-depth.md` under "Bypass paths
 * (audited)" — the `reason` argument here doubles as a grep marker.
 */
export async function withRlsBypass<T>(
  reason: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!reason) throw new Error("withRlsBypass: reason is required for audit");
  const client = await connectWithRetry();
  try {
    await client.query(`SET app.rls_bypass = 'on'`);
    const scoped = drizzle(client, { schema });
    return await dbContext.run({ scoped }, fn);
  } finally {
    try {
      await client.query(
        `RESET app.rls_bypass; RESET app.current_company_id;`,
      );
    } catch {
      /* connection may already be unusable; release anyway */
    }
    client.release();
  }
}

/**
 * The single, named, grep-able way to say "I am about to create a new
 * workspace". Wraps `withRlsBypass("workspace:create", fn)`.
 *
 * Why a dedicated helper (task #167):
 *
 *   Creating a workspace is the one moment when the active scope is about
 *   to change. The seed chart of accounts and the per-workspace settings
 *   row are written under the *new* company's id, which never matches the
 *   `app.current_company_id` of the caller's existing scope — so the
 *   `workspace_isolation` RLS policies on `accounts` / `settings` reject
 *   the inserts unless we run with `app.rls_bypass = 'on'`.
 *
 *   Two of these paths exist today (`POST /api/companies` →
 *   `DatabaseStorage.createCompany`, and the signup-time bootstrap →
 *   `authBizStorage.createCompanyForOwner`); a future admin
 *   "clone workspace" tool, a bulk-import script, or a teammate-onboarding
 *   flow would hit the same wall the moment it ran from inside an existing
 *   workspace's scope. Funnelling every workspace-creation site through
 *   this one helper means:
 *
 *     1. The convention is grep-able — `withWorkspaceCreation(` is the
 *        single search term that surfaces every workspace-creation path.
 *     2. The lint at `tests/e2e/db-isolation-allowlist.spec.ts` can
 *        statically reject any future `db.insert(companies)` that does
 *        *not* sit inside a `withWorkspaceCreation(...)` block, so this
 *        isn't rediscovered the hard way.
 *
 * The bypass scope is intentionally narrow: it lasts only for the
 * insert + seed of the new workspace, and is released the moment `fn`
 * returns. Caller code outside the helper continues to run with the
 * original `app.current_company_id` scope.
 */
export async function withWorkspaceCreation<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return withRlsBypass("workspace:create", fn);
}
