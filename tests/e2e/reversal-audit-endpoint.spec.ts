import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #212 — lock the contract of
 * `GET /api/audit/journal_entry/:id/with-reversal` against every
 * cascade-delete source that drives `reverseAutoPostedJournalEntry`:
 *
 *   - payroll_run        DELETE /api/hr/payroll/runs/:id
 *   - depreciation_run   DELETE /api/depreciation-runs/:id
 *   - impairment_event   DELETE /api/impairment-events/:id
 *   - revaluation_event  DELETE /api/revaluation-events/:id
 *   - disposal           DELETE /api/disposals/:id
 *   - document (inbox)   DELETE /api/documents/:id
 *
 * The sibling specs (`payroll-delete-reverses-journal.spec.ts` and
 * `auto-post-delete-reverses-journal.spec.ts`) already exercise the
 * cascade itself + the 409 refuse path. This spec is laser-focused on
 * what the audit endpoint actually returns:
 *
 *   • For each source: after the cascade delete, the with-reversal
 *     endpoint must surface a reversal audit row whose `changes`
 *     carry BOTH `reversedBy: <kind>#<sourceId>` and
 *     `companyId: <workspaceId>`. A future refactor of
 *     `reverseAutoPostedJournalEntry` that silently drops either field
 *     (eg moves the workspace stamp out of `changes`) would break the
 *     reversal-aware History drawer for cascade-deleted JEs — this
 *     spec is what would catch that drift.
 *
 *   • Cross-workspace: the endpoint must return 404 when the audit
 *     trail (live or post-cascade) belongs to a different tenant. The
 *     reversal lookup deliberately refuses to leak audit rows across
 *     workspace boundaries.
 *
 * Each fixture is built directly against the database (via pg.Client)
 * so the spec doesn't need the full IFRS chart of accounts that the
 * real posting engines require. The auth + accounts + JE creation
 * paths remain real HTTP so the request shape stays representative.
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
  const email = `reversal-audit-${salt}-${RUN_TAG}@example.test`;
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
      firstName: "Audit",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Reversal Audit ${salt} ${RUN_TAG}`,
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

/**
 * Seeds two unique-coded accounts and posts a balanced JE through the real
 * /api/journal-entries route. Returns the JE id we'll later cascade-reverse.
 */
async function seedJournalEntry(s: Session, tag: string): Promise<number> {
  const acc1 = await postJson(s, "/api/accounts", {
    code: `7100-${tag}`,
    nameAr: `حساب أ ${tag}`,
    nameEn: `Account A ${tag}`,
    type: "asset",
    subtype: "current_asset",
    isHeader: false,
    isActive: true,
  });
  const acc2 = await postJson(s, "/api/accounts", {
    code: `7200-${tag}`,
    nameAr: `حساب ب ${tag}`,
    nameEn: `Account B ${tag}`,
    type: "expense",
    subtype: "operating_expense",
    isHeader: false,
    isActive: true,
  });
  const je = await postJson(s, "/api/journal-entries", {
    description: `Reversal-audit JE ${tag}`,
    source: "manual",
    lines: [
      { accountId: acc1.id, debit: 1000, credit: 0 },
      { accountId: acc2.id, debit: 0, credit: 1000 },
    ],
  });
  return asNumber(je.id, "je.id");
}

/**
 * Seeds a fixed-asset row (with its category + the seven required GL stubs)
 * needed to back impairment / revaluation / disposal events. The actual
 * postings are stubbed in directly via SQL so this spec doesn't need the
 * full IFRS chart of accounts the real engines depend on.
 */
async function seedFixedAsset(
  client: pg.Client,
  s: Session,
  tag: string,
): Promise<number> {
  const accountIds: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = await postJson(s, "/api/accounts", {
      code: `6${i}00-${tag}`,
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

/**
 * Per-source fixture builders. Each one inserts the source row pointing at a
 * pre-seeded JE and returns the source row id. The matching DELETE call sits
 * in the per-source test below so the failure messages stay specific.
 */
async function seedDepreciationRun(
  client: pg.Client,
  s: Session,
  jeId: number,
): Promise<number> {
  const ins = await client.query<{ id: number }>(
    `INSERT INTO depreciation_runs
       (company_id, year, month, status, total_amount, journal_entry_id)
     VALUES ($1, 2099, 1, 'posted', '1000.00', $2)
     RETURNING id`,
    [s.companyId, jeId],
  );
  return ins.rows[0].id;
}

async function seedPayrollRun(
  client: pg.Client,
  s: Session,
  jeId: number,
): Promise<number> {
  // Pick a random month so re-running the spec doesn't violate the
  // (company_id, year, month) unique guard a second payroll_run insert would
  // otherwise hit when two specs share a workspace tag.
  const ins = await client.query<{ id: number }>(
    `INSERT INTO payroll_runs
       (company_id, year, month, status, total_gross, total_net, journal_entry_id)
     VALUES ($1, 2099, $2, 'posted', '1000.00', '900.00', $3)
     RETURNING id`,
    [s.companyId, Math.floor(Math.random() * 12) + 1, jeId],
  );
  return ins.rows[0].id;
}

async function seedImpairmentEvent(
  client: pg.Client,
  companyId: number,
  assetId: number,
  jeId: number,
): Promise<number> {
  const ins = await client.query<{ id: number }>(
    `INSERT INTO impairment_events
       (company_id, asset_id, event_date, recoverable_amount,
        loss_amount, journal_entry_id, asset_balance_delta)
     VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3, $4)
     RETURNING id`,
    [
      companyId,
      assetId,
      jeId,
      // Non-null delta so the legacy-row guard (task #208) is bypassed.
      JSON.stringify({ asset: { accumImpairment: 0 } }),
    ],
  );
  return ins.rows[0].id;
}

async function seedRevaluationEvent(
  client: pg.Client,
  companyId: number,
  assetId: number,
  jeId: number,
): Promise<number> {
  const ins = await client.query<{ id: number }>(
    `INSERT INTO revaluation_events
       (company_id, asset_id, event_date, fair_value, method,
        surplus_delta, pl_impact, journal_entry_id, asset_balance_delta)
     VALUES ($1, $2, '2099-12-31', '12000.00', 'elimination',
             '2000.00', '0.00', $3, $4)
     RETURNING id`,
    [companyId, assetId, jeId, JSON.stringify({ asset: {} })],
  );
  return ins.rows[0].id;
}

async function seedDisposal(
  client: pg.Client,
  companyId: number,
  assetId: number,
  jeId: number,
): Promise<number> {
  const ins = await client.query<{ id: number }>(
    `INSERT INTO disposals
       (company_id, asset_id, event_date, proceeds, method,
        gain_loss, surplus_transferred, journal_entry_id,
        asset_balance_delta)
     VALUES ($1, $2, '2099-12-31', '8000.00', 'sale',
             '-2000.00', '0.00', $3, $4)
     RETURNING id`,
    [companyId, assetId, jeId, JSON.stringify({ asset: {} })],
  );
  return ins.rows[0].id;
}

async function seedDocument(
  client: pg.Client,
  companyId: number,
  jeId: number,
  tag: string,
): Promise<number> {
  // A synthetic storage path so the route's "delete file if orphaned"
  // helper just sees a non-existent path and is a no-op.
  const ins = await client.query<{ id: number }>(
    `INSERT INTO documents
       (company_id, file_name, mime_type, size_bytes, storage_path,
        status, journal_entry_id)
     VALUES ($1, 'r.pdf', 'application/pdf', 1024,
             $2, 'posted', $3)
     RETURNING id`,
    [companyId, `nonexistent/reversal-audit-${tag}.pdf`, jeId],
  );
  return ins.rows[0].id;
}

/**
 * Shape of one audit row as returned by the with-reversal endpoint.
 * Only the fields the spec asserts on are typed; the rest is `unknown`.
 */
interface AuditRow {
  id: number;
  action: string;
  /**
   * Display name (or fallback) of the user who issued the mutation. The
   * server derives it from the verified session principal (see
   * `actorName` in `server/routes.ts`) — never from client-controlled
   * input — and writes it through `recordAudit` -> `audit_log.actor`.
   * On a cascade-reversed JE this *must* be populated so the History
   * drawer can answer "by whom" and not just "what".
   */
  actor: string | null;
  changes: Array<{ field: string; from?: unknown; to?: unknown }> | null;
}

/** Find the reversal audit row in a list returned by the with-reversal
 * endpoint. The reversal row is identified by the presence of a
 * `reversedBy` change field — `reverseAutoPostedJournalEntry` writes
 * exactly one such row per cascade.  */
function findReversalRow(rows: AuditRow[]): AuditRow | undefined {
  return rows.find((r) => (r.changes ?? []).some((c) => c.field === "reversedBy"));
}

function findChange(row: AuditRow, field: string) {
  return (row.changes ?? []).find((c) => c.field === field);
}

/**
 * Per-source matrix. Each row drives one test: build the source row,
 * cascade-delete it through its public DELETE route, fetch the audit
 * trail through the with-reversal endpoint, and assert both stamps.
 *
 * Splitting into a table keeps the per-source assertion identical and
 * the future "is the contract still tight on every source?" sweep
 * obvious in one place.
 */
type SourceCase = {
  /** Stable label that doubles as the per-test salt and the Playwright
   * test name suffix. */
  label: string;
  /** Value the audit row's `reversedBy` field must encode the source as. */
  kind:
    | "payroll_run"
    | "depreciation_run"
    | "impairment_event"
    | "revaluation_event"
    | "disposal"
    | "document";
  /** Build the source row + return its id. The fixture is responsible
   * for any prerequisites the source row needs (eg fixed_assets). */
  seed: (client: pg.Client, s: Session, jeId: number, tag: string) => Promise<number>;
  /** Public DELETE route for the source row. */
  deletePath: (sourceId: number) => string;
};

const SOURCES: SourceCase[] = [
  {
    label: "payroll_run",
    kind: "payroll_run",
    seed: (client, s, jeId) => seedPayrollRun(client, s, jeId),
    deletePath: (id) => `/api/hr/payroll/runs/${id}`,
  },
  {
    label: "depreciation_run",
    kind: "depreciation_run",
    seed: (client, s, jeId) => seedDepreciationRun(client, s, jeId),
    deletePath: (id) => `/api/depreciation-runs/${id}`,
  },
  {
    label: "impairment_event",
    kind: "impairment_event",
    seed: async (client, s, jeId, tag) => {
      const assetId = await seedFixedAsset(client, s, tag);
      return seedImpairmentEvent(client, s.companyId, assetId, jeId);
    },
    deletePath: (id) => `/api/impairment-events/${id}`,
  },
  {
    label: "revaluation_event",
    kind: "revaluation_event",
    seed: async (client, s, jeId, tag) => {
      const assetId = await seedFixedAsset(client, s, tag);
      return seedRevaluationEvent(client, s.companyId, assetId, jeId);
    },
    deletePath: (id) => `/api/revaluation-events/${id}`,
  },
  {
    label: "disposal",
    kind: "disposal",
    seed: async (client, s, jeId, tag) => {
      const assetId = await seedFixedAsset(client, s, tag);
      return seedDisposal(client, s.companyId, assetId, jeId);
    },
    deletePath: (id) => `/api/disposals/${id}`,
  },
  {
    label: "document",
    kind: "document",
    seed: (client, s, jeId, tag) => seedDocument(client, s.companyId, jeId, tag),
    deletePath: (id) => `/api/documents/${id}`,
  },
];

test.describe(
  "GET /api/audit/journal_entry/:id/with-reversal returns the cascade trail @api",
  () => {
    for (const source of SOURCES) {
      test(`${source.label}: surfaces reversedBy + companyId stamps after a cascade delete`, async () => {
        const user = await bootstrapUser(source.label.slice(0, 6));
        const tag = `${source.label}-${user.companyId}-${RUN_TAG}`;
        const client = await pgConnect();
        try {
          const jeId = await seedJournalEntry(user, tag);
          const sourceId = await source.seed(client, user, jeId, tag);

          const del = await call("DELETE", source.deletePath(sourceId), user.jar, {
            headers: user.headers,
          });
          expect(
            del.status,
            `DELETE ${source.deletePath(sourceId)}: ${del.text}`,
          ).toBe(204);

          // The endpoint under test — must succeed even though the JE
          // entity has been cascade-deleted (the reversal lookup falls
          // back on the workspace-stamped audit row, which is exactly
          // what the contract this test pins down requires).
          const trail = await call(
            "GET",
            `/api/audit/journal_entry/${jeId}/with-reversal`,
            user.jar,
            { headers: user.headers },
          );
          expect(
            trail.status,
            `with-reversal lookup for cascade-deleted JE ${jeId}: ${trail.text}`,
          ).toBe(200);
          expect(Array.isArray(trail.body)).toBe(true);
          const rows = trail.body as AuditRow[];

          const reversalRow = findReversalRow(rows);
          expect(
            reversalRow,
            `expected a reversal audit row in trail for JE ${jeId}, ` +
              `got ${JSON.stringify(rows)}`,
          ).toBeTruthy();

          const reversedBy = findChange(reversalRow!, "reversedBy");
          expect(reversedBy?.to).toBe(`${source.kind}#${sourceId}`);

          const companyStamp = findChange(reversalRow!, "companyId");
          expect(
            companyStamp,
            `expected a companyId stamp on the reversal audit row, ` +
              `got changes=${JSON.stringify(reversalRow!.changes)}`,
          ).toBeTruthy();
          expect(companyStamp?.to).toBe(user.companyId);

          // Attribution check: the reversal audit row must carry the
          // user who triggered the cascade (not be silently anonymous).
          // The route layer feeds `userCtx(req)` into each `deleteX`
          // storage method, which threads it through into
          // `reverseAutoPostedJournalEntry` -> `recordAudit`. A future
          // refactor that drops `ctx` on any of the six cascade sources
          // would silently strip attribution from the History drawer
          // for cascade-reversed JEs — auditors would see "the JE was
          // reversed" but not "by whom". This assertion locks down
          // every source so that drift can't happen on any of them.
          //
          // The expected value is the human-readable name our signup
          // helper provides ("Audit Tester" — `firstName` + `lastName`
          // joined). `actorName()` in `server/routes.ts` prefers the
          // joined name over email/sub, so this matches whether the
          // session was minted via OIDC or local-auth.
          expect(
            reversalRow!.actor,
            `expected non-null actor on reversal audit row for ` +
              `${source.label}, got actor=${JSON.stringify(reversalRow!.actor)}`,
          ).toBe("Audit Tester");
        } finally {
          await client.end();
        }
      });
    }

    test("returns 404 when the audit trail belongs to a different workspace", async () => {
      // Two independent owners in two independent workspaces. Owner A
      // triggers a cascade-reversal; owner B then tries to read the
      // resulting trail. The endpoint must refuse.
      const ownerA = await bootstrapUser("xworkA");
      const ownerB = await bootstrapUser("xworkB");
      expect(ownerA.companyId).not.toBe(ownerB.companyId);

      const tag = `xwork-${ownerA.companyId}-${RUN_TAG}`;
      const client = await pgConnect();
      try {
        const jeId = await seedJournalEntry(ownerA, tag);
        const runId = await seedDepreciationRun(client, ownerA, jeId);

        const del = await call("DELETE", `/api/depreciation-runs/${runId}`, ownerA.jar, {
          headers: ownerA.headers,
        });
        expect(del.status, `owner A delete: ${del.text}`).toBe(204);

        // Sanity: owner A can still see the trail post-cascade.
        const ownerATrail = await call(
          "GET",
          `/api/audit/journal_entry/${jeId}/with-reversal`,
          ownerA.jar,
          { headers: ownerA.headers },
        );
        expect(ownerATrail.status, `owner A trail: ${ownerATrail.text}`).toBe(200);
        const ownerARows = ownerATrail.body as AuditRow[];
        expect(findReversalRow(ownerARows)).toBeTruthy();

        // The actual assertion: owner B (different workspace) gets 404.
        // The endpoint must NOT leak the audit row across the workspace
        // boundary even though the JE id is guessable.
        const ownerBTrail = await call(
          "GET",
          `/api/audit/journal_entry/${jeId}/with-reversal`,
          ownerB.jar,
          { headers: ownerB.headers },
        );
        expect(
          ownerBTrail.status,
          `owner B (workspace ${ownerB.companyId}) must NOT see owner A's ` +
            `JE ${jeId} reversal trail, got ${ownerBTrail.status}: ${ownerBTrail.text}`,
        ).toBe(404);
      } finally {
        await client.end();
      }
    });
  },
);
