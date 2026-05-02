import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";
import { gotoWithPinnedLocale } from "./_helpers/pin-locale";

/**
 * Task #320 — workspace-wide jump-to-nearest period hint.
 *
 * Covers:
 *   1. Hint surfaces when the active period is empty but historic
 *      postings exist; clicking jumps the period to include them.
 *   2. The hint is workspace-scoped — switching companies in the
 *      topbar selector does not leak the previous workspace's data.
 */

const TEST_EMAIL = "e2e-period-chip-jump@example.test";
const TEST_PASSWORD = "playwright-period-chip-jump-pw-2026";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface SingleSeed {
  companyId: number;
  cashAccountId: number;
  cashCode: string;
}

interface TwoCompanySeed {
  emptyCompanyId: number;
  filledCompanyId: number;
  emptyCompanyName: string;
  filledCompanyName: string;
}

async function seedWorkspaceWithHistoricEntry(page: Page): Promise<SingleSeed> {
  const dbUrl = requireDbUrl("period-chip-jump-nearest spec");
  requireCookieSecret("period-chip-jump-nearest spec");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let companyId: number;
  let cashAccountId: number;
  const cashCode = "CHIPJUMP-CASH";
  try {
    const userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "Chip",
      lastName: "Jump",
    });
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E Chip Jump Co",
    });

    await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM journal_entries WHERE company_id = $1`, [companyId]);
    await client.query(
      `DELETE FROM accounts WHERE company_id = $1 AND code = $2`,
      [companyId, cashCode],
    );

    cashAccountId = Number(
      (
        await client.query(
          `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
           VALUES ($1, $2, 'نقدية اختبار شيب', 'Chip Jump Test Cash', 'asset', 'current_asset', false, true)
           RETURNING id`,
          [companyId, cashCode],
        )
      ).rows[0].id,
    );

    // Balanced debit/credit on the same account so we don't need a 2nd row.
    const HISTORIC_DATE = new Date(
      Date.UTC(new Date().getUTCFullYear() - 1, 5, 15, 12, 0, 0),
    );
    const jeId = Number(
      (
        await client.query(
          `INSERT INTO journal_entries
             (company_id, reference, entry_date, description, source)
           VALUES ($1, $2, $3, $4, 'manual')
           RETURNING id`,
          [
            companyId,
            `JE-CHIP-${Date.now()}`,
            HISTORIC_DATE.toISOString(),
            "Historic posting for period-chip jump-to-nearest spec",
          ],
        )
      ).rows[0].id,
    );
    await client.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, account_id, debit, credit, description)
       VALUES
         ($1, $2, $3, '200.00', '0',     'Cash receipt'),
         ($1, $2, $3, '0',      '200.00','Offset')`,
      [companyId, jeId, cashAccountId],
    );

    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL,
      firstName: "Chip",
      lastName: "Jump",
      baseURL: BASE_URL,
      afterCookiesPlanted: async (p) => {
        await p.goto(BASE_URL, { waitUntil: "domcontentloaded" });
        await p.evaluate((id) => {
          window.localStorage.setItem("active_company_id", String(id));
        }, companyId);
      },
    });
  } finally {
    await client.end();
  }

  return { companyId, cashAccountId, cashCode };
}

/**
 * Two workspaces under one user:
 *   - "Empty Co" — zero postings.
 *   - "Filled Co" — one historic posting >1y ago.
 * Active workspace is set to Empty Co at session forge time.
 */
async function seedTwoCompaniesForSwitcher(page: Page): Promise<TwoCompanySeed> {
  const dbUrl = requireDbUrl("period-chip-jump-nearest workspace-switch spec");
  requireCookieSecret("period-chip-jump-nearest workspace-switch spec");

  const TEST_EMAIL_2 = "e2e-period-chip-switch@example.test";
  const TEST_PASSWORD_2 = "playwright-period-chip-switch-pw-2026";
  const emptyCompanyName = `E2E Empty Co ${Date.now()}`;
  const filledCompanyName = `E2E Filled Co ${Date.now()}`;
  const cashCode = "CHIPJUMP-SWITCH-CASH";

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let emptyCompanyId: number;
  let filledCompanyId: number;
  try {
    const userId = await ensureUser(client, {
      email: TEST_EMAIL_2,
      password: TEST_PASSWORD_2,
      firstName: "Switch",
      lastName: "Test",
    });

    // Wipe any prior memberships/companies tied to this synthetic user
    // so the spec is deterministic across runs.
    const prior = await client.query(
      `SELECT company_id FROM memberships WHERE user_id = $1`,
      [userId],
    );
    for (const row of prior.rows) {
      await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [row.company_id]);
      await client.query(`DELETE FROM journal_entries WHERE company_id = $1`, [row.company_id]);
      await client.query(`DELETE FROM accounts WHERE company_id = $1`, [row.company_id]);
      await client.query(`DELETE FROM memberships WHERE company_id = $1`, [row.company_id]);
      await client.query(`DELETE FROM companies WHERE id = $1`, [row.company_id]);
    }

    emptyCompanyId = Number(
      (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
           VALUES ($1, $2, 'USD', '$', true) RETURNING id`,
          [emptyCompanyName, userId],
        )
      ).rows[0].id,
    );
    filledCompanyId = Number(
      (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
           VALUES ($1, $2, 'USD', '$', false) RETURNING id`,
          [filledCompanyName, userId],
        )
      ).rows[0].id,
    );
    await client.query(
      `INSERT INTO memberships (id, user_id, company_id, role)
       VALUES ($1, $2, $3, 'owner'), ($4, $2, $5, 'owner')`,
      [crypto.randomUUID(), userId, emptyCompanyId, crypto.randomUUID(), filledCompanyId],
    );

    const cashId = Number(
      (
        await client.query(
          `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
           VALUES ($1, $2, 'نقدية', 'Cash', 'asset', 'current_asset', false, true)
           RETURNING id`,
          [filledCompanyId, cashCode],
        )
      ).rows[0].id,
    );
    const HISTORIC_DATE = new Date(
      Date.UTC(new Date().getUTCFullYear() - 1, 5, 15, 12, 0, 0),
    );
    const jeId = Number(
      (
        await client.query(
          `INSERT INTO journal_entries
             (company_id, reference, entry_date, description, source)
           VALUES ($1, $2, $3, $4, 'manual') RETURNING id`,
          [
            filledCompanyId,
            `JE-CHIP-SWITCH-${Date.now()}`,
            HISTORIC_DATE.toISOString(),
            "Historic posting in Filled Co",
          ],
        )
      ).rows[0].id,
    );
    await client.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, account_id, debit, credit, description)
       VALUES
         ($1, $2, $3, '500.00', '0',     'Cash receipt'),
         ($1, $2, $3, '0',      '500.00','Offset')`,
      [filledCompanyId, jeId, cashId],
    );

    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL_2,
      firstName: "Switch",
      lastName: "Test",
      baseURL: BASE_URL,
      afterCookiesPlanted: async (p) => {
        await p.goto(BASE_URL, { waitUntil: "domcontentloaded" });
        await p.evaluate((id) => {
          window.localStorage.setItem("active_company_id", String(id));
        }, emptyCompanyId);
      },
    });
  } finally {
    await client.end();
  }

  return { emptyCompanyId, filledCompanyId, emptyCompanyName, filledCompanyName };
}

test.describe("period chip — workspace-wide jump-to-nearest hint @ui", () => {
  // Topbar period selector is `hidden md:flex`; default 360px viewport hides it.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("surfaces a chip-level hint and snaps the period to a window with the historic posting", async ({
    page,
  }) => {
    await seedWorkspaceWithHistoricEntry(page);

    await gotoWithPinnedLocale(page, "/app", { locale: "en" });
    await page
      .getByTestId("app-topbar")
      .waitFor({ state: "visible", timeout: 15_000 });

    const periodButton = page.getByTestId("button-period-selector");
    const indicator = page.getByTestId("indicator-period-empty");
    await expect(indicator).toBeVisible({ timeout: 10_000 });

    await periodButton.click();
    const jumpButton = page.getByTestId("button-period-popover-jump-nearest");
    await expect(jumpButton).toBeVisible();

    const expectedYear = String(new Date().getUTCFullYear() - 1);
    await expect(jumpButton).toContainText(expectedYear);

    const labelBefore = (await periodButton.textContent())?.trim() ?? "";

    await jumpButton.click();

    // After the jump, the active window contains the historic posting,
    // so the workspace is no longer empty under it and the hint vanishes.
    await expect(indicator).toBeHidden({ timeout: 10_000 });

    const labelAfter = (await periodButton.textContent())?.trim() ?? "";
    expect(
      labelAfter,
      "the period selector label must change after the jump",
    ).not.toBe(labelBefore);
    expect(labelAfter).toContain(expectedYear);
  });

  test("hint is workspace-scoped — switching companies does not leak the previous workspace's emptiness state", async ({
    page,
  }) => {
    const seed = await seedTwoCompaniesForSwitcher(page);

    await gotoWithPinnedLocale(page, "/app", { locale: "en" });
    await page.getByTestId("app-topbar").waitFor({ state: "visible", timeout: 15_000 });

    const indicator = page.getByTestId("indicator-period-empty");
    const switcher = page.getByTestId("select-active-company");

    // Active = Empty Co. Workspace has zero postings entirely → hint must NOT show.
    await expect(switcher).toContainText(seed.emptyCompanyName, { timeout: 10_000 });
    await expect(indicator).toBeHidden({ timeout: 10_000 });

    // Switch to Filled Co. The journal-entries cache is keyed by
    // active company id, so switching evicts Empty Co's data and the
    // hint reflects Filled Co's historic posting.
    await switcher.click();
    await page.getByRole("option", { name: new RegExp(seed.filledCompanyName) }).click();
    await expect(switcher).toContainText(seed.filledCompanyName);
    await expect(indicator).toBeVisible({ timeout: 10_000 });

    // Switch back. If the cache leaked, we would still see the dot
    // (Filled Co's data driving the hint over Empty Co's UI).
    await switcher.click();
    await page.getByRole("option", { name: new RegExp(seed.emptyCompanyName) }).click();
    await expect(switcher).toContainText(seed.emptyCompanyName);
    await expect(indicator).toBeHidden({ timeout: 10_000 });
  });
});
