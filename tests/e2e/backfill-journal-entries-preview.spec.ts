import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #237 — the owner-only "Re-pair missing journal
 * entries" card on /app/settings now ships with a count preview so an
 * owner can see whether they're about to fix 0, 4, or 4,000 entries
 * before they confirm. The settings UI calls
 * `GET /api/admin/backfill-journal-entries/preview`; the count it
 * surfaces must match exactly the rows the POST sibling will then act
 * on, otherwise the dialog would lie to the owner ("This will create N
 * entries — continue?" then a different N is created).
 *
 * This spec exercises the preview endpoint end-to-end against a fresh
 * workspace, against three states the UI cares about distinguishing:
 *
 *   1. A clean, just-bootstrapped workspace with no transactions →
 *      preview returns `{ count: 0 }` (drives the "Everything is in
 *      sync" indicator and the disabled button).
 *   2. A workspace with N transactions whose auto-posted JEs were
 *      orphaned in-database → preview returns `{ count: N }` (drives
 *      the "N transactions are missing journal entries" copy and the
 *      "This will create N entries — continue?" dialog).
 *   3. Immediately after the POST backfill, the preview returns
 *      `{ count: 0 }` again — i.e. the count flips back to "in sync"
 *      without a manual reload.
 *
 * Owner gating is checked separately (the existing route inherits the
 * same `requireRole("owner")` middleware as the POST sibling, which is
 * already covered by other specs in this folder); this spec focuses on
 * the count semantics the new UI depends on.
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
      `expected an object, got ${typeof value}: ${JSON.stringify(value)}`,
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

async function bootstrapOwner(salt: string): Promise<Session> {
  const jar = new CookieJar();
  const email = `backfill-preview-${salt}-${RUN_TAG}@example.test`;
  const forwardedFor = `10.${
    (salt.charCodeAt(0) + (Date.now() % 200)) & 0xff
  }.${(Date.now() >> 8) & 0xff}.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Preview",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Backfill Preview ${salt} ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    },
  });
  expect(company.status, `create company ${salt}: ${company.text}`).toBe(201);
  const companyId = asNumber(asObject(company.body).id, "company.id");

  return {
    jar,
    email,
    companyId,
    headers: { "x-company-id": String(companyId) },
  };
}

interface JournalEntry {
  id: number;
  sourceTransactionId: number | null;
}

async function pgConnect(): Promise<pg.Client> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  return client;
}

async function orphanJournalEntry(
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

async function getPreviewCount(s: Session): Promise<number> {
  const r = await call(
    "GET",
    "/api/admin/backfill-journal-entries/preview",
    s.jar,
    { headers: s.headers },
  );
  expect(r.status, `preview: ${r.text}`).toBe(200);
  const body = asObject(r.body);
  return asNumber(body.count, "preview.count");
}

test.describe(
  "GET /api/admin/backfill-journal-entries/preview reports the orphan count the POST will then act on @api",
  () => {
    test("count goes 0 → N → 0 across no-op, orphan, and recover-via-POST", async () => {
      const owner = await bootstrapOwner("orphan");

      // (1) Fresh workspace, no transactions yet → count must be 0 so the
      // settings card can flip to its "Everything is in sync" indicator
      // and disable the confirm button instead of inviting a no-op click.
      expect(
        await getPreviewCount(owner),
        "fresh workspace must report 0 missing JEs",
      ).toBe(0);

      // Post a couple of transactions so autoPostFromTransaction creates
      // their JE twins. We pick income + expense to mirror both branches
      // of the backfill helper.
      const txs: number[] = [];
      const tx1 = await call("POST", "/api/transactions", owner.jar, {
        body: {
          type: "income",
          amount: 100,
          description: `preview-orphan-income-${RUN_TAG}`,
          category: "PreviewOrphanRegression",
        },
        headers: owner.headers,
      });
      expect(tx1.status, `create income tx: ${tx1.text}`).toBe(201);
      txs.push(asNumber(asObject(tx1.body).id, "tx1.id"));

      const tx2 = await call("POST", "/api/transactions", owner.jar, {
        body: {
          type: "expense",
          amount: 42.5,
          description: `preview-orphan-expense-${RUN_TAG}`,
          category: "PreviewOrphanRegression",
        },
        headers: owner.headers,
      });
      expect(tx2.status, `create expense tx: ${tx2.text}`).toBe(201);
      txs.push(asNumber(asObject(tx2.body).id, "tx2.id"));

      // Both JEs were just auto-posted, so the count should still be 0 —
      // not "2", which would mean autoPostFromTransaction silently failed
      // (the original task #136 incident the backfill was authored for).
      expect(
        await getPreviewCount(owner),
        "auto-posted txs must not show up as missing JEs in the preview",
      ).toBe(0);

      // (2) Orphan both JEs in-database so the workspace is back in the
      // failure-mode state the recovery action exists for. The preview
      // must now report exactly 2 — the same number the POST sibling will
      // create when invoked.
      const client = await pgConnect();
      try {
        const jesResp = await call(
          "GET",
          "/api/journal-entries",
          owner.jar,
          { headers: owner.headers },
        );
        expect(jesResp.status).toBe(200);
        const jes = jesResp.body as JournalEntry[];
        const orphanIds = txs.map((txId) => {
          const je = jes.find((j) => j.sourceTransactionId === txId);
          expect(je, `JE for tx ${txId} should exist before orphaning`).toBeTruthy();
          return je!.id;
        });
        for (const jeId of orphanIds) {
          await orphanJournalEntry(client, owner.companyId, jeId);
        }

        expect(
          await getPreviewCount(owner),
          "after orphaning 2 JEs, preview must report exactly 2",
        ).toBe(2);

        // (3) The POST sibling consumes the same orphan set; after it
        // runs, the preview must drop back to 0 so the UI flips back to
        // the "Everything is in sync" state without a manual reload.
        const backfill = await call(
          "POST",
          "/api/admin/backfill-journal-entries",
          owner.jar,
          { headers: owner.headers },
        );
        expect(backfill.status, `backfill: ${backfill.text}`).toBe(200);
        const result = asObject(backfill.body);
        expect(
          asNumber(result.created, "backfill.created"),
          "backfill must create as many JEs as the preview promised",
        ).toBe(2);

        expect(
          await getPreviewCount(owner),
          "after the POST, preview must return to 0",
        ).toBe(0);
      } finally {
        await client.end();
      }
    });

    test("preview is per-workspace — owner of A never sees B's orphan count", async () => {
      // Two independent owners with their own workspaces. Owner A orphans
      // a JE in their workspace; the preview owner B sees must remain 0,
      // because the count is scoped by `cid(req)` exactly like the POST
      // sibling. If this assertion fails, an owner would see a
      // misleading "fix N entries" promise computed from rows that don't
      // belong to their workspace.
      const ownerA = await bootstrapOwner("a");
      const ownerB = await bootstrapOwner("b");

      const txA = await call("POST", "/api/transactions", ownerA.jar, {
        body: {
          type: "income",
          amount: 17,
          description: `preview-isolation-${RUN_TAG}`,
          category: "PreviewIsolationRegression",
        },
        headers: ownerA.headers,
      });
      expect(txA.status, `create tx in A: ${txA.text}`).toBe(201);
      const txAId = asNumber(asObject(txA.body).id, "txA.id");

      const client = await pgConnect();
      try {
        const jesA = (
          await call("GET", "/api/journal-entries", ownerA.jar, {
            headers: ownerA.headers,
          })
        ).body as JournalEntry[];
        const jeA = jesA.find((j) => j.sourceTransactionId === txAId);
        expect(jeA, "JE for txA should exist before orphaning").toBeTruthy();
        await orphanJournalEntry(client, ownerA.companyId, jeA!.id);

        expect(
          await getPreviewCount(ownerA),
          "owner A must see their own orphan reflected in the count",
        ).toBe(1);
        expect(
          await getPreviewCount(ownerB),
          "owner B must NOT see owner A's orphan in the count",
        ).toBe(0);
      } finally {
        await client.end();
      }
    });
  },
);
