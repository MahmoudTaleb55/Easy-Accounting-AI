import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #222 — `recordAudit` (server/storage.ts) and the
 * mutations that call it must commit through the *same* DB transaction so a
 * failed audit write rolls the parent mutation back. Before #222, the audit
 * insert ran on its own implicit transaction; if the audit insert failed
 * (e.g. a workspace_isolation RLS rejection on `audit_log` since task #169,
 * a CHECK constraint violation, or a network blip between two pool
 * checkouts) the entity write had already committed and the audit history
 * silently dropped a row.
 *
 * This spec forces the failure deterministically by installing a BEFORE
 * INSERT trigger on `audit_log` that RAISEs whenever a `transaction`-type
 * `create` audit row is being inserted for the test workspace, then issues
 * a real `POST /api/transactions` HTTP request. The expectations:
 *
 *   1. The HTTP call surfaces a 5xx (the trigger error rethrows out of
 *      `db.transaction(async tx => …)`).
 *   2. The `transactions` table contains *no* new row for the test
 *      workspace — proof that the parent insert rolled back rather than
 *      committing without its audit row. This is the assertion that would
 *      have failed under the pre-#222 split-transaction shape.
 *   3. Removing the trigger and replaying the same request succeeds and
 *      *does* leave both rows behind, so the rollback in (2) was caused by
 *      the trigger and not by some unrelated server-side bug.
 *
 * Talks straight to Postgres via `pg.Client` for the trigger install/drop
 * and ad-hoc selects. The trigger is scoped to `company_id = <ours>` so it
 * cannot perturb other parallel specs that may be running against the same
 * DB.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";
const FIRST_NAME = "Audit";
const LAST_NAME = "Atomic";

class CookieJar {
  private store = new Map<string, string>();
  ingest(setCookieHeaders: string[]) {
    for (const h of setCookieHeaders) {
      const [pair] = h.split(";");
      const [name, ...rest] = pair.split("=");
      if (!name) continue;
      this.store.set(name.trim(), rest.join("=").trim());
    }
  }
  asHeader(): string {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

interface Session {
  jar: CookieJar;
  email: string;
  companyId: number;
  headers: Record<string, string>;
}

interface ApiResponse {
  status: number;
  body: unknown;
  text: string;
}

type HeadersWithGetSetCookie = Headers & { getSetCookie: () => string[] };

async function call(
  method: string,
  path: string,
  jar: CookieJar,
  init?: { body?: unknown; headers?: Record<string, string> },
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-proto": "https",
    cookie: jar.asHeader(),
    ...(init?.headers ?? {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const setCookie = (res.headers as HeadersWithGetSetCookie).getSetCookie?.() ?? [];
  if (setCookie.length) jar.ingest(setCookie);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body, text };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`expected an object, got ${typeof value}: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} expected number, got ${typeof value}: ${value}`);
  }
  return value;
}

async function bootstrapUser(salt: string): Promise<Session> {
  const jar = new CookieJar();
  const email = `audit-atomic-${salt}-${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP so the express signup rate limiter (keyed
  // by client IP) doesn't throttle the test on re-run.
  const forwardedFor = `10.${(salt.charCodeAt(0) + (Date.now() % 200)) & 0xff}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Audit Atomic ${salt} ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    },
  });
  expect(company.status, `create company ${salt}: ${company.text}`).toBe(201);
  const companyId = asNumber(asObject(company.body).id, "company.id");

  return { jar, email, companyId, headers: { "x-company-id": String(companyId) } };
}

async function pgConnect(): Promise<pg.Client> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  // Bypass workspace_isolation RLS so the trigger DDL and the cross-
  // workspace SELECT used by `countTransactions` aren't filtered by the
  // empty `current_company_id()` of this ad-hoc connection.
  await client.query(`SET app.rls_bypass = 'on'`);
  return client;
}

async function installAuditTrigger(
  pgc: pg.Client,
  companyId: number,
  triggerName: string,
): Promise<void> {
  // Per-company-scoped trigger so parallel specs targeting other workspaces
  // are not affected. Fires only on `transaction` create-audit rows for the
  // test workspace, mirroring the audit insert that happens inside
  // `createTransaction`'s `db.transaction(async tx => …)` block.
  await pgc.query(`
    CREATE OR REPLACE FUNCTION ${triggerName}_fn() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.entity_type = 'transaction'
         AND NEW.action = 'create'
         AND NEW.company_id = ${companyId} THEN
        RAISE EXCEPTION 'audit-write-atomic-rollback test trigger fired';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pgc.query(`
    DROP TRIGGER IF EXISTS ${triggerName} ON audit_log;
    CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION ${triggerName}_fn();
  `);
}

async function dropAuditTrigger(
  pgc: pg.Client,
  triggerName: string,
): Promise<void> {
  await pgc.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_log;`);
  await pgc.query(`DROP FUNCTION IF EXISTS ${triggerName}_fn();`);
}

async function countTransactions(
  pgc: pg.Client,
  companyId: number,
): Promise<number> {
  const r = await pgc.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM transactions WHERE company_id = $1`,
    [companyId],
  );
  return Number(r.rows[0].c);
}

test.describe("recordAudit + entity write commit atomically @api", () => {
  test.skip(
    !process.env.DATABASE_URL,
    "DATABASE_URL not set — atomic-audit spec needs Postgres access",
  );

  test("a failed audit insert rolls back the parent transaction insert", async () => {
    const user = await bootstrapUser("rb");
    const pgc = await pgConnect();
    // Suffix with the timestamp+random salt so parallel test workers can
    // each install their own trigger without colliding on the global name.
    const triggerName = `t222_audit_block_${RUN_TAG.replace(/[^a-z0-9]/gi, "_")}`;

    try {
      const beforeCount = await countTransactions(pgc, user.companyId);

      // Step 1: install the trigger that will RAISE on the audit insert
      // performed inside `createTransaction`'s db.transaction block.
      await installAuditTrigger(pgc, user.companyId, triggerName);

      // Step 2: POST /api/transactions — expected to fail because the
      // trigger error rethrows out of the db.transaction callback,
      // surfacing as a 5xx at the route boundary.
      const blocked = await call("POST", "/api/transactions", user.jar, {
        body: {
          type: "income",
          amount: 123,
          description: `audit-rollback-${RUN_TAG}`,
          category: "RollbackRegression",
        },
        headers: user.headers,
      });
      expect(
        blocked.status,
        `expected the audit-blocked POST /api/transactions to return 5xx, ` +
          `got ${blocked.status}: ${blocked.text}`,
      ).toBeGreaterThanOrEqual(500);

      // Step 3: the *parent* mutation must have rolled back. If
      // recordAudit and the transaction insert weren't sharing one
      // db.transaction (the pre-#222 shape), the transaction row would
      // have committed before the audit insert was even attempted and
      // this count would be `beforeCount + 1`.
      const afterBlockedCount = await countTransactions(pgc, user.companyId);
      expect(
        afterBlockedCount,
        `the failed audit insert must have rolled back the parent transactions ` +
          `insert. Before=${beforeCount}, after-blocked=${afterBlockedCount}. ` +
          `If after-blocked == before+1 this means the entity write committed ` +
          `independently of the audit write — task #222 has regressed.`,
      ).toBe(beforeCount);

      // Step 4: drop the trigger and replay the same call. It must now
      // succeed end-to-end and leave both the transaction row *and* the
      // audit row behind. This rules out a coincidental rollback caused
      // by some other server-side error path.
      await dropAuditTrigger(pgc, triggerName);

      const ok = await call("POST", "/api/transactions", user.jar, {
        body: {
          type: "income",
          amount: 123,
          description: `audit-rollback-replay-${RUN_TAG}`,
          category: "RollbackRegression",
        },
        headers: user.headers,
      });
      expect(
        ok.status,
        `replay POST /api/transactions after dropping the trigger should be ` +
          `201, got ${ok.status}: ${ok.text}`,
      ).toBe(201);

      const finalCount = await countTransactions(pgc, user.companyId);
      expect(
        finalCount,
        `replay should have inserted exactly one transaction row`,
      ).toBe(beforeCount + 1);

      // And the audit row for the replayed insert must exist (proving
      // the success path also threads recordAudit through the same
      // transaction — the row commits inside the same unit as the entity
      // write).
      const txId = asNumber(asObject(ok.body).id, "transaction.id");
      const auditRows = await pgc.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM audit_log
         WHERE company_id = $1 AND entity_type = 'transaction'
           AND entity_id = $2 AND action = 'create'`,
        [user.companyId, txId],
      );
      expect(
        Number(auditRows.rows[0].count),
        `replay should have written exactly one create-audit row for the ` +
          `transaction it inserted`,
      ).toBe(1);
    } finally {
      // Belt-and-braces cleanup: even if an assertion above failed mid-run
      // we must not leave the trigger installed (it would poison every
      // other parallel spec that touches `transactions` for this
      // workspace).
      await dropAuditTrigger(pgc, triggerName).catch(() => {});
      await pgc.end();
    }
  });
});
