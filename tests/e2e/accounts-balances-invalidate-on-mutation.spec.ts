import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";

// Asserts that JE create / edit on /app/journal invalidates the React-Query
// cache for /api/accounts/balances so the COA refetches trailing balances on
// SPA navigation back to /app/accounts (no hard refresh).

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
  // hides the desktop sidebar links the SPA-navigation steps below depend on.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("posting a JE on /app/journal refreshes /app/accounts balances without a hard refresh", async ({
    page,
  }) => {
    const { cashCode, revenueCode } = await seedWorkspaceFixtures(page);

    await page.goto("/app/accounts", { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });

    const cashBalanceLocator = page.getByTestId(`text-balance-${cashCode}`);
    await cashBalanceLocator.waitFor({ state: "visible", timeout: 15_000 });
    await expect(cashBalanceLocator).toContainText("0");

    // SPA-navigate (not page.goto) so the React-Query cache is preserved.
    await page.getByTestId("sidebar-link-nav_journal").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/journal");
    await page
      .getByTestId("page-journal-entries")
      .waitFor({ state: "visible", timeout: 15_000 });

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
    ).toBeVisible();

    await page.getByTestId("sidebar-link-nav_accounts").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/accounts");
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });

    // Locale-formatted balance ("250.00", "$250.00", "٢٥٠٫٠٠"); match digits.
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

  test("editing a JE on /app/journal refreshes /app/accounts balances without a hard refresh", async ({
    page,
  }) => {
    const { cashCode, revenueCode } = await seedWorkspaceFixtures(page);

    await page.goto("/app/accounts", { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });
    const cashBalanceLocator = page.getByTestId(`text-balance-${cashCode}`);
    await cashBalanceLocator.waitFor({ state: "visible", timeout: 15_000 });
    await expect(cashBalanceLocator).toContainText("0");

    // Seed a JE so the edit step has something to mutate.
    await page.getByTestId("sidebar-link-nav_journal").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/journal");
    await page
      .getByTestId("page-journal-entries")
      .waitFor({ state: "visible", timeout: 15_000 });

    await page.getByTestId("button-new-entry").click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible({ timeout: 10_000 });

    const description = `bal-invalidate edit-roundtrip ${Date.now()}`;
    await page.getByTestId("input-entry-description").fill(description);

    await page.getByTestId("select-line-account-0").click();
    await page.getByRole("option").filter({ hasText: cashCode }).click();
    await page.getByTestId("input-line-debit-0").fill(String(JE_AMOUNT));

    await page.getByTestId("select-line-account-1").click();
    await page.getByRole("option").filter({ hasText: revenueCode }).click();
    await page.getByTestId("input-line-credit-1").fill(String(JE_AMOUNT));

    await page.getByTestId("button-save-entry").click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });
    const entryCard = page
      .locator("[data-testid^='card-entry-']")
      .filter({ hasText: description });
    await expect(entryCard).toBeVisible();

    // Confirm the create path landed the seed amount on the COA so the
    // post-edit assertion is unambiguous: 250 → 500 only happens because
    // the *edit* invalidation fired, not the create one.
    await page.getByTestId("sidebar-link-nav_accounts").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/accounts");
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (await page
            .getByTestId(`text-balance-${cashCode}`)
            .textContent({ timeout: 5_000 })) ?? "",
        { timeout: 15_000 },
      )
      .toMatch(/2\D?5\D?0/);

    await page.getByTestId("sidebar-link-nav_journal").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/journal");
    await page
      .getByTestId("page-journal-entries")
      .waitFor({ state: "visible", timeout: 15_000 });

    const refreshedCard = page
      .locator("[data-testid^='card-entry-']")
      .filter({ hasText: description });
    await refreshedCard.locator("[data-testid^='button-edit-entry-']").click();
    const editDialog = page.getByTestId("dialog-edit-entry");
    await expect(editDialog).toBeVisible({ timeout: 10_000 });

    const NEW_AMOUNT = JE_AMOUNT * 2;
    const debitInput = page.getByTestId("input-edit-line-debit-0");
    await debitInput.fill("");
    await debitInput.fill(String(NEW_AMOUNT));
    const creditInput = page.getByTestId("input-edit-line-credit-1");
    await creditInput.fill("");
    await creditInput.fill(String(NEW_AMOUNT));

    await page.getByTestId("button-save-edit-entry").click();
    await expect(editDialog).toBeHidden({ timeout: 10_000 });

    await page.getByTestId("sidebar-link-nav_accounts").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/accounts");
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });

    await expect
      .poll(
        async () =>
          (await page
            .getByTestId(`text-balance-${cashCode}`)
            .textContent({ timeout: 5_000 })) ?? "",
        { timeout: 15_000 },
      )
      .toMatch(/5\D?0\D?0/);
  });

  // Server-side guard: a JE referenced by an upstream source row (payroll
  // here) must not be editable through PATCH even if the UI gate is bypassed.
  test("PATCH /api/journal-entries/:id refuses to edit a JE referenced by a payroll run", async ({
    page,
  }) => {
    const { companyId, cashCode, revenueCode } = await seedWorkspaceFixtures(page);

    const dbUrl = requireDbUrl("the source-link refusal spec");
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    let jeId: number;
    let cashAccountId: number;
    let revenueAccountId: number;
    try {
      cashAccountId = Number(
        (
          await client.query(`SELECT id FROM accounts WHERE code = $1 LIMIT 1`, [cashCode])
        ).rows[0].id,
      );
      revenueAccountId = Number(
        (
          await client.query(`SELECT id FROM accounts WHERE code = $1 LIMIT 1`, [revenueCode])
        ).rows[0].id,
      );
      const today = new Date().toISOString();
      const ref = `JE-LOCKED-${Date.now()}`;
      jeId = Number(
        (
          await client.query(
            `INSERT INTO journal_entries (company_id, reference, entry_date, description, source)
             VALUES ($1, $2, $3::timestamp, 'locked by payroll', 'manual')
             RETURNING id`,
            [companyId, ref, today],
          )
        ).rows[0].id,
      );
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, '100.00', '0', 'cash leg'),
                ($1, $2, $4, '0', '100.00', 'revenue leg')`,
        [companyId, jeId, cashAccountId, revenueAccountId],
      );
      // Link a payroll run at the JE so detectJournalEntryReferences()
      // surfaces a conflict on the next PATCH attempt.
      await client.query(
        `INSERT INTO payroll_runs (company_id, year, month, status, total_gross, total_net, journal_entry_id)
         VALUES ($1, 2026, 4, 'posted', '100.00', '100.00', $2)`,
        [companyId, jeId],
      );
    } finally {
      await client.end();
    }

    // The seedWorkspaceFixtures helper already planted the auth cookie
    // on the page, so page.request reuses the same session.
    const res = await page.request.patch(`/api/journal-entries/${jeId}`, {
      data: {
        entryDate: new Date().toISOString().slice(0, 10),
        description: "attempted edit through public route",
        lines: [
          { accountId: cashAccountId, debit: 999, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 999 },
        ],
      },
    });
    expect(res.status(), "source-linked JE must not be editable via PATCH").toBe(400);

    // And the lines on disk must still carry the original 100/100 amounts.
    const verify = new pg.Client({ connectionString: dbUrl });
    await verify.connect();
    try {
      const lines = (
        await verify.query(
          `SELECT account_id, debit::text AS debit, credit::text AS credit
           FROM journal_lines WHERE journal_entry_id = $1 ORDER BY id`,
          [jeId],
        )
      ).rows;
      expect(lines).toHaveLength(2);
      expect(lines.map((l) => Number(l.debit) + Number(l.credit))).toEqual([100, 100]);
    } finally {
      await verify.end();
    }
  });
});
