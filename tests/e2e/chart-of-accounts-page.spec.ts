import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import { forgeSession, requireDbUrl } from "./_helpers/forge-session";

/**
 * Visual-contract regression net for the chart-of-accounts page itself.
 *
 * The companion specs already pin the *data* contract behind this page:
 *
 *   - `tests/e2e/account-balances-rollup.spec.ts` — workspace scoping,
 *     period scoping, and the debit-vs-credit-normal sign rule of the
 *     `/api/accounts/balances` aggregator.
 *   - `client/src/pages/__tests__/chart-of-accounts-rollup.test.ts` —
 *     the in-page rollup that sums every descendant leaf onto its
 *     ancestor headers.
 *
 * What none of those exercise is the *rendered* contract: that the
 * page actually paints a parent header alongside its (expanded) leaf,
 * that the leaf shows its own posted amount, and that the parent
 * header simultaneously shows the rolled-up amount in the same row.
 * A future refactor that, for example, swapped the rollup helper for
 * a server-only aggregation, dropped the per-row `text-balance-<code>`
 * test id, or stopped rendering header rows at all would not break
 * anything in those data-contract specs — but it would silently
 * regress the page itself. This spec closes that gap end-to-end.
 *
 * Mirrors the per-owner BrowserContext + signup + `forgeSession`
 * pattern used by `account-balances-rollup.spec.ts` so the workspace
 * we provision is brand-new on every run (auto-seeded IFRS chart, no
 * cross-test contamination from sibling specs that touch
 * `/api/accounts`). We post a single balanced JE that lands on a
 * postable current-asset leaf and then assert two things on the
 * rendered tree:
 *
 *   1. The leaf row shows the formatted amount we posted.
 *   2. The leaf's nearest ancestor header (climbed via `parentId` from
 *      the seeded chart) shows the same amount, proving the rollup
 *      actually reaches the rendered DOM and isn't merely computed and
 *      thrown away.
 *
 * The amount (1234) is chosen to be unique enough that grepping the
 * row's text for the digit run can't collide with the seeded "0"
 * placeholders other postable accounts render. The header's rolled-up
 * value equals the leaf's because every other postable leaf in the
 * brand-new workspace has zero activity.
 */

const PASSWORD = "Sup3rS3cret!42";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

/**
 * Strip everything that is not a digit and translate Arabic-Indic
 * digits (٠-٩) into their ASCII equivalents. Used to compare the
 * rendered trailing-balance text without binding the spec to either a
 * specific currency symbol, separator style, or numeral system — the
 * workspace's `org_settings.locale` defaults to `'ar'`, which renders
 * `1234` as `١٬٢٣٤ ر.س`, while a workspace switched to `'en'` would
 * render `$ 1,234`. Both must satisfy the same load-bearing claim:
 * the trailing-balance cell carries the digit run we posted.
 */
function digitsOnly(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

interface Owner {
  userId: string;
  companyId: number;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Sign up a fresh owner (which auto-seeds the IFRS chart inside the
 * workspace-creation transaction) and forge a parallel passport
 * session into the supplied page so Playwright's browser context can
 * drive `/app/accounts` as that user. Mirrors the equivalent helper
 * in `chart-of-accounts-tree.spec.ts` and `account-balances-rollup
 * .spec.ts` — kept inline so this spec stays self-contained.
 */
async function signupFreshOwner(page: Page, label: string): Promise<Owner> {
  const dbUrl = requireDbUrl(`chart-of-accounts-page ${label} spec`);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `coa-page-${label}-${stamp}@example.test`;
  const firstName = "Coa";
  const lastName = "Page";

  // Spoof a unique forwarded IP so the signup limiter (keyed by client
  // IP, 8/hour) does not throttle reruns of the suite. The proto
  // override convinces express-session that this is an HTTPS request,
  // which is what the Secure cookie path on signup requires.
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
  return { userId, companyId, email, firstName, lastName };
}

interface SeedAccount {
  id: number;
  code: string;
  type: string;
  subtype: string;
  isHeader: boolean;
  parentId: number | null;
}

/**
 * Resolve a postable current-asset leaf and its full ancestor chain
 * up to the asset root. We post into the leaf and then walk its
 * `parentId` pointers to find a header to assert the rollup against
 * — this is the same shape `account-balances-rollup.spec.ts` posts
 * against (debit current asset, credit revenue), so the JE is
 * guaranteed to be balanced and accepted by the autoposter.
 */
async function pickAssetLeafAndAncestors(
  page: Page,
  companyId: number,
): Promise<{
  leaf: SeedAccount;
  ancestors: SeedAccount[];
  revenue: SeedAccount;
}> {
  const accountsRes = await page.request.get("/api/accounts", {
    headers: { "X-Company-Id": String(companyId) },
  });
  expect(
    accountsRes.status(),
    `GET /api/accounts: ${await accountsRes.text()}`,
  ).toBe(200);
  const rows = (await accountsRes.json()) as SeedAccount[];
  const byId = new Map<number, SeedAccount>(rows.map((r) => [r.id, r]));

  const leaf = rows.find(
    (a) => a.type === "asset" && a.subtype === "current_asset" && !a.isHeader,
  );
  expect(
    leaf,
    "auto-seeded chart must include a postable current-asset leaf",
  ).toBeTruthy();
  const revenue = rows.find((a) => a.type === "revenue" && !a.isHeader);
  expect(
    revenue,
    "auto-seeded chart must include a postable revenue leaf",
  ).toBeTruthy();

  // Walk parentId pointers up to the asset root. Innermost first
  // (i.e. the leaf's immediate parent header) so the test can
  // expand each ancestor in order without guessing at depth.
  const ancestors: SeedAccount[] = [];
  let cursor: number | null | undefined = leaf!.parentId ?? null;
  while (cursor != null) {
    const parent = byId.get(cursor);
    if (!parent) break;
    ancestors.push(parent);
    cursor = parent.parentId ?? null;
  }
  expect(
    ancestors.length,
    "current-asset leaf must have at least one ancestor header in the seeded chart " +
      "(otherwise the rollup we are asserting against is trivially the leaf itself)",
  ).toBeGreaterThan(0);

  return { leaf: leaf!, ancestors, revenue: revenue! };
}

/**
 * Pin `active_company_id` so the SPA's queryClient stamps the
 * workspace's id into every `X-Company-Id` header from the very
 * first render — otherwise the COA page would briefly query
 * whichever workspace the membership lookup falls back to before
 * `CompanyProvider` rehydrates from localStorage.
 */
async function pinActiveWorkspace(page: Page, companyId: number): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((id) => {
    window.localStorage.setItem("active_company_id", String(id));
  }, companyId);
}

test.describe("chart-of-accounts page render @ui", () => {
  test("renders parent header with rolled-up balance and leaf with its own balance", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const owner = await signupFreshOwner(page, "render");

      const { leaf, ancestors, revenue } = await pickAssetLeafAndAncestors(
        page,
        owner.companyId,
      );

      // Post a single balanced JE that lands on the chosen asset leaf
      // (debit) and the revenue leaf (credit). 1234 is small enough to
      // produce a recognisable digit run in any locale — and we do
      // *not* pin the formatted string itself, because the workspace
      // org settings default to `locale: 'ar'` (so the balance renders
      // with Arabic-Indic digits + SAR symbol) and a future change to
      // that default would otherwise churn this spec. Instead we
      // normalise the rendered text down to its ASCII digit run and
      // compare that — locale-independent, formatter-independent.
      const amount = 1234;
      const expectedDigits = "1234";
      const jeRes = await page.request.post("/api/journal-entries", {
        headers: { "X-Company-Id": String(owner.companyId) },
        data: {
          description: "coa-page-render JE",
          source: "manual",
          entryDate: new Date().toISOString(),
          lines: [
            { accountId: leaf.id, debit: amount, credit: 0 },
            { accountId: revenue.id, debit: 0, credit: amount },
          ],
        },
      });
      expect(
        jeRes.status(),
        `POST /api/journal-entries: ${await jeRes.text()}`,
      ).toBe(201);

      // Render the COA page. Pin the active workspace first so the
      // very first /api/accounts and /api/accounts/balances requests
      // both scope to the workspace we just posted into — otherwise
      // the page might paint with a different workspace's chart.
      await pinActiveWorkspace(page, owner.companyId);
      await page.goto("/app/accounts", { waitUntil: "domcontentloaded" });
      await page
        .getByTestId("page-chart-of-accounts")
        .waitFor({ state: "visible", timeout: 15_000 });
      await page
        .getByTestId("card-type-asset")
        .waitFor({ state: "visible" });

      // The default expansion set covers each type root only — child
      // headers (like 1100) start collapsed, so the leaf (e.g. 1110)
      // is not yet in the DOM. Walk the ancestor chain root→leaf and
      // expand any header that is not already open. The toggle is
      // idempotent in the test sense: clicking expands, and we never
      // click on an already-expanded row because expansion bubbles
      // its child rows into the DOM as it goes.
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const header = ancestors[i];
        const headerRow = page.getByTestId(`row-account-${header.code}`);
        await expect(
          headerRow,
          `ancestor header ${header.code} must be visible after expanding ` +
            `its parent (or be a top-level type root rendered by default)`,
        ).toBeVisible();
        // The toggle button only renders when the header has children
        // (which every ancestor does — the leaf is its descendant).
        const toggle = page.getByTestId(`toggle-account-${header.code}`);
        const expanded = await toggle.getAttribute("aria-expanded");
        if (expanded !== "true") {
          await toggle.click();
        }
      }

      // ---- (a) Leaf row is now in the DOM and shows the formatted
      // amount we posted. The trailing balance is rendered as a
      // <button> with `data-testid="text-balance-<code>"` (it doubles
      // as the breakdown popover trigger), so we read its text and
      // assert the amount's digit run appears. We avoid pinning the
      // exact "$ 1,234" string so a future workspace-currency or
      // separator change doesn't churn this spec — the digit run is
      // the load-bearing part. ----
      const leafRow = page.getByTestId(`row-account-${leaf.code}`);
      await expect(
        leafRow,
        `posted leaf ${leaf.code} must be visible once its ancestors are expanded`,
      ).toBeVisible();
      const leafBalance = page.getByTestId(`text-balance-${leaf.code}`);
      await expect(
        leafBalance,
        `leaf ${leaf.code} must render its trailing-balance trigger`,
      ).toBeVisible();
      const leafText = (await leafBalance.textContent())?.trim() ?? "";
      const leafDigits = digitsOnly(leafText);
      expect(
        leafDigits,
        `leaf ${leaf.code} balance must contain the posted digit run (${expectedDigits}); got rendered=${JSON.stringify(leafText)} digits=${JSON.stringify(leafDigits)}`,
      ).toBe(expectedDigits);

      // ---- (b) Every header on the leaf's ancestor chain rolls up
      // to the same posted amount, since this brand-new workspace
      // has zero activity on every other leaf in the subtree. We
      // assert against the *root* header (the one whose `parentId`
      // is null) because that is the visible top-of-card row a user
      // sees without expanding anything — proving the rollup
      // reaches the rendered DOM at every depth. ----
      const rootHeader = ancestors[ancestors.length - 1];
      expect(
        rootHeader.parentId,
        "the root header used for the rollup assertion must be a true type root " +
          "(parentId === null), so we are pinning the *full* descendant sum, not " +
          "a partial one",
      ).toBeNull();
      const rootBalance = page.getByTestId(`text-balance-${rootHeader.code}`);
      await expect(
        rootBalance,
        `root header ${rootHeader.code} must render its rolled-up trailing balance`,
      ).toBeVisible();
      const rootText = (await rootBalance.textContent())?.trim() ?? "";
      const rootDigits = digitsOnly(rootText);
      expect(
        rootDigits,
        `root header ${rootHeader.code} rolled-up balance must contain the same ${expectedDigits} digit run as its only posted descendant; got rendered=${JSON.stringify(rootText)} digits=${JSON.stringify(rootDigits)}`,
      ).toBe(expectedDigits);
      // The root header's only posted descendant in this fresh
      // workspace is `leaf`, so the formatted root text must equal
      // the formatted leaf text exactly. This pins the rollup to
      // "sum of descendants" rather than "sum + something else"
      // (e.g. accidental double-counting of the header itself).
      expect(
        rootText,
        `root header ${rootHeader.code} text must match leaf ${leaf.code} text exactly ` +
          `because the leaf is the only posted descendant in this workspace`,
      ).toBe(leafText);
    } finally {
      await context.close();
    }
  });
});
