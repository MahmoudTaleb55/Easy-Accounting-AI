/**
 * Regression test for the intermittent "No active workspace" (403) /
 * EMAXCONNSESSION (500) workspace-resolution bug.
 *
 * ROOT CAUSE (proven via runtime instrumentation + live-DB HTTP repro): the
 * app connects through the Supabase SESSION pooler, which caps simultaneous
 * client connections at a hard server-side ceiling (pool_size, 15 on this
 * tier). `withCompanyScope` pins ONE physical client per request for the whole
 * request lifetime, and the connect-pg-simple session store originally SHARED
 * that same pg pool. The post-login fan-out of ~15 concurrent /api/* GETs then
 * demanded more connections than the pooler allowed:
 *   - the pg pool `max` default (20) was ABOVE the pooler ceiling, so a 16th+
 *     physical connect was FATAL-ed by the pooler
 *     (`XX000 EMAXCONNSESSION max clients reached in session mode`), and
 *   - session reads (every request, before withCompanyScope) queued behind the
 *     long-lived pinned RLS clients and timed out ("timeout exceeded when
 *     trying to connect" from PGStore._asyncQuery).
 * Either path surfaced as an INTERMITTENT 500/403 for the SAME authenticated
 * single-membership user in the same instant — the reported symptom.
 *
 * THE FIX (server/db.ts + server/setup.ts): keep the TOTAL simultaneous
 * physical connections below the pooler ceiling by (1) sizing the
 * request-scoped pool below the ceiling so an over-limit acquire QUEUES
 * client-side instead of being FATAL-ed, and (2) giving the session store its
 * OWN dedicated pool so session reads can never be starved by pinned RLS
 * clients. The budget invariant is DB_POOL_MAX + DB_SESSION_POOL_MAX < ceiling.
 *
 * This test locks in that invariant and, when a database is reachable,
 * proves that bursting MORE concurrent withCompanyScope() scopes than
 * DB_POOL_MAX resolves cleanly (they queue + succeed) rather than throwing a
 * pooler FATAL or a connect timeout.
 */
import { describe, it, expect } from "vitest";
import { pool, sessionPool, withCompanyScope } from "./db";
import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * The Supabase session-pooler pool_size observed on this project tier. The
 * app's two pools MUST sum to strictly less than this so neither pool ever
 * asks the pooler for a connection it will refuse. Overridable so the test
 * stays meaningful on a larger tier.
 */
const POOLER_CEILING = Number(process.env.TEST_POOLER_CEILING) || 15;

describe("workspace-resolution connection budget", () => {
  it("keeps the request-scoped and session-store pools as SEPARATE pg pools", () => {
    // The whole point of the fix: session reads must not draw from the same
    // pool as the long-lived request-pinned RLS clients.
    expect(sessionPool).not.toBe(pool);
  });

  it("sizes both pools so their SUM stays below the session-pooler ceiling", () => {
    // pg exposes the configured max on the pool options.
    const requestMax = (pool as unknown as { options: { max?: number } }).options.max ?? 0;
    const sessionMax = (sessionPool as unknown as { options: { max?: number } }).options.max ?? 0;

    expect(requestMax).toBeGreaterThan(0);
    expect(sessionMax).toBeGreaterThan(0);
    // Strictly below the ceiling — never equal, to leave headroom for the few
    // connections opened outside both pools (boot migrations, reconnects).
    expect(requestMax + sessionMax).toBeLessThan(POOLER_CEILING);
  });

  it("bounds a client acquire with a timeout (never hangs forever)", () => {
    const timeout = (pool as unknown as { options: { connectionTimeoutMillis?: number } })
      .options.connectionTimeoutMillis ?? 0;
    expect(timeout).toBeGreaterThan(0);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDb)("workspace-resolution under concurrency (DB-backed)", () => {
  it(
    "resolves MORE concurrent withCompanyScope scopes than DB_POOL_MAX without a pooler FATAL",
    async () => {
      const requestMax = (pool as unknown as { options: { max?: number } }).options.max ?? 8;
      // Deliberately exceed the request pool size so the extra acquires must
      // QUEUE client-side. Before the fix (max > ceiling, shared session pool)
      // this burst produced EMAXCONNSESSION / connect-timeout 500s; after the
      // fix every scope queues and completes.
      const concurrency = requestMax + 6;

      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, (_, i) =>
          withCompanyScope(1, async () => {
            // A trivial scoped query that holds the pinned client briefly.
            await db.execute(sql`SELECT 1 AS ok`);
            return i;
          }),
        ),
      );

      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      // No scope should fail — specifically never with the pooler's FATAL.
      for (const r of rejected) {
        const msg = String((r.reason as { message?: string } | undefined)?.message ?? r.reason);
        expect(msg).not.toMatch(/EMAXCONNSESSION|max clients reached/i);
        expect(msg).not.toMatch(/timeout exceeded when trying to connect/i);
      }
      expect(rejected.length).toBe(0);
    },
    60_000,
  );
});
