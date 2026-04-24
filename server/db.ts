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

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
 */
const dbContext = new AsyncLocalStorage<{ scoped: Drizzle }>();

function activeDb(): Drizzle {
  return dbContext.getStore()?.scoped ?? baseDb;
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
  const client = await pool.connect();
  try {
    // Escape: pg-node does not parameterise SET. companyId is a positive
    // integer at this point so the literal interpolation is safe.
    await client.query(`SET app.current_company_id = '${companyId}'`);
    await client.query(`SET app.rls_bypass = 'off'`);
    // Drop superuser privileges for the lifetime of this request — superusers
    // bypass RLS regardless of FORCE ROW LEVEL SECURITY, so without the role
    // switch the workspace_isolation policies would never fire. The role is
    // created by `applyWorkspaceRlsOnStartup` and granted to the connecting
    // role so SET ROLE succeeds. RESET ROLE on cleanup, below.
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
  const client = await pool.connect();
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
