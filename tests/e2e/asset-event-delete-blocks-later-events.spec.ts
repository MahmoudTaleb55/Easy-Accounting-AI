import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #209 — refuse to delete an impairment / revaluation /
 * disposal event when the same `assetId` has at least one *later* event of any
 * kind. The delta-rollback in task #157 only knows how to subtract this event's
 * own snapshot; a later event's posting math used the post-this-event balances,
 * so undoing this event in isolation would leave the later event's snapshot
 * inconsistent (e.g. an impairment posted on top of a revaluation has computed
 * its loss against the revalued cost — undoing the revaluation invalidates that
 * loss).
 *
 * Mirrors the 409 test pattern in `auto-post-delete-reverses-journal.spec.ts`
 * (the JE-orphan guard from task #111). For each event kind we seed an "A then
 * B" pair on the same asset and assert:
 *   - DELETE A returns 409 with a clear message
 *   - both A and its journal entry remain in place
 *   - deleting B first, then A, succeeds (proving the guard is per-asset,
 *     not a blanket prohibition)
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
  const email = `asset-evt-later-${salt}-${RUN_TAG}@example.test`;
  const forwardedFor = `10.${(salt.charCodeAt(0) + (Date.now() % 200)) & 0xff}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Asset",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Asset Later ${salt} ${RUN_TAG}`,
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

async function postJson(
  s: Session,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await call("POST", path, s.jar, { body, headers: s.headers });
  if (r.status !== 201) {
    throw new Error(`POST ${path} expected 201, got ${r.status}: ${r.text}`);
  }
  return asObject(r.body);
}

async function pgConnect(): Promise<pg.Client> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  return client;
}

async function rowExists(
  client: pg.Client,
  table: string,
  id: number,
  companyId: number,
): Promise<boolean> {
  const r = await client.query<{ id: number }>(
    `SELECT id FROM ${table} WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return r.rowCount! > 0;
}

async function journalEntryExists(client: pg.Client, jeId: number): Promise<boolean> {
  const r = await client.query(`SELECT id FROM journal_entries WHERE id = $1`, [jeId]);
  return r.rowCount! > 0;
}

/**
 * Seeds two distinct, balanced manual journal entries so the "earlier" and
 * "later" event each get their own JE — keeps the test focused on the new
 * later-event guard rather than the existing JE-orphan guard.
 */
async function seedAccountsAndTwoJournalEntries(
  s: Session,
  tag: string,
): Promise<{ acc1Id: number; acc2Id: number; je1Id: number; je2Id: number }> {
  const acc1 = await postJson(s, "/api/accounts", {
    code: `9100-${tag}`,
    nameAr: `حساب ١ ${tag}`,
    nameEn: `Account 1 ${tag}`,
    type: "asset",
    subtype: "current_asset",
    isHeader: false,
    isActive: true,
  });
  const acc2 = await postJson(s, "/api/accounts", {
    code: `9200-${tag}`,
    nameAr: `حساب ٢ ${tag}`,
    nameEn: `Account 2 ${tag}`,
    type: "expense",
    subtype: "operating_expense",
    isHeader: false,
    isActive: true,
  });

  const mkJe = async (label: string) => {
    const je = await postJson(s, "/api/journal-entries", {
      description: `Asset later JE ${label} ${tag}`,
      source: "manual",
      lines: [
        { accountId: acc1.id, debit: 1000, credit: 0 },
        { accountId: acc2.id, debit: 0, credit: 1000 },
      ],
    });
    return asNumber(je.id, "je.id");
  };
  return {
    acc1Id: asNumber(acc1.id, "acc1.id"),
    acc2Id: asNumber(acc2.id, "acc2.id"),
    je1Id: await mkJe("first"),
    je2Id: await mkJe("second"),
  };
}

async function seedFixedAsset(
  client: pg.Client,
  s: Session,
  tag: string,
): Promise<number> {
  const accountIds: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = await postJson(s, "/api/accounts", {
      code: `8${i}00-${tag}`,
      nameAr: `حساب أصول ${i} ${tag}`,
      nameEn: `Asset Account ${i} ${tag}`,
      type: i < 4 ? "asset" : i < 6 ? "expense" : "equity",
      subtype: i < 4 ? "non_current_asset" : i < 6 ? "operating_expense" : "equity",
      isHeader: false,
      isActive: true,
    });
    accountIds.push(asNumber(a.id, `acc[${i}].id`));
  }
  const cat = await client.query<{ id: number }>(
    `INSERT INTO asset_categories
       (company_id, name, measurement_model, default_useful_life_months,
        default_method, asset_cost_account_id, accumulated_dep_account_id,
        dep_expense_account_id, accumulated_imp_account_id, imp_loss_account_id,
        reval_surplus_account_id, gain_loss_disposal_account_id)
     VALUES ($1, $2, 'cost', 60, 'straight_line',
             $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [s.companyId, `Cat ${tag}`, ...accountIds],
  );
  const categoryId = cat.rows[0].id;

  const asset = await client.query<{ id: number }>(
    `INSERT INTO fixed_assets
       (company_id, category_id, code, name, acquisition_date, in_service_date,
        currency, tx_cost, fx_rate, cost, residual, useful_life_months,
        method, measurement_model, status)
     VALUES ($1, $2, $3, $4, '2099-01-01', '2099-01-01',
             'USD', '10000.00', '1', '10000.00', '0', 60,
             'straight_line', 'cost', 'active')
     RETURNING id`,
    [s.companyId, categoryId, `A-${tag}`, `Asset ${tag}`],
  );
  return asset.rows[0].id;
}

/** Inserts an event row with an explicit `created_at` so we can deterministically
 * order "earlier" vs "later" in tests without leaning on wall-clock skew. The
 * `asset_balance_delta` snapshot is set to a non-null payload so the legacy-
 * row guard (task #208) doesn't preempt the later-event guard we're testing. */
async function insertImpairment(
  client: pg.Client,
  s: Session,
  assetId: number,
  jeId: number,
  createdAtIso: string,
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO impairment_events
       (company_id, asset_id, event_date, recoverable_amount, loss_amount,
        journal_entry_id, created_at, asset_balance_delta)
     VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3, $4, $5)
     RETURNING id`,
    [
      s.companyId,
      assetId,
      jeId,
      createdAtIso,
      JSON.stringify({ asset: { accumImpairment: 0 } }),
    ],
  );
  return r.rows[0].id;
}

async function insertRevaluation(
  client: pg.Client,
  s: Session,
  assetId: number,
  jeId: number,
  createdAtIso: string,
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO revaluation_events
       (company_id, asset_id, event_date, fair_value, method,
        surplus_delta, pl_impact, journal_entry_id, created_at,
        asset_balance_delta)
     VALUES ($1, $2, '2099-08-31', '12000.00', 'elimination',
             '2000.00', '0.00', $3, $4, $5)
     RETURNING id`,
    [
      s.companyId,
      assetId,
      jeId,
      createdAtIso,
      JSON.stringify({ asset: { revalSurplus: 0 } }),
    ],
  );
  return r.rows[0].id;
}

async function insertDisposal(
  client: pg.Client,
  s: Session,
  assetId: number,
  jeId: number,
  createdAtIso: string,
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO disposals
       (company_id, asset_id, event_date, proceeds, method,
        gain_loss, surplus_transferred, journal_entry_id, created_at,
        asset_balance_delta)
     VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
             '-2000.00', '0.00', $3, $4, $5)
     RETURNING id`,
    [
      s.companyId,
      assetId,
      jeId,
      createdAtIso,
      JSON.stringify({ asset: { statusBefore: "active" } }),
    ],
  );
  return r.rows[0].id;
}

const EARLIER = "2099-06-01T10:00:00Z";
const LATER = "2099-09-01T10:00:00Z";

// ---------------------------------------------------------------------------
// Impairment with a later revaluation on the same asset.
// ---------------------------------------------------------------------------

test.describe("DELETE /api/impairment-events/:id refuses when a later event exists @api", () => {
  test("returns 409 because a revaluation was posted afterwards on the same asset", async () => {
    const user = await bootstrapUser("imp-blk");
    const seeded = await seedAccountsAndTwoJournalEntries(user, `imp-blk-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-blk-${user.companyId}`);
      const impairmentId = await insertImpairment(client, user, assetId, seeded.je1Id, EARLIER);
      const revaluationId = await insertRevaluation(client, user, assetId, seeded.je2Id, LATER);

      const del = await call(
        "DELETE",
        `/api/impairment-events/${impairmentId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message).toBe("string");
      expect(String(body.message).length).toBeGreaterThan(10);

      // Both rows + the JE survive intact.
      expect(await rowExists(client, "impairment_events", impairmentId, user.companyId)).toBe(true);
      expect(await rowExists(client, "revaluation_events", revaluationId, user.companyId)).toBe(true);
      expect(await journalEntryExists(client, seeded.je1Id)).toBe(true);

      // Deleting the later event first must succeed, and then the earlier
      // event becomes deletable — proving the guard is "later-event only",
      // not a blanket prohibition.
      const delLater = await call(
        "DELETE",
        `/api/revaluation-events/${revaluationId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(delLater.status, `cleanup later: ${delLater.text}`).toBe(204);

      const delEarlier = await call(
        "DELETE",
        `/api/impairment-events/${impairmentId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(delEarlier.status, `cleanup earlier: ${delEarlier.text}`).toBe(204);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Revaluation with a later impairment on the same asset.
// ---------------------------------------------------------------------------

test.describe("DELETE /api/revaluation-events/:id refuses when a later event exists @api", () => {
  test("returns 409 because an impairment was posted afterwards on the same asset", async () => {
    const user = await bootstrapUser("rev-blk");
    const seeded = await seedAccountsAndTwoJournalEntries(user, `rev-blk-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `rev-blk-${user.companyId}`);
      const revaluationId = await insertRevaluation(client, user, assetId, seeded.je1Id, EARLIER);
      const impairmentId = await insertImpairment(client, user, assetId, seeded.je2Id, LATER);

      const del = await call(
        "DELETE",
        `/api/revaluation-events/${revaluationId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);

      expect(await rowExists(client, "revaluation_events", revaluationId, user.companyId)).toBe(true);
      expect(await rowExists(client, "impairment_events", impairmentId, user.companyId)).toBe(true);
      expect(await journalEntryExists(client, seeded.je1Id)).toBe(true);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Disposal with a later disposal on the same asset (same-table case — the
// most likely realistic scenario for two events of the same kind being
// chained, eg a partial then full disposal).
// ---------------------------------------------------------------------------

test.describe("DELETE /api/disposals/:id refuses when a later event exists @api", () => {
  test("returns 409 because a later disposal exists on the same asset", async () => {
    const user = await bootstrapUser("dis-blk");
    const seeded = await seedAccountsAndTwoJournalEntries(user, `dis-blk-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `dis-blk-${user.companyId}`);
      const earlierDisposalId = await insertDisposal(client, user, assetId, seeded.je1Id, EARLIER);
      const laterDisposalId = await insertDisposal(client, user, assetId, seeded.je2Id, LATER);

      const del = await call(
        "DELETE",
        `/api/disposals/${earlierDisposalId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);

      expect(await rowExists(client, "disposals", earlierDisposalId, user.companyId)).toBe(true);
      expect(await rowExists(client, "disposals", laterDisposalId, user.companyId)).toBe(true);
      expect(await journalEntryExists(client, seeded.je1Id)).toBe(true);
    } finally {
      await client.end();
    }
  });

  test("ignores later events on a *different* asset (the guard is per-asset)", async () => {
    const user = await bootstrapUser("dis-iso");
    const seeded = await seedAccountsAndTwoJournalEntries(user, `dis-iso-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetA = await seedFixedAsset(client, user, `dis-iso-A-${user.companyId}`);
      const assetB = await seedFixedAsset(client, user, `dis-iso-B-${user.companyId}`);
      const targetDisposalId = await insertDisposal(client, user, assetA, seeded.je1Id, EARLIER);
      // Later event lives on a different asset — must NOT block the delete.
      await insertImpairment(client, user, assetB, seeded.je2Id, LATER);

      const del = await call(
        "DELETE",
        `/api/disposals/${targetDisposalId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 204, got ${del.status}: ${del.text}`).toBe(204);
      expect(await rowExists(client, "disposals", targetDisposalId, user.companyId)).toBe(false);
    } finally {
      await client.end();
    }
  });
});
