import { test, expect } from "@playwright/test";
import pg from "pg";
import {
  CASH_ACCOUNT_CODE,
  pickExpenseAccountCode,
  pickRevenueAccountCode,
} from "../../shared/coa-seed";

/**
 * Regression net for task #240 — keep `autoPostFromTransaction` from silently
 * double-cashing the JE when the picked revenue/expense account is missing.
 *
 * Sister spec to `auto-post-missing-cash-account.spec.ts` (task #191), which
 * covered the cash leg. The same silent-failure mode used to hide on the
 * other leg in `server/storage.ts → autoPostFromTransaction`:
 *
 *   crId = rev?.id ?? cash.id;   // income path
 *   drId = exp?.id ?? cash.id;   // expense path
 *
 * If `pickRevenueAccountCode` / `pickExpenseAccountCode` returned a code that
 * was missing from the workspace's CoA (deleted by an admin import, a future
 * migration, a soft-delete, etc.), the helper produced a "balanced" but
 * accounting-meaningless JE: `Dr cash / Cr cash`. Revenue or expense never
 * hit the GL, and the trial balance, P&L, and dashboard totals were quietly
 * wrong.
 *
 * The fix mirrors the cash branch self-heal: when the resolved
 * revenue/expense code is absent, re-run `seedDefaultCoaForCompany` for the
 * workspace (idempotent), re-fetch, and only then post the JE — so the
 * recovered JE references the picked revenue/expense account, not cash on
 * both legs. If the re-seed itself didn't restore the account, the helper
 * throws a loud error which `createTransaction`'s try/catch surfaces via
 * `console.error` with the orphaned transaction id (instead of silently
 * letting the books drift).
 *
 * What this spec asserts after deleting the picked revenue/expense account
 * directly in the database and posting a fresh transaction:
 *
 *   1. The transaction is created (the user is not blocked on the silent
 *      defensive branch).
 *   2. The picked revenue/expense account is back in the workspace's chart
 *      of accounts (the self-heal re-seed ran).
 *   3. A balanced double-entry JE was auto-posted for the transaction with
 *      the correct revenue/expense leg referencing the workspace's own
 *      newly-restored account, NOT `Dr cash / Cr cash`. If the helper
 *      silently double-cashed again, this assertion fails loudly with a
 *      message naming the helper.
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
  const email = `auto-post-no-rev-exp-${salt}-${RUN_TAG}@example.test`;
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
      firstName: "NoRevExp",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `No RevExp ${salt} ${RUN_TAG}`,
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

interface AccountRow {
  id: number;
  code: string;
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

test.describe(
  "autoPostFromTransaction self-heals when the workspace's revenue/expense account is missing @api",
  () => {
    test("posting an income transaction after the picked revenue account is deleted re-seeds it and credits revenue, not cash", async () => {
      const user = await bootstrapUser("inc");

      // Use a category whose Arabic-keyword mapping in shared/coa-seed.ts
      // routes to a specific, non-default revenue account. That way deleting
      // it can't be silently masked by the `4100` fallback in
      // pickRevenueAccountCode.
      const description = `auto-post-no-rev-${RUN_TAG} خدمات استشارية`;
      const category = "خدمات";
      const amount = 480;
      const expectedRevenueCode = pickRevenueAccountCode(category, description);
      // Sanity: the picked code must not be the default sales code, otherwise
      // we are not exercising the "missing non-default revenue account"
      // branch this regression covers.
      expect(
        expectedRevenueCode,
        `test fixture must pick a non-default revenue code so the deletion below ` +
          `actually exercises the missing-revenue-account branch (got ${expectedRevenueCode})`,
      ).not.toBe("4100");

      const accountsBefore = (await getJson(user, "/api/accounts")) as AccountRow[];
      const cashBefore = accountsBefore.find((a) => a.code === CASH_ACCOUNT_CODE);
      expect(
        cashBefore,
        `freshly-bootstrapped workspace ${user.companyId} should have ` +
          `code=${CASH_ACCOUNT_CODE} from the seeded chart of accounts`,
      ).toBeTruthy();
      const revBefore = accountsBefore.find((a) => a.code === expectedRevenueCode);
      expect(
        revBefore,
        `freshly-bootstrapped workspace ${user.companyId} should have the picked ` +
          `revenue account code=${expectedRevenueCode} from the seeded CoA`,
      ).toBeTruthy();

      // Knock out the picked revenue account directly in the database to
      // simulate a future migration / admin import / soft-delete that left
      // the workspace without it. We scope by company_id as a defense in
      // depth in case a future test runs with a polluted DB.
      const client = await pgConnect();
      try {
        const del = await client.query(
          `DELETE FROM accounts WHERE company_id = $1 AND code = $2`,
          [user.companyId, expectedRevenueCode],
        );
        expect(
          del.rowCount,
          `expected to delete the workspace's ${expectedRevenueCode} revenue account, ` +
            `got ${del.rowCount} rows`,
        ).toBe(1);

        const accountsAfterDelete = (await getJson(
          user,
          "/api/accounts",
        )) as AccountRow[];
        expect(
          accountsAfterDelete.find((a) => a.code === expectedRevenueCode),
          `revenue account ${expectedRevenueCode} should be gone before the ` +
            `transaction is posted, otherwise this test isn't exercising the ` +
            `missing-revenue-account branch of autoPostFromTransaction`,
        ).toBeUndefined();

        // Post the income transaction. The previous behaviour would have
        // silently fallen back to `crId = cash.id`, producing a
        // `Dr cash / Cr cash` JE that "balances" but never books revenue.
        const txResp = await call("POST", "/api/transactions", user.jar, {
          body: { type: "income", amount, description, category },
          headers: user.headers,
        });
        expect(
          txResp.status,
          `create income transaction (revenue account was missing): ${txResp.text}`,
        ).toBe(201);
        const txId = asNumber(asObject(txResp.body).id, "transaction.id");

        // Self-heal: the workspace's CoA should have been re-seeded so the
        // revenue account is back.
        const accountsAfterPost = (await getJson(
          user,
          "/api/accounts",
        )) as AccountRow[];
        const revAfterPost = accountsAfterPost.find(
          (a) => a.code === expectedRevenueCode,
        );
        expect(
          revAfterPost,
          `autoPostFromTransaction must re-seed the workspace's picked revenue ` +
            `account (code=${expectedRevenueCode}) when it's missing — if this ` +
            `fails, the self-heal branch was skipped or the seed didn't cover ` +
            `that code`,
        ).toBeTruthy();

        const entries = (await getJson(
          user,
          "/api/journal-entries",
        )) as JournalEntry[];
        const je = entries.find((j) => j.sourceTransactionId === txId);
        expect(
          je,
          `expected an auto-posted JE with sourceTransactionId=${txId} after ` +
            `posting an income transaction whose picked revenue account ` +
            `${expectedRevenueCode} had been deleted. entries=${JSON.stringify(
              entries.map((j) => ({
                id: j.id,
                sourceTransactionId: j.sourceTransactionId,
              })),
            )}`,
        ).toBeTruthy();

        const lines = je!.lines;
        expect(
          lines.length,
          `recovered JE ${je!.id} should have 2 lines, got ${lines.length}`,
        ).toBe(2);
        const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
        const totalCredit = lines.reduce(
          (s, l) => s + Number(l.credit || 0),
          0,
        );
        expect(totalDebit).toBeCloseTo(amount, 2);
        expect(totalCredit).toBeCloseTo(amount, 2);
        expect(totalDebit).toBeCloseTo(totalCredit, 2);

        // Income → Dr cash (1110), Cr revenue (the picked, restored code).
        const drLine = lines.find((l) => Number(l.debit || 0) > 0);
        const crLine = lines.find((l) => Number(l.credit || 0) > 0);
        expect(
          drLine?.account?.code,
          `recovered income JE must Dr the workspace's ${CASH_ACCOUNT_CODE} cash account`,
        ).toBe(CASH_ACCOUNT_CODE);
        expect(
          crLine?.account?.code,
          `recovered income JE must Cr the picked revenue account ` +
            `${expectedRevenueCode}, NOT cash. If this assertion fails, ` +
            `autoPostFromTransaction silently double-cashed the JE — exactly ` +
            `the silent-failure mode task #240 closes.`,
        ).toBe(expectedRevenueCode);
        // Defense in depth: the credit leg must not reference cash.
        expect(
          crLine?.account?.code,
          `recovered income JE Cr leg must not be cash; that would mean ` +
            `autoPostFromTransaction fell back to Cr cash silently`,
        ).not.toBe(CASH_ACCOUNT_CODE);
        expect(
          crLine?.accountId,
          `recovered JE Cr line must reference the workspace's newly-restored revenue account id`,
        ).toBe(revAfterPost!.id);
      } finally {
        await client.end();
      }
    });

    test("posting an expense transaction after the picked expense account is deleted re-seeds it and debits expense, not cash", async () => {
      const user = await bootstrapUser("exp");

      // Pick a category whose mapping routes to a specific, non-default
      // expense account. The default fallback in pickExpenseAccountCode is
      // 6900, so we want anything other than that to make sure the deletion
      // is meaningful.
      const description = `auto-post-no-exp-${RUN_TAG} إيجار المكتب`;
      const category = "إيجار";
      const amount = 1500;
      const expectedExpenseCode = pickExpenseAccountCode(category, description);
      expect(
        expectedExpenseCode,
        `test fixture must pick a non-default expense code so the deletion below ` +
          `actually exercises the missing-expense-account branch (got ${expectedExpenseCode})`,
      ).not.toBe("6900");

      const accountsBefore = (await getJson(user, "/api/accounts")) as AccountRow[];
      const expBefore = accountsBefore.find((a) => a.code === expectedExpenseCode);
      expect(
        expBefore,
        `freshly-bootstrapped workspace ${user.companyId} should have the picked ` +
          `expense account code=${expectedExpenseCode} from the seeded CoA`,
      ).toBeTruthy();

      const client = await pgConnect();
      try {
        const del = await client.query(
          `DELETE FROM accounts WHERE company_id = $1 AND code = $2`,
          [user.companyId, expectedExpenseCode],
        );
        expect(
          del.rowCount,
          `expected to delete the workspace's ${expectedExpenseCode} expense account, ` +
            `got ${del.rowCount} rows`,
        ).toBe(1);

        const accountsAfterDelete = (await getJson(
          user,
          "/api/accounts",
        )) as AccountRow[];
        expect(
          accountsAfterDelete.find((a) => a.code === expectedExpenseCode),
          `expense account ${expectedExpenseCode} should be gone before the ` +
            `transaction is posted, otherwise this test isn't exercising the ` +
            `missing-expense-account branch of autoPostFromTransaction`,
        ).toBeUndefined();

        // Post the expense transaction. The previous behaviour would have
        // silently fallen back to `drId = cash.id`, producing a
        // `Dr cash / Cr cash` JE that "balances" but never books expense.
        const txResp = await call("POST", "/api/transactions", user.jar, {
          body: { type: "expense", amount, description, category },
          headers: user.headers,
        });
        expect(
          txResp.status,
          `create expense transaction (expense account was missing): ${txResp.text}`,
        ).toBe(201);
        const txId = asNumber(asObject(txResp.body).id, "transaction.id");

        const accountsAfterPost = (await getJson(
          user,
          "/api/accounts",
        )) as AccountRow[];
        const expAfterPost = accountsAfterPost.find(
          (a) => a.code === expectedExpenseCode,
        );
        expect(
          expAfterPost,
          `autoPostFromTransaction must re-seed the workspace's picked expense ` +
            `account (code=${expectedExpenseCode}) when it's missing`,
        ).toBeTruthy();

        const entries = (await getJson(
          user,
          "/api/journal-entries",
        )) as JournalEntry[];
        const je = entries.find((j) => j.sourceTransactionId === txId);
        expect(
          je,
          `expected an auto-posted JE with sourceTransactionId=${txId} after ` +
            `posting an expense transaction whose picked expense account ` +
            `${expectedExpenseCode} had been deleted`,
        ).toBeTruthy();

        const lines = je!.lines;
        expect(lines.length).toBe(2);
        const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
        const totalCredit = lines.reduce(
          (s, l) => s + Number(l.credit || 0),
          0,
        );
        expect(totalDebit).toBeCloseTo(amount, 2);
        expect(totalCredit).toBeCloseTo(amount, 2);
        expect(totalDebit).toBeCloseTo(totalCredit, 2);

        // Expense → Dr expense (the picked, restored code), Cr cash (1110).
        const drLine = lines.find((l) => Number(l.debit || 0) > 0);
        const crLine = lines.find((l) => Number(l.credit || 0) > 0);
        expect(
          crLine?.account?.code,
          `recovered expense JE must Cr the workspace's ${CASH_ACCOUNT_CODE} cash account`,
        ).toBe(CASH_ACCOUNT_CODE);
        expect(
          drLine?.account?.code,
          `recovered expense JE must Dr the picked expense account ` +
            `${expectedExpenseCode}, NOT cash. If this assertion fails, ` +
            `autoPostFromTransaction silently double-cashed the JE — exactly ` +
            `the silent-failure mode task #240 closes.`,
        ).toBe(expectedExpenseCode);
        expect(
          drLine?.account?.code,
          `recovered expense JE Dr leg must not be cash; that would mean ` +
            `autoPostFromTransaction fell back to Dr cash silently`,
        ).not.toBe(CASH_ACCOUNT_CODE);
        expect(
          drLine?.accountId,
          `recovered JE Dr line must reference the workspace's newly-restored expense account id`,
        ).toBe(expAfterPost!.id);
      } finally {
        await client.end();
      }
    });
  },
);
