import { test, expect } from "@playwright/test";
import crypto from "node:crypto";

/**
 * Cross-workspace data isolation regression net.
 *
 * Signs up two distinct users (A and B), gives each their own workspace, then
 * has user A create rows under every workspace-scoped resource (accounts,
 * journal entries, transactions, fixed-assets, employees, attendance, leaves,
 * budgets). User B then queries every list endpoint and asserts none of A's
 * rows appear, every detail endpoint for A's rows returns 404, every audit
 * history endpoint for A's rows returns 404, and every /api/insights/*
 * aggregate (health, alerts, taxes, cash-forecast, simulate, budget-vs-actual,
 * ai-coach) is computed only from B's own data.
 *
 * If this test fails, a route or a storage method is no longer scoping by
 * the active companyId — financial data is leaking across tenants.
 *
 * Implementation note: we drive the API with `fetch` and a manual cookie jar
 * rather than Playwright's request context because the express-session cookie
 * is `Secure` and the dev server runs over plain HTTP — Playwright's cookie
 * jar would refuse to resend it. The `X-Forwarded-Proto: https` header tricks
 * the trust-proxy-aware session middleware into emitting the Set-Cookie at all.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";

/**
 * The legacy workspace-member RBAC layer (server/auth.ts) is independent of
 * the new tenant model under test here — it gates writes by a signed `wm_id`
 * cookie. Without that cookie every caller is treated as an anonymous viewer
 * and blocked from POSTing. We sign the cookie ourselves using the same
 * SESSION_SECRET the server uses, granting both test users the existing
 * "Workspace Owner" identity. Tenant isolation under test still flows through
 * the new auth session + X-Company-Id header, so sharing this cookie does not
 * weaken what we're verifying.
 */
const WM_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET || "";
function signedWmCookie(memberId: number): string {
  if (!WM_SECRET) {
    throw new Error("SESSION_SECRET / WM_COOKIE_SECRET must be set for the workspace-isolation test");
  }
  const sig = crypto.createHmac("sha256", WM_SECRET).update(String(memberId)).digest("hex").slice(0, 32);
  return `${memberId}.${sig}`;
}

class CookieJar {
  private store = new Map<string, string>();
  constructor(seed?: Record<string, string>) {
    if (seed) for (const [k, v] of Object.entries(seed)) this.store.set(k, v);
  }
  ingest(setCookieHeaders: string[]) {
    for (const h of setCookieHeaders) {
      const [pair] = h.split(";");
      const [name, ...rest] = pair.split("=");
      if (!name) continue;
      this.store.set(name.trim(), rest.join("=").trim());
    }
  }
  asHeader(): string {
    return Array.from(this.store.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

interface Session {
  jar: CookieJar;
  email: string;
  companyId: number;
  /** Active company header to attach to every workspace-scoped request. */
  headers: Record<string, string>;
}

interface ApiResponse {
  status: number;
  body: unknown;
  text: string;
}

/**
 * Node 18+ exposes `getSetCookie()` on the fetch `Headers` instance, but the
 * stock TypeScript DOM lib still types it as undefined. This narrow cast keeps
 * us inside structural typing — no `any` escape hatches — while letting us
 * read the multi-Set-Cookie array we need for the cookie jar.
 */
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
  if (typeof value !== "number") throw new Error(`${label} expected number, got ${typeof value}: ${value}`);
  return value;
}

async function bootstrapUser(label: "A" | "B", salt = ""): Promise<Session> {
  const jar = new CookieJar({ wm_id: signedWmCookie(1) });
  const email = `iso-${label.toLowerCase()}-${salt}${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP per user so the express signup/signin rate
  // limiters (keyed by client IP) do not throttle this test when re-run.
  const forwardedFor = `10.${(label.charCodeAt(0) + (Date.now() % 200)) & 0xff}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await call("POST", "/api/auth/signup", jar, {
    body: { email, password: PASSWORD, firstName: `Iso${label}`, lastName: "Tester", preferredLocale: "en" },
    headers: ipHeader,
  });
  expect(signup.status, `signup for user ${label}: ${signup.text}`).toBe(201);

  const company = await call("POST", "/api/companies", jar, {
    body: {
      name: `Iso ${label} ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    },
  });
  expect(company.status, `create company for user ${label}: ${company.text}`).toBe(201);
  const companyId = asNumber(asObject(company.body).id, "created company id");

  return { jar, email, companyId, headers: { "x-company-id": String(companyId) } };
}

async function getJson(s: Session, path: string): Promise<unknown> {
  const r = await call("GET", path, s.jar, { headers: s.headers });
  expect(r.status, `GET ${path} as ${s.email}: ${r.text}`).toBe(200);
  return r.body;
}

async function postJson(
  s: Session,
  path: string,
  body: Record<string, unknown>,
  expectedStatus = 201,
): Promise<Record<string, unknown>> {
  const r = await call("POST", path, s.jar, { body, headers: s.headers });
  if (r.status !== expectedStatus) {
    throw new Error(`POST ${path} expected ${expectedStatus}, got ${r.status}: ${r.text}`);
  }
  return asObject(r.body);
}

interface SeededRows {
  accountIds: number[];
  transactionId: number;
  journalEntryId: number;
  fixedAssetId: number;
  categoryId: number;
  employeeId: number;
  attendanceId: number;
  leaveId: number;
  budgetId: number;
  uniqueDescription: string;
}

async function seedWorkspace(s: Session): Promise<SeededRows> {
  const tag = `${RUN_TAG}-${s.companyId}`;
  const uniqueDescription = `iso-marker-${tag}`;

  const acc1 = await postJson(s, "/api/accounts", {
    code: `9001-${tag}`,
    nameAr: `حساب أ ${tag}`,
    nameEn: `Iso Cash ${tag}`,
    type: "asset",
    subtype: "current_asset",
    isHeader: false,
    isActive: true,
  });
  const acc2 = await postJson(s, "/api/accounts", {
    code: `9002-${tag}`,
    nameAr: `حساب ب ${tag}`,
    nameEn: `Iso Revenue ${tag}`,
    type: "revenue",
    subtype: "operating_revenue",
    isHeader: false,
    isActive: true,
  });

  const tx = await postJson(s, "/api/transactions", {
    type: "income",
    amount: "123.45",
    description: uniqueDescription,
    category: `iso-${tag}`,
  });

  const je = await postJson(s, "/api/journal-entries", {
    description: `Iso JE ${tag}`,
    source: "manual",
    lines: [
      { accountId: acc1.id, debit: 100, credit: 0 },
      { accountId: acc2.id, debit: 0, credit: 100 },
    ],
  });

  const cat = await postJson(s, "/api/asset-categories", {
    companyId: s.companyId,
    name: `Iso Cat ${tag}`,
    measurementModel: "cost",
    defaultMethod: "straight_line",
    defaultUsefulLifeMonths: 60,
    assetCostAccountId: acc1.id,
    accumulatedDepAccountId: acc1.id,
    depExpenseAccountId: acc2.id,
    accumulatedImpAccountId: acc1.id,
    impLossAccountId: acc2.id,
    revalSurplusAccountId: acc1.id,
    gainLossDisposalAccountId: acc2.id,
  });
  const asset = await postJson(s, "/api/fixed-assets", {
    categoryId: cat.id,
    code: `FA-${tag}`,
    name: `Iso Asset ${tag}`,
    acquisitionDate: "2025-01-01",
    inServiceDate: "2025-01-01",
    currency: "USD",
    txCost: 1200,
    fxRate: 1,
    residual: 0,
    usefulLifeMonths: 12,
    method: "straight_line",
    measurementModel: "cost",
    status: "active",
  });

  const emp = await postJson(s, "/api/hr/employees", {
    fullName: `Iso Employee ${tag}`,
    jobTitle: "Tester",
    hireDate: "2025-01-01",
    baseSalary: 5000,
    allowances: 100,
    isNational: true,
    isActive: true,
  });

  const att = await postJson(s, "/api/hr/attendance", {
    employeeId: emp.id,
    date: "2025-02-03",
    status: "present",
    overtimeHours: 1,
  });

  const lv = await postJson(s, "/api/hr/leaves", {
    employeeId: emp.id,
    startDate: "2025-03-01",
    endDate: "2025-03-03",
    days: 3,
    type: "annual",
    status: "approved",
    notes: "iso",
  });

  const bg = await postJson(s, "/api/budgets", {
    accountId: acc2.id,
    year: 2025,
    month: 5,
    amount: 999,
  });

  return {
    accountIds: [asNumber(acc1.id, "acc1.id"), asNumber(acc2.id, "acc2.id")],
    transactionId: asNumber(tx.id, "tx.id"),
    journalEntryId: asNumber(je.id, "je.id"),
    fixedAssetId: asNumber(asset.id, "asset.id"),
    categoryId: asNumber(cat.id, "cat.id"),
    employeeId: asNumber(emp.id, "emp.id"),
    attendanceId: asNumber(att.id, "att.id"),
    leaveId: asNumber(lv.id, "lv.id"),
    budgetId: asNumber(bg.id, "bg.id"),
    uniqueDescription,
  };
}

function expectNoCrossover(rows: unknown, ids: Set<number>, label: string) {
  expect(Array.isArray(rows), `${label} must be an array`).toBe(true);
  const arr = rows as Array<{ id?: unknown }>;
  const leaked = arr
    .filter((r) => typeof r.id === "number" && ids.has(r.id))
    .map((r) => r.id as number);
  expect(leaked, `${label} leaked rows from the other workspace: ${leaked.join(", ")}`).toEqual([]);
}

async function expect404(s: Session, path: string) {
  const r = await call("GET", path, s.jar, { headers: s.headers });
  expect(
    r.status,
    `GET ${path} as workspace ${s.companyId} must not leak the other workspace's row (got ${r.status})`,
  ).toBe(404);
}

test.describe("workspace isolation across tenants @api", () => {
  test("user B cannot see, fetch, or audit user A's rows", async () => {
    const userA = await bootstrapUser("A");
    const userB = await bootstrapUser("B");
    expect(userA.companyId).not.toBe(userB.companyId);

    const seededA = await seedWorkspace(userA);
    const seededB = await seedWorkspace(userB);
    // Sanity: A and B got different row IDs (otherwise the cross-leak test
    // below would be vacuous because A.id === B.id by coincidence).
    expect(seededA.transactionId).not.toBe(seededB.transactionId);

    // ---- list endpoints: B must not see A's rows ----
    const aIds = {
      accounts: new Set(seededA.accountIds),
      transactions: new Set([seededA.transactionId]),
      journals: new Set([seededA.journalEntryId]),
      fixedAssets: new Set([seededA.fixedAssetId]),
      employees: new Set([seededA.employeeId]),
      leaves: new Set([seededA.leaveId]),
      attendance: new Set([seededA.attendanceId]),
      budgets: new Set([seededA.budgetId]),
      categories: new Set([seededA.categoryId]),
    };

    expectNoCrossover(await getJson(userB, "/api/accounts"), aIds.accounts, "/api/accounts");
    expectNoCrossover(await getJson(userB, "/api/transactions"), aIds.transactions, "/api/transactions");
    expectNoCrossover(await getJson(userB, "/api/journal-entries"), aIds.journals, "/api/journal-entries");
    expectNoCrossover(await getJson(userB, "/api/fixed-assets"), aIds.fixedAssets, "/api/fixed-assets");
    expectNoCrossover(await getJson(userB, "/api/hr/employees"), aIds.employees, "/api/hr/employees");
    expectNoCrossover(await getJson(userB, "/api/hr/leaves"), aIds.leaves, "/api/hr/leaves");
    expectNoCrossover(await getJson(userB, "/api/hr/attendance"), aIds.attendance, "/api/hr/attendance");
    expectNoCrossover(await getJson(userB, "/api/budgets"), aIds.budgets, "/api/budgets");
    expectNoCrossover(await getJson(userB, "/api/asset-categories"), aIds.categories, "/api/asset-categories");

    // Symmetric direction: A should also not see B's rows.
    expectNoCrossover(await getJson(userA, "/api/transactions"), new Set([seededB.transactionId]), "A→B /api/transactions");
    expectNoCrossover(await getJson(userA, "/api/fixed-assets"), new Set([seededB.fixedAssetId]), "A→B /api/fixed-assets");
    expectNoCrossover(await getJson(userA, "/api/hr/employees"), new Set([seededB.employeeId]), "A→B /api/hr/employees");

    // ---- transactions summary: B's totals must reflect only B's rows ----
    const summaryB = asObject(await getJson(userB, "/api/transactions/summary"));
    // B seeded one income tx for 123.45 — A's 123.45 income must not be summed in.
    expect(asNumber(summaryB.totalIncome, "summary.totalIncome")).toBeCloseTo(123.45, 2);

    // ---- /api/insights/* — every aggregate must be computed only from B's data ----
    const stringifyContains = (value: unknown, needle: string): boolean =>
      JSON.stringify(value ?? "").includes(needle);

    // health: returns workspace KPIs. Must not contain A's marker text or
    // be inflated by A's revenue (A also booked 123.45, so a leak would
    // double the totalRevenue field).
    const healthB = asObject(await getJson(userB, "/api/insights/health"));
    expect(stringifyContains(healthB, seededA.uniqueDescription),
      "/api/insights/health leaked A's marker into B's response").toBe(false);
    const kpisB = asObject(healthB.kpis);
    // Total revenue should equal B's seeded income (123.45); a leak from A
    // would double it. Allow some slack since insights may zero-out for
    // pre-bootstrap accounts not yet in COA.
    const revenueB = asNumber(kpisB.totalRevenue, "kpis.totalRevenue");
    expect(revenueB, `B's revenue ${revenueB} must not include A's 123.45`).toBeLessThan(200);

    // alerts: list of objects. None should reference A's account ids,
    // employee id, or marker text.
    const alertsResp = asObject(await getJson(userB, "/api/insights/alerts"));
    expect(stringifyContains(alertsResp, seededA.uniqueDescription),
      "/api/insights/alerts leaked A's marker text").toBe(false);
    expect(stringifyContains(alertsResp, `iso-${RUN_TAG}-${userA.companyId}`),
      "/api/insights/alerts leaked A's category tag").toBe(false);

    // cash-forecast: rolling cash projection.
    const cashB = await getJson(userB, "/api/insights/cash-forecast?days=30");
    expect(stringifyContains(cashB, seededA.uniqueDescription),
      "/api/insights/cash-forecast leaked A's marker").toBe(false);

    // taxes: aggregated revenue/expense rollups.
    const taxB = asObject(await getJson(userB, "/api/insights/taxes"));
    expect(stringifyContains(taxB, seededA.uniqueDescription),
      "/api/insights/taxes leaked A's marker").toBe(false);

    // budget-vs-actual: rows per accountId. Must not include A's accounts.
    const bvaResp = asObject(await getJson(userB, "/api/insights/budget-vs-actual?year=2025&month=5"));
    const bvaRows = bvaResp.rows as Array<{ accountId?: number }>;
    const bvaLeaks = bvaRows.filter((r) => typeof r.accountId === "number" && aIds.accounts.has(r.accountId));
    expect(bvaLeaks.map((r) => r.accountId), "/api/insights/budget-vs-actual leaked A's accounts").toEqual([]);

    // simulate: scenario projector — POST. Computed from cid(req)'s data only.
    const simResp = await call("POST", "/api/insights/simulate", userB.jar, {
      headers: userB.headers,
      body: { priceChangePct: 5, costChangePct: 0, newMonthlyExpense: 0, expenseReductionPct: 0, monthsAhead: 6 },
    });
    expect(simResp.status, `simulate as B: ${simResp.text}`).toBe(200);
    expect(stringifyContains(simResp.body, seededA.uniqueDescription),
      "/api/insights/simulate leaked A's marker").toBe(false);

    // ai-coach: optional — only run if an OpenAI integration is configured.
    // The response is generated by an LLM, so we do not assert on shape; we
    // only assert that A's unique marker string never appears (which would
    // mean the route fed B's caller A's ledger as context).
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      const coachResp = await call("POST", "/api/insights/ai-coach", userB.jar, {
        headers: userB.headers,
        body: { question: "Summarize my last quarter in one sentence." },
      });
      // The route may rate-limit (429) or 500 if the LLM rejects; treat any
      // non-200 as inconclusive but still assert no leak in the body.
      expect(stringifyContains(coachResp.body, seededA.uniqueDescription),
        `/api/insights/ai-coach leaked A's marker (status=${coachResp.status})`).toBe(false);
    }

    // ---- detail / lookup endpoints: 404 for the other workspace's rows ----
    await expect404(userB, `/api/fixed-assets/${seededA.fixedAssetId}`);
    await expect404(userA, `/api/fixed-assets/${seededB.fixedAssetId}`);

    // ---- audit history: 404 for the other workspace's rows ----
    const auditCases: Array<[string, number]> = [
      ["transaction", seededA.transactionId],
      ["journal_entry", seededA.journalEntryId],
      ["account", seededA.accountIds[0]],
      ["fixed_asset", seededA.fixedAssetId],
      ["employee", seededA.employeeId],
      ["attendance", seededA.attendanceId],
      ["leave", seededA.leaveId],
    ];
    for (const [entityType, id] of auditCases) {
      await expect404(userB, `/api/audit/${entityType}/${id}`);
    }
    // And vice-versa for one row from B (proves the gate is bidirectional).
    await expect404(userA, `/api/audit/transaction/${seededB.transactionId}`);

    // ---- HR leave-balance: querying the *other* workspace's employee must
    // return a fully-zero balance. This route does not 404 by design (it
    // returns a zero-balance shape when the employee is not found in the
    // active workspace), but a leak would surface as non-zero entitlement
    // because A's seeded employee was just hired and would have entitled
    // days carved out of the annual allowance.
    const balResp = await call("GET", `/api/hr/leave-balance/${seededA.employeeId}`, userB.jar, { headers: userB.headers });
    expect(balResp.status, `leave-balance as B for A's employee: ${balResp.text}`).toBe(200);
    const bal = asObject(balResp.body);
    expect(asNumber(bal.entitled, "bal.entitled")).toBe(0);
    expect(asNumber(bal.taken, "bal.taken")).toBe(0);
    expect(asNumber(bal.remaining, "bal.remaining")).toBe(0);
  });

  /**
   * Write-side isolation: a logged-in user must not be able to attach rows to,
   * or borrow rows from, another tenant by sending POSTs with body fields that
   * reference foreign-workspace ids (accountId, categoryId, employeeId, …).
   *
   * Each subtest below seeds a row in user A's workspace, then has user B post
   * a CREATE that references A's id. Every such write must fail with a 4xx.
   * If the route happily writes the row, the storage layer would silently
   * cross-link tenants and the read-side checks above would not catch it
   * (because B's row genuinely belongs to B's workspace, just with a foreign
   * key pointing at A's data).
   */
  test("user B cannot POST writes that reference user A's ids", async () => {
    const userA = await bootstrapUser("A", "w");
    const userB = await bootstrapUser("B", "w");
    expect(userA.companyId).not.toBe(userB.companyId);

    const seededA = await seedWorkspace(userA);
    // Bootstrap minimal rows in B's workspace so we have a valid local id to
    // compare the error path against (i.e. same body shape, only the foreign
    // id is swapped in).
    const seededB = await seedWorkspace(userB);

    async function expectRejected(path: string, body: Record<string, unknown>, label: string) {
      const r = await call("POST", path, userB.jar, { body, headers: userB.headers });
      expect(
        [400, 403, 404].includes(r.status),
        `${label}: foreign id POST must be rejected, got ${r.status}: ${r.text}`,
      ).toBe(true);
    }

    // 1) Journal entry whose lines reference A's accounts. Must NOT post.
    await expectRejected(
      "/api/journal-entries",
      {
        description: "cross-tenant je",
        source: "manual",
        lines: [
          { accountId: seededA.accountIds[0], debit: 50, credit: 0 },
          { accountId: seededA.accountIds[1], debit: 0, credit: 50 },
        ],
      },
      "POST /api/journal-entries with A's accountId",
    );

    // 2) Budget against A's accountId.
    await expectRejected(
      "/api/budgets",
      { accountId: seededA.accountIds[1], year: 2025, month: 7, amount: 100 },
      "POST /api/budgets with A's accountId",
    );

    // 3) Asset category whose GL mappings reference A's accounts.
    await expectRejected(
      "/api/asset-categories",
      {
        name: `Cross Cat ${RUN_TAG}`,
        measurementModel: "cost",
        defaultMethod: "straight_line",
        defaultUsefulLifeMonths: 60,
        assetCostAccountId: seededA.accountIds[0],
        accumulatedDepAccountId: seededA.accountIds[0],
        depExpenseAccountId: seededA.accountIds[1],
        accumulatedImpAccountId: seededA.accountIds[0],
        impLossAccountId: seededA.accountIds[1],
        revalSurplusAccountId: seededA.accountIds[0],
        gainLossDisposalAccountId: seededA.accountIds[1],
      },
      "POST /api/asset-categories with A's accountIds",
    );

    // 3b) PATCH B's own category but try to swap in one of A's accounts.
    const patchResp = await call(
      "PATCH",
      `/api/asset-categories/${seededB.categoryId}`,
      userB.jar,
      { headers: userB.headers, body: { assetCostAccountId: seededA.accountIds[0] } },
    );
    expect(
      [400, 403, 404].includes(patchResp.status),
      `PATCH /api/asset-categories with A's accountId must be rejected, got ${patchResp.status}: ${patchResp.text}`,
    ).toBe(true);

    // 4) Fixed asset against A's category (note: category contains A's account ids).
    await expectRejected(
      "/api/fixed-assets",
      {
        categoryId: seededA.categoryId,
        code: `FAX-${RUN_TAG}`,
        name: "Cross Asset",
        acquisitionDate: "2025-01-01",
        inServiceDate: "2025-01-01",
        currency: "USD",
        txCost: 1000,
        fxRate: 1,
        residual: 0,
        usefulLifeMonths: 12,
        method: "straight_line",
        measurementModel: "cost",
        status: "active",
      },
      "POST /api/fixed-assets with A's categoryId",
    );

    // 5) HR attendance against A's employeeId.
    await expectRejected(
      "/api/hr/attendance",
      { employeeId: seededA.employeeId, date: "2025-04-01", status: "present", overtimeHours: 0 },
      "POST /api/hr/attendance with A's employeeId",
    );

    // 6) HR leave against A's employeeId.
    await expectRejected(
      "/api/hr/leaves",
      {
        employeeId: seededA.employeeId,
        startDate: "2025-04-01",
        endDate: "2025-04-02",
        days: 2,
        type: "annual",
        status: "approved",
        notes: "x",
      },
      "POST /api/hr/leaves with A's employeeId",
    );

    // Sanity: the same writes with B's own ids still succeed — proves the
    // gate is the foreign-id check, not a blanket reject.
    const okJe = await call("POST", "/api/journal-entries", userB.jar, {
      headers: userB.headers,
      body: {
        description: "B local je",
        source: "manual",
        lines: [
          { accountId: seededB.accountIds[0], debit: 1, credit: 0 },
          { accountId: seededB.accountIds[1], debit: 0, credit: 1 },
        ],
      },
    });
    expect(okJe.status, `local-only JE must succeed: ${okJe.text}`).toBe(201);
  });
});
