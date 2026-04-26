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
 * Regression coverage for Task #256 — when the account-ledger drawer's
 * active period contains no postings but the account *does* have history
 * outside the window, the empty state surfaces a "Jump to nearest
 * posting (<date>)" affordance that snaps the global period to a window
 * which actually includes that posting.
 *
 * The interesting risk is the wiring across three units:
 *
 *   1. `AccountLedgerSheet` (client/src/pages/chart-of-accounts.tsx)
 *      computes the nearest posting (past or future) and renders the
 *      jump button in the period-empty state.
 *   2. `pickPeriodKeyForDate` + `setPeriodToInclude` in
 *      client/src/contexts/period-context.tsx pick the smallest preset
 *      window that contains the target date — or fall back to a custom
 *      calendar-month range when no preset can.
 *   3. The PeriodChip in the drawer header re-renders against the new
 *      key, and the postings list switches from the empty state to
 *      showing the jumped-to row.
 *
 * The unit test (`client/src/contexts/__tests__/period-context.test.ts`)
 * pins (2) in isolation. This spec end-to-ends (1)+(2)+(3) together so
 * any future refactor that breaks the wiring fails loudly.
 *
 * Auth — uses the same `ensureUser` + `ensureCompany` + `forgeSession`
 * helpers as `period-selector.setup.ts` rather than driving the public
 * signup endpoint. We still need to manually seed a single asset
 * account into the workspace because `ensureCompany` does not run the
 * COA auto-seed transaction (only `createCompanyForOwner` does, and
 * that path is reserved for the public signup flow).
 */

const TEST_EMAIL = "e2e-ledger-jump@example.test";
const TEST_PASSWORD = "playwright-ledger-jump-pw-2026";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface Seed {
  companyId: number;
  cashAccountId: number;
  cashCode: string;
}

/**
 * Stand up a deterministic workspace for the spec — idempotent across
 * runs so we can re-execute without leaking state. Returns the ids the
 * test needs to drive the UI and post the historic JE.
 */
async function seedWorkspaceAndAccount(page: Page): Promise<Seed> {
  const dbUrl = requireDbUrl("account-ledger-jump-nearest spec");
  requireCookieSecret("account-ledger-jump-nearest spec");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let companyId: number;
  let cashAccountId: number;
  const cashCode = "JUMP-CASH"; // distinctive code so the COA tree row is easy to grep
  try {
    const userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "Jump",
      lastName: "Nearest",
    });
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E Ledger Jump Co",
    });

    // Reset between runs: drop any prior JE + lines + the seed account
    // so this spec lands on the same blank slate every time.
    await client.query(
      `DELETE FROM journal_lines WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM journal_entries WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM accounts WHERE company_id = $1 AND code = $2`,
      [companyId, cashCode],
    );

    // Seed the one account this spec needs — a debit-normal asset row
    // that we'll post to and surface in the COA tree. We don't need
    // the full IFRS chart, so we don't run the auto-seed transaction.
    cashAccountId = Number(
      (
        await client.query(
          `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
           VALUES ($1, $2, 'نقدية اختبار', 'Jump Test Cash', 'asset', 'current_asset', false, true)
           RETURNING id`,
          [companyId, cashCode],
        )
      ).rows[0].id,
    );

    // Post a historic JE (>1 year in the past) to that account. Self-
    // balancing single-line is invalid; pair against a credit posted
    // *to the same account* so we don't need a second account row —
    // the AccountLedgerSheet filters by accountId and will show only
    // the debit line as a posting in the table. Two rows on the same
    // entry sum to a balanced 150 / 150.
    const HISTORIC_DATE = new Date(
      Date.UTC(new Date().getUTCFullYear() - 1, 5 /* June */, 15, 12, 0, 0),
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
            `JE-JUMP-${Date.now()}`,
            HISTORIC_DATE.toISOString(),
            "Historic posting for jump-to-nearest spec",
          ],
        )
      ).rows[0].id,
    );
    await client.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, account_id, debit, credit, description)
       VALUES
         ($1, $2, $3, '150.00', '0',     'Cash receipt'),
         ($1, $2, $3, '0',      '150.00','Offset')`,
      [companyId, jeId, cashAccountId],
    );

    // Plant the forged session + pin the active workspace before the
    // verification fetch hits /api/auth/user.
    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL,
      firstName: "Jump",
      lastName: "Nearest",
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

test.describe("account ledger — jump to nearest posting @ui", () => {
  test("surfaces a jump action when the active period is empty but the account has older history", async ({
    page,
  }) => {
    const seed = await seedWorkspaceAndAccount(page);

    // Pin the SPA to English via `?lang=en` so date strings render
    // with Western digits (the seeded user has no preferred_locale and
    // the app's default locale chain falls through to Arabic, which
    // formats years as "٢٠٢٥" — pinning sidesteps a locale-coupled
    // assertion that would otherwise need to grep for both digit sets).
    await gotoWithPinnedLocale(page, "/app/accounts", { locale: "en" });
    await page
      .getByTestId("page-chart-of-accounts")
      .waitFor({ state: "visible", timeout: 15_000 });

    // Open the seeded account's ledger drawer. The COA tree exposes
    // a per-row "open ledger" affordance keyed by account code.
    const opener = page.getByTestId(`button-open-ledger-${seed.cashCode}`);
    await opener.scrollIntoViewIfNeeded();
    await opener.click();

    const drawer = page.getByTestId("sheet-account-ledger");
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    // Default global period is "month" (current calendar month). A
    // posting from June of the previous year cannot fit any preset, so
    // the period-empty state must render — and the jump button must be
    // visible because the account does have history outside the window.
    const emptyPanel = drawer.getByTestId("empty-account-ledger-period");
    await expect(emptyPanel).toBeVisible({ timeout: 10_000 });
    const jumpButton = drawer.getByTestId("button-ledger-jump-nearest");
    await expect(jumpButton).toBeVisible();

    // The button label must name the date of the nearest posting so
    // users know what they're switching to. Match on the year only —
    // the month/day chunks render through date-fns locale formatting.
    const expectedYear = String(new Date().getUTCFullYear() - 1);
    await expect(jumpButton).toContainText(expectedYear);

    // Snapshot the period-chip range BEFORE clicking so the assertion
    // below proves the chip actually changed (not just that the empty
    // state fell off).
    const rangeText = drawer.getByTestId("text-period-chip-range");
    const rangeBefore = (await rangeText.textContent())?.trim() ?? "";
    await jumpButton.click();

    // The empty state must close and the postings table must render —
    // proving the global period really did move to a window that
    // includes the historic posting (the helper falls back to a custom
    // calendar-month range in June of the previous year because no
    // preset can contain a date >1y old).
    await expect(emptyPanel).toBeHidden({ timeout: 10_000 });
    await expect(drawer.getByTestId("table-account-ledger")).toBeVisible();
    await expect(rangeText).toContainText(expectedYear, { timeout: 10_000 });
    await expect(
      rangeText,
      "the period chip range must actually change after the jump",
    ).not.toHaveText(rangeBefore);
  });
});
