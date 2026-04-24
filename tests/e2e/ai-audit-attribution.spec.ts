import { test, expect } from "@playwright/test";
import pg from "pg";
import { executeTool } from "../../server/services/assistant-tools";

/**
 * Regression net for AI-attributed audit rows.
 *
 * The chat tool calls and the document-inbox post route both thread the
 * signed-in user's name into the audit log alongside `source: "ai"`. A future
 * refactor of the audit-context plumbing (`actorName(req)` → `aiCtx(req)` →
 * `executeTool({ actor })` / `storage.createJournalEntry({ ctx })`) could
 * silently regress to the anonymous "AI assistant" fallback without any other
 * test catching it. These two tests pin both code paths in place:
 *
 *  1. `executeTool` (the entry point the chat handler uses for every assistant
 *     tool call) — when invoked with the human's name as `ctx.actor`, the
 *     resulting transaction's audit row must record `source = "ai"` and
 *     `actor = <human name>` (not the "AI assistant" fallback).
 *
 *  2. `POST /api/documents/:id/post` (the document-inbox confirm route, called
 *     over HTTP with a real signed-in session cookie) — the journal entry it
 *     creates must record `source = "ai"` and `actor = <session full name>`.
 *
 * Test 1 imports `executeTool` directly (the simplest way to exercise the tool
 * boundary without an LLM round-trip). Test 2 drives the route over HTTP so it
 * also exercises the `actorName(req)` → `aiCtx(req)` plumbing in the route
 * handler.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";
const FIRST_NAME = "Sara";
const LAST_NAME = "Tester";
const HUMAN_ACTOR = `${FIRST_NAME} ${LAST_NAME}`;

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
  const email = `ai-audit-${salt}-${RUN_TAG}@example.test`;
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
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `AI Audit ${salt} ${RUN_TAG}`,
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

interface AuditRow {
  source: string;
  actor: string | null;
  action: string;
}

function findAiAuditRow(rows: unknown, action?: string): AuditRow {
  expect(Array.isArray(rows), "audit log must be an array").toBe(true);
  const arr = rows as AuditRow[];
  const aiRows = arr.filter(
    (r) => r.source === "ai" && (action ? r.action === action : true),
  );
  expect(
    aiRows.length,
    `expected at least one ai-source audit row${action ? ` with action=${action}` : ""}, got rows=${JSON.stringify(arr)}`,
  ).toBeGreaterThan(0);
  return aiRows[0];
}

test.describe("AI-posted journals carry the human actor in the audit log @api", () => {
  test("executeTool('add_quick_transaction') records source=ai with the human actor", async () => {
    const user = await bootstrapUser("tool");

    // The chat route resolves the human via `actorName(req)` and forwards it
    // into `executeTool({ actor })`. We mirror that here: a future refactor
    // that drops the `actor` field, or that hard-codes "AI assistant" inside
    // executeTool, would flip this assertion to red.
    const uniqueDescription = `ai-tool-marker-${RUN_TAG}`;
    const result = await executeTool(
      "add_quick_transaction",
      {
        type: "expense",
        amount: 42.5,
        description: uniqueDescription,
        category: "AI Audit Test",
      },
      { companyId: user.companyId, currency: "USD", actor: HUMAN_ACTOR },
    );
    expect(result.modelResult, "executeTool returned no modelResult").toBeDefined();
    const modelOk = (result.modelResult as { ok?: boolean }).ok;
    expect(modelOk, `executeTool failed: ${JSON.stringify(result.modelResult)}`).toBe(true);

    // Look up the resulting transaction by its unique marker description.
    const txList = (await getJson(user, "/api/transactions")) as Array<{
      id: number;
      description: string;
    }>;
    const created = txList.find((t) => t.description === uniqueDescription);
    expect(created, `did not find AI-created transaction with description ${uniqueDescription}`).toBeTruthy();
    const txId = created!.id;

    const txAudit = (await getJson(
      user,
      `/api/audit/transaction/${txId}`,
    )) as AuditRow[];
    const txAiRow = findAiAuditRow(txAudit, "create");
    expect(txAiRow.source).toBe("ai");
    expect(
      txAiRow.actor,
      `transaction audit actor must be the signed-in human, not the "AI assistant" fallback`,
    ).toBe(HUMAN_ACTOR);
    expect(
      txAiRow.actor,
      `transaction audit actor must not regress to the "AI assistant" fallback`,
    ).not.toBe("AI assistant");

    // `add_quick_transaction` also auto-posts a balanced double-entry journal
    // entry for the same transaction. That journal's audit row must inherit
    // the same ai/actor pair — otherwise the History drawer would show the
    // human on the transaction but "AI assistant" on the journal it spawned.
    const jeList = (await getJson(user, "/api/journal-entries")) as Array<{
      id: number;
      description: string | null;
    }>;
    // The auto-posted JE description includes the original transaction
    // description; pick the most recent one referencing our marker.
    const jeMatch = jeList
      .filter((j) => (j.description ?? "").includes(uniqueDescription))
      .sort((a, b) => b.id - a.id)[0];
    expect(
      jeMatch,
      `auto-posted journal entry for ${uniqueDescription} not found in /api/journal-entries`,
    ).toBeTruthy();
    const jeAudit = (await getJson(
      user,
      `/api/audit/journal_entry/${jeMatch.id}`,
    )) as AuditRow[];
    const jeAiRow = findAiAuditRow(jeAudit);
    expect(jeAiRow.source).toBe("ai");
    expect(jeAiRow.actor).toBe(HUMAN_ACTOR);
  });

  test("POST /api/documents/:id/post records source=ai with the confirming human's name", async () => {
    const user = await bootstrapUser("doc");

    // Two accounts on the user's chart of accounts so the post body validates.
    const acc1 = await postJson(user, "/api/accounts", {
      code: `9100-${RUN_TAG}`,
      nameAr: `نقدية ${RUN_TAG}`,
      nameEn: `Cash ${RUN_TAG}`,
      type: "asset",
      subtype: "current_asset",
      isHeader: false,
      isActive: true,
    });
    const acc2 = await postJson(user, "/api/accounts", {
      code: `9200-${RUN_TAG}`,
      nameAr: `إيراد ${RUN_TAG}`,
      nameEn: `Revenue ${RUN_TAG}`,
      type: "revenue",
      subtype: "operating_revenue",
      isHeader: false,
      isActive: true,
    });
    const cashId = asNumber(acc1.id, "acc1.id");
    const revenueId = asNumber(acc2.id, "acc2.id");

    // The /api/documents/upload route requires a real image upload + a real
    // OpenAI vision call to land in the `ready` state. We sidestep that by
    // inserting a `ready` document row directly via the same Postgres URL the
    // server uses, then calling the post route over HTTP. This keeps the test
    // focused on the post-route audit-attribution plumbing.
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
    const pgClient = new pg.Client({ connectionString: dbUrl });
    await pgClient.connect();
    let documentId: number;
    try {
      const inserted = await pgClient.query<{ id: number }>(
        `INSERT INTO documents
           (company_id, file_name, mime_type, size_bytes, storage_path,
            status, extracted_json, suggested_journal_json)
         VALUES ($1, $2, $3, $4, $5, 'ready', $6::jsonb, $7::jsonb)
         RETURNING id`,
        [
          user.companyId,
          `audit-test-${RUN_TAG}.png`,
          "image/png",
          1024,
          `documents/audit-test-${RUN_TAG}.png`,
          JSON.stringify({
            vendor: "Audit Vendor",
            documentDate: "2025-04-01",
            currency: "USD",
            total: 100,
            paymentMethod: "cash",
            documentType: "receipt",
            language: "en",
            lineItems: [],
            confidence: 0.9,
          }),
          JSON.stringify({
            description: `Audit doc ${RUN_TAG}`,
            entryDate: "2025-04-01",
            lines: [
              { accountId: cashId, accountCode: "9100", accountName: "Cash", debit: 100, credit: 0 },
              { accountId: revenueId, accountCode: "9200", accountName: "Revenue", debit: 0, credit: 100 },
            ],
          }),
        ],
      );
      documentId = inserted.rows[0].id;
    } finally {
      await pgClient.end();
    }

    const postBody = {
      description: `Audit doc post ${RUN_TAG}`,
      entryDate: "2025-04-01",
      lines: [
        { accountId: cashId, debit: 100, credit: 0, description: "cash leg" },
        { accountId: revenueId, debit: 0, credit: 100, description: "revenue leg" },
      ],
    };
    const postResp = await call("POST", `/api/documents/${documentId}/post`, user.jar, {
      body: postBody,
      headers: user.headers,
    });
    expect(postResp.status, `POST /api/documents/${documentId}/post: ${postResp.text}`).toBe(201);
    const postBodyParsed = asObject(postResp.body);
    const journalEntry = asObject(postBodyParsed.journalEntry);
    const jeId = asNumber(journalEntry.id, "journalEntry.id");

    const jeAudit = (await getJson(
      user,
      `/api/audit/journal_entry/${jeId}`,
    )) as AuditRow[];
    const aiRow = findAiAuditRow(jeAudit, "create");
    expect(aiRow.source).toBe("ai");
    expect(
      aiRow.actor,
      `document-post audit actor must be the confirming human (${HUMAN_ACTOR}), not the "AI assistant" fallback`,
    ).toBe(HUMAN_ACTOR);
    expect(
      aiRow.actor,
      `document-post audit actor must not regress to the "AI assistant" fallback`,
    ).not.toBe("AI assistant");

    // None of the journal-entry audit rows should mention the "AI assistant"
    // anonymous fallback — the entire history of this JE was authored by the
    // confirming human, even if storage records create + post events.
    const fallbackLeak = jeAudit.find((r) => r.actor === "AI assistant");
    expect(
      fallbackLeak,
      `audit log for journal_entry/${jeId} unexpectedly contains an "AI assistant" actor row: ${JSON.stringify(fallbackLeak)}`,
    ).toBeUndefined();
  });
});
