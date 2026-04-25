import { test, expect } from "@playwright/test";
import {
  DEFAULT_COA,
  FIXED_ASSETS_EXTRA_ACCOUNTS,
  PAYROLL_EXTRA_ACCOUNTS,
} from "@shared/coa-seed";

/**
 * Regression net for Task #120 — RLS used to reject the chart-of-accounts
 * seed when a logged-in *owner* created a SECOND workspace, because the
 * seed inserts run under the active workspace's `app.current_company_id`
 * GUC and the new company id never matched. The fix wraps `createCompany`
 * in `withRlsBypass` and runs the seed inside the company-create
 * transaction so the new workspace cannot commit half-bootstrapped.
 *
 * The previously existing tests didn't catch this because they either
 * drove the very first workspace creation (signup, no membership yet, so
 * no active GUC to clash with) or only exercised the SQL layer directly.
 *
 * This spec drives the public API path that users actually take: it signs
 * up an owner (signup auto-bootstraps workspace #1), then creates a
 * SECOND workspace via POST /api/companies while the first workspace is
 * the active one, and asserts the new workspace receives:
 *
 *   1. The full canonical chart of accounts (every code from
 *      DEFAULT_COA + PAYROLL_EXTRA_ACCOUNTS + FIXED_ASSETS_EXTRA_ACCOUNTS),
 *      with every row scoped to the new workspace's company id.
 *   2. A settings row that belongs to the new workspace.
 *
 * Implementation note: we drive the API with `fetch` and a manual cookie
 * jar (and `X-Forwarded-Proto: https`) for the same reasons as
 * `workspace-isolation.spec.ts` — express-session emits a Secure cookie
 * over a trust-proxy-aware HTTPS-forwarded request, and Playwright's
 * cookie jar refuses to resend Secure cookies over plain HTTP.
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
    return Array.from(this.store.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
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
  if (typeof value !== "number") throw new Error(`${label} expected number, got ${typeof value}: ${value}`);
  return value;
}

test.describe("second-workspace bootstrap @api", () => {
  test("owner can create an additional workspace and receives full COA + settings seed", async () => {
    const jar = new CookieJar();
    // Spoof a unique forwarded IP so the express signup limiter (keyed by
    // client IP) does not throttle reruns.
    const forwardedFor = `10.${(Date.now() >> 16) & 0xff}.${
      (Date.now() >> 8) & 0xff
    }.${Math.floor(Math.random() * 200) + 1}`;
    const email = `byom-${RUN_TAG}@example.test`;

    // ---- 1. Sign up. The signup handler auto-bootstraps workspace #1. ----
    const signup = await call("POST", "/api/auth/signup", jar, {
      body: { email, password: PASSWORD, firstName: "Byom", lastName: "Owner", preferredLocale: "en" },
      headers: { "x-forwarded-for": forwardedFor },
    });
    expect(signup.status, `signup: ${signup.text}`).toBe(201);

    // ---- 2. Confirm exactly one workspace exists (the bootstrap one). ----
    const initialList = await call("GET", "/api/companies", jar);
    expect(initialList.status, `initial /api/companies: ${initialList.text}`).toBe(200);
    const firstWorkspaces = initialList.body as Array<{ id: number }>;
    expect(Array.isArray(firstWorkspaces)).toBe(true);
    expect(firstWorkspaces.length).toBe(1);
    const firstCompanyId = firstWorkspaces[0].id;

    // ---- 3. The bug-prone path: create a SECOND workspace from inside
    //         the first workspace's active scope. The active company id
    //         (firstCompanyId) is implicit via the membership fallback, so
    //         the request runs with `app.current_company_id = firstCompanyId`
    //         on the underlying pg client. Without `withRlsBypass`, the
    //         seed inserts under the *new* company id would be rejected by
    //         the workspace_isolation RLS policy. ----
    const create = await call("POST", "/api/companies", jar, {
      body: {
        name: `Byom Workspace 2 ${RUN_TAG}`,
        functionalCurrency: "USD",
        currencySymbol: "$",
        isDefault: false,
        isActive: true,
      },
    });
    expect(create.status, `create second workspace: ${create.text}`).toBe(201);
    const secondCompanyId = asNumber(asObject(create.body).id, "created workspace id");
    expect(secondCompanyId).not.toBe(firstCompanyId);

    // The list endpoint should now return both workspaces — proves the
    // owner-membership row was created alongside the company.
    const updatedList = await call("GET", "/api/companies", jar);
    expect(updatedList.status).toBe(200);
    const allWorkspaces = updatedList.body as Array<{ id: number }>;
    const ids = new Set(allWorkspaces.map((w) => w.id));
    expect(ids.has(firstCompanyId), "first workspace must still be listed").toBe(true);
    expect(ids.has(secondCompanyId), "second workspace must be listed").toBe(true);

    // ---- 4. Switch the active workspace to the new one and inspect its
    //         seed via the same public API the UI uses. ----
    const newWsHeaders = { "x-company-id": String(secondCompanyId) };

    const accountsResp = await call("GET", "/api/accounts", jar, { headers: newWsHeaders });
    expect(accountsResp.status, `GET /api/accounts in new workspace: ${accountsResp.text}`).toBe(200);
    const accountRows = accountsResp.body as Array<{
      id: number;
      companyId: number;
      code: string;
    }>;
    expect(Array.isArray(accountRows), "accounts response must be an array").toBe(true);

    // Every returned row must belong to the new workspace — a missing
    // company_id scope would have leaked the first workspace's accounts in.
    const wrongScope = accountRows.filter((r) => r.companyId !== secondCompanyId).map((r) => r.id);
    expect(
      wrongScope,
      `accounts in new workspace must all be company_id=${secondCompanyId}, leaked ids: ${wrongScope.join(", ")}`,
    ).toEqual([]);

    // Every canonical code must be present. Anything missing means the
    // seed transaction either did not run or partially failed and got
    // rolled back — both of which Task #120's bug would produce.
    const presentCodes = new Set(accountRows.map((r) => r.code));
    const expectedCodes = [
      ...DEFAULT_COA.map((s) => s.code),
      ...PAYROLL_EXTRA_ACCOUNTS.map((s) => s.code),
      ...FIXED_ASSETS_EXTRA_ACCOUNTS.map((s) => s.code),
    ];
    const missing = expectedCodes.filter((code) => !presentCodes.has(code));
    expect(
      missing,
      `new workspace is missing canonical chart-of-accounts codes: ${missing.join(", ")}`,
    ).toEqual([]);

    // ---- 5. Settings row: the new workspace must own its own settings
    //         (not the first workspace's row, and not a leak/clash). ----
    const settingsResp = await call("GET", "/api/settings", jar, { headers: newWsHeaders });
    expect(settingsResp.status, `GET /api/settings in new workspace: ${settingsResp.text}`).toBe(200);
    const settingsRow = asObject(settingsResp.body);
    expect(
      asNumber(settingsRow.companyId, "settings.companyId"),
      "settings row must belong to the newly-created workspace",
    ).toBe(secondCompanyId);

    // Sanity: the first workspace's accounts are still scoped to *its*
    // company id (the second workspace's seed didn't accidentally
    // re-tag them). This catches a regression where the seed wrote into
    // the wrong workspace because the GUC bypass was over-broad.
    const firstWsAccounts = await call("GET", "/api/accounts", jar, {
      headers: { "x-company-id": String(firstCompanyId) },
    });
    expect(firstWsAccounts.status).toBe(200);
    const firstRows = firstWsAccounts.body as Array<{ companyId: number; code: string }>;
    const firstWrongScope = firstRows.filter((r) => r.companyId !== firstCompanyId);
    expect(
      firstWrongScope.length,
      `first workspace's accounts must remain company_id=${firstCompanyId}`,
    ).toBe(0);
    // And the first workspace also has the canonical seed (sanity that
    // the assertion above isn't passing because the seed list is empty).
    const firstPresent = new Set(firstRows.map((r) => r.code));
    expect(firstPresent.has("1110"), "first workspace must still have its 1110 cash account").toBe(true);
  });
});
