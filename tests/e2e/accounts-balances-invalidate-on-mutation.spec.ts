import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * Regression net for Task #225 — every frontend mutation that changes
 * journal lines must invalidate the React-Query cache for
 * `["/api/accounts/balances", period]` so the chart-of-accounts page
 * (`/app/accounts`) refetches its trailing balances on the next visit.
 *
 * Why this matters:
 *   The COA balances query is keyed by *period* (one cache entry per
 *   `month` / `year` / `all` toggle). Before this task the only thing
 *   that invalidated those entries was the user changing the period
 *   chip or hard-refreshing — so an owner who posted a JE on
 *   `/app/journal` and then flipped back to `/app/accounts` saw the
 *   *previous* balance until they hit reload. Easy to plug now,
 *   hard to track down later.
 *
 * What this spec exercises end-to-end:
 *   1. The freshly seeded workspace has a balance of 0 on the cash
 *      account (1110-style asset). The COA page renders that 0.
 *   2. The user navigates to `/app/journal` *via SPA routing* — no
 *      page reload — so the React-Query cache for the balances query
 *      is preserved across the navigation.
 *   3. The user opens the JE create dialog, fills in a balanced
 *      Dr cash / Cr revenue entry, and submits. The success handler
 *      now invalidates `/api/accounts/balances` for every period (see
 *      `invalidateAccountBalances` in `client/src/lib/queryClient.ts`).
 *   4. The user navigates back to `/app/accounts` via SPA routing.
 *      Without the invalidation the cached zero would render. With
 *      the invalidation, the page refetches and the cash row shows
 *      the JE amount.
 *
 * The seeded accounts use namespaced codes (`E2E-CASH-${companyId}`,
 * `E2E-REV-${companyId}`) so re-runs don't collide with other suites
 * sharing the dev database. Both are non-header, isActive accounts so
 * the JE form's account selector picks them up.
 */

const TEST_EMAIL = "e2e-balances-invalidate@example.test";
const TEST_PASSWORD = "playwright-balances-invalidate-pw-2026";
const TEST_FIRST = "E2E";
const TEST_LAST = "BalancesInvalidate";
const JE_AMOUNT = 250;

interface SeededWorkspace {
  companyId: number;
  cashCode: string;
  revenueCode: string;
}

async function seedWorkspaceFixtures(page: Page): Promise<SeededWorkspace> {
  const dbUrl = requireDbUrl("the balances-invalidate spec");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let companyId: number;
  let userId: string;
  let cashCode: string;
  let revenueCode: string;
  try {
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
      // Pin English so the test asserts against ASCII digits instead of
      // the Arabic locale's "٠"/"٢٥٠" — the user's preferredLocale also
      // controls money formatting on the COA balance row.
      preferredLocale: "en",
    });
    companyId = await ensureCompany(client, {
      userId,
      companyName: "E2E Balances Invalidate Co",
    });

    // Wipe any prior journal data so the "balance was zero before, JE
    // moves it to JE_AMOUNT" assertion is deterministic across re-runs.
    // Delete in dependency order so the composite FK from
    // journal_lines.journal_entry_id back into journal_entries.id
    // doesn't reject the wipe.
    await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM journal_entries WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [companyId]);

    cashCode = `E2E-CASH-${companyId}`;
    revenueCode = `E2E-REV-${companyId}`;

    const upsertAccount = async (
      code: string,
      nameAr: string,
      nameEn: string,
      type: string,
      subtype: string,
    ): Promise<void> => {
      const row = (
        await client.query(
          `SELECT id, company_id FROM accounts WHERE code = $1 LIMIT 1`,
          [code],
        )
      ).rows[0];
      if (row) {
        if (Number(row.company_id) !== companyId) {
          await client.query(
            `UPDATE accounts SET company_id = $1 WHERE id = $2`,
            [companyId, row.id],
          );
        }
        await client.query(
          `UPDATE accounts SET name_ar = $1, name_en = $2, type = $3, subtype = $4,
                               is_header = false, is_active = true WHERE id = $5`,
          [nameAr, nameEn, type, subtype, row.id],
        );
        return;
      }
      await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, false, true)`,
        [companyId, code, nameAr, nameEn, type, subtype],
      );
    };

    await upsertAccount(cashCode, "نقدية اختبار", "E2E Cash", "asset", "current_asset");
    await upsertAccount(revenueCode, "إيرادات اختبار", "E2E Revenue", "revenue", "operating_revenue");

    // Pin org-level locale to English so `formatMoney` (which reads
    // `settings.locale` from `/api/settings`, *not* the per-user
    // preferredLocale) renders ASCII digits. Without this the cash
    // balance would render as Arabic-Indic "٠ $" / "٢٥٠ $" and the
    // assertions below would never see the expected substring.
    // No DB-level unique on settings.company_id, so do a check-then-write
    // upsert by hand. The seed connection runs as the postgres superuser,
    // so the RLS policy on `settings` is bypassed automatically.
    const existingSettings = await client.query(
      `SELECT id FROM settings WHERE company_id = $1 LIMIT 1`,
      [companyId],
    );
    if (existingSettings.rows[0]) {
      await client.query(`UPDATE settings SET locale = 'en' WHERE id = $1`, [
        existingSettings.rows[0].id,
      ]);
    } else {
      await client.query(
        `INSERT INTO settings (company_id, locale) VALUES ($1, 'en')`,
        [companyId],
      );
    }
  } finally {
    await client.end();
  }

  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
    baseURL,
    afterCookiesPlanted: async (p) => {
      // Pin the workspace before any authed page render so the very
      // first /api/accounts/balances request scopes to this companyId
      // (otherwise CompanyProvider would briefly query whichever
      // workspace the membership lookup falls back to first).
      await p.goto(baseURL, { waitUntil: "domcontentloaded" });
      await p.evaluate((id) => {
        window.localStorage.setItem("active_company_id", String(id));
        // Pin the locale override so the LocaleSync effect doesn't fall
        // through to the default Arabic — both "0" and the JE amount
        // assertions below depend on ASCII digits.
        window.localStorage.setItem("app.locale", "en");
      }, companyId);
    },
  });

  return { companyId, cashCode, revenueCode };
}

test.describe("/api/accounts/balances cache invalidation @api @ui", () => {
  // The repo-wide playwright.config defaults to a 360px mobile viewport, which
  // hides the desktop sidebar (`sidebar-link-nav_*` testids). This spec depends
  // on those sidebar links to drive *SPA* navigation between /app/accounts and
  // /app/journal — anything that triggers a full reload would defeat the cache-
  // invalidation assertion. Override to a desktop viewport instead of fighting
  // the mobile drawer toggle.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("posting a JE on /app/journal refreshes /app/accounts balances without a hard refresh", async ({
    page,
  }) => {
    const { cashCode, revenueCode } = await seedWorkspaceFixtures(page);

    // ---- (1) Land on /app/accounts and wait for the balances query
    // to settle. The cash row should render its initial 0 — with the
    // workspace's journal lines wiped above, this is the "before"
    // state of the cache we are about to invalidate. ----
    await page.goto("/app/accounts", { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });

    const cashBalanceLocator = page.getByTestId(`text-balance-${cashCode}`);
    await cashBalanceLocator.waitFor({ state: "visible", timeout: 15_000 });
    await expect(
      cashBalanceLocator,
      "before posting any JE the cash row must render a zero balance — " +
        "the seeded workspace has no journal lines",
    ).toContainText("0");

    // ---- (2) SPA-navigate to /app/journal by clicking the sidebar
    // link. Using `page.goto` would full-reload and reset the React-
    // Query cache, which is the very thing we want to assert is
    // refreshed by the mutation — not by the navigation. ----
    await page.getByTestId("sidebar-link-nav_journal").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/journal");
    await page
      .getByTestId("page-journal-entries")
      .waitFor({ state: "visible", timeout: 15_000 });

    // ---- (3) Open the create dialog and submit a balanced
    // Dr cash / Cr revenue entry. The createMutation's success
    // handler is the code path under test: it now calls
    // `invalidateAccountBalances()` after every JE create. ----
    await page.getByTestId("button-new-entry").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const description = `bal-invalidate je ${Date.now()}`;
    await page.getByTestId("input-entry-description").fill(description);

    await page.getByTestId("select-line-account-0").click();
    await page
      .getByRole("option")
      .filter({ hasText: cashCode })
      .click();
    await page.getByTestId("input-line-debit-0").fill(String(JE_AMOUNT));

    await page.getByTestId("select-line-account-1").click();
    await page
      .getByRole("option")
      .filter({ hasText: revenueCode })
      .click();
    await page.getByTestId("input-line-credit-1").fill(String(JE_AMOUNT));

    await page.getByTestId("button-save-entry").click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(
      page.locator("[data-testid^='card-entry-']").filter({ hasText: description }),
      "the just-submitted JE must land in the journal-entries list — " +
        "if this fails the mutation itself didn't succeed and the cache " +
        "assertion below would be misleading",
    ).toBeVisible();

    // ---- (4) SPA-navigate back to /app/accounts. The page mounts,
    // notices the balances query is invalid, and refetches — only
    // because the mutation's onSuccess handler invalidated every
    // `["/api/accounts/balances", period]` cache entry. Without that
    // invalidation the cached `0` would render here and the
    // assertion would fail. ----
    await page.getByTestId("sidebar-link-nav_accounts").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/accounts");
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });

    // The balance text is locale-formatted (e.g. "250.00", "$250.00",
    // "٢٥٠٫٠٠"). Match on the digit run rather than a hard-coded
    // formatting so a future locale tweak doesn't churn this spec.
    await expect
      .poll(
        async () =>
          (await page
            .getByTestId(`text-balance-${cashCode}`)
            .textContent({ timeout: 5_000 })) ?? "",
        { timeout: 15_000 },
      )
      .toMatch(/2\D?5\D?0/);
  });
});
