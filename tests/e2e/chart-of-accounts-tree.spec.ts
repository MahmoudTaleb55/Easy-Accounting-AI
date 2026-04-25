import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import { forgeSession, requireDbUrl } from "./_helpers/forge-session";

/**
 * Regression net for Task #124's two interlocking guarantees on the
 * chart of accounts:
 *
 *   1. Every freshly-created workspace is auto-seeded with the IFRS
 *      default chart inside the workspace-creation transaction
 *      (`server/auth/storage.ts -> createCompanyForOwner` and
 *      `server/storage.ts -> createCompany`). A future refactor that
 *      drops the `seedDefaultCoaInTx` call from either path would
 *      silently leave new workspaces with an empty chart of accounts —
 *      the auto-seed assertion in the first test below would fail
 *      loudly instead.
 *
 *   2. The chart-of-accounts page renders accounts as a real
 *      collapsible tree, persists its expansion set per-workspace in
 *      `localStorage["coa-expanded-v1:<companyId>"]`, and auto-expands
 *      the ancestors of any search hit so the match is reachable
 *      without manual digging. The first test drives the toggle, the
 *      reload-persistence, and the search-driven auto-expand
 *      end-to-end against the real /app/accounts page.
 *
 * The companion test in this file locks down
 * `POST /api/accounts/restore-defaults`: 200 (with a non-zero
 * `seeded` count) when the workspace's accounts have been wiped, and
 * 409 the moment any account already exists — so the recovery hatch
 * for legacy workspaces can never silently merge into / muddle a real
 * chart of accounts.
 *
 * Auth notes — the signup endpoint is the only public route that
 * runs `createCompanyForOwner`, which is what auto-seeds the first
 * workspace. We sign up via a raw `fetch` (with `x-forwarded-proto:
 * https` so express-session accepts the secure cookie path, and a
 * spoofed `x-forwarded-for` IP so the 8/hour signup limiter doesn't
 * throttle reruns), then forge a parallel passport session via
 * `_helpers/forge-session.ts` so Playwright's browser context — which
 * cannot keep `Secure` cookies over plain HTTP — can still drive the
 * UI as that user. The two sessions point at the same user row, so
 * the UI sees the workspace the signup just bootstrapped.
 */

const PASSWORD = "Sup3rS3cret!42";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface SignupResult {
  userId: string;
  companyId: number;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Drive the public signup flow end-to-end so the workspace-creation
 * transaction inside `createCompanyForOwner` actually runs — that is
 * the code path that composes `seedDefaultCoaInTx` into the same
 * transaction as the company + settings inserts. After signup we
 * resolve the freshly created user + workspace ids via SQL and forge
 * a passport session so the test can also drive the SPA as that
 * user (signup's outbound `Secure` cookie cannot be retained by
 * Playwright's browser context over plain HTTP — see the helper for
 * details).
 */
async function signupFreshOwner(
  page: Page,
  label: string,
): Promise<SignupResult> {
  const dbUrl = requireDbUrl(`chart-of-accounts ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `coa-${label}-${stamp}@example.test`;
  const firstName = "Coa";
  const lastName = label === "tree" ? "Tree" : "Restore";

  // Spoof a unique forwarded IP so the signup limiter (keyed by client
  // IP, 8/hour) does not throttle reruns of the suite. The proto
  // override convinces express-session that this is an HTTPS request,
  // which is required for the Secure cookie path that signup hits.
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
    `POST /api/auth/signup must succeed, got ${res.status}: ${await res.text()}`,
  ).toBe(201);

  // Resolve userId + the just-bootstrapped company id from the DB —
  // signup's response body is intentionally minimal and doesn't echo
  // either id.
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
        `SELECT company_id FROM memberships WHERE user_id=$1 AND role='owner'
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

  // Plant a forged passport session so the browser context can drive
  // the UI as the signup user without needing the Secure cookie that
  // signup itself emitted.
  await forgeSession({ page, dbUrl, userId, email, firstName, lastName });

  return { userId, companyId, email, firstName, lastName };
}

/**
 * Pre-seed `active_company_id` so the SPA's queryClient stamps the
 * workspace's id into every `X-Company-Id` header from the very first
 * render — otherwise the COA page would briefly query whichever
 * workspace the membership lookup falls back to before
 * CompanyProvider rehydrates from localStorage.
 */
async function pinActiveWorkspace(page: Page, companyId: number): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((id) => {
    window.localStorage.setItem("active_company_id", String(id));
  }, companyId);
}

test.describe("chart-of-accounts auto-seed + tree UI @api @ui", () => {
  test("auto-seeds a fresh workspace and renders a collapsible, persistent, search-aware tree", async ({
    page,
  }) => {
    const { companyId } = await signupFreshOwner(page, "tree");

    // ---- (a) Auto-seed regression: GET /api/accounts must return the
    // canonical chart for the brand-new workspace WITHOUT anyone
    // having to call /api/accounts/restore-defaults. This is the
    // single most important contract on workspace bootstrap — if the
    // `seedDefaultCoaInTx` call ever falls out of `createCompanyForOwner`,
    // this assertion fails before the UI checks even run. ----
    const accountsRes = await page.request.get("/api/accounts", {
      headers: { "X-Company-Id": String(companyId) },
    });
    expect(
      accountsRes.status(),
      `GET /api/accounts: ${await accountsRes.text()}`,
    ).toBe(200);
    const accountRows = (await accountsRes.json()) as Array<{
      code: string;
      companyId: number;
    }>;
    expect(
      accountRows.length,
      "auto-seed must produce a non-empty chart of accounts",
    ).toBeGreaterThan(0);
    const wrongScope = accountRows.filter((r) => r.companyId !== companyId);
    expect(
      wrongScope,
      `every seeded row must scope to companyId=${companyId}; leaks: ${JSON.stringify(wrongScope)}`,
    ).toEqual([]);
    const presentCodes = new Set(accountRows.map((r) => r.code));
    for (const code of ["1000", "1100", "1110"]) {
      expect(
        presentCodes.has(code),
        `auto-seed must include canonical code ${code}`,
      ).toBe(true);
    }

    // ---- (b) Render the COA tree page. The CompanyProvider reads the
    // active workspace from the localStorage we pinned above, so the
    // very first /api/accounts request from the SPA scopes to
    // companyId. ----
    await pinActiveWorkspace(page, companyId);
    await page.goto("/app/accounts", { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("card-type-asset").waitFor({ state: "visible" });

    // The asset top-level header (1000) is the only "root within the
    // asset card" — every other asset row has 1000 as an ancestor —
    // and the page initialises its expansion set to every type root,
    // so 1000 is open by default and its child header 1100 is
    // therefore visible. 1100 itself is NOT in the default expansion
    // set, so its grandchild postable 1110 must be hidden until the
    // user expands 1100.
    await expect(page.getByTestId("row-account-1000")).toBeVisible();
    await expect(page.getByTestId("row-account-1100")).toBeVisible();
    await expect(page.getByTestId("row-account-1110")).toHaveCount(0);

    // ---- (c) Expand 1100 — the grandchild becomes reachable. ----
    await page.getByTestId("toggle-account-1100").click();
    await expect(page.getByTestId("row-account-1110")).toBeVisible();

    // The expansion-persistence effect writes synchronously after the
    // state change but on the next microtask. Wait for the storage
    // key to actually carry "1100" before reload so we never race a
    // not-yet-flushed write — the reload-persistence assertion below
    // is the entire point of this test.
    const storageKey = `coa-expanded-v1:${companyId}`;
    await page.waitForFunction(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        try {
          const arr = JSON.parse(raw) as unknown;
          return Array.isArray(arr) && arr.includes("1100");
        } catch {
          return false;
        }
      },
      { key: storageKey },
    );

    // ---- (d) Reload — expansion survives because the page hydrates
    // the expansion set from localStorage on mount, keyed by the
    // active companyId so two workspaces never share state. ----
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect(
      page.getByTestId("row-account-1110"),
      "1110 must remain visible after reload — expansion is persisted in localStorage",
    ).toBeVisible();
    const persisted = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      storageKey,
    );
    expect(
      persisted,
      `localStorage key ${storageKey} must hold the expansion set after reload`,
    ).not.toBeNull();
    const persistedCodes = JSON.parse(persisted as string) as string[];
    expect(
      persistedCodes,
      "persisted expansion set must include the just-toggled 1100 header",
    ).toContain("1100");

    // ---- (e) Collapse 1100 again, then search "1110" — the search
    // filter rebuilds the visible set to {match} ∪ {ancestors} and
    // adds every ancestor to an `autoExpand` set, so the match is
    // reachable even though the persisted expansion set no longer
    // contains 1100. ----
    await page.getByTestId("toggle-account-1100").click();
    await expect(page.getByTestId("row-account-1110")).toHaveCount(0);

    await page.getByTestId("input-search-accounts").fill("1110");
    await expect(
      page.getByTestId("row-account-1110"),
      "search-driven ancestor auto-expand must surface 1110 even with 1100 collapsed",
    ).toBeVisible();
    await expect(page.getByTestId("row-account-1100")).toBeVisible();
    await expect(page.getByTestId("row-account-1000")).toBeVisible();
  });

  test("POST /api/accounts/restore-defaults rejects populated workspaces and re-seeds wiped ones", async ({
    page,
  }) => {
    const { companyId } = await signupFreshOwner(page, "restore");

    // ---- (a) The workspace was just auto-seeded, so calling
    // restore-defaults must refuse with 409. This is the contract
    // that protects a real chart of accounts from being clobbered by
    // someone clicking the empty-state action on an already-populated
    // workspace (e.g. via a stale tab). ----
    const populated = await page.request.post(
      "/api/accounts/restore-defaults",
      {
        headers: { "X-Company-Id": String(companyId) },
        data: {},
      },
    );
    expect(
      populated.status(),
      `populated workspace must return 409, got ${populated.status()}: ${await populated.text()}`,
    ).toBe(409);

    // ---- (b) Wipe the workspace's accounts. Brand-new workspace
    // means no journal_lines, no asset_categories, no budgets touch
    // these rows yet, so the only FK we have to clear is the self
    // reference accounts.parent_id → accounts.id. NULLing parent_id
    // first lets the bulk DELETE proceed without touching any other
    // workspace's data. ----
    const dbUrl = requireDbUrl("chart-of-accounts restore-defaults wipe");
    const wiper = new pg.Client({ connectionString: dbUrl });
    await wiper.connect();
    try {
      await wiper.query(
        `UPDATE accounts SET parent_id = NULL WHERE company_id = $1`,
        [companyId],
      );
      const result = await wiper.query(
        `DELETE FROM accounts WHERE company_id = $1`,
        [companyId],
      );
      expect(
        result.rowCount,
        "wipe must remove every seeded account from the test workspace",
      ).toBeGreaterThan(0);
    } finally {
      await wiper.end();
    }

    // ---- (c) Now the workspace really is empty, so restore-defaults
    // must succeed and report a non-zero `seeded` count. The exact
    // count is not pinned because adding a new canonical code in
    // `@shared/coa-seed` should be allowed without churning this
    // spec — what matters is the response shape and that *some* rows
    // landed. ----
    const restored = await page.request.post(
      "/api/accounts/restore-defaults",
      {
        headers: { "X-Company-Id": String(companyId) },
        data: {},
      },
    );
    expect(
      restored.status(),
      `wiped workspace must return 200, got ${restored.status()}: ${await restored.text()}`,
    ).toBe(200);
    const restoredBody = (await restored.json()) as { seeded?: number };
    expect(
      typeof restoredBody.seeded,
      "restore-defaults response must report a numeric seeded count",
    ).toBe("number");
    expect(
      restoredBody.seeded,
      "restore-defaults must seed a non-zero number of rows into a wiped workspace",
    ).toBeGreaterThan(0);

    // ---- (d) Calling restore-defaults again on the now-repopulated
    // workspace falls right back to 409 — proves the guard is
    // re-armed on every call (i.e. it isn't a one-shot flag). ----
    const again = await page.request.post(
      "/api/accounts/restore-defaults",
      {
        headers: { "X-Company-Id": String(companyId) },
        data: {},
      },
    );
    expect(
      again.status(),
      `re-populated workspace must return 409 again, got ${again.status()}: ${await again.text()}`,
    ).toBe(409);
  });
});
