import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * End-to-end coverage for the topbar's "Quick create" dropdown items.
 *
 * These are the highest-traffic write paths in the app — every dashboard
 * user reaches them dozens of times a day — but until now the Plus-menu
 * navigations and the dialogs they open were never exercised under
 * Playwright. A silent regression in any of:
 *
 *   • the dropdown trigger itself (e.g. a Radix prop rename),
 *   • client-side routing for `?new=1` deep links,
 *   • the page-level "Add" button that opens the dialog,
 *   • the dialog's form validation / mutation,
 *
 * would surface immediately to every signed-in user. This spec drives
 * each quick-action end-to-end against an isolated workspace seeded by
 * `quick-actions.setup.ts`:
 *
 *   1. quick-new-tx  → /app/transactions → Add transaction dialog
 *   2. quick-new-acc → /app/accounts     → Add account dialog
 *   3. quick-new-je  → /app/journal      → Add journal entry dialog
 *
 * For each one we open the dropdown, click the item, wait for the
 * destination page, click that page's primary "Add" button to mount the
 * dialog, fill in the minimum valid set of fields and submit. Success
 * is asserted by (a) the dialog disappearing and (b) the new record
 * appearing in the page's list — i.e. the round-trip mutation actually
 * landed in the API.
 *
 * Note on scope: the topbar exposes three quick-create items today —
 * "New transaction", "New journal entry", "New account". The originating
 * task brief listed "New Transaction, New Invoice, New Employee" as an
 * approximate set; New Invoice and New Employee aren't wired into the
 * Quick-create dropdown in the current dashboard, so this spec covers
 * every quick-action that actually exists.
 */

const FIXTURES_PATH = path.resolve(".playwright/quick-actions-fixtures.json");

interface Fixtures {
  companyId: number;
  cashAccountId: number;
  revenueAccountId: number;
}

function readFixtures(): Fixtures {
  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  return JSON.parse(raw) as Fixtures;
}

async function gotoDashboard(page: Page) {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  // The topbar is `hidden md:flex`; the project's viewport (1280×800) keeps
  // it visible, but we still wait for the Quick-create button to mount so
  // the rest of the spec doesn't race the shell.
  await page
    .getByTestId("button-quick-create")
    .waitFor({ state: "visible", timeout: 15_000 });
}

async function pickQuickAction(
  page: Page,
  itemTestId: "quick-new-tx" | "quick-new-je" | "quick-new-acc",
  expectedPath: string,
  expectedPageTestId: string,
) {
  await page.getByTestId("button-quick-create").click();
  // Radix portals the dropdown content; targeting by data-testid is enough,
  // but `waitFor visible` makes the click race-proof on slow CI.
  const item = page.getByTestId(itemTestId);
  await item.waitFor({ state: "visible" });
  await item.click();

  // setLocation pushes via wouter — no full reload, so wait for the URL
  // and the destination page's root testid instead of a navigation event.
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
  await page
    .getByTestId(expectedPageTestId)
    .waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("topbar quick-create actions", () => {
  test("New transaction → /app/transactions → submits a record", async ({ page }) => {
    await gotoDashboard(page);

    await pickQuickAction(
      page,
      "quick-new-tx",
      "/app/transactions",
      "page-transactions",
    );

    // Open the page's add-transaction dialog. The transaction-form ships
    // without per-input data-testids, so we target inputs by their RHF
    // `name` attribute (Controller's spread propagates `name` down to the
    // native <input>). Type defaults to "expense" so we don't need to
    // touch the Select.
    await page.getByTestId("button-add-transaction").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const description = `QA tx ${Date.now()}`;
    await dialog.locator('input[name="amount"]').fill("123.45");
    await dialog.locator('input[name="category"]').fill("QA");
    await dialog.locator('input[name="description"]').fill(description);
    await dialog.locator('button[type="submit"]').click();

    // Dialog closes on success and the new row appears in the list. The
    // testid id is unknown ahead of time, so we match by the description
    // text we just submitted.
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(
      page.getByTestId("list-transactions").getByText(description),
    ).toBeVisible();
  });

  test("New account → /app/accounts → submits a record", async ({ page }) => {
    await gotoDashboard(page);

    await pickQuickAction(
      page,
      "quick-new-acc",
      "/app/accounts",
      "page-chart-of-accounts",
    );

    await page.getByTestId("button-add-account").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // `accounts.code` is GLOBALLY unique (migration 0005), so namespace
    // the test code with a timestamp to keep reruns idempotent.
    const code = `QA-${Date.now()}`;
    await page.getByTestId("input-account-code").fill(code);
    await page.getByTestId("input-account-name-ar").fill("حساب اختبار سريع");
    await page.getByTestId("input-account-name-en").fill("QA Quick Account");
    // Type defaults to "expense" and subtype defaults to "operating_expense";
    // both satisfy `insertAccountSchema` so we don't override either.
    await page.getByTestId("button-save-account").click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId(`row-account-${code}`)).toBeVisible();
  });

  test("New journal entry → /app/journal → submits a balanced entry", async ({ page }) => {
    const fx = readFixtures();
    await gotoDashboard(page);

    await pickQuickAction(
      page,
      "quick-new-je",
      "/app/journal",
      "page-journal-entries",
    );

    await page.getByTestId("button-new-entry").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const description = `QA je ${Date.now()}`;
    await page.getByTestId("input-entry-description").fill(description);

    // Line 0: debit cash; Line 1: credit revenue. Account ids come from
    // the seeded fixtures so the spec doesn't have to rely on the
    // ordering of GET /api/accounts. Radix Select renders the option text
    // as `${code}  ${nameAr}`, so filter the option list by the unique
    // namespaced code we seeded.
    const cashCode = `QA-CASH-${fx.companyId}`;
    const revCode = `QA-REV-${fx.companyId}`;

    await page.getByTestId("select-line-account-0").click();
    await page
      .getByRole("option")
      .filter({ hasText: cashCode })
      .click();
    await page.getByTestId("input-line-debit-0").fill("250");

    await page.getByTestId("select-line-account-1").click();
    await page
      .getByRole("option")
      .filter({ hasText: revCode })
      .click();
    await page.getByTestId("input-line-credit-1").fill("250");

    await page.getByTestId("button-save-entry").click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // Newly-created entries render as a card with the description inside
    // — match by the unique description text we just submitted.
    await expect(
      page.locator("[data-testid^='card-entry-']").filter({ hasText: description }),
    ).toBeVisible();
  });
});
