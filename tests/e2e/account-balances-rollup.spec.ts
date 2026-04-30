import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import pg from "pg";
import { forgeSession, requireDbUrl } from "./_helpers/forge-session";

/**
 * Regression net for Task #226's three load-bearing contracts on the
 * `/api/accounts/balances` aggregation that powers the chart-of-accounts
 * trailing-balance column:
 *
 *   1. Workspace scoping — a journal entry posted in workspace B must
 *      never appear in workspace A's totals (or vice versa). The
 *      composite FK on `journal_lines (account_id, company_id) →
 *      accounts (id, company_id)` already physically prevents a
 *      cross-tenant *write*, but the aggregator doubles down on the
 *      read side by filtering on both `journalLines.companyId` and
 *      `journalEntries.companyId`. A future refactor that drops one of
 *      those WHERE clauses would silently leak balances from a peer
 *      workspace; this test fails loudly the moment that happens.
 *
 *   2. Period scoping — `?period=month` must exclude any JE whose
 *      `entryDate` falls outside the active calendar month, and
 *      `?period=year` must exclude anything outside the active calendar
 *      year. The route translates the period into [from, to] timestamps
 *      and passes them into `storage.getAccountBalances`; if either
 *      bound is dropped, last quarter's postings would silently
 *      contaminate "this month's" displayed balances.
 *
 *   3. Debit-normal vs credit-normal sign convention — the route
 *      computes `balance = isDebitNormal ? debit - credit : credit -
 *      debit`. Inverting that on the wrong side would make every
 *      revenue line look like a loss (or every asset look as if it had
 *      been spent). We post a balanced JE (debit asset / credit
 *      revenue) and assert both sides come out positive in the
 *      response — the only outcome consistent with the trial-balance
 *      view in `server/services/financialReports.ts`.
 *
 * The companion frontend test in
 * `client/src/pages/__tests__/chart-of-accounts-rollup.test.ts` covers
 * the rollup itself (header rows summing every descendant leaf,
 * including across multiple header layers).
 *
 * Auth notes — the signup endpoint is the only public path that runs
 * `createCompanyForOwner`, which auto-seeds the IFRS chart inside the
 * workspace-creation transaction (the test relies on that seed to find
 * a posting-eligible asset and revenue account without provisioning
 * its own chart). We sign up via a raw `fetch` (with `x-forwarded-proto:
 * https` so express-session accepts the secure cookie path, and a
 * spoofed `x-forwarded-for` IP so the 8/hour signup limiter does not
 * throttle reruns), then forge a parallel passport session via
 * `_helpers/forge-session.ts` so Playwright's request context can call
 * the workspace-scoped routes as that user.
 */

const PASSWORD = "Sup3rS3cret!42";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface Owner {
  userId: string;
  companyId: number;
  email: string;
  firstName: string;
  lastName: string;
  context: BrowserContext;
  request: APIRequestContext;
}

/**
 * Sign up a fresh owner inside a *dedicated* browser context so the
 * connect.sid cookie planted by `forgeSession` for one workspace can
 * never overwrite the cookie planted for the other. Without this,
 * `page.request` for both owners would share the most-recently-forged
 * session and the workspace-scoping assertions would silently degrade
 * into "same user, two workspaces" — which still 403s on the second
 * workspace because the user has no membership there.
 */
async function signupOwner(browser: Browser, label: string): Promise<Owner> {
  const dbUrl = requireDbUrl(`account-balances-rollup ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `bal-${label}-${stamp}@example.test`;
  const firstName = "Bal";
  const lastName = label;

  const context = await browser.newContext();
  const page = await context.newPage();

  const forwardedFor = `10.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256,
  )}.${Math.floor(Math.random() * 200) + 1}`;

  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-for": forwardedFor,
    },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      firstName,
      lastName,
      preferredLocale: "en",
    }),
  });
  expect(
    res.status,
    `POST /api/auth/signup must succeed for ${label}, got ${res.status}: ${await res.text()}`,
  ).toBe(201);

  const seed = new pg.Client({ connectionString: dbUrl });
  await seed.connect();
  let userId: string;
  let companyId: number;
  try {
    const userRow = (
      await seed.query(`SELECT id FROM users WHERE email=$1 LIMIT 1`, [email])
    ).rows[0];
    expect(userRow, `signup must persist a users row for ${email}`).toBeTruthy();
    userId = userRow.id as string;
    const companyRow = (
      await seed.query(
        `SELECT company_id FROM memberships
         WHERE user_id=$1 AND role='owner'
         ORDER BY created_at ASC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    expect(
      companyRow,
      "signup must auto-create an owner membership pointing at the bootstrapped workspace",
    ).toBeTruthy();
    companyId = Number(companyRow.company_id);
  } finally {
    await seed.end();
  }

  await forgeSession({ page, dbUrl, userId, email, firstName, lastName });
  return {
    userId,
    companyId,
    email,
    firstName,
    lastName,
    context,
    request: context.request,
  };
}

interface SeedAccounts {
  assetId: number;
  revenueId: number;
}

/** Resolve the seeded asset (current_asset) and revenue accounts that
 *  the IFRS chart auto-populates on workspace creation. We post into
 *  these so the JE is already a balanced debit-asset / credit-revenue
 *  pair — the same shape `transaction-autopost-and-backfill` uses. */
async function fetchSeedAccounts(
  request: APIRequestContext,
  companyId: number,
): Promise<SeedAccounts> {
  const res = await request.get("/api/accounts", {
    headers: { "X-Company-Id": String(companyId) },
  });
  expect(
    res.status(),
    `GET /api/accounts for company ${companyId}: ${await res.text()}`,
  ).toBe(200);
  const rows = (await res.json()) as Array<{
    id: number;
    type: string;
    subtype: string;
    isHeader: boolean;
  }>;
  const asset = rows.find(
    (a) => a.type === "asset" && a.subtype === "current_asset" && !a.isHeader,
  );
  const revenue = rows.find((a) => a.type === "revenue" && !a.isHeader);
  expect(asset, `auto-seeded chart must include a postable current asset`).toBeTruthy();
  expect(revenue, `auto-seeded chart must include a postable revenue account`).toBeTruthy();
  return { assetId: asset!.id, revenueId: revenue!.id };
}

/** Post a balanced manual JE (debit asset / credit revenue) on the
 *  given date so the test can dial in whether it falls inside or
 *  outside the requested period. Returns the persisted JE id so a
 *  caller can later reverse it via `DELETE /api/journal-entries/:id`. */
async function postBalancedJE(
  request: APIRequestContext,
  companyId: number,
  accounts: SeedAccounts,
  amount: number,
  entryDate: Date,
  description: string,
): Promise<number> {
  const res = await request.post("/api/journal-entries", {
    headers: { "X-Company-Id": String(companyId) },
    data: {
      description,
      source: "manual",
      entryDate: entryDate.toISOString(),
      lines: [
        { accountId: accounts.assetId, debit: amount, credit: 0 },
        { accountId: accounts.revenueId, debit: 0, credit: amount },
      ],
    },
  });
  expect(
    res.status(),
    `POST /api/journal-entries (${description}): ${await res.text()}`,
  ).toBe(201);
  const body = (await res.json()) as { id: number };
  expect(
    typeof body.id,
    `POST /api/journal-entries (${description}) must return a numeric id`,
  ).toBe("number");
  return body.id;
}

interface BalanceRow {
  accountId: number;
  debit: number;
  credit: number;
  balance: number;
}

async function fetchBalances(
  request: APIRequestContext,
  companyId: number,
  period: "month" | "year" | "all",
): Promise<{ period: string; rows: BalanceRow[] }> {
  const res = await request.get(
    `/api/accounts/balances?period=${encodeURIComponent(period)}`,
    { headers: { "X-Company-Id": String(companyId) } },
  );
  expect(
    res.status(),
    `GET /api/accounts/balances?period=${period} for ${companyId}: ${await res.text()}`,
  ).toBe(200);
  return (await res.json()) as { period: string; rows: BalanceRow[] };
}

test.describe("/api/accounts/balances aggregation @api", () => {
  test("scopes balances to the active workspace, the requested period, and the correct sign convention", async ({
    browser,
  }) => {
    // ---- (a) Provision two fresh workspaces (A and B), each in its
    // own browser context so the forged passport sessions never
    // collide. Each signup auto-seeds an IFRS chart inside the
    // workspace-creation transaction, so we don't need to hand-craft
    // accounts. ----
    const ownerA = await signupOwner(browser, "ws-a");
    const ownerB = await signupOwner(browser, "ws-b");

    try {
      await runScenario(ownerA, ownerB);
    } finally {
      await Promise.all([ownerA.context.close(), ownerB.context.close()]);
    }
  });

  /**
   * Task #280 — reversal regression net.
   *
   * The aggregation tested above only covers the *posting* path: a
   * balanced JE goes in, debits/credits surface in the response. The
   * reversal path is the highest-risk untested branch: a buggy
   * `deleteJournalEntry` (the reversal storage helper backing
   * `DELETE /api/journal-entries/:id`) could leave half-deleted lines
   * behind, doubling or stranding balances on the chart-of-accounts
   * trailing-balance column AND on the trial balance.
   *
   * This test pins three invariants the reversal flow must preserve:
   *
   *   1. After reversal, both the asset (debit-normal) and revenue
   *      (credit-normal) row must net to a 0 balance under
   *      `?period=all`. The aggregator groups by `accountId` *after*
   *      joining `journal_lines → journal_entries`, so a JE whose
   *      lines have been deleted simply drops out of the response —
   *      we accept either "row absent" or "row present with zero
   *      debit / credit / balance" because both are observationally
   *      indistinguishable from a never-posted account, which is the
   *      contract this test locks in.
   *
   *   2. The same 0-balance invariant must hold under `?period=month`,
   *      because the period filter is layered on *top* of the join.
   *      A bug that leaks a stray line into the month-window
   *      aggregation (without leaking into `all`) would silently flip
   *      the chart-of-accounts month column non-zero while the
   *      "all-time" column stays clean — exactly the kind of partial
   *      reversal that's hardest to spot in the UI.
   *
   *   3. Workspace scoping is preserved across the reversal. A peer
   *      workspace's identical posting must remain *fully present* in
   *      its own balances response after workspace A reverses.
   *      Because `deleteJournalEntry` issues a DELETE keyed on
   *      `(id, companyId)`, a refactor that drops either half of that
   *      composite would either no-op (if it filtered too tightly) or
   *      cross-tenant delete (if it filtered too loosely). The
   *      assertion below catches the cross-tenant case directly: B's
   *      asset+revenue rows must still show the original posted
   *      amount and the same `balance` after A reverses.
   */
  test("after reversal the asset and revenue rows net to zero without disturbing peer workspaces", async ({
    browser,
  }) => {
    const ownerA = await signupOwner(browser, "rev-a");
    const ownerB = await signupOwner(browser, "rev-b");

    try {
      await runReversalScenario(ownerA, ownerB);
    } finally {
      await Promise.all([ownerA.context.close(), ownerB.context.close()]);
    }
  });
});

async function runScenario(ownerA: Owner, ownerB: Owner): Promise<void> {
    const accountsA = await fetchSeedAccounts(ownerA.request, ownerA.companyId);
    const accountsB = await fetchSeedAccounts(ownerB.request, ownerB.companyId);

    // ---- (b) Pick a date that is *guaranteed* to be in this calendar
    // month and another that is guaranteed to be in a prior calendar
    // *year*. Using a prior-year date for the out-of-period JE lets us
    // exercise both bounds in one fixture: it must be excluded by
    // `?period=month` (a tighter window) AND by `?period=year` (the
    // wider window that drops only when the year filter actually
    // applies). The 15th avoids DST / month-boundary weirdness. ----
    const now = new Date();
    const inPeriod = new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0, 0);
    const outOfPeriod = new Date(
      now.getFullYear() - 2,
      now.getMonth(),
      15,
      12,
      0,
      0,
      0,
    );
    // Sanity: inPeriod really is in this calendar month/year, outOfPeriod
    // is two calendar years earlier so both period bounds drop it.
    expect(inPeriod.getMonth()).toBe(now.getMonth());
    expect(inPeriod.getFullYear()).toBe(now.getFullYear());
    expect(outOfPeriod.getFullYear()).toBeLessThan(now.getFullYear());

    const inAmount = 1234;
    const oldAmount = 5000;
    const peerAmount = 9999;

    // Workspace A: one in-period JE (1234) and one out-of-period JE (5000).
    await postBalancedJE(
      ownerA.request,
      ownerA.companyId,
      accountsA,
      inAmount,
      inPeriod,
      "ws-a in-period JE",
    );
    await postBalancedJE(
      ownerA.request,
      ownerA.companyId,
      accountsA,
      oldAmount,
      outOfPeriod,
      "ws-a out-of-period JE",
    );

    // Workspace B: one in-period JE (9999) — must NEVER bleed into A.
    await postBalancedJE(
      ownerB.request,
      ownerB.companyId,
      accountsB,
      peerAmount,
      inPeriod,
      "ws-b in-period JE",
    );

    // ---- (c) Workspace scoping — workspace A's `?period=all` totals
    // must reflect both of A's postings (1234 + 5000 = 6234) and
    // *only* A's seeded account ids. None of B's account ids may
    // appear in A's response. ----
    const allA = await fetchBalances(ownerA.request, ownerA.companyId, "all");
    const aAssetAll = allA.rows.find((r) => r.accountId === accountsA.assetId);
    const aRevenueAll = allA.rows.find((r) => r.accountId === accountsA.revenueId);
    expect(
      aAssetAll,
      "ws-a `period=all` must include the seeded asset row after two postings",
    ).toBeTruthy();
    expect(
      aRevenueAll,
      "ws-a `period=all` must include the seeded revenue row after two postings",
    ).toBeTruthy();
    expect(aAssetAll!.debit).toBe(inAmount + oldAmount);
    expect(aAssetAll!.credit).toBe(0);
    expect(aRevenueAll!.debit).toBe(0);
    expect(aRevenueAll!.credit).toBe(inAmount + oldAmount);

    // Workspace B's seeded account ids must NOT appear in A's response
    // — that would mean the aggregator joined across tenants.
    for (const peerId of [accountsB.assetId, accountsB.revenueId]) {
      expect(
        allA.rows.find((r) => r.accountId === peerId),
        `ws-a balances must not surface ws-b account id ${peerId}`,
      ).toBeUndefined();
    }

    // ---- (d) Period scoping — `?period=month` on workspace A must
    // exclude the 6-months-ago JE entirely. The asset/revenue rows
    // should reflect *only* the in-period posting (1234), proving
    // that `entryDate < from` is excluded by the SQL aggregator. ----
    const monthA = await fetchBalances(ownerA.request, ownerA.companyId, "month");
    expect(monthA.period).toBe("month");
    const aAssetMonth = monthA.rows.find((r) => r.accountId === accountsA.assetId);
    const aRevenueMonth = monthA.rows.find(
      (r) => r.accountId === accountsA.revenueId,
    );
    expect(
      aAssetMonth,
      "ws-a `period=month` must include the seeded asset row for the in-period JE",
    ).toBeTruthy();
    expect(
      aRevenueMonth,
      "ws-a `period=month` must include the seeded revenue row for the in-period JE",
    ).toBeTruthy();
    expect(
      aAssetMonth!.debit,
      "out-of-period JE must NOT contribute to `period=month` aggregation",
    ).toBe(inAmount);
    expect(aAssetMonth!.credit).toBe(0);
    expect(aRevenueMonth!.debit).toBe(0);
    expect(aRevenueMonth!.credit).toBe(inAmount);

    // ---- (e) Period scoping (year) — `?period=year` on workspace A
    // must also drop the prior-year JE, since `outOfPeriod` is two
    // calendar years older than `inPeriod`. This pins the second of
    // the two date bounds in `getAccountBalances` (the year-bound
    // window built by the route). ----
    const yearA = await fetchBalances(ownerA.request, ownerA.companyId, "year");
    expect(yearA.period).toBe("year");
    const aAssetYear = yearA.rows.find((r) => r.accountId === accountsA.assetId);
    const aRevenueYear = yearA.rows.find(
      (r) => r.accountId === accountsA.revenueId,
    );
    expect(
      aAssetYear,
      "ws-a `period=year` must include the seeded asset row for the in-year JE",
    ).toBeTruthy();
    expect(
      aRevenueYear,
      "ws-a `period=year` must include the seeded revenue row for the in-year JE",
    ).toBeTruthy();
    expect(
      aAssetYear!.debit,
      "prior-year JE must NOT contribute to `period=year` aggregation",
    ).toBe(inAmount);
    expect(aRevenueYear!.credit).toBe(inAmount);

    // ---- (f) Debit-normal vs credit-normal sign convention. The
    // asset (debit-normal) must show a positive balance equal to
    // `debit - credit`. The revenue (credit-normal) must show a
    // positive balance equal to `credit - debit`. Inverting either
    // sign rule would flip the corresponding line negative. ----
    expect(aAssetMonth!.balance).toBe(inAmount); // debit-normal: 1234 - 0
    expect(aRevenueMonth!.balance).toBe(inAmount); // credit-normal: 1234 - 0
    expect(aAssetAll!.balance).toBe(inAmount + oldAmount);
    expect(aRevenueAll!.balance).toBe(inAmount + oldAmount);

    // ---- (g) Workspace B sees *only* its own posting (9999), proving
    // the WHERE on `journalLines.companyId = $cid` actually scopes
    // the aggregation. Querying B should never reveal A's totals. ----
    const allB = await fetchBalances(ownerB.request, ownerB.companyId, "all");
    const bAssetAll = allB.rows.find((r) => r.accountId === accountsB.assetId);
    const bRevenueAll = allB.rows.find((r) => r.accountId === accountsB.revenueId);
    expect(
      bAssetAll,
      "ws-b must see its own seeded asset row after a posting",
    ).toBeTruthy();
    expect(
      bRevenueAll,
      "ws-b must see its own seeded revenue row after a posting",
    ).toBeTruthy();
    expect(bAssetAll!.debit).toBe(peerAmount);
    expect(bAssetAll!.balance).toBe(peerAmount);
    expect(bRevenueAll!.credit).toBe(peerAmount);
    expect(bRevenueAll!.balance).toBe(peerAmount);
    for (const peerId of [accountsA.assetId, accountsA.revenueId]) {
      expect(
        allB.rows.find((r) => r.accountId === peerId),
        `ws-b balances must not surface ws-a account id ${peerId}`,
      ).toBeUndefined();
    }
}

/**
 * After-reversal invariant: a row that the aggregator either dropped
 * entirely (because no `journal_lines` remain for that accountId post-
 * delete) or kept with zeroed totals must look identical to a never-
 * posted account. Any non-zero residual debit / credit / balance is a
 * partial-reversal bug — exactly what task #280 is here to catch.
 */
function expectZeroedRow(
  rows: BalanceRow[],
  accountId: number,
  label: string,
): void {
  const row = rows.find((r) => r.accountId === accountId);
  if (row === undefined) return; // dropped from GROUP BY → zero by construction
  expect(row.debit, `${label} debit must be zero after reversal`).toBe(0);
  expect(row.credit, `${label} credit must be zero after reversal`).toBe(0);
  expect(row.balance, `${label} balance must be zero after reversal`).toBe(0);
}

async function runReversalScenario(ownerA: Owner, ownerB: Owner): Promise<void> {
  const accountsA = await fetchSeedAccounts(ownerA.request, ownerA.companyId);
  const accountsB = await fetchSeedAccounts(ownerB.request, ownerB.companyId);

  // Pick an in-month/in-year date so the same posting is visible to
  // both `?period=all` and `?period=month`. This is what lets a single
  // reversal exercise both windows in one fixture: if the reversal
  // mishandles either window, the corresponding assertion below will
  // be the one that fires.
  const now = new Date();
  const inPeriod = new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0, 0);
  expect(inPeriod.getMonth()).toBe(now.getMonth());
  expect(inPeriod.getFullYear()).toBe(now.getFullYear());

  const reversedAmount = 4321;
  const peerAmount = 8765;

  // ---- (a) Workspace A posts the JE that will later be reversed.
  // Workspace B posts an identical-shape JE concurrently so the
  // reversal-scoping assertion has something to *prove* didn't move. ----
  const reversedJeId = await postBalancedJE(
    ownerA.request,
    ownerA.companyId,
    accountsA,
    reversedAmount,
    inPeriod,
    "ws-a JE to be reversed",
  );
  await postBalancedJE(
    ownerB.request,
    ownerB.companyId,
    accountsB,
    peerAmount,
    inPeriod,
    "ws-b peer JE (must survive ws-a reversal)",
  );

  // ---- (b) Pre-reversal sanity: workspace A's posting really did
  // hit both `?period=all` and `?period=month`. Without this we could
  // not distinguish "reversal cleared the balances" from "the JE was
  // never visible to the aggregator in the first place" (e.g. if a
  // future bug stamped the entryDate in the wrong timezone). ----
  const beforeAll = await fetchBalances(ownerA.request, ownerA.companyId, "all");
  const beforeMonth = await fetchBalances(
    ownerA.request,
    ownerA.companyId,
    "month",
  );
  for (const [label, snapshot] of [
    ["period=all", beforeAll],
    ["period=month", beforeMonth],
  ] as const) {
    const asset = snapshot.rows.find((r) => r.accountId === accountsA.assetId);
    const revenue = snapshot.rows.find(
      (r) => r.accountId === accountsA.revenueId,
    );
    expect(
      asset?.balance,
      `pre-reversal ws-a asset balance under ${label} must equal the posted amount`,
    ).toBe(reversedAmount);
    expect(
      revenue?.balance,
      `pre-reversal ws-a revenue balance under ${label} must equal the posted amount`,
    ).toBe(reversedAmount);
  }

  // ---- (c) Reverse via the same route the chart-of-accounts UI
  // (and the JE-history drawer) hit when an owner clicks "delete".
  // The route delegates to `storage.deleteJournalEntry`, which is the
  // reversal storage helper for manual JEs: it removes the JE +
  // lines + writes the reversal audit row in one transaction. ----
  const reversalRes = await ownerA.request.delete(
    `/api/journal-entries/${reversedJeId}`,
    { headers: { "X-Company-Id": String(ownerA.companyId) } },
  );
  expect(
    reversalRes.status(),
    `DELETE /api/journal-entries/${reversedJeId} (reversal) must succeed: ${await reversalRes.text()}`,
  ).toBe(204);

  // ---- (d) Both `?period=all` and `?period=month` must report a
  // 0 balance on the asset *and* the revenue side after reversal.
  // Asserting both periods catches the partial-reversal class of bug
  // where a refactor accidentally exempts one window from the join
  // (e.g. a new "fast path" for the all-time view that stops looking
  // at deletes). ----
  const afterAll = await fetchBalances(ownerA.request, ownerA.companyId, "all");
  expect(afterAll.period).toBe("all");
  expectZeroedRow(afterAll.rows, accountsA.assetId, "ws-a asset (period=all)");
  expectZeroedRow(
    afterAll.rows,
    accountsA.revenueId,
    "ws-a revenue (period=all)",
  );

  const afterMonth = await fetchBalances(
    ownerA.request,
    ownerA.companyId,
    "month",
  );
  expect(afterMonth.period).toBe("month");
  expectZeroedRow(
    afterMonth.rows,
    accountsA.assetId,
    "ws-a asset (period=month)",
  );
  expectZeroedRow(
    afterMonth.rows,
    accountsA.revenueId,
    "ws-a revenue (period=month)",
  );

  // ---- (e) Workspace scoping under reversal — workspace B's
  // identical-shape posting must remain fully present, with its
  // original posted amounts and signs. A `deleteJournalEntry` that
  // dropped the `companyId` half of its WHERE would either silently
  // fail (no-op) or cross-tenant delete; the latter would zero out
  // B's rows alongside A's, which this block detects. ----
  const peerAfter = await fetchBalances(
    ownerB.request,
    ownerB.companyId,
    "all",
  );
  const peerAsset = peerAfter.rows.find(
    (r) => r.accountId === accountsB.assetId,
  );
  const peerRevenue = peerAfter.rows.find(
    (r) => r.accountId === accountsB.revenueId,
  );
  expect(
    peerAsset,
    "ws-b asset row must survive the ws-a reversal",
  ).toBeTruthy();
  expect(
    peerRevenue,
    "ws-b revenue row must survive the ws-a reversal",
  ).toBeTruthy();
  expect(peerAsset!.debit).toBe(peerAmount);
  expect(peerAsset!.credit).toBe(0);
  expect(peerAsset!.balance).toBe(peerAmount);
  expect(peerRevenue!.debit).toBe(0);
  expect(peerRevenue!.credit).toBe(peerAmount);
  expect(peerRevenue!.balance).toBe(peerAmount);
}
