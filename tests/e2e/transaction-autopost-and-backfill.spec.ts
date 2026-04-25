import { test, expect } from "@playwright/test";
import pg from "pg";
import {
  CASH_ACCOUNT_CODE,
  pickExpenseAccountCode,
  pickRevenueAccountCode,
} from "../../shared/coa-seed";

/**
 * Regression net for task #183 — keep the transaction → JE pipeline balanced
 * across both code paths that can post the JE.
 *
 * The original incident behind task #136 was a silent regression:
 * `autoPostFromTransaction` (server/storage.ts) threw
 * `ReferenceError: cash is not defined` and quietly left every new
 * transaction without its journal entry. The boot-time backfill and the
 * owner-only admin route (`POST /api/admin/backfill-journal-entries`) both
 * heal the resulting backlog by calling
 * `backfillJournalForLegacyTransactions(companyId)` (server/init-coa.ts),
 * but nothing in CI catches the same shape of bug if it returns.
 *
 * This spec exercises both halves end-to-end against a fresh workspace:
 *
 *   1. POST /api/transactions → assert `autoPostFromTransaction` produced a
 *      balanced double-entry JE (equal debits/credits) referencing the
 *      workspace's own `1110` cash account, with `source=transaction` and
 *      `sourceTransactionId` pointing back at the transaction. We do this
 *      for both an income transaction (Dr cash / Cr revenue) and an
 *      expense transaction (Dr expense / Cr cash) so a future regression
 *      that breaks only one branch still fails CI.
 *
 *   2. Orphan the JE in-database (delete its lines + the JE row) so the
 *      transaction is once again missing its auto-posted twin, then call
 *      `POST /api/admin/backfill-journal-entries` and assert the recovered
 *      JE matches the original (same Dr/Cr accounts, same amount, same
 *      `source=transaction`, same `sourceTransactionId`, balanced).
 *
 * If either path silently returns early — the most likely future
 * regression mode (resolving CASH_ACCOUNT_CODE fails, the helper throws,
 * the admin route swallows an error) — the corresponding assertion fails
 * loudly with a message that names the affected helper.
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

async function bootstrapUser(salt: string): Promise<Session> {
  const jar = new CookieJar();
  const email = `tx-autopost-backfill-${salt}-${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP so the express signup rate limiter (keyed by
  // client IP) does not throttle this test when re-run.
  const forwardedFor = `10.${
    (salt.charCodeAt(0) + (Date.now() % 200)) & 0xff
  }.${(Date.now() >> 8) & 0xff}.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Backfill",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Tx Autopost ${salt} ${RUN_TAG}`,
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

async function getJson(s: Session, path: string): Promise<unknown> {
  const r = await call("GET", path, s.jar, { headers: s.headers });
  expect(r.status, `GET ${path}: ${r.text}`).toBe(200);
  return r.body;
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
  account?: { code?: string; id?: number } | null;
}

interface JournalEntry {
  id: number;
  description: string | null;
  source: string | null;
  sourceTransactionId: number | null;
  lines: JournalLine[];
}

function findJEForTransaction(
  entries: unknown,
  txId: number,
  hint: string,
): JournalEntry {
  expect(
    Array.isArray(entries),
    `/api/journal-entries must return an array (${hint})`,
  ).toBe(true);
  const arr = entries as JournalEntry[];
  const match = arr.find((j) => j.sourceTransactionId === txId);
  expect(
    match,
    `${hint}: no journal entry found with sourceTransactionId=${txId}. ` +
      `If this assertion fails, ${hint} silently returned early — ` +
      `most likely because resolving CASH_ACCOUNT_CODE (${CASH_ACCOUNT_CODE}) ` +
      `failed or the helper threw before inserting the JE rows. ` +
      `entries=${JSON.stringify(
        arr.map((j) => ({
          id: j.id,
          sourceTransactionId: j.sourceTransactionId,
        })),
      )}`,
  ).toBeTruthy();
  return match!;
}

interface JeShape {
  drCode: string;
  crCode: string;
  drAccountId: number;
  crAccountId: number;
  amount: number;
}

function shapeOf(je: JournalEntry): JeShape {
  expect(je.lines.length, `JE ${je.id} should have 2 lines`).toBe(2);
  const dr = je.lines.find((l) => Number(l.debit || 0) > 0);
  const cr = je.lines.find((l) => Number(l.credit || 0) > 0);
  expect(dr, `JE ${je.id} missing a debit line`).toBeTruthy();
  expect(cr, `JE ${je.id} missing a credit line`).toBeTruthy();
  const drCode = dr!.account?.code ?? "";
  const crCode = cr!.account?.code ?? "";
  expect(drCode, `JE ${je.id} debit line missing account code`).not.toBe("");
  expect(crCode, `JE ${je.id} credit line missing account code`).not.toBe("");
  return {
    drCode,
    crCode,
    drAccountId: dr!.accountId,
    crAccountId: cr!.accountId,
    amount: Number(dr!.debit),
  };
}

function assertBalanced(je: JournalEntry, amount: number, hint: string): void {
  const totalDebit = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = je.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  expect(totalDebit, `${hint}: JE ${je.id} debits should equal amount`).toBeCloseTo(
    amount,
    2,
  );
  expect(
    totalCredit,
    `${hint}: JE ${je.id} credits should equal amount`,
  ).toBeCloseTo(amount, 2);
  expect(totalDebit, `${hint}: JE ${je.id} must be balanced`).toBeCloseTo(
    totalCredit,
    2,
  );
}

async function orphanJournalEntry(
  client: pg.Client,
  companyId: number,
  jeId: number,
): Promise<void> {
  // Delete the JE + its lines directly so the transaction is once again
  // missing its auto-posted twin. We scope by company_id as a defense in
  // depth in case a future test runs with a polluted DB.
  const lines = await client.query(
    `DELETE FROM journal_lines WHERE journal_entry_id = $1 AND company_id = $2`,
    [jeId, companyId],
  );
  expect(
    lines.rowCount,
    `expected at least 2 journal_lines deleted for JE ${jeId}, got ${lines.rowCount}`,
  ).toBeGreaterThanOrEqual(2);
  const entry = await client.query(
    `DELETE FROM journal_entries WHERE id = $1 AND company_id = $2`,
    [jeId, companyId],
  );
  expect(
    entry.rowCount,
    `expected to delete JE ${jeId}, got ${entry.rowCount} rows`,
  ).toBe(1);
}

test.describe(
  "transaction → journal entry pipeline stays balanced across auto-post and recovery hatch @api",
  () => {
    test("income tx auto-posts a balanced JE, and the admin backfill recreates the same JE if it goes missing", async () => {
      const user = await bootstrapUser("inc");

      const description = `tx-autopost-backfill-income-${RUN_TAG}`;
      const category = "AutoPostBackfillRegression";
      const amount = 250;
      const expectedRevenueCode = pickRevenueAccountCode(category, description);

      // ---- Path 1: autoPostFromTransaction via POST /api/transactions ----
      const txResp = await call("POST", "/api/transactions", user.jar, {
        body: { type: "income", amount, description, category },
        headers: user.headers,
      });
      expect(
        txResp.status,
        `create income transaction: ${txResp.text}`,
      ).toBe(201);
      const txId = asNumber(asObject(txResp.body).id, "transaction.id");

      const autoPosted = findJEForTransaction(
        await getJson(user, "/api/journal-entries"),
        txId,
        "autoPostFromTransaction",
      );
      assertBalanced(autoPosted, amount, "autoPostFromTransaction");
      expect(
        autoPosted.source,
        `autoPostFromTransaction must stamp source="transaction"`,
      ).toBe("transaction");
      const original = shapeOf(autoPosted);
      // Income → Dr cash (1110), Cr revenue (category-mapped account from
      // shared/coa-seed.ts). Both must live in this workspace's CoA.
      expect(
        original.drCode,
        `income JE must Dr the workspace's own ${CASH_ACCOUNT_CODE} cash account`,
      ).toBe(CASH_ACCOUNT_CODE);
      expect(
        original.crCode,
        `income JE must Cr the picked revenue account ${expectedRevenueCode}`,
      ).toBe(expectedRevenueCode);

      // ---- Path 2: backfillJournalForLegacyTransactions via admin route ----
      const client = await pgConnect();
      try {
        await orphanJournalEntry(client, user.companyId, autoPosted.id);

        // Sanity check: the JE really is gone from the workspace's view.
        const afterOrphan =
          (await getJson(user, "/api/journal-entries")) as JournalEntry[];
        expect(
          afterOrphan.find((j) => j.sourceTransactionId === txId),
          `JE for tx ${txId} should be gone after orphaning`,
        ).toBeUndefined();

        const backfill = await call(
          "POST",
          "/api/admin/backfill-journal-entries",
          user.jar,
          { headers: user.headers },
        );
        expect(
          backfill.status,
          `admin backfill: ${backfill.text}`,
        ).toBe(200);
        const result = asObject(backfill.body);
        expect(
          asNumber(result.created, "backfill.created"),
          `backfill should report created>=1, got ${JSON.stringify(result)}`,
        ).toBeGreaterThanOrEqual(1);

        const recovered = findJEForTransaction(
          await getJson(user, "/api/journal-entries"),
          txId,
          "backfillJournalForLegacyTransactions",
        );
        assertBalanced(
          recovered,
          amount,
          "backfillJournalForLegacyTransactions",
        );
        expect(
          recovered.source,
          `backfilled JE must stamp source="transaction"`,
        ).toBe("transaction");
        expect(
          recovered.sourceTransactionId,
          `backfilled JE must point back at the originating transaction`,
        ).toBe(txId);

        const recoveredShape = shapeOf(recovered);
        expect(
          recoveredShape.drCode,
          `backfilled income JE must Dr the same ${CASH_ACCOUNT_CODE} account as the auto-posted one`,
        ).toBe(original.drCode);
        expect(
          recoveredShape.crCode,
          `backfilled income JE must Cr the same revenue account as the auto-posted one`,
        ).toBe(original.crCode);
        expect(
          recoveredShape.drAccountId,
          `backfilled JE must reference the workspace's own debit account id`,
        ).toBe(original.drAccountId);
        expect(
          recoveredShape.crAccountId,
          `backfilled JE must reference the workspace's own credit account id`,
        ).toBe(original.crAccountId);
        expect(
          recoveredShape.amount,
          `backfilled JE amount must match the original`,
        ).toBeCloseTo(original.amount, 2);
      } finally {
        await client.end();
      }
    });

    test("expense tx auto-posts a balanced JE, and the admin backfill recreates the same JE if it goes missing", async () => {
      const user = await bootstrapUser("exp");

      const description = `tx-autopost-backfill-expense-${RUN_TAG}`;
      const category = "AutoPostBackfillRegression";
      const amount = 75.5;
      const expectedExpenseCode = pickExpenseAccountCode(category, description);

      // ---- Path 1: autoPostFromTransaction ----
      const txResp = await call("POST", "/api/transactions", user.jar, {
        body: { type: "expense", amount, description, category },
        headers: user.headers,
      });
      expect(
        txResp.status,
        `create expense transaction: ${txResp.text}`,
      ).toBe(201);
      const txId = asNumber(asObject(txResp.body).id, "transaction.id");

      const autoPosted = findJEForTransaction(
        await getJson(user, "/api/journal-entries"),
        txId,
        "autoPostFromTransaction",
      );
      assertBalanced(autoPosted, amount, "autoPostFromTransaction");
      expect(autoPosted.source).toBe("transaction");
      const original = shapeOf(autoPosted);
      // Expense → Dr expense, Cr cash (1110).
      expect(
        original.drCode,
        `expense JE must Dr the picked expense account ${expectedExpenseCode}`,
      ).toBe(expectedExpenseCode);
      expect(
        original.crCode,
        `expense JE must Cr the workspace's own ${CASH_ACCOUNT_CODE} cash account`,
      ).toBe(CASH_ACCOUNT_CODE);

      // ---- Path 2: admin backfill ----
      const client = await pgConnect();
      try {
        await orphanJournalEntry(client, user.companyId, autoPosted.id);

        const backfill = await call(
          "POST",
          "/api/admin/backfill-journal-entries",
          user.jar,
          { headers: user.headers },
        );
        expect(
          backfill.status,
          `admin backfill: ${backfill.text}`,
        ).toBe(200);
        const result = asObject(backfill.body);
        expect(
          asNumber(result.created, "backfill.created"),
        ).toBeGreaterThanOrEqual(1);

        const recovered = findJEForTransaction(
          await getJson(user, "/api/journal-entries"),
          txId,
          "backfillJournalForLegacyTransactions",
        );
        assertBalanced(
          recovered,
          amount,
          "backfillJournalForLegacyTransactions",
        );
        expect(recovered.source).toBe("transaction");
        expect(recovered.sourceTransactionId).toBe(txId);

        const recoveredShape = shapeOf(recovered);
        expect(recoveredShape.drCode).toBe(original.drCode);
        expect(recoveredShape.crCode).toBe(original.crCode);
        expect(recoveredShape.drAccountId).toBe(original.drAccountId);
        expect(recoveredShape.crAccountId).toBe(original.crAccountId);
        expect(recoveredShape.amount).toBeCloseTo(original.amount, 2);
      } finally {
        await client.end();
      }
    });
  },
);
