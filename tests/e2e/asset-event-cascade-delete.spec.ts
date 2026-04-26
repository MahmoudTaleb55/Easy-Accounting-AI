import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #262 — `?cascade=true` on the impairment /
 * revaluation / disposal delete routes atomically reverses every later event
 * on the same asset (latest first) before reversing the target row, so the
 * user can undo a chain with one click instead of having to discover the
 * order and manually delete each later event in reverse.
 *
 * Mirrors the seed pattern in `asset-event-delete-blocks-later-events.spec.ts`
 * (the task #209 "no later events" guard). For the happy path we seed an
 * "A then B then C" chain on the same asset and assert:
 *   - DELETE A?cascade=true returns 204
 *   - all three rows are gone
 *   - all three journal entries are gone
 *   - rows on a *different* asset survive untouched
 *
 * For the conflict path we attach an unrelated module to the latest event's
 * JE (a manual sales invoice that points at the same JE) and assert the
 * cascade refuses with 409 and leaves every row in place — the JE-orphan
 * guard from task #111 still wins.
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
  const email = `asset-evt-cascade-${salt}-${RUN_TAG}@example.test`;
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
      name: `Asset Cascade ${salt} ${RUN_TAG}`,
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

async function seedAccountsAndManualJournalEntries(
  s: Session,
  tag: string,
  count: number,
): Promise<{ acc1Id: number; acc2Id: number; jeIds: number[] }> {
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

  const jeIds: number[] = [];
  for (let i = 0; i < count; i++) {
    const je = await postJson(s, "/api/journal-entries", {
      description: `Asset cascade JE ${i} ${tag}`,
      source: "manual",
      lines: [
        { accountId: acc1.id, debit: 1000, credit: 0 },
        { accountId: acc2.id, debit: 0, credit: 1000 },
      ],
    });
    jeIds.push(asNumber(je.id, `je[${i}].id`));
  }

  return {
    acc1Id: asNumber(acc1.id, "acc1.id"),
    acc2Id: asNumber(acc2.id, "acc2.id"),
    jeIds,
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

/** Same insertion shape as the task #209 spec — explicit `created_at` so we
 * can deterministically order earlier vs later, and a non-null
 * `asset_balance_delta` so the legacy-row guard (task #208) doesn't preempt
 * the cascade we're testing. */
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

const T_EARLY = "2099-06-01T10:00:00Z";
const T_MID = "2099-09-01T10:00:00Z";
const T_LATE = "2099-12-01T10:00:00Z";

// ---------------------------------------------------------------------------
// Happy path: cascade-delete the earliest of three chained events on the
// same asset; the entire chain (and its journal entries) must vanish.
// ---------------------------------------------------------------------------

test.describe("DELETE /api/impairment-events/:id?cascade=true reverses the whole chain @api", () => {
  test("cascade-deletes A while B and C exist on the same asset; all three rows + their JEs are gone", async () => {
    const user = await bootstrapUser("imp-cas");
    const seeded = await seedAccountsAndManualJournalEntries(
      user,
      `imp-cas-${user.companyId}`,
      4,
    );
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-cas-${user.companyId}`);
      const otherAsset = await seedFixedAsset(client, user, `imp-cas-other-${user.companyId}`);

      // A (earliest, target), B (middle revaluation), C (latest disposal).
      const aId = await insertImpairment(client, user, assetId, seeded.jeIds[0], T_EARLY);
      const bId = await insertRevaluation(client, user, assetId, seeded.jeIds[1], T_MID);
      const cId = await insertDisposal(client, user, assetId, seeded.jeIds[2], T_LATE);

      // Sentinel on a *different* asset — the cascade must not touch it.
      const sentinelImpId = await insertImpairment(
        client,
        user,
        otherAsset,
        seeded.jeIds[3],
        T_LATE,
      );

      const del = await call(
        "DELETE",
        `/api/impairment-events/${aId}?cascade=true`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `cascade delete: ${del.text}`).toBe(204);

      // All three event rows + their JEs are gone.
      expect(await rowExists(client, "impairment_events", aId, user.companyId)).toBe(false);
      expect(await rowExists(client, "revaluation_events", bId, user.companyId)).toBe(false);
      expect(await rowExists(client, "disposals", cId, user.companyId)).toBe(false);
      expect(await journalEntryExists(client, seeded.jeIds[0])).toBe(false);
      expect(await journalEntryExists(client, seeded.jeIds[1])).toBe(false);
      expect(await journalEntryExists(client, seeded.jeIds[2])).toBe(false);

      // Per-asset scope: the sentinel on a different asset survives.
      expect(await rowExists(client, "impairment_events", sentinelImpId, user.companyId)).toBe(true);
      expect(await journalEntryExists(client, seeded.jeIds[3])).toBe(true);
    } finally {
      await client.end();
    }
  });

  test("without ?cascade=true the same chain still 409s with the later-event guard", async () => {
    const user = await bootstrapUser("imp-noc");
    const seeded = await seedAccountsAndManualJournalEntries(
      user,
      `imp-noc-${user.companyId}`,
      3,
    );
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-noc-${user.companyId}`);
      const aId = await insertImpairment(client, user, assetId, seeded.jeIds[0], T_EARLY);
      const bId = await insertRevaluation(client, user, assetId, seeded.jeIds[1], T_MID);
      const cId = await insertDisposal(client, user, assetId, seeded.jeIds[2], T_LATE);

      // Default (no cascade flag) still returns 409 — the friendlier path is
      // strictly opt-in.
      const blocked = await call(
        "DELETE",
        `/api/impairment-events/${aId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(blocked.status, `default delete: ${blocked.text}`).toBe(409);
      expect(await rowExists(client, "impairment_events", aId, user.companyId)).toBe(true);
      expect(await rowExists(client, "revaluation_events", bId, user.companyId)).toBe(true);
      expect(await rowExists(client, "disposals", cId, user.companyId)).toBe(true);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Cascade respects the JE-orphan guard: if the latest event's JE has been
// picked up by an unrelated module (here, a sales invoice pointing at the
// same JE), the whole cascade aborts with 409 and nothing changes.
// ---------------------------------------------------------------------------

test.describe("DELETE /api/impairment-events/:id?cascade=true honours the JE-orphan guard @api", () => {
  test("aborts the cascade with 409 when a later event's JE is referenced by an unrelated module", async () => {
    const user = await bootstrapUser("imp-orph");
    const seeded = await seedAccountsAndManualJournalEntries(
      user,
      `imp-orph-${user.companyId}`,
      3,
    );
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-orph-${user.companyId}`);
      const aId = await insertImpairment(client, user, assetId, seeded.jeIds[0], T_EARLY);
      const bId = await insertRevaluation(client, user, assetId, seeded.jeIds[1], T_MID);
      const cId = await insertDisposal(client, user, assetId, seeded.jeIds[2], T_LATE);

      // Force a payroll-run row to point at the latest event's JE — the
      // JE-orphan guard from task #111 must refuse to silently reverse
      // someone else's reference even within a cascade. Payroll runs are
      // the simplest "owns a JE" sibling table (no FKs to seed first).
      await client.query(
        `INSERT INTO payroll_runs
           (company_id, year, month, status, total_gross, total_net,
            journal_entry_id)
         VALUES ($1, 2099, 12, 'posted', '0', '0', $2)`,
        [user.companyId, seeded.jeIds[2]],
      );

      const del = await call(
        "DELETE",
        `/api/impairment-events/${aId}?cascade=true`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `cascade should abort with 409: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message).toBe("string");
      expect(String(body.message).length).toBeGreaterThan(10);

      // Nothing was deleted — the cascade is atomic.
      expect(await rowExists(client, "impairment_events", aId, user.companyId)).toBe(true);
      expect(await rowExists(client, "revaluation_events", bId, user.companyId)).toBe(true);
      expect(await rowExists(client, "disposals", cId, user.companyId)).toBe(true);
      expect(await journalEntryExists(client, seeded.jeIds[0])).toBe(true);
      expect(await journalEntryExists(client, seeded.jeIds[1])).toBe(true);
      expect(await journalEntryExists(client, seeded.jeIds[2])).toBe(true);
    } finally {
      await client.end();
    }
  });
});
