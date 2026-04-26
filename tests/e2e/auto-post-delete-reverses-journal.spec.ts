import { test, expect } from "@playwright/test";
import pg from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Regression net for task 111 — apply the JE-orphan guard from payroll-run
 * delete (task 78) to every other auto-posting module:
 *
 *   - depreciation_runs        DELETE /api/depreciation-runs/:id
 *   - impairment_events        DELETE /api/impairment-events/:id
 *   - revaluation_events       DELETE /api/revaluation-events/:id
 *   - disposals                DELETE /api/disposals/:id
 *   - documents (AI inbox)     DELETE /api/documents/:id
 *
 * For each module we exercise both arms of the contract:
 *
 *   1. Reverse path — when the linked journal entry is owned solely by
 *      this row, the JE is reversed (deleted) atomically with the source
 *      row, so the GL twin and the source row disappear together.
 *
 *   2. Refuse path — when the JE has been picked up by another auto-posting
 *      module, the request is rejected with 409 + a clear message and BOTH
 *      the source row and the journal entry remain in place.
 *
 * Each fixture is built directly via pg.Client because the public posting
 * routes (the full depreciation engine, the impairment/revaluation/disposal
 * engines, and the document-post route) all require an IFRS chart of accounts
 * a brand-new workspace doesn't have. The auth + accounts + JE creation paths
 * remain real HTTP so the request shape stays representative.
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
  const email = `auto-post-delete-${salt}-${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP so the express signup rate limiter (keyed by
  // client IP) does not throttle this test when re-run.
  const forwardedFor = `10.${(salt.charCodeAt(0) + (Date.now() % 200)) & 0xff}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Auto",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Auto-Post Delete ${salt} ${RUN_TAG}`,
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

async function getJson(s: Session, path: string): Promise<unknown> {
  const r = await call("GET", path, s.jar, { headers: s.headers });
  expect(r.status, `GET ${path}: ${r.text}`).toBe(200);
  return r.body;
}

/**
 * Creates a balanced JE via the real /api/journal-entries route after seeding
 * two unique-coded accounts. Returns the JE id and the two account ids so the
 * caller can reuse them for the source row's GL pointers if relevant.
 */
async function seedAccountsAndJournalEntry(
  s: Session,
  tag: string,
): Promise<{ acc1Id: number; acc2Id: number; journalEntryId: number }> {
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

  const je = await postJson(s, "/api/journal-entries", {
    description: `Auto-post JE ${tag}`,
    source: "manual",
    lines: [
      { accountId: acc1.id, debit: 1000, credit: 0 },
      { accountId: acc2.id, debit: 0, credit: 1000 },
    ],
  });

  return {
    acc1Id: asNumber(acc1.id, "acc1.id"),
    acc2Id: asNumber(acc2.id, "acc2.id"),
    journalEntryId: asNumber(je.id, "je.id"),
  };
}

async function pgConnect(): Promise<pg.Client> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  return client;
}

async function journalEntryExists(s: Session, jeId: number): Promise<boolean> {
  const list = (await getJson(s, "/api/journal-entries")) as Array<{ id: number }>;
  return list.some((j) => j.id === jeId);
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

/** Pin a second `payroll_runs` row to the same JE — the cheapest way to
 * make `detectJournalEntryReferences` flag the JE as foreign-referenced. We
 * don't need the row to be semantically meaningful; the storage helper only
 * looks at journal_entry_id and the source kind on a SELECT. */
async function pinForeignReference(
  client: pg.Client,
  companyId: number,
  journalEntryId: number,
): Promise<number> {
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO payroll_runs
       (company_id, year, month, status, total_gross, total_net, journal_entry_id)
     VALUES ($1, 2099, 1, 'posted', '1000.00', '900.00', $2)
     RETURNING id`,
    [companyId, journalEntryId],
  );
  return inserted.rows[0].id;
}

// ---------------------------------------------------------------------------
// Module 1: depreciation_runs
// ---------------------------------------------------------------------------

test.describe("DELETE /api/depreciation-runs/:id keeps depreciation and GL in sync @api", () => {
  test("reverses the linked journal entry alongside the depreciation run", async () => {
    const user = await bootstrapUser("dep-rev");
    const seeded = await seedAccountsAndJournalEntry(user, `dep-rev-${user.companyId}`);
    const client = await pgConnect();
    try {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO depreciation_runs
           (company_id, year, month, status, total_amount, journal_entry_id)
         VALUES ($1, 2099, 1, 'posted', '1000.00', $2)
         RETURNING id`,
        [user.companyId, seeded.journalEntryId],
      );
      const runId = ins.rows[0].id;

      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);
      expect(await rowExists(client, "depreciation_runs", runId, user.companyId)).toBe(true);

      const del = await call(
        "DELETE",
        `/api/depreciation-runs/${runId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      expect(await rowExists(client, "depreciation_runs", runId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);

      // Audit row on the JE side must record what triggered the reversal.
      const audit = await client.query<{
        action: string;
        changes: Array<{ field: string; to?: unknown }> | null;
      }>(
        `SELECT action, changes FROM audit_log
          WHERE entity_type = 'journal_entry' AND entity_id = $1`,
        [seeded.journalEntryId],
      );
      const deleteRow = audit.rows.find((r) => r.action === "delete");
      expect(deleteRow, `expected JE delete audit row, got ${JSON.stringify(audit.rows)}`)
        .toBeTruthy();
      const reversedBy = (deleteRow!.changes ?? []).find((c) => c.field === "reversedBy");
      expect(reversedBy?.to).toBe(`depreciation_run#${runId}`);
    } finally {
      await client.end();
    }
  });

  test("refuses with 409 when the journal entry is referenced from another row", async () => {
    const user = await bootstrapUser("dep-ref");
    const seeded = await seedAccountsAndJournalEntry(user, `dep-ref-${user.companyId}`);
    const client = await pgConnect();
    try {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO depreciation_runs
           (company_id, year, month, status, total_amount, journal_entry_id)
         VALUES ($1, 2099, 2, 'posted', '500.00', $2)
         RETURNING id`,
        [user.companyId, seeded.journalEntryId],
      );
      const runId = ins.rows[0].id;
      const pinId = await pinForeignReference(client, user.companyId, seeded.journalEntryId);

      const del = await call(
        "DELETE",
        `/api/depreciation-runs/${runId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message).toBe("string");
      expect(String(body.message).length).toBeGreaterThan(10);

      expect(await rowExists(client, "depreciation_runs", runId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);

      await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [pinId]);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers for fixed-asset events (impairment, revaluation, disposal) — they
// all share the same FK chain: event → fixed_asset → asset_category → 7 GL
// accounts. We seed the bare minimum here.
// ---------------------------------------------------------------------------

async function seedFixedAsset(
  client: pg.Client,
  s: Session,
  tag: string,
): Promise<number> {
  // Seven account stubs the asset_category needs.
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

// ---------------------------------------------------------------------------
// Module 2: impairment_events
// ---------------------------------------------------------------------------

test.describe("DELETE /api/impairment-events/:id keeps impairments and GL in sync @api", () => {
  test("reverses the linked journal entry alongside the impairment event", async () => {
    const user = await bootstrapUser("imp-rev");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-rev-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-rev-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3, $4)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          seeded.journalEntryId,
          // Non-null delta so the legacy-row guard (task #208) is bypassed:
          // we are exercising the JE-reversal path here, not the legacy
          // refusal path.
          JSON.stringify({ asset: { accumImpairment: 0 } }),
        ],
      );
      const eventId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      expect(await rowExists(client, "impairment_events", eventId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);

      const audit = await client.query<{
        action: string;
        changes: Array<{ field: string; to?: unknown }> | null;
      }>(
        `SELECT action, changes FROM audit_log
          WHERE entity_type = 'journal_entry' AND entity_id = $1`,
        [seeded.journalEntryId],
      );
      const deleteRow = audit.rows.find((r) => r.action === "delete");
      expect(deleteRow).toBeTruthy();
      const reversedBy = (deleteRow!.changes ?? []).find((c) => c.field === "reversedBy");
      expect(reversedBy?.to).toBe(`impairment_event#${eventId}`);
    } finally {
      await client.end();
    }
  });

  test("refuses with 409 when the journal entry is referenced from another row", async () => {
    const user = await bootstrapUser("imp-ref");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-ref-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-ref-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3, $4)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          seeded.journalEntryId,
          // See note in the reverse-path test above.
          JSON.stringify({ asset: { accumImpairment: 0 } }),
        ],
      );
      const eventId = ins.rows[0].id;
      const pinId = await pinForeignReference(client, user.companyId, seeded.journalEntryId);

      const del = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);
      expect(await rowExists(client, "impairment_events", eventId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);

      await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [pinId]);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Module 3: revaluation_events
// ---------------------------------------------------------------------------

test.describe("DELETE /api/revaluation-events/:id keeps revaluations and GL in sync @api", () => {
  test("reverses the linked journal entry alongside the revaluation event", async () => {
    const user = await bootstrapUser("rev-rev");
    const seeded = await seedAccountsAndJournalEntry(user, `rev-rev-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `rev-rev-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO revaluation_events
           (company_id, asset_id, event_date, fair_value, method,
            surplus_delta, pl_impact, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '12000.00', 'elimination',
                 '2000.00', '0.00', $3, $4)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          seeded.journalEntryId,
          // Non-null delta so the legacy-row guard (task #208) is bypassed:
          // we are exercising the JE-reversal path here, not the legacy
          // refusal path. An empty `asset` object is a valid no-op delta.
          JSON.stringify({ asset: {} }),
        ],
      );
      const eventId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/revaluation-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      expect(await rowExists(client, "revaluation_events", eventId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);

      const audit = await client.query<{
        action: string;
        changes: Array<{ field: string; to?: unknown }> | null;
      }>(
        `SELECT action, changes FROM audit_log
          WHERE entity_type = 'journal_entry' AND entity_id = $1`,
        [seeded.journalEntryId],
      );
      const deleteRow = audit.rows.find((r) => r.action === "delete");
      expect(deleteRow).toBeTruthy();
      const reversedBy = (deleteRow!.changes ?? []).find((c) => c.field === "reversedBy");
      expect(reversedBy?.to).toBe(`revaluation_event#${eventId}`);
    } finally {
      await client.end();
    }
  });

  test("refuses with 409 when the journal entry is referenced from another row", async () => {
    const user = await bootstrapUser("rev-ref");
    const seeded = await seedAccountsAndJournalEntry(user, `rev-ref-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `rev-ref-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO revaluation_events
           (company_id, asset_id, event_date, fair_value, method,
            surplus_delta, pl_impact, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '12000.00', 'elimination',
                 '2000.00', '0.00', $3, $4)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          seeded.journalEntryId,
          // See note in the reverse-path test above.
          JSON.stringify({ asset: {} }),
        ],
      );
      const eventId = ins.rows[0].id;
      const pinId = await pinForeignReference(client, user.companyId, seeded.journalEntryId);

      const del = await call(
        "DELETE",
        `/api/revaluation-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);
      expect(await rowExists(client, "revaluation_events", eventId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);

      await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [pinId]);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Module 4: disposals
// ---------------------------------------------------------------------------

test.describe("DELETE /api/disposals/:id keeps disposals and GL in sync @api", () => {
  test("reverses the linked journal entry alongside the disposal", async () => {
    const user = await bootstrapUser("dis-rev");
    const seeded = await seedAccountsAndJournalEntry(user, `dis-rev-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `dis-rev-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO disposals
           (company_id, asset_id, event_date, proceeds, method,
            gain_loss, surplus_transferred, journal_entry_id,
            asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', '0.00', $3, $4)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          seeded.journalEntryId,
          // Non-null delta so the legacy-row guard (task #208) is bypassed:
          // we are exercising the JE-reversal path here, not the legacy
          // refusal path. An empty `asset` object is a valid no-op delta.
          JSON.stringify({ asset: {} }),
        ],
      );
      const eventId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/disposals/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      expect(await rowExists(client, "disposals", eventId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);

      const audit = await client.query<{
        action: string;
        changes: Array<{ field: string; to?: unknown }> | null;
      }>(
        `SELECT action, changes FROM audit_log
          WHERE entity_type = 'journal_entry' AND entity_id = $1`,
        [seeded.journalEntryId],
      );
      const deleteRow = audit.rows.find((r) => r.action === "delete");
      expect(deleteRow).toBeTruthy();
      const reversedBy = (deleteRow!.changes ?? []).find((c) => c.field === "reversedBy");
      expect(reversedBy?.to).toBe(`disposal#${eventId}`);
    } finally {
      await client.end();
    }
  });

  test("refuses with 409 when the journal entry is referenced from another row", async () => {
    const user = await bootstrapUser("dis-ref");
    const seeded = await seedAccountsAndJournalEntry(user, `dis-ref-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `dis-ref-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO disposals
           (company_id, asset_id, event_date, proceeds, method,
            gain_loss, surplus_transferred, journal_entry_id,
            asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', '0.00', $3, $4)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          seeded.journalEntryId,
          // See note in the reverse-path test above.
          JSON.stringify({ asset: {} }),
        ],
      );
      const eventId = ins.rows[0].id;
      const pinId = await pinForeignReference(client, user.companyId, seeded.journalEntryId);

      const del = await call(
        "DELETE",
        `/api/disposals/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);
      expect(await rowExists(client, "disposals", eventId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);

      await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [pinId]);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Module 5: documents (AI inbox post)
// ---------------------------------------------------------------------------

test.describe("DELETE /api/documents/:id keeps inbox and GL in sync @api", () => {
  test("reverses the linked journal entry alongside the posted document", async () => {
    const user = await bootstrapUser("doc-rev");
    const seeded = await seedAccountsAndJournalEntry(user, `doc-rev-${user.companyId}`);
    const client = await pgConnect();
    try {
      // Use a synthetic storage path so the route's "delete file if orphaned"
      // helper just sees a non-existent path and is a no-op.
      const ins = await client.query<{ id: number }>(
        `INSERT INTO documents
           (company_id, file_name, mime_type, size_bytes, storage_path,
            status, journal_entry_id)
         VALUES ($1, 'r.pdf', 'application/pdf', 1024,
                 $2, 'posted', $3)
         RETURNING id`,
        [
          user.companyId,
          `nonexistent/auto-post-${RUN_TAG}-${user.companyId}-rev.pdf`,
          seeded.journalEntryId,
        ],
      );
      const docId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/documents/${docId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      expect(await rowExists(client, "documents", docId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);

      const audit = await client.query<{
        action: string;
        changes: Array<{ field: string; to?: unknown }> | null;
      }>(
        `SELECT action, changes FROM audit_log
          WHERE entity_type = 'journal_entry' AND entity_id = $1`,
        [seeded.journalEntryId],
      );
      const deleteRow = audit.rows.find((r) => r.action === "delete");
      expect(deleteRow).toBeTruthy();
      const reversedBy = (deleteRow!.changes ?? []).find((c) => c.field === "reversedBy");
      expect(reversedBy?.to).toBe(`document#${docId}`);
    } finally {
      await client.end();
    }
  });

  test("refuses with 409 when the journal entry is referenced from another row", async () => {
    const user = await bootstrapUser("doc-ref");
    const seeded = await seedAccountsAndJournalEntry(user, `doc-ref-${user.companyId}`);
    const client = await pgConnect();
    try {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO documents
           (company_id, file_name, mime_type, size_bytes, storage_path,
            status, journal_entry_id)
         VALUES ($1, 'r.pdf', 'application/pdf', 1024,
                 $2, 'posted', $3)
         RETURNING id`,
        [
          user.companyId,
          `nonexistent/auto-post-${RUN_TAG}-${user.companyId}-ref.pdf`,
          seeded.journalEntryId,
        ],
      );
      const docId = ins.rows[0].id;
      const pinId = await pinForeignReference(client, user.companyId, seeded.journalEntryId);

      const del = await call(
        "DELETE",
        `/api/documents/${docId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete should be 409, got ${del.status}: ${del.text}`).toBe(409);
      expect(await rowExists(client, "documents", docId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);

      await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [pinId]);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Regression net for task #157: deleting an impairment / revaluation / disposal
// event must also undo the per-asset balance changes the original posting
// applied (accumImpairment, cost, accumDepreciation, revalSurplus, status, …).
//
// Each test simulates a fully-posted event by:
//   1. Snapshotting the asset row pre-event.
//   2. Inserting the event row WITH a populated `asset_balance_delta`
//      snapshot AND mutating the asset row to match the post-event balances
//      the real posting handler would have written.
//   3. Issuing DELETE and asserting the asset row is exactly back to its
//      pre-event snapshot.
//
// We bypass the public POST routes here for the same reason the JE-orphan
// fixtures above do (those engines need an IFRS COA a fresh workspace
// doesn't seed). The delete path under test is the same one the live
// posting routes exercise, so this covers task #157 end-to-end.
// ---------------------------------------------------------------------------

interface AssetBalanceSnapshot {
  cost: string;
  accumDepreciation: string;
  accumImpairment: string;
  revalSurplus: string;
  accumRevalLoss: string;
  status: string;
}

async function snapshotAsset(
  client: pg.Client,
  assetId: number,
): Promise<AssetBalanceSnapshot> {
  const r = await client.query<AssetBalanceSnapshot>(
    `SELECT cost, accum_depreciation AS "accumDepreciation",
            accum_impairment AS "accumImpairment",
            reval_surplus AS "revalSurplus",
            accum_reval_loss AS "accumRevalLoss",
            status
       FROM fixed_assets WHERE id = $1`,
    [assetId],
  );
  if (r.rowCount === 0) throw new Error(`asset ${assetId} not found`);
  return r.rows[0];
}

test.describe("DELETE /api/impairment-events/:id restores asset balances @api", () => {
  test("subtracts the captured accumImpairment delta back off the asset", async () => {
    const user = await bootstrapUser("imp-bal");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-bal-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-bal-${user.companyId}`);
      const before = await snapshotAsset(client, assetId);

      // Simulate a 700-loss impairment posting having ran end-to-end.
      const lossAmount = 700;
      await client.query(
        `UPDATE fixed_assets SET accum_impairment = $1 WHERE id = $2`,
        [String(Number(before.accumImpairment) + lossAmount), assetId],
      );
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '5000.00', $3, $4, $5)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          String(lossAmount),
          seeded.journalEntryId,
          JSON.stringify({ asset: { accumImpairment: lossAmount } }),
        ],
      );
      const eventId = ins.rows[0].id;

      const midway = await snapshotAsset(client, assetId);
      expect(Number(midway.accumImpairment)).toBe(Number(before.accumImpairment) + lossAmount);

      const del = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      const after = await snapshotAsset(client, assetId);
      expect(after).toEqual(before);
    } finally {
      await client.end();
    }
  });

  test("rolls per-component impairment back to its pre-event value", async () => {
    const user = await bootstrapUser("imp-comp");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-comp-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-comp-${user.companyId}`);
      const assetBefore = await snapshotAsset(client, assetId);

      // Seed two asset components with nonzero pre-event accumImpairment so we
      // can prove the per-component delta is subtracted (not just zeroed out).
      const compRows = await client.query<{ id: number; accum_impairment: string }>(
        `INSERT INTO asset_components
           (company_id, asset_id, name, cost, residual, useful_life_months,
            method, accum_depreciation, accum_impairment)
         VALUES
           ($1, $2, 'Frame', '6000.00', '0.00', 60, 'straight_line',
            '0.00', '50.00'),
           ($1, $2, 'Engine', '4000.00', '0.00', 60, 'straight_line',
            '0.00', '20.00')
         RETURNING id, accum_impairment`,
        [user.companyId, assetId],
      );
      expect(compRows.rowCount).toBe(2);
      const [c0Before, c1Before] = compRows.rows;

      // Simulate a 600-loss impairment that allocated 360 to comp0 and 240 to
      // comp1 proportional to carrying amount, and lifted asset.accumImpairment
      // by the full 600.
      const lossAmount = 600;
      const c0Delta = 360;
      const c1Delta = 240;
      await client.query(
        `UPDATE fixed_assets SET accum_impairment = $1 WHERE id = $2`,
        [String(Number(assetBefore.accumImpairment) + lossAmount), assetId],
      );
      await client.query(
        `UPDATE asset_components SET accum_impairment = $1 WHERE id = $2`,
        [String(Number(c0Before.accum_impairment) + c0Delta), c0Before.id],
      );
      await client.query(
        `UPDATE asset_components SET accum_impairment = $1 WHERE id = $2`,
        [String(Number(c1Before.accum_impairment) + c1Delta), c1Before.id],
      );
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '4000.00', $3, $4, $5)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          String(lossAmount),
          seeded.journalEntryId,
          JSON.stringify({
            asset: { accumImpairment: lossAmount },
            components: [
              { id: c0Before.id, accumImpairment: c0Delta },
              { id: c1Before.id, accumImpairment: c1Delta },
            ],
          }),
        ],
      );
      const eventId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      const assetAfter = await snapshotAsset(client, assetId);
      expect(assetAfter).toEqual(assetBefore);

      const compsAfter = await client.query<{ id: number; accum_impairment: string }>(
        `SELECT id, accum_impairment FROM asset_components
          WHERE asset_id = $1 ORDER BY id`,
        [assetId],
      );
      expect(compsAfter.rows[0].accum_impairment).toBe(c0Before.accum_impairment);
      expect(compsAfter.rows[1].accum_impairment).toBe(c1Before.accum_impairment);
    } finally {
      await client.end();
    }
  });

  test("delete + re-post leaves the asset in the same balance state as a single post", async () => {
    // Ensures the delete rollback is the true inverse of the create path —
    // i.e. you can delete an event and recreate it (via the same direct-insert
    // simulation) and end up with the same per-asset balances as a single
    // posting would have left.
    const user = await bootstrapUser("imp-rep");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-rep-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-rep-${user.companyId}`);
      const before = await snapshotAsset(client, assetId);

      const post = async (loss: number, je: number) => {
        await client.query(
          `UPDATE fixed_assets
              SET accum_impairment = accum_impairment::numeric + $1
            WHERE id = $2`,
          [String(loss), assetId],
        );
        const r = await client.query<{ id: number }>(
          `INSERT INTO impairment_events
             (company_id, asset_id, event_date, recoverable_amount,
              loss_amount, journal_entry_id, asset_balance_delta)
           VALUES ($1, $2, '2099-06-30', '5000.00', $3, $4, $5)
           RETURNING id`,
          [
            user.companyId,
            assetId,
            String(loss),
            je,
            JSON.stringify({ asset: { accumImpairment: loss } }),
          ],
        );
        return r.rows[0].id;
      };

      const lossAmount = 450;
      const firstId = await post(lossAmount, seeded.journalEntryId);
      const oncePosted = await snapshotAsset(client, assetId);

      const del = await call(
        "DELETE",
        `/api/impairment-events/${firstId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);
      expect(await snapshotAsset(client, assetId)).toEqual(before);

      // Re-post (with a fresh JE) and confirm we land on the same balances.
      const reposted = await seedAccountsAndJournalEntry(user, `imp-rep2-${user.companyId}`);
      await post(lossAmount, reposted.journalEntryId);
      expect(await snapshotAsset(client, assetId)).toEqual(oncePosted);
    } finally {
      await client.end();
    }
  });
});

test.describe("DELETE /api/revaluation-events/:id restores asset balances @api", () => {
  test("rolls cost / accumDep / accumImp / revalSurplus / accumRevalLoss back to pre-event", async () => {
    const user = await bootstrapUser("rev-bal");
    const seeded = await seedAccountsAndJournalEntry(user, `rev-bal-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `rev-bal-${user.companyId}`);
      // Seed a non-trivial pre-event state so each delta value gets exercised
      // (otherwise zero-deltas can mask sign mistakes in the rollback math).
      await client.query(
        `UPDATE fixed_assets
            SET accum_depreciation = '1500.00',
                accum_impairment = '300.00',
                reval_surplus = '200.00',
                accum_reval_loss = '50.00'
          WHERE id = $1`,
        [assetId],
      );
      const before = await snapshotAsset(client, assetId);

      // Mimic an `elimination` revaluation that nukes accumDep + accumImp,
      // restates cost to fairValue, and pushes the upward delta into surplus.
      const newCost = 12000;
      const newAccumDep = 0;
      const newAccumImp = 0;
      const newSurplus = 200 + 3800;
      const newRevalLoss = 0;
      await client.query(
        `UPDATE fixed_assets
            SET cost = $1,
                accum_depreciation = $2,
                accum_impairment = $3,
                reval_surplus = $4,
                accum_reval_loss = $5
          WHERE id = $6`,
        [
          String(newCost),
          String(newAccumDep),
          String(newAccumImp),
          String(newSurplus),
          String(newRevalLoss),
          assetId,
        ],
      );
      const delta = {
        asset: {
          cost: newCost - Number(before.cost),
          accumDepreciation: newAccumDep - Number(before.accumDepreciation),
          accumImpairment: newAccumImp - Number(before.accumImpairment),
          revalSurplus: newSurplus - Number(before.revalSurplus),
          accumRevalLoss: newRevalLoss - Number(before.accumRevalLoss),
        },
      };
      const ins = await client.query<{ id: number }>(
        `INSERT INTO revaluation_events
           (company_id, asset_id, event_date, fair_value, method,
            surplus_delta, pl_impact, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', $3, 'elimination',
                 $4, '0.00', $5, $6)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          String(newCost),
          String(delta.asset.revalSurplus),
          seeded.journalEntryId,
          JSON.stringify(delta),
        ],
      );
      const eventId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/revaluation-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      const after = await snapshotAsset(client, assetId);
      expect(after).toEqual(before);
    } finally {
      await client.end();
    }
  });
});

test.describe("DELETE /api/disposals/:id restores asset balances @api", () => {
  test("brings the asset back from 'disposed' and refunds the transferred surplus", async () => {
    const user = await bootstrapUser("dis-bal");
    const seeded = await seedAccountsAndJournalEntry(user, `dis-bal-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `dis-bal-${user.companyId}`);
      // Seed a positive surplus so we can prove the transfer-back math works.
      await client.query(
        `UPDATE fixed_assets SET reval_surplus = '900.00' WHERE id = $1`,
        [assetId],
      );
      const before = await snapshotAsset(client, assetId);
      expect(before.status).toBe("active");

      const surplusTransferred = 900;
      await client.query(
        `UPDATE fixed_assets
            SET status = 'disposed',
                reval_surplus = $1
          WHERE id = $2`,
        [String(Number(before.revalSurplus) - surplusTransferred), assetId],
      );
      const ins = await client.query<{ id: number }>(
        `INSERT INTO disposals
           (company_id, asset_id, event_date, proceeds, method,
            gain_loss, surplus_transferred, journal_entry_id,
            asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', $3, $4, $5)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          String(surplusTransferred),
          seeded.journalEntryId,
          JSON.stringify({
            asset: {
              revalSurplus: -surplusTransferred,
              statusBefore: before.status,
              statusAfter: "disposed",
            },
          }),
        ],
      );
      const eventId = ins.rows[0].id;

      const del = await call(
        "DELETE",
        `/api/disposals/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `delete: ${del.text}`).toBe(204);

      const after = await snapshotAsset(client, assetId);
      expect(after).toEqual(before);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Task #208 — refuse to delete legacy rows whose `asset_balance_delta` is
// NULL (because they were posted before migration 0015 added the snapshot
// column). Without the snapshot the delete path can't roll the per-asset
// balances back precisely, so silently reversing only the JE would leave
// `accumImpairment`, `revalSurplus`, `accumRevalLoss`, and `status` stale on
// the asset row. The fix surfaces a 409 + a clear message on each module
// (impairment / revaluation / disposal) and leaves both the source row and
// the JE in place so the user can repair the asset row by hand.
// ---------------------------------------------------------------------------

test.describe("DELETE legacy fixed-asset events refuses with 409 @api", () => {
  test("impairment_events: NULL asset_balance_delta is refused, JE + row + balances untouched", async () => {
    const user = await bootstrapUser("imp-leg");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-leg-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-leg-${user.companyId}`);
      // Mimic the on-disk shape of a row created before migration 0015:
      // every field present except `asset_balance_delta`, which is NULL.
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3, NULL)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
      );
      const eventId = ins.rows[0].id;
      const before = await snapshotAsset(client, assetId);

      const del = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `expected 409, got ${del.status}: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message).toBe("string");
      expect(String(body.message).length).toBeGreaterThan(10);

      // Row + JE + asset balances must all be intact — the request was
      // refused before any side-effect ran.
      expect(await rowExists(client, "impairment_events", eventId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);
      expect(await snapshotAsset(client, assetId)).toEqual(before);
    } finally {
      await client.end();
    }
  });

  test("revaluation_events: NULL asset_balance_delta is refused, JE + row + balances untouched", async () => {
    const user = await bootstrapUser("rev-leg");
    const seeded = await seedAccountsAndJournalEntry(user, `rev-leg-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `rev-leg-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO revaluation_events
           (company_id, asset_id, event_date, fair_value, method,
            surplus_delta, pl_impact, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '12000.00', 'elimination',
                 '2000.00', '0.00', $3, NULL)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
      );
      const eventId = ins.rows[0].id;
      const before = await snapshotAsset(client, assetId);

      const del = await call(
        "DELETE",
        `/api/revaluation-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `expected 409, got ${del.status}: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message).toBe("string");
      expect(String(body.message).length).toBeGreaterThan(10);

      expect(await rowExists(client, "revaluation_events", eventId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);
      expect(await snapshotAsset(client, assetId)).toEqual(before);
    } finally {
      await client.end();
    }
  });

  test("disposals: NULL asset_balance_delta is refused, JE + row + balances untouched", async () => {
    const user = await bootstrapUser("dis-leg");
    const seeded = await seedAccountsAndJournalEntry(user, `dis-leg-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `dis-leg-${user.companyId}`);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO disposals
           (company_id, asset_id, event_date, proceeds, method,
            gain_loss, surplus_transferred, journal_entry_id,
            asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', '0.00', $3, NULL)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
      );
      const eventId = ins.rows[0].id;
      const before = await snapshotAsset(client, assetId);

      const del = await call(
        "DELETE",
        `/api/disposals/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `expected 409, got ${del.status}: ${del.text}`).toBe(409);
      const body = asObject(del.body);
      expect(typeof body.message).toBe("string");
      expect(String(body.message).length).toBeGreaterThan(10);

      expect(await rowExists(client, "disposals", eventId, user.companyId)).toBe(true);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(true);
      expect(await snapshotAsset(client, assetId)).toEqual(before);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Task #257 — best-effort migration backfill so legacy NULL-snapshot rows
// can flow through the standard delete path again.
//
// Each scenario below mirrors the legacy "row inserted before migration 0015"
// shape (NULL `asset_balance_delta`), then runs the backfill SQL inline (the
// same statements migration 0021 ships, executed against the live test DB so
// no re-deploy is required), then issues DELETE through the public API.
//
// Documented post-rollback states (see the comment block at the top of
// `migrations/0021_backfill_asset_event_balance_delta.sql` for the
// reasoning):
//
//   - impairment: `accumImpairment` rolls back to its pre-event value;
//     per-component `accumImpairment` is left untouched (the per-component
//     split is not recoverable from the row).
//   - revaluation: `revalSurplus` and `accumRevalLoss` roll back; cost,
//     accumDepreciation, and accumImpairment are left untouched (those
//     deltas were derived from the pre-event asset state and aren't on the
//     row).
//   - disposal: status flips back from `disposed` to `active` and the
//     transferred `revalSurplus` is refunded; cost / depreciation / etc are
//     not touched.
// ---------------------------------------------------------------------------

const BACKFILL_MIGRATION_PATH = path.resolve(
  process.cwd(),
  "migrations",
  "0021_backfill_asset_event_balance_delta.sql",
);

async function runBackfillMigration(client: pg.Client): Promise<void> {
  const sql = await fs.readFile(BACKFILL_MIGRATION_PATH, "utf8");
  // The runner splits on `--> statement-breakpoint`; for a direct in-test
  // exec we just need each chunk to run individually so a syntax issue in
  // one doesn't mask another. Postgres tolerates the in-chunk SQL comments
  // so no extra stripping is needed.
  const statements = sql
    .split(/-->\s*statement-breakpoint/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

test.describe("DELETE legacy fixed-asset events after backfill (task #257) @api", () => {
  test("impairment_events: backfilled NULL snapshot now allows delete to roll asset.accumImpairment back", async () => {
    const user = await bootstrapUser("imp-bf");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-bf-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-bf-${user.companyId}`);
      const before = await snapshotAsset(client, assetId);

      // Simulate a legacy 700-loss impairment that wrote the asset balance
      // but never recorded a snapshot (pre-migration-0015 shape).
      const lossAmount = 700;
      await client.query(
        `UPDATE fixed_assets SET accum_impairment = $1 WHERE id = $2`,
        [String(Number(before.accumImpairment) + lossAmount), assetId],
      );
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '5000.00', $3, $4, NULL)
         RETURNING id`,
        [user.companyId, assetId, String(lossAmount), seeded.journalEntryId],
      );
      const eventId = ins.rows[0].id;

      // Sanity: the legacy guard refuses the delete BEFORE the backfill.
      const refused = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(refused.status, `pre-backfill expected 409, got ${refused.text}`).toBe(409);

      // Run the backfill and confirm the snapshot now matches the loss amount.
      await runBackfillMigration(client);
      const filled = await client.query<{ asset_balance_delta: unknown }>(
        `SELECT asset_balance_delta FROM impairment_events WHERE id = $1`,
        [eventId],
      );
      expect(filled.rows[0].asset_balance_delta).toEqual({
        asset: { accumImpairment: lossAmount },
        components: [],
      });

      // Delete now succeeds and the asset row rolls back to its pre-event state.
      const del = await call(
        "DELETE",
        `/api/impairment-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `post-backfill delete: ${del.text}`).toBe(204);

      expect(await rowExists(client, "impairment_events", eventId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);
      expect(await snapshotAsset(client, assetId)).toEqual(before);
    } finally {
      await client.end();
    }
  });

  test("revaluation_events: backfilled NULL snapshot rolls revalSurplus + accumRevalLoss back", async () => {
    const user = await bootstrapUser("rev-bf");
    const seeded = await seedAccountsAndJournalEntry(user, `rev-bf-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `rev-bf-${user.companyId}`);
      // Seed an existing accumRevalLoss so we can prove the recovered
      // delta restores the prior value (not just zero).
      await client.query(
        `UPDATE fixed_assets
            SET reval_surplus = '100.00',
                accum_reval_loss = '50.00'
          WHERE id = $1`,
        [assetId],
      );
      const before = await snapshotAsset(client, assetId);

      // Simulate a downward revaluation that pushed `pl_impact = -200` into
      // accum_reval_loss and left `surplus_delta = 0`. The on-row state
      // post-event reflects that.
      const surplusDelta = 0;
      const plImpact = -200;
      await client.query(
        `UPDATE fixed_assets
            SET reval_surplus = $1,
                accum_reval_loss = $2
          WHERE id = $3`,
        [
          String(Number(before.revalSurplus) + surplusDelta),
          String(Number(before.accumRevalLoss) + Math.max(0, -plImpact) - Math.max(0, plImpact)),
          assetId,
        ],
      );
      const ins = await client.query<{ id: number }>(
        `INSERT INTO revaluation_events
           (company_id, asset_id, event_date, fair_value, method,
            surplus_delta, pl_impact, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '9000.00', 'elimination',
                 $3, $4, $5, NULL)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          String(surplusDelta),
          String(plImpact),
          seeded.journalEntryId,
        ],
      );
      const eventId = ins.rows[0].id;

      // Pre-backfill: refused.
      const refused = await call(
        "DELETE",
        `/api/revaluation-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(refused.status, `pre-backfill expected 409, got ${refused.text}`).toBe(409);

      await runBackfillMigration(client);
      const filled = await client.query<{ asset_balance_delta: unknown }>(
        `SELECT asset_balance_delta FROM revaluation_events WHERE id = $1`,
        [eventId],
      );
      expect(filled.rows[0].asset_balance_delta).toEqual({
        asset: { revalSurplus: surplusDelta, accumRevalLoss: 200 },
      });

      const del = await call(
        "DELETE",
        `/api/revaluation-events/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `post-backfill delete: ${del.text}`).toBe(204);
      expect(await rowExists(client, "revaluation_events", eventId, user.companyId)).toBe(false);
      expect(await journalEntryExists(user, seeded.journalEntryId)).toBe(false);

      // Documented post-rollback state: revalSurplus + accumRevalLoss are
      // back to their pre-event values; cost / accumDep / accumImp are
      // intentionally untouched (no snapshot for them — backfill omits the
      // keys, rollback skips them).
      const after = await snapshotAsset(client, assetId);
      expect(after.revalSurplus).toBe(before.revalSurplus);
      expect(after.accumRevalLoss).toBe(before.accumRevalLoss);
      expect(after.cost).toBe(before.cost);
      expect(after.accumDepreciation).toBe(before.accumDepreciation);
      expect(after.accumImpairment).toBe(before.accumImpairment);
    } finally {
      await client.end();
    }
  });

  test("disposals: backfilled NULL snapshot brings asset back from 'disposed' and refunds the surplus", async () => {
    const user = await bootstrapUser("dis-bf");
    const seeded = await seedAccountsAndJournalEntry(user, `dis-bf-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `dis-bf-${user.companyId}`);
      await client.query(
        `UPDATE fixed_assets SET reval_surplus = '900.00' WHERE id = $1`,
        [assetId],
      );
      const before = await snapshotAsset(client, assetId);
      expect(before.status).toBe("active");

      const surplusTransferred = 900;
      await client.query(
        `UPDATE fixed_assets
            SET status = 'disposed',
                reval_surplus = $1
          WHERE id = $2`,
        [String(Number(before.revalSurplus) - surplusTransferred), assetId],
      );
      const ins = await client.query<{ id: number }>(
        `INSERT INTO disposals
           (company_id, asset_id, event_date, proceeds, method,
            gain_loss, surplus_transferred, journal_entry_id,
            asset_balance_delta)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', $3, $4, NULL)
         RETURNING id`,
        [
          user.companyId,
          assetId,
          String(surplusTransferred),
          seeded.journalEntryId,
        ],
      );
      const eventId = ins.rows[0].id;

      const refused = await call(
        "DELETE",
        `/api/disposals/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(refused.status, `pre-backfill expected 409, got ${refused.text}`).toBe(409);

      await runBackfillMigration(client);
      const filled = await client.query<{ asset_balance_delta: unknown }>(
        `SELECT asset_balance_delta FROM disposals WHERE id = $1`,
        [eventId],
      );
      expect(filled.rows[0].asset_balance_delta).toEqual({
        asset: {
          revalSurplus: -surplusTransferred,
          statusBefore: "active",
          statusAfter: "disposed",
        },
      });

      const del = await call(
        "DELETE",
        `/api/disposals/${eventId}`,
        user.jar,
        { headers: user.headers },
      );
      expect(del.status, `post-backfill delete: ${del.text}`).toBe(204);

      const after = await snapshotAsset(client, assetId);
      expect(after).toEqual(before);
    } finally {
      await client.end();
    }
  });

  test("backfill is idempotent: a second pass does not overwrite already-populated snapshots", async () => {
    // Defence-in-depth: rows posted AFTER migration 0015 already carry a
    // snapshot, and re-running the backfill must not clobber them. The
    // `asset_balance_delta IS NULL` gate is what makes the migration safe to
    // re-apply on every boot.
    const user = await bootstrapUser("imp-idem");
    const seeded = await seedAccountsAndJournalEntry(user, `imp-idem-${user.companyId}`);
    const client = await pgConnect();
    try {
      const assetId = await seedFixedAsset(client, user, `imp-idem-${user.companyId}`);
      const populated = JSON.stringify({
        asset: { accumImpairment: 123 },
        components: [{ id: 9999, accumImpairment: 7 }],
      });
      const ins = await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id, asset_balance_delta)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3, $4)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId, populated],
      );
      const eventId = ins.rows[0].id;

      await runBackfillMigration(client);
      await runBackfillMigration(client);

      const after = await client.query<{ asset_balance_delta: unknown }>(
        `SELECT asset_balance_delta FROM impairment_events WHERE id = $1`,
        [eventId],
      );
      expect(after.rows[0].asset_balance_delta).toEqual({
        asset: { accumImpairment: 123 },
        components: [{ id: 9999, accumImpairment: 7 }],
      });
    } finally {
      await client.end();
    }
  });
});
