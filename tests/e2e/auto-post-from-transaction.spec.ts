import { test, expect } from "@playwright/test";
import {
  CASH_ACCOUNT_CODE,
  pickExpenseAccountCode,
  pickRevenueAccountCode,
} from "../../shared/coa-seed";

/**
 * Regression net for `autoPostFromTransaction` (server/storage.ts).
 *
 * Two coupled bugs fixed in task #97 are easy to silently re-introduce:
 *
 *   1. `ReferenceError: cash is not defined` — the helper resolves the
 *      workspace's `1110` cash account once and uses it on both legs of
 *      the JE. If a future refactor stops awaiting `getAccountByCode`,
 *      drops the variable, or renames it, the JE never gets posted and
 *      revenue / expense numbers double-count (the transaction itself is
 *      created, but no offsetting JE balances it on the books).
 *
 *   2. `recordAudit({ ctx: { source: "system", ... } })` instead of
 *      inheriting the calling `ctx` — this hard-codes "system" as the
 *      author of every auto-posted JE. Manual transactions made by a
 *      signed-in user, and AI-attributed transactions made via chat
 *      tools, would both lose their attribution and show up as
 *      "system" in the History drawer.
 *
 * The existing `tests/e2e/ai-audit-attribution.spec.ts` exercises bug #2
 * indirectly via the chat-tool path. This spec covers both bugs at the
 * `POST /api/transactions` boundary directly: it creates one income and
 * one expense transaction as a signed-in human and asserts that
 *
 *   - a balanced double-entry JE was auto-posted,
 *   - it references `CASH_ACCOUNT_CODE` plus the picked revenue/expense
 *     account from `shared/coa-seed.ts`, and
 *   - the JE audit row carries the caller's `source: "user"` and the
 *     signed-in human's full name.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";
const FIRST_NAME = "Auto";
const LAST_NAME = "Poster";
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
  const email = `auto-post-${salt}-${RUN_TAG}@example.test`;
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
      name: `Auto Post ${salt} ${RUN_TAG}`,
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

interface JournalLine {
  accountId: number;
  debit: string | number;
  credit: string | number;
  account?: { code?: string } | null;
}

interface JournalEntry {
  id: number;
  description: string | null;
  source: string | null;
  sourceTransactionId: number | null;
  lines: JournalLine[];
}

function findAutoPostedJE(entries: unknown, txId: number): JournalEntry {
  expect(Array.isArray(entries), "/api/journal-entries must return an array").toBe(true);
  const arr = entries as JournalEntry[];
  const match = arr.find((j) => j.sourceTransactionId === txId);
  expect(
    match,
    `no auto-posted journal entry found with sourceTransactionId=${txId}. ` +
      `If this assertion fails, autoPostFromTransaction silently returned ` +
      `early — most likely because resolving CASH_ACCOUNT_CODE (${CASH_ACCOUNT_CODE}) ` +
      `failed or the helper threw before inserting the JE rows. ` +
      `entries=${JSON.stringify(arr.map((j) => ({ id: j.id, sourceTransactionId: j.sourceTransactionId })))}`,
  ).toBeTruthy();
  return match!;
}

function legFor(je: JournalEntry, code: string, side: "debit" | "credit"): JournalLine {
  const matching = je.lines.find((l) => {
    if (l.account?.code !== code) return false;
    const v = Number(side === "debit" ? l.debit : l.credit);
    return v > 0;
  });
  expect(
    matching,
    `expected JE ${je.id} to have a ${side} on account code ${code}, ` +
      `got lines=${JSON.stringify(je.lines.map((l) => ({ code: l.account?.code, debit: l.debit, credit: l.credit })))}`,
  ).toBeTruthy();
  return matching!;
}

test.describe("auto-posted JE for /api/transactions @api", () => {
  test("income transaction auto-posts a balanced Dr cash / Cr revenue JE attributed to the human caller", async () => {
    const user = await bootstrapUser("inc");

    const description = `auto-post-income-${RUN_TAG}`;
    const category = "AutoPostRegression";
    const amount = 250;

    const txResp = await call("POST", "/api/transactions", user.jar, {
      body: { type: "income", amount, description, category },
      headers: user.headers,
    });
    expect(txResp.status, `create income transaction: ${txResp.text}`).toBe(201);
    const txId = asNumber(asObject(txResp.body).id, "transaction.id");

    const expectedRevenueCode = pickRevenueAccountCode(category, description);

    const entries = await getJson(user, "/api/journal-entries");
    const je = findAutoPostedJE(entries, txId);

    // Balanced double entry: exactly two lines, debits == credits == amount.
    expect(je.lines.length, `JE ${je.id} should have 2 lines, got ${je.lines.length}`).toBe(2);
    const totalDebit = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = je.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    expect(totalDebit, `JE ${je.id} debits should equal amount`).toBeCloseTo(amount, 2);
    expect(totalCredit, `JE ${je.id} credits should equal amount`).toBeCloseTo(amount, 2);
    expect(totalDebit, `JE ${je.id} must be balanced`).toBeCloseTo(totalCredit, 2);

    // Income → Dr cash, Cr revenue.
    legFor(je, CASH_ACCOUNT_CODE, "debit");
    legFor(je, expectedRevenueCode, "credit");

    // Audit attribution must inherit the calling user ctx (source=user, actor=human),
    // not the previous "source: system" hard-code.
    const jeAudit = (await getJson(user, `/api/audit/journal_entry/${je.id}`)) as AuditRow[];
    expect(Array.isArray(jeAudit), "JE audit log must be an array").toBe(true);
    const createRow = jeAudit.find((r) => r.action === "create");
    expect(
      createRow,
      `expected a create audit row for JE ${je.id}, got rows=${JSON.stringify(jeAudit)}`,
    ).toBeTruthy();
    expect(
      createRow!.source,
      `auto-posted JE audit row must inherit source from the calling ctx (user), ` +
        `not the legacy hard-coded "system" value`,
    ).toBe("user");
    expect(
      createRow!.actor,
      `auto-posted JE audit row must record the signed-in human as actor`,
    ).toBe(HUMAN_ACTOR);
  });

  test("expense transaction auto-posts a balanced Dr expense / Cr cash JE attributed to the human caller", async () => {
    const user = await bootstrapUser("exp");

    const description = `auto-post-expense-${RUN_TAG}`;
    const category = "AutoPostRegression";
    const amount = 75.5;

    const txResp = await call("POST", "/api/transactions", user.jar, {
      body: { type: "expense", amount, description, category },
      headers: user.headers,
    });
    expect(txResp.status, `create expense transaction: ${txResp.text}`).toBe(201);
    const txId = asNumber(asObject(txResp.body).id, "transaction.id");

    const expectedExpenseCode = pickExpenseAccountCode(category, description);

    const entries = await getJson(user, "/api/journal-entries");
    const je = findAutoPostedJE(entries, txId);

    expect(je.lines.length, `JE ${je.id} should have 2 lines, got ${je.lines.length}`).toBe(2);
    const totalDebit = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = je.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    expect(totalDebit, `JE ${je.id} debits should equal amount`).toBeCloseTo(amount, 2);
    expect(totalCredit, `JE ${je.id} credits should equal amount`).toBeCloseTo(amount, 2);
    expect(totalDebit, `JE ${je.id} must be balanced`).toBeCloseTo(totalCredit, 2);

    // Expense → Dr expense account, Cr cash.
    legFor(je, expectedExpenseCode, "debit");
    legFor(je, CASH_ACCOUNT_CODE, "credit");

    const jeAudit = (await getJson(user, `/api/audit/journal_entry/${je.id}`)) as AuditRow[];
    expect(Array.isArray(jeAudit), "JE audit log must be an array").toBe(true);
    const createRow = jeAudit.find((r) => r.action === "create");
    expect(
      createRow,
      `expected a create audit row for JE ${je.id}, got rows=${JSON.stringify(jeAudit)}`,
    ).toBeTruthy();
    expect(
      createRow!.source,
      `auto-posted JE audit row must inherit source from the calling ctx (user), ` +
        `not the legacy hard-coded "system" value`,
    ).toBe("user");
    expect(
      createRow!.actor,
      `auto-posted JE audit row must record the signed-in human as actor`,
    ).toBe(HUMAN_ACTOR);
  });
});
