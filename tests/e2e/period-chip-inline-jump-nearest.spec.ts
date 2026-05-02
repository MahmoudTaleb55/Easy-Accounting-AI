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
 * Task #366 — pin the inline `PeriodChip`'s empty-period jump-to-nearest hint
 * with its own end-to-end check.
 *
 * Sibling spec to `period-chip-jump-nearest.spec.ts`, which only drives the
 * topbar's period popover. The same hint logic also renders inside the inline
 * `PeriodChip` (used in /app/journal, /app/reports, /app/insights,
 * /app/transactions, the COA ledger drawer, etc.), so a chip-only regression
 * — for example dropping the Tooltip wrapper or swapping the Locate icon —
 * would not be caught by the topbar spec. This spec opens /app/journal, which
 * hosts a `PeriodChip`, and exercises:
 *
 *   1. The chip renders the empty-period jump arrow when the active period
 *      contains no postings but historic postings exist elsewhere.
 *   2. Clicking `button-period-chip-jump-nearest` snaps the period to a
 *      window covering the historic posting, the chip range label changes,
 *      and the hint button vanishes (because the new active range is no
 *      longer empty).
 */

const TEST_EMAIL = "e2e-period-chip-inline-jump@example.test";
const TEST_PASSWORD = "playwright-period-chip-inline-jump-pw-2026";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface Seed {
  companyId: number;
  cashAccountId: number;
  cashCode: string;
}

async function seedWorkspaceWithHistoricEntry(page: Page): Promise<Seed> {
  const dbUrl = requireDbUrl("period-chip-inline-jump-nearest spec");
  requireCookieSecret("period-chip-inline-jump-nearest spec");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let companyId: number;
  let cashAccountId: number;
  const cashCode = "CHIPJUMP-INLINE-CASH";
  try {
    const userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "Inline",
      lastName: "Chip",
    });
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E Inline Chip Jump Co",
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
           VALUES ($1, $2, 'نقدية اختبار شيب', 'Inline Chip Jump Test Cash', 'asset', 'current_asset', false, true)
           RETURNING id`,
          [companyId, cashCode],
        )
      ).rows[0].id,
    );

    // Historic posting >1 calendar year ago so no preset window
    // (today/week/month/quarter/ytd/30d) covers it — the jump must
    // therefore widen the period for the hint to clear.
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
            `JE-CHIP-INLINE-${Date.now()}`,
            HISTORIC_DATE.toISOString(),
            "Historic posting for inline period-chip jump-to-nearest spec",
          ],
        )
      ).rows[0].id,
    );
    await client.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, account_id, debit, credit, description)
       VALUES
         ($1, $2, $3, '300.00', '0',     'Cash receipt'),
         ($1, $2, $3, '0',      '300.00','Offset')`,
      [companyId, jeId, cashAccountId],
    );

    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL,
      firstName: "Inline",
      lastName: "Chip",
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

test.describe("inline period chip — jump-to-nearest hint @ui", () => {
  // The chip's date range is `hidden sm:inline`, so a default 360px
  // viewport would hide the very label we're asserting on. Use a desktop
  // viewport to keep the hint and the range label both visible.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("inline chip surfaces the jump arrow and snaps the period to cover the historic posting", async ({
    page,
  }) => {
    await seedWorkspaceWithHistoricEntry(page);

    await gotoWithPinnedLocale(page, "/app/journal", { locale: "en" });
    await page
      .getByTestId("page-journal-entries")
      .waitFor({ state: "visible", timeout: 15_000 });

    const chip = page.getByTestId("period-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    const rangeLabel = chip.getByTestId("text-period-chip-range");
    const jumpButton = chip.getByTestId("button-period-chip-jump-nearest");

    await expect(jumpButton).toBeVisible({ timeout: 10_000 });

    const labelBefore = (await rangeLabel.textContent())?.trim() ?? "";
    expect(labelBefore.length).toBeGreaterThan(0);

    await jumpButton.click();

    // After the jump the active window contains the historic posting,
    // so the workspace is no longer empty under it and the chip-level
    // hint must disappear.
    await expect(jumpButton).toBeHidden({ timeout: 10_000 });

    // The chip's range label is the visible proof that the period
    // actually moved — assert it changed and now references the
    // historic year so a regression that no-ops the click is caught.
    const expectedYear = String(new Date().getUTCFullYear() - 1);
    await expect(rangeLabel).toContainText(expectedYear, { timeout: 10_000 });

    const labelAfter = (await rangeLabel.textContent())?.trim() ?? "";
    expect(
      labelAfter,
      "the inline period chip's range label must change after the jump",
    ).not.toBe(labelBefore);
  });
});
