import { test, expect } from "@playwright/test";
import pg from "pg";

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
            loss_amount, journal_entry_id)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
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
            loss_amount, journal_entry_id)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
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
            surplus_delta, pl_impact, journal_entry_id)
         VALUES ($1, $2, '2099-12-31', '12000.00', 'elimination',
                 '2000.00', '0.00', $3)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
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
            surplus_delta, pl_impact, journal_entry_id)
         VALUES ($1, $2, '2099-12-31', '12000.00', 'elimination',
                 '2000.00', '0.00', $3)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
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
            gain_loss, surplus_transferred, journal_entry_id)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', '0.00', $3)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
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
            gain_loss, surplus_transferred, journal_entry_id)
         VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
                 '-2000.00', '0.00', $3)
         RETURNING id`,
        [user.companyId, assetId, seeded.journalEntryId],
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
