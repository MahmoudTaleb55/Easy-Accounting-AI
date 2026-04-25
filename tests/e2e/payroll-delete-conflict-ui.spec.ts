import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * UI coverage for task #110 — when DELETE /api/hr/payroll/runs/:id returns
 * HTTP 409 with a server-supplied reason (typically because the auto-posted
 * journal entry is referenced by another GL-impact module — depreciation,
 * impairment, document inbox, …), the HR > Payroll page must surface that
 * reason verbatim inside a modal alert that stays on screen until the user
 * dismisses it.
 *
 * Pre-task behaviour was a generic destructive toast ("خطأ" + the raw
 * "<status>: <body>" formatted by the shared apiRequest helper), which
 * auto-dismissed before users could read which downstream module was
 * holding the JE. The API-level conflict path itself is already pinned by
 * `payroll-delete-reverses-journal.spec.ts`; this spec mirrors that
 * coverage at the UI layer.
 *
 * The only API call this spec mocks is the payroll-runs list (so the row
 * exists to click) and the DELETE itself (so we can deterministically
 * return 409 + a known message). Every other request hits the real server,
 * which is logged in via a forged session — same pattern as the other UI
 * specs in this directory (avatar-upload, dashboard-shell, …).
 */

const TEST_EMAIL = "e2e-payroll-conflict@example.test";
const TEST_PASSWORD = "playwright-payroll-conflict-pw-2026";
const TEST_FIRST = "Payroll";
const TEST_LAST = "Conflict";
const STORAGE_PATH = path.resolve(".playwright/payroll-delete-conflict-state.json");

const FAKE_RUN_ID = 999_111;
const FAKE_JE_ID = 888_222;
// The exact wording the server uses for the depreciation case — we assert
// the UI surfaces it verbatim so a future change to that copy fails loudly.
const CONFLICT_MESSAGE =
  "تعذّر حذف كشف الرواتب: القيد المحاسبي مرتبط بدورة إهلاك ولا يمكن عكسه تلقائياً.";

async function seedAndLogin(page: Page): Promise<{ companyId: number }> {
  const dbUrl = requireDbUrl("the payroll-delete-conflict-ui spec");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  try {
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
    });
    // Owner role so WriteGuard renders the delete button enabled.
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "Payroll Conflict Test Co",
    });
  } finally {
    await client.end();
  }

  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
    storagePath: STORAGE_PATH,
    afterCookiesPlanted: async (p) => {
      // Pin the active workspace so X-Company-Id is sent on every request,
      // including the DELETE the test intercepts. Without this the very
      // first authenticated render falls back to the user's first
      // membership which may not be this fresh workspace.
      await p.addInitScript((cid) => {
        window.localStorage.setItem("active_company_id", String(cid));
      }, companyId);
    },
  });

  return { companyId };
}

test.describe("HR > Payroll surfaces the 409 conflict reason", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("renders the server message in a modal alert (not a toast)", async ({ page }) => {
    const { companyId } = await seedAndLogin(page);

    // Mock the payroll-runs list so a deterministic row exists to delete.
    // We only mock GET; the cache-invalidation paths in PayrollTab do
    // refetch this URL but our handler keeps returning the same row, which
    // is exactly the behaviour we want when the server refuses the delete.
    await page.route("**/api/hr/payroll/runs", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: FAKE_RUN_ID,
            companyId,
            year: 2099,
            month: 1,
            status: "posted",
            totalGross: "1000.00",
            totalNet: "900.00",
            journalEntryId: FAKE_JE_ID,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    // Mock the DELETE so it answers exactly the way the real route would
    // when another GL-impact module is referencing the JE.
    let deleteCalls = 0;
    await page.route(`**/api/hr/payroll/runs/${FAKE_RUN_ID}`, async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleteCalls += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: CONFLICT_MESSAGE }),
      });
    });

    // Use the `#pr-<id>` deep link the JE-source-link badge uses — that's
    // the canonical way to land directly on the Payroll tab with a
    // specific row in view (see `mapHashToTab` in client/src/pages/hr.tsx).
    await page.goto(`/app/hr#pr-${FAKE_RUN_ID}`, { waitUntil: "domcontentloaded" });

    const row = page.locator(`[data-testid="row-payroll-run-${FAKE_RUN_ID}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const deleteBtn = page.locator(
      `[data-testid="button-delete-payroll-run-${FAKE_RUN_ID}"]`,
    );
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // The server message must appear in the modal alert exactly as worded —
    // no truncation, no "<status>: ..." wrapping, no destructive toast.
    const dialog = page.locator('[data-testid="dialog-payroll-delete-conflict"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const message = page.locator(
      '[data-testid="text-payroll-delete-conflict-message"]',
    );
    await expect(message).toHaveText(CONFLICT_MESSAGE);

    // The destructive toast (the old behaviour) must NOT also fire — that
    // would split the user's attention and cover the dialog.
    await expect(page.getByRole("status").filter({ hasText: /^خطأ$/ })).toHaveCount(0);

    // The dialog must persist until the user explicitly dismisses it. We
    // wait well past the toast auto-dismiss window (~5s) and confirm the
    // message is still on screen.
    await page.waitForTimeout(5_500);
    await expect(dialog).toBeVisible();
    await expect(message).toHaveText(CONFLICT_MESSAGE);

    // The row must NOT have been removed from the list — the delete was
    // refused, so the user can keep working with it.
    await expect(row).toBeVisible();

    // Dismiss closes the dialog and the row stays put.
    await page
      .locator('[data-testid="button-payroll-delete-conflict-close"]')
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeVisible();

    // Sanity: the DELETE was actually attempted exactly once (not retried,
    // not skipped). Catches a regression where a future "confirm before
    // delete" dialog would suppress the request entirely.
    expect(deleteCalls).toBe(1);
  });
});
