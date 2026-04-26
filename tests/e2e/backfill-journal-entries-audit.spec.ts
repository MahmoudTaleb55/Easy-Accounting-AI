import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Task #236 — audit trail for the journal-entry recovery action.
 *
 * The owner-only `POST /api/admin/backfill-journal-entries` endpoint heals
 * orphaned transactions by re-posting their JEs. Three things must be true
 * after a successful invocation:
 *
 *   1. A single per-invocation `backfill/create` audit row is appended,
 *      attributing the action to the calling owner with a `changes` payload
 *      that carries `{ created, skipped, triggered_via }` so a future
 *      "who re-paired the books?" question always has an answer.
 *
 *   2. Each backfilled JE carries the same `journal_entry/create` audit
 *      row a manually-posted entry does, with the actor stamped as
 *      "backfill on behalf of <owner>" so the History drawer surfaces
 *      the recovery lineage instead of leaving the JE looking
 *      authorless.
 *
 *   3. The companion `GET /api/admin/backfill-journal-entries/last-run`
 *      endpoint returns the row written above so /app/settings can
 *      render "Last run by <owner> on <date>" under the Re-pair card.
 *
 * The transaction-autopost-and-backfill spec already covers the
 * functional pipeline (JE shape, balance, source linkage); this spec is
 * purely about the audit metadata surfaces.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";

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
  const setCookie =
    (res.headers as HeadersWithGetSetCookie).getSetCookie?.() ?? [];
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
    throw new Error(
      `expected object, got ${typeof value}: ${JSON.stringify(value)}`,
    );
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} expected number, got ${typeof value}: ${value}`);
  }
  return value;
}

async function bootstrapOwner(): Promise<Session> {
  const jar = new CookieJar();
  const email = `backfill-audit-${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP so the express signup rate limiter
  // (keyed by client IP) does not throttle this test on re-runs.
  const forwardedFor = `10.${(Date.now() & 0xff)}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Backfill",
      lastName: "Auditor",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Backfill Audit ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    },
  });
  expect(company.status, `create company: ${company.text}`).toBe(201);
  const companyId = asNumber(asObject(company.body).id, "company.id");

  return {
    jar,
    email,
    companyId,
    headers: { "x-company-id": String(companyId) },
  };
}

async function pgConnect(): Promise<pg.Client> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  return client;
}

interface JournalLine {
  accountId: number;
  debit: string | number;
  credit: string | number;
}

interface JournalEntry {
  id: number;
  sourceTransactionId: number | null;
  lines: JournalLine[];
}

async function orphanJE(
  client: pg.Client,
  companyId: number,
  jeId: number,
): Promise<void> {
  await client.query(
    `DELETE FROM journal_lines WHERE journal_entry_id = $1 AND company_id = $2`,
    [jeId, companyId],
  );
  await client.query(
    `DELETE FROM journal_entries WHERE id = $1 AND company_id = $2`,
    [jeId, companyId],
  );
}

test.describe("backfill-journal-entries writes a complete audit trail @api", () => {
  test("admin invocation writes a per-run summary row, per-JE attribution, and the last-run endpoint surfaces it", async () => {
    const owner = await bootstrapOwner();
    const ownerName = "Backfill Auditor";

    // Post a transaction so autoPostFromTransaction creates a JE we can
    // orphan and recover. We'll use income (Dr cash / Cr revenue).
    const txResp = await call("POST", "/api/transactions", owner.jar, {
      body: {
        type: "income",
        amount: 123.45,
        description: `audit-trail-${RUN_TAG}`,
        category: "AuditTrailRegression",
      },
      headers: owner.headers,
    });
    expect(txResp.status, `create transaction: ${txResp.text}`).toBe(201);
    const txId = asNumber(asObject(txResp.body).id, "transaction.id");

    const beforeJEs = await call(
      "GET",
      "/api/journal-entries",
      owner.jar,
      { headers: owner.headers },
    );
    expect(beforeJEs.status).toBe(200);
    const autoPosted = (beforeJEs.body as JournalEntry[]).find(
      (j) => j.sourceTransactionId === txId,
    );
    expect(autoPosted, "auto-posted JE must exist before we orphan it").toBeTruthy();

    // Orphan the JE so the next backfill run actually creates one row.
    const client = await pgConnect();
    let recoveredJeId: number;
    try {
      await orphanJE(client, owner.companyId, autoPosted!.id);

      // Sanity: the last-run endpoint should be reachable but report
      // null before we ever invoke the backfill on this fresh workspace.
      const beforeLastRun = await call(
        "GET",
        "/api/admin/backfill-journal-entries/last-run",
        owner.jar,
        { headers: owner.headers },
      );
      expect(
        beforeLastRun.status,
        `last-run before invocation: ${beforeLastRun.text}`,
      ).toBe(200);
      expect(asObject(beforeLastRun.body).lastRun).toBeNull();

      // ---- Run the backfill ----
      const runResp = await call(
        "POST",
        "/api/admin/backfill-journal-entries",
        owner.jar,
        { headers: owner.headers },
      );
      expect(runResp.status, `backfill run: ${runResp.text}`).toBe(200);
      const runResult = asObject(runResp.body);
      expect(asNumber(runResult.created, "created")).toBeGreaterThanOrEqual(1);

      // The recovered JE must exist again under the same source tx.
      const afterJEs = await call(
        "GET",
        "/api/journal-entries",
        owner.jar,
        { headers: owner.headers },
      );
      expect(afterJEs.status).toBe(200);
      const recovered = (afterJEs.body as JournalEntry[]).find(
        (j) => j.sourceTransactionId === txId,
      );
      expect(
        recovered,
        "recovered JE must exist after backfill run",
      ).toBeTruthy();
      recoveredJeId = recovered!.id;

      // ---- Deliverable 1: per-invocation summary audit row exists,
      // attributes the action to the caller, and carries the
      // {created, skipped, triggered_via} payload. ----
      //
      // Read directly from the DB because there is no GET /api/audit
      // endpoint for the `backfill` entity type — the row is exposed
      // to UIs through the dedicated last-run endpoint instead.
      const summaryRows = await client.query(
        `SELECT actor, source, action, changes
         FROM audit_log
         WHERE entity_type = 'backfill'
           AND entity_id = $1
           AND company_id = $1
         ORDER BY occurred_at DESC
         LIMIT 5`,
        [owner.companyId],
      );
      expect(
        summaryRows.rowCount,
        `expected exactly 1 backfill summary row, got ${summaryRows.rowCount}`,
      ).toBe(1);
      const summary = summaryRows.rows[0] as {
        actor: string | null;
        source: string;
        action: string;
        changes: Array<{ field: string; to: unknown }>;
      };
      expect(summary.action).toBe("create");
      expect(
        summary.actor,
        `summary actor must be the calling owner ("${ownerName}"), got ${summary.actor}`,
      ).toBe(ownerName);
      expect(summary.source).toBe("user");
      const changesByField = new Map(
        (summary.changes ?? []).map((c) => [c.field, c.to]),
      );
      expect(
        Number(changesByField.get("created")),
        "summary must record the JE-created count",
      ).toBeGreaterThanOrEqual(1);
      expect(
        Number(changesByField.get("skipped")),
        "summary must record the skipped count (zero is fine)",
      ).toBeGreaterThanOrEqual(0);
      expect(
        changesByField.get("triggered_via"),
        "summary must stamp triggered_via='admin-route' for owner-initiated runs",
      ).toBe("admin-route");

      // ---- Deliverable 2: per-JE audit row with backfill lineage. ----
      const jeAudit = await call(
        "GET",
        `/api/audit/journal_entry/${recoveredJeId}`,
        owner.jar,
        { headers: owner.headers },
      );
      expect(
        jeAudit.status,
        `per-JE audit lookup: ${jeAudit.text}`,
      ).toBe(200);
      const events = jeAudit.body as Array<{
        action: string;
        actor: string | null;
      }> | null;
      expect(
        Array.isArray(events) && events.length >= 1,
        `recovered JE ${recoveredJeId} must have at least one audit event`,
      ).toBe(true);
      const created = events!.find((e) => e.action === "create");
      expect(
        created,
        `recovered JE must have a 'create' audit event`,
      ).toBeTruthy();
      expect(
        created!.actor,
        `recovered JE actor must name the backfill lineage and the owner; got "${created!.actor}"`,
      ).toBe(`backfill on behalf of ${ownerName}`);

      // ---- Deliverable 3: the last-run endpoint surfaces the row. ----
      const afterLastRun = await call(
        "GET",
        "/api/admin/backfill-journal-entries/last-run",
        owner.jar,
        { headers: owner.headers },
      );
      expect(
        afterLastRun.status,
        `last-run after invocation: ${afterLastRun.text}`,
      ).toBe(200);
      const lastRun = asObject(afterLastRun.body).lastRun;
      expect(lastRun, "lastRun must be non-null after a successful invocation").toBeTruthy();
      const lr = asObject(lastRun);
      expect(lr.actor).toBe(ownerName);
      expect(lr.triggeredVia).toBe("admin-route");
      expect(asNumber(lr.created, "lastRun.created")).toBeGreaterThanOrEqual(1);
      // occurredAt must parse as a valid ISO date — the settings UI runs
      // it through `new Date(...)` for the "on <date>" line, so an
      // unparseable value would render "Invalid Date".
      expect(
        Number.isFinite(new Date(String(lr.occurredAt)).getTime()),
        `lastRun.occurredAt must be a valid ISO date, got ${lr.occurredAt}`,
      ).toBe(true);
    } finally {
      await client.end();
    }
  });
});
