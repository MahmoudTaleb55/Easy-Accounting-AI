import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";

// Task #282 — cross-tab balance refresh.
//
// The single-tab regression net lives in
// `accounts-balances-invalidate-on-mutation.spec.ts`. This spec covers the
// sibling-tab path: when the journal-entries page mutation onSuccess fires
// `invalidateAccountBalances()`, the BroadcastChannel ping inside that
// helper must reach a *different tab* and refetch its balances cache.
//
// We deliberately drive the JE through the real UI in tab A (not the raw
// POST + manual postMessage) so that if the broadcast were ever dropped
// from `invalidateAccountBalances()`, this test would fail.

const TEST_EMAIL = "e2e-balances-cross-tab@example.test";
const TEST_PASSWORD = "playwright-balances-cross-tab-pw-2026";
const TEST_FIRST = "E2E";
const TEST_LAST = "BalancesCrossTab";
const JE_AMOUNT = 314;

interface SeededWorkspace {
  companyId: number;
  cashCode: string;
  revenueCode: string;
}

async function seedWorkspaceFixtures(): Promise<{
  seeded: SeededWorkspace;
  userId: string;
}> {
  const dbUrl = requireDbUrl("the cross-tab balances spec");

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
      preferredLocale: "en",
    });
    companyId = await ensureCompany(client, {
      userId,
      companyName: "E2E Balances Cross-Tab Co",
    });

    // Wipe in dependency order so the composite FK on
    // journal_lines.journal_entry_id doesn't reject the reset.
    await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM journal_entries WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [companyId]);

    cashCode = `E2E-CASH-XTAB-${companyId}`;
    revenueCode = `E2E-REV-XTAB-${companyId}`;

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

    await upsertAccount(cashCode, "نقدية اختبار xtab", "E2E Cash xtab", "asset", "current_asset");
    await upsertAccount(
      revenueCode,
      "إيرادات اختبار xtab",
      "E2E Revenue xtab",
      "revenue",
      "operating_revenue",
    );

    // Pin org-level locale to English so `formatMoney` renders ASCII
    // digits — the assertion below matches on `/3\D?1\D?4/`.
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

  return { seeded: { companyId, cashCode, revenueCode }, userId };
}

async function pinWorkspaceLocale(page: Page, companyId: number): Promise<void> {
  await page.evaluate((id) => {
    window.localStorage.setItem("active_company_id", String(id));
    window.localStorage.setItem("app.locale", "en");
  }, companyId);
}

test.describe("/api/accounts/balances cross-tab refresh @api @ui", () => {
  // The repo-wide playwright.config defaults to a 360px viewport, which
  // hides the desktop sidebar links and crowds the COA balance row out of
  // view.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("posting a JE in tab A refreshes /app/accounts balances in tab B without a hard refresh", async ({
    browser,
  }) => {
    const { seeded, userId } = await seedWorkspaceFixtures();

    // Two tabs in the *same* browser context. Chromium partitions
    // BroadcastChannel by storage key, so two separate Playwright
    // contexts wouldn't share the channel; two tabs of one context do,
    // which mirrors the real "user opens /app/accounts in two tabs"
    // scenario.
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const tabA = await context.newPage();
      const tabB = await context.newPage();

      const dbUrl = requireDbUrl("authentication in cross-tab spec");
      const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
      await forgeSession({
        page: tabA,
        dbUrl,
        userId,
        email: TEST_EMAIL,
        firstName: TEST_FIRST,
        lastName: TEST_LAST,
        baseURL,
        afterCookiesPlanted: async (p) => {
          await p.goto(baseURL, { waitUntil: "domcontentloaded" });
          await pinWorkspaceLocale(p, seeded.companyId);
        },
      });
      // Tab B inherits the connect.sid cookie (same context), but needs
      // its own localStorage seeded so the first balances fetch scopes
      // to this workspace and renders English digits.
      await tabB.goto("/", { waitUntil: "domcontentloaded" });
      await pinWorkspaceLocale(tabB, seeded.companyId);

      // Tab B parks on /app/accounts and confirms a 0 starting balance.
      // Tab A goes to /app/journal so the create-entry mutation runs
      // through the real UI path.
      await Promise.all([
        tabA.goto("/app/journal", { waitUntil: "domcontentloaded" }),
        tabB.goto("/app/accounts", { waitUntil: "domcontentloaded" }),
      ]);

      const cashTestId = `text-balance-${seeded.cashCode}`;
      await tabB
        .getByTestId("page-chart-of-accounts")
        .waitFor({ state: "visible", timeout: 15_000 });
      await tabB
        .getByTestId(cashTestId)
        .waitFor({ state: "visible", timeout: 15_000 });
      await expect(tabB.getByTestId(cashTestId)).toContainText("0");

      // Drive the JE through the actual journal-entries form in tab A so
      // the mutation onSuccess (which calls
      // `invalidateAccountBalances()` and broadcasts on the channel) is
      // what triggers the refresh in tab B.
      await tabA
        .getByTestId("page-journal-entries")
        .waitFor({ state: "visible", timeout: 15_000 });
      await tabA.getByTestId("button-new-entry").click();
      const dialog = tabA.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const description = `xtab-balance-refresh ${Date.now()}`;
      await tabA.getByTestId("input-entry-description").fill(description);
      await tabA.getByTestId("select-line-account-0").click();
      await tabA.getByRole("option").filter({ hasText: seeded.cashCode }).click();
      await tabA.getByTestId("input-line-debit-0").fill(String(JE_AMOUNT));
      await tabA.getByTestId("select-line-account-1").click();
      await tabA.getByRole("option").filter({ hasText: seeded.revenueCode }).click();
      await tabA.getByTestId("input-line-credit-1").fill(String(JE_AMOUNT));
      await tabA.getByTestId("button-save-entry").click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      // Tab B never navigates, never clicks — its listener on
      // `BroadcastChannel('accounts-balances')` must catch the ping
      // emitted by tab A's `invalidateAccountBalances()` and refetch
      // the COA balance to 314 within a couple of seconds.
      await expect
        .poll(
          async () =>
            (await tabB
              .getByTestId(cashTestId)
              .textContent({ timeout: 5_000 })) ?? "",
          { timeout: 10_000, intervals: [250, 500, 1_000] },
        )
        .toMatch(/3\D?1\D?4/);
    } finally {
      await context?.close();
    }
  });
});
