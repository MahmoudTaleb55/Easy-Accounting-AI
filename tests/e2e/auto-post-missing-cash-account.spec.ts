import { test, expect } from "@playwright/test";
import pg from "pg";
import {
  CASH_ACCOUNT_CODE,
  pickRevenueAccountCode,
} from "../../shared/coa-seed";

/**
 * Regression net for task #191 — keep `autoPostFromTransaction` from silently
 * skipping when a workspace's `1110` cash account has been removed.
 *
 * The previous helper (`server/storage.ts → autoPostFromTransaction`) opened
 * with:
 *
 *   const cash = await this.getAccountByCode(companyId, CASH_ACCOUNT_CODE);
 *   if (!cash) return;
 *
 * Today every new workspace gets a CoA seeded in the same transaction as the
 * company row, so this branch is mostly defensive — but if a future
 * migration, an admin import, or a soft-deleted account ever leaves a
 * workspace without code `1110`, transactions would post fine and yet have
 * no balancing JE. That is exactly the revenue / expense double-counting
 * symptom the regression test for task #97 was added to catch on the seeded
 * path; this spec covers the no-cash-account edge.
 *
 * The fix self-heals: when `1110` is missing, `autoPostFromTransaction`
 * re-runs the canonical seed for that single workspace (idempotent, only
 * touches the rows it needs to), then re-fetches and posts the balanced JE
 * normally. A loud server-side `console.warn` annotates the recovery so
 * ops can notice. If the re-seed itself failed to restore `1110`, the
 * helper throws a loud error which `createTransaction`'s try/catch logs as
 * `console.error` with the orphaned transaction id.
 *
 * What this spec asserts after deleting `1110` directly in the database
 * and posting a fresh income transaction:
 *
 *   1. The transaction is created (the user is not blocked on the silent
 *      defensive branch).
 *   2. The cash account `1110` is back in the workspace's chart of
 *      accounts (the self-heal re-seed ran).
 *   3. A balanced double-entry JE was auto-posted for the transaction
 *      with `Dr cash / Cr revenue` referencing the workspace's own
 *      newly-restored `1110` and the picked revenue account from
 *      `shared/coa-seed.ts`. If the helper silently returned again, this
 *      assertion fails loudly with a message naming the helper.
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
  const email = `auto-post-no-cash-${salt}-${RUN_TAG}@example.test`;
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
      firstName: "NoCash",
      lastName: "Tester",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup ${salt}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `No Cash ${salt} ${RUN_TAG}`,
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
  "autoPostFromTransaction self-heals when the workspace's cash account is missing @api",
  () => {
    test("posting a transaction after the workspace's 1110 cash account is deleted re-seeds the cash account and still produces a balanced JE", async () => {
      const user = await bootstrapUser("inc");

      const description = `auto-post-no-cash-${RUN_TAG}`;
      const category = "AutoPostNoCashRegression";
      const amount = 320;
      const expectedRevenueCode = pickRevenueAccountCode(category, description);

      // Sanity: a fresh workspace does have its 1110 cash account.
      const accountsBefore = (await getJson(user, "/api/accounts")) as AccountRow[];
      const cashBefore = accountsBefore.find((a) => a.code === CASH_ACCOUNT_CODE);
      expect(
        cashBefore,
        `freshly-bootstrapped workspace ${user.companyId} should have ` +
          `code=${CASH_ACCOUNT_CODE} from the seeded chart of accounts`,
      ).toBeTruthy();

      // Knock out the cash account directly in the database to simulate a
      // future migration / admin import / soft-delete that left a
      // workspace without code 1110. We scope by company_id as a defense
      // in depth in case a future test runs with a polluted DB.
      const client = await pgConnect();
      try {
        const del = await client.query(
          `DELETE FROM accounts WHERE company_id = $1 AND code = $2`,
          [user.companyId, CASH_ACCOUNT_CODE],
        );
        expect(
          del.rowCount,
          `expected to delete the workspace's ${CASH_ACCOUNT_CODE} cash account, ` +
            `got ${del.rowCount} rows`,
        ).toBe(1);

        // Confirm the deletion is visible through the API too — if
        // RLS or caching held the row alive, the regression below would
        // be testing the wrong thing.
        const accountsAfterDelete = (await getJson(
          user,
          "/api/accounts",
        )) as AccountRow[];
        expect(
          accountsAfterDelete.find((a) => a.code === CASH_ACCOUNT_CODE),
          `cash account ${CASH_ACCOUNT_CODE} should be gone before the ` +
            `transaction is posted, otherwise this test isn't exercising the ` +
            `no-cash-account branch of autoPostFromTransaction`,
        ).toBeUndefined();

        // Post the income transaction. The previous behaviour of
        // autoPostFromTransaction would have silently returned at
        // `if (!cash) return;` here, leaving the transaction with no
        // offsetting JE — exactly the silent-failure mode this task
        // closes.
        const txResp = await call("POST", "/api/transactions", user.jar, {
          body: { type: "income", amount, description, category },
          headers: user.headers,
        });
        expect(
          txResp.status,
          `create income transaction (cash account was missing): ${txResp.text}`,
        ).toBe(201);
        const txId = asNumber(asObject(txResp.body).id, "transaction.id");

        // Self-heal: the workspace's CoA should have been re-seeded by
        // autoPostFromTransaction, so 1110 is back.
        const accountsAfterPost = (await getJson(
          user,
          "/api/accounts",
        )) as AccountRow[];
        const cashAfterPost = accountsAfterPost.find(
          (a) => a.code === CASH_ACCOUNT_CODE,
        );
        expect(
          cashAfterPost,
          `autoPostFromTransaction must re-seed the workspace's ` +
            `${CASH_ACCOUNT_CODE} cash account when it's missing — ` +
            `if this fails, the self-heal branch was skipped or the ` +
            `seed didn't cover code ${CASH_ACCOUNT_CODE}`,
        ).toBeTruthy();

        // The balanced double-entry JE must exist for this transaction.
        // If autoPostFromTransaction silently returned again (the bug
        // this task closes), no JE would be present here.
        const entries = (await getJson(
          user,
          "/api/journal-entries",
        )) as JournalEntry[];
        const je = entries.find((j) => j.sourceTransactionId === txId);
        expect(
          je,
          `expected an auto-posted JE with sourceTransactionId=${txId} after ` +
            `posting a transaction in a workspace whose ${CASH_ACCOUNT_CODE} ` +
            `cash account had been deleted. If this assertion fails, ` +
            `autoPostFromTransaction silently returned at the missing-cash ` +
            `branch instead of self-healing — exactly the silent-failure ` +
            `mode task #191 closed. entries=${JSON.stringify(
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
        expect(
          totalDebit,
          `recovered JE ${je!.id} debits should equal amount`,
        ).toBeCloseTo(amount, 2);
        expect(
          totalCredit,
          `recovered JE ${je!.id} credits should equal amount`,
        ).toBeCloseTo(amount, 2);
        expect(
          totalDebit,
          `recovered JE ${je!.id} must be balanced`,
        ).toBeCloseTo(totalCredit, 2);

        // Income → Dr cash (1110), Cr revenue (category-mapped).
        const drLine = lines.find((l) => Number(l.debit || 0) > 0);
        const crLine = lines.find((l) => Number(l.credit || 0) > 0);
        expect(
          drLine?.account?.code,
          `recovered income JE must Dr the workspace's own ${CASH_ACCOUNT_CODE} cash account`,
        ).toBe(CASH_ACCOUNT_CODE);
        expect(
          crLine?.account?.code,
          `recovered income JE must Cr the picked revenue account ${expectedRevenueCode}`,
        ).toBe(expectedRevenueCode);

        // The freshly re-seeded cash account is the one the JE references —
        // not some stale id left over from before the delete.
        expect(
          drLine?.accountId,
          `recovered JE Dr line must reference the workspace's newly-restored cash account id`,
        ).toBe(cashAfterPost!.id);
      } finally {
        await client.end();
      }
    });
  },
);
