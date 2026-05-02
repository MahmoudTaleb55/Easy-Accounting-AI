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
 * UI coverage for task #263 — when DELETE
 * /api/{impairment-events,revaluation-events,disposals}/:id returns HTTP 409
 * (e.g. because a later event on the same asset blocks the delete per task
 * #209, the JE is referenced elsewhere per task #111, or the legacy-row
 * guard from task #208 fires), the Fixed-Assets module must surface that
 * server-supplied reason verbatim inside a modal alert that stays on screen
 * until the user dismisses it.
 *
 * Pre-task behaviour was a generic destructive toast ("خطأ" + the raw
 * "<status>: <body>" formatted by the shared apiRequest helper) that
 * auto-dismissed before the user could read which event was holding things
 * up. The API-level conflict path itself is already pinned by
 * `tests/e2e/asset-event-delete-blocks-later-events.spec.ts`; this spec
 * mirrors that coverage at the UI layer the same way
 * `payroll-delete-conflict-ui.spec.ts` does for HR > Payroll.
 *
 * The only API calls this spec mocks are the asset-list/asset-detail GETs
 * (so a deterministic asset with two events exists to click) and the DELETE
 * itself (so we can return 409 + a known message without seeding through
 * the real posting flows). Every other request hits the real server, which
 * is logged in via a forged session — same pattern as the payroll spec.
 *
 * Task #335: the "later event blocks delete" path (AssetEventLaterDependencyError
 * from task #209) was the original case pinned here. The same DELETE route
 * also returns 409 for two other reasons — `JournalEntryReferenceConflictError`
 * (the JE is referenced by another module: depreciation, inbox, bank
 * reconciliation, …) from task #111, and `LegacyAssetEventBalanceMissingError`
 * (the row was posted before migration 0015 and has no `asset_balance_delta`
 * snapshot) from task #208. Both branches go through the exact same `onError`
 * handler in `AssetDetailDialog`, so the modal wiring is identical, but
 * without UI-level coverage a future refactor that special-cases one of them
 * into a toast would slip through. The two extra `test()` blocks below seed
 * those messages and assert the modal renders them verbatim.
 */

const TEST_EMAIL = "e2e-asset-event-conflict@example.test";
const TEST_PASSWORD = "playwright-asset-event-conflict-pw-2026";
const TEST_FIRST = "Asset";
const TEST_LAST = "Conflict";
const STORAGE_PATH = path.resolve(
  ".playwright/asset-event-delete-conflict-state.json",
);

const FAKE_ASSET_ID = 909_111;
const FAKE_EARLIER_IMPAIRMENT_ID = 909_201;
const FAKE_LATER_REVALUATION_ID = 909_202;
const FAKE_JE_EARLIER = 909_301;
const FAKE_JE_LATER = 909_302;
// The exact wording the server uses when a later event on the same asset
// blocks the delete (see AssetEventLaterDependencyError in server/storage.ts).
// We assert the UI surfaces it verbatim so a future change to that copy —
// or a refactor that swallows it into a generic toast — fails loudly here.
const CONFLICT_MESSAGE =
  "تعذّر حذف هذا الحدث: يوجد حدث لاحق (إعادة تقييم بتاريخ 2099-08-31) على نفس الأصل. " +
  "يجب حذف الحدث الأحدث أولاً قبل التراجع عن هذا الحدث.";

async function seedAndLogin(page: Page): Promise<{ companyId: number }> {
  const dbUrl = requireDbUrl("the asset-event-delete-conflict-ui spec");
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
      companyName: "Asset Event Conflict Test Co",
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

function buildAsset(companyId: number) {
  return {
    id: FAKE_ASSET_ID,
    companyId,
    categoryId: 1,
    code: `A-${FAKE_ASSET_ID}`,
    name: "Asset Event Conflict Test Asset",
    acquisitionDate: "2099-01-01",
    inServiceDate: "2099-01-01",
    currency: "USD",
    txCost: "10000.00",
    fxRate: "1",
    cost: "10000.00",
    residual: "0",
    usefulLifeMonths: 60,
    method: "straight_line",
    measurementModel: "cost",
    status: "active",
    accumDepreciation: "0",
    accumImpairment: "0",
    revalSurplus: "0",
    accumDepNoImpairment: "0",
    location: null,
    custodian: null,
    lastDepreciatedPeriod: null,
    carryingAmount: 10000,
  };
}

function buildAssetDetail(companyId: number) {
  return {
    ...buildAsset(companyId),
    components: [],
    schedule: [],
    impairments: [
      {
        id: FAKE_EARLIER_IMPAIRMENT_ID,
        eventDate: "2099-06-30",
        recoverableAmount: "5000.00",
        lossAmount: "500.00",
        journalEntryId: FAKE_JE_EARLIER,
        notes: "",
      },
    ],
    revaluations: [
      {
        id: FAKE_LATER_REVALUATION_ID,
        eventDate: "2099-08-31",
        fairValue: "12000.00",
        method: "elimination",
        surplusDelta: "2000.00",
        plImpact: "0.00",
        journalEntryId: FAKE_JE_LATER,
        notes: "",
      },
    ],
    disposals: [],
    depreciations: [],
  };
}

// Shared GET-route mocks. Used by every test in this file because each one
// drives the *same* asset-detail page; only the DELETE response differs
// between cases. Extracted as a helper so the per-test bodies stay focused
// on the specific 409 branch they're asserting.
async function mockAssetReads(page: Page, companyId: number): Promise<void> {
  // Mock the asset-list GET so the deep-link `#asset-<id>` opens the
  // detail dialog (the effect in fixed-assets.tsx checks the asset
  // exists in the list before opening). Both endpoints below are kept
  // in sync so cache invalidations after a successful delete (which
  // won't happen in these tests, but might in future regressions) keep
  // returning the same shape.
  await page.route("**/api/fixed-assets?**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([buildAsset(companyId)]),
    });
  });

  // The asset-detail GET drives the impairment / revaluation / disposal
  // tabs. We seed two events on the same asset (an impairment and a
  // later revaluation) so the earlier impairment is the one the server
  // would refuse to delete in real life.
  await page.route(`**/api/fixed-assets/${FAKE_ASSET_ID}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildAssetDetail(companyId)),
    });
  });

  // The asset-categories GET is queried by the register card; respond
  // with an empty list so the page doesn't 500 on fetch failure.
  await page.route("**/api/asset-categories?**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

test.describe("Fixed Assets surfaces the 409 conflict reason for asset-event deletes", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("renders the server message in a modal alert (not a toast)", async ({ page }) => {
    const { companyId } = await seedAndLogin(page);

    await mockAssetReads(page, companyId);

    // Mock the DELETE so it answers exactly the way the real route would
    // when a later event on the same asset blocks the delete (task #209).
    let deleteCalls = 0;
    await page.route(
      `**/api/impairment-events/${FAKE_EARLIER_IMPAIRMENT_ID}`,
      async (route) => {
        if (route.request().method() !== "DELETE") return route.fallback();
        deleteCalls += 1;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: CONFLICT_MESSAGE }),
        });
      },
    );

    // Use the `#asset-<id>` deep link the JE source-link badge uses —
    // that's the canonical way to land directly on the Register tab with
    // the detail dialog open for a specific asset.
    await page.goto(`/app/fixed-assets#asset-${FAKE_ASSET_ID}`, {
      waitUntil: "domcontentloaded",
    });

    const detailDialog = page.locator('[data-testid="dialog-asset-detail"]');
    await expect(detailDialog).toBeVisible({ timeout: 15_000 });

    // Switch to the Impairments tab and click delete on the earlier event.
    await page.locator('[data-testid="tab-detail-impairments"]').click();
    const row = page.locator(
      `[data-testid="row-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
    );
    await expect(row).toBeVisible({ timeout: 10_000 });

    const deleteBtn = page.locator(
      `[data-testid="button-delete-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
    );
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // The server message must appear in the modal alert exactly as worded —
    // no truncation, no "<status>: ..." wrapping, no destructive toast.
    const conflictDialog = page.locator(
      '[data-testid="dialog-asset-event-delete-conflict"]',
    );
    await expect(conflictDialog).toBeVisible({ timeout: 10_000 });

    const message = page.locator(
      '[data-testid="text-asset-event-delete-conflict-message"]',
    );
    await expect(message).toHaveText(CONFLICT_MESSAGE);

    // The destructive toast (the old behaviour) must NOT also fire — that
    // would split the user's attention and cover the dialog.
    await expect(
      page.getByRole("status").filter({ hasText: /^خطأ$/ }),
    ).toHaveCount(0);

    // The dialog must persist until the user explicitly dismisses it. We
    // wait well past the toast auto-dismiss window (~5s) and confirm the
    // message is still on screen.
    await page.waitForTimeout(5_500);
    await expect(conflictDialog).toBeVisible();
    await expect(message).toHaveText(CONFLICT_MESSAGE);

    // The row must NOT have been removed from the list — the delete was
    // refused, so the user can keep working with it.
    await expect(row).toBeVisible();

    // Dismiss closes the dialog and the row stays put.
    await page
      .locator('[data-testid="button-asset-event-delete-conflict-close"]')
      .click();
    await expect(conflictDialog).toHaveCount(0);
    await expect(row).toBeVisible();

    // Sanity: the DELETE was actually attempted exactly once (not retried,
    // not skipped). Catches a regression where a future "confirm before
    // delete" dialog would suppress the request entirely.
    expect(deleteCalls).toBe(1);
  });

  // Task #335: same modal must surface the OTHER two 409 reasons too. The
  // server formats both with `JournalEntryReferenceConflictError` /
  // `LegacyAssetEventBalanceMissingError` (see server/storage.ts lines
  // 3850-3886), and the route in server/routes.ts maps both to 409 with the
  // error's own `.message`. We mirror those exact strings here so a future
  // refactor that special-cases either branch into a destructive toast (the
  // pre-task #263 behaviour) trips this spec instead of slipping through.
  // The wording matches `deleteImpairmentEvent` in server/storage.ts so a
  // change there without updating the test is caught immediately.
  const JE_REFERENCE_CONFLICT_MESSAGE =
    "لا يمكن حذف خسارة الانخفاض لأن قيدها المحاسبي مرتبط بسجلات أخرى: " +
    "تسوية بنكية #4242، فاتورة #909";
  const LEGACY_BALANCE_MISSING_MESSAGE =
    "لا يمكن حذف خسارة الانخفاض لأنها مُسجَّلة قبل تحديث تتبّع الأرصدة (task #157). " +
    "يرجى تعديل أرصدة الأصل يدوياً.";

  // Helper: the per-test bodies below only differ by the 409 message the
  // mocked DELETE returns, so wrap the common steps (stub the DELETE,
  // navigate, switch tab, click delete, assert modal verbatim, assert no
  // toast, assert dialog persists past the toast auto-dismiss window, assert
  // row stays put, dismiss, assert DELETE was tried exactly once) here.
  // Keeps each new test() body to its essential difference: the message.
  async function runDeleteAndAssertModalShowsServerMessage(
    page: Page,
    expectedMessage: string,
  ): Promise<void> {
    let deleteCalls = 0;
    await page.route(
      `**/api/impairment-events/${FAKE_EARLIER_IMPAIRMENT_ID}`,
      async (route) => {
        if (route.request().method() !== "DELETE") return route.fallback();
        deleteCalls += 1;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: expectedMessage }),
        });
      },
    );

    await page.goto(`/app/fixed-assets#asset-${FAKE_ASSET_ID}`, {
      waitUntil: "domcontentloaded",
    });

    const detailDialog = page.locator('[data-testid="dialog-asset-detail"]');
    await expect(detailDialog).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="tab-detail-impairments"]').click();
    const row = page.locator(
      `[data-testid="row-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
    );
    await expect(row).toBeVisible({ timeout: 10_000 });

    const deleteBtn = page.locator(
      `[data-testid="button-delete-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
    );
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    const conflictDialog = page.locator(
      '[data-testid="dialog-asset-event-delete-conflict"]',
    );
    await expect(conflictDialog).toBeVisible({ timeout: 10_000 });

    const message = page.locator(
      '[data-testid="text-asset-event-delete-conflict-message"]',
    );
    await expect(message).toHaveText(expectedMessage);

    // Same toast-suppression and persistence guarantees as the original
    // test: a regression that downgrades any of the three 409 branches
    // into a toast would fire here too.
    await expect(
      page.getByRole("status").filter({ hasText: /^خطأ$/ }),
    ).toHaveCount(0);
    await page.waitForTimeout(5_500);
    await expect(conflictDialog).toBeVisible();
    await expect(message).toHaveText(expectedMessage);
    await expect(row).toBeVisible();

    await page
      .locator('[data-testid="button-asset-event-delete-conflict-close"]')
      .click();
    await expect(conflictDialog).toHaveCount(0);
    await expect(row).toBeVisible();

    expect(deleteCalls).toBe(1);
  }

  test(
    "renders the JE-reference conflict message verbatim (task #111 branch)",
    async ({ page }) => {
      const { companyId } = await seedAndLogin(page);
      await mockAssetReads(page, companyId);
      await runDeleteAndAssertModalShowsServerMessage(
        page,
        JE_REFERENCE_CONFLICT_MESSAGE,
      );
    },
  );

  test(
    "renders the legacy asset-balance missing message verbatim (task #208 branch)",
    async ({ page }) => {
      const { companyId } = await seedAndLogin(page);
      await mockAssetReads(page, companyId);
      await runDeleteAndAssertModalShowsServerMessage(
        page,
        LEGACY_BALANCE_MISSING_MESSAGE,
      );
    },
  );
});
