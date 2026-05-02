import { test, expect, type Page, type Route } from "@playwright/test";
import path from "node:path";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * UI coverage for task #336 — when the user clicks delete on an asset event
 * that has later siblings on the same asset, the Fixed-Assets module must
 * open a confirmation dialog that names how many later events will be
 * reversed and offers a single "delete and reverse later events" button.
 * Confirming sends DELETE …?cascade=true (the route shipped in task #262)
 * and shows a single success toast describing the scope of the undo. When
 * no later events exist, the plain delete path must still run unchanged
 * (no extra confirmation dialog) — the API spec in
 * `asset-event-cascade-delete.spec.ts` covers the server side; this spec
 * mirrors that behaviour at the UI layer.
 *
 * The seed pattern + GET-route mocks are deliberately the same as
 * `asset-event-delete-conflict-ui.spec.ts` (task #263 / #335) so any future
 * refactor of `AssetDetailDialog` that breaks shared assumptions trips both
 * specs at once. Only the DELETE route differs between cases (cascade
 * confirmation vs plain delete vs cascade-with-409).
 */

const TEST_EMAIL = "e2e-asset-event-cascade-ui@example.test";
const TEST_PASSWORD = "playwright-asset-event-cascade-ui-pw-2026";
const TEST_FIRST = "Cascade";
const TEST_LAST = "UiTester";
const STORAGE_PATH = path.resolve(
  ".playwright/asset-event-cascade-ui-state.json",
);

const FAKE_ASSET_ID = 919_111;
const FAKE_LONELY_ASSET_ID = 919_112;
const FAKE_EARLIER_IMPAIRMENT_ID = 919_201;
const FAKE_MIDDLE_REVALUATION_ID = 919_202;
const FAKE_LATER_DISPOSAL_ID = 919_203;
const FAKE_LONELY_IMPAIRMENT_ID = 919_204;
const FAKE_JE_EARLIER = 919_301;
const FAKE_JE_MIDDLE = 919_302;
const FAKE_JE_LATER = 919_303;
const FAKE_JE_LONELY = 919_304;

// Mirrors the server cascade ordering — events are ordered by `createdAt`
// (ties broken by id). With three increasing timestamps the impairment is
// the *earliest* on this asset, so deleting it would, in real life, hit the
// task #209 guard unless the cascade flag is set.
const T_EARLY = "2099-06-01T10:00:00.000Z";
const T_MID = "2099-09-01T10:00:00.000Z";
const T_LATE = "2099-12-01T10:00:00.000Z";

async function seedAndLogin(page: Page): Promise<{ companyId: number }> {
  const dbUrl = requireDbUrl("the asset-event-cascade-delete-ui spec");
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
      companyName: "Asset Event Cascade UI Test Co",
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
      await p.addInitScript((cid) => {
        window.localStorage.setItem("active_company_id", String(cid));
      }, companyId);
    },
  });

  return { companyId };
}

function buildAsset(companyId: number, id: number, name: string) {
  return {
    id,
    companyId,
    categoryId: 1,
    code: `A-${id}`,
    name,
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

// "Chained" asset detail: 3 events on the same asset, ordered by createdAt
// (impairment is earliest, disposal is latest). Deleting the impairment
// requires cascading the revaluation + disposal first.
function buildChainedAssetDetail(companyId: number) {
  return {
    ...buildAsset(companyId, FAKE_ASSET_ID, "Asset Cascade UI Chain"),
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
        createdAt: T_EARLY,
      },
    ],
    revaluations: [
      {
        id: FAKE_MIDDLE_REVALUATION_ID,
        eventDate: "2099-08-31",
        fairValue: "12000.00",
        method: "elimination",
        surplusDelta: "2000.00",
        plImpact: "0.00",
        journalEntryId: FAKE_JE_MIDDLE,
        notes: "",
        createdAt: T_MID,
      },
    ],
    disposals: [
      {
        id: FAKE_LATER_DISPOSAL_ID,
        eventDate: "2099-12-31",
        proceeds: "8000.00",
        method: "sale",
        gainLoss: "-2000.00",
        surplusTransferred: "0.00",
        journalEntryId: FAKE_JE_LATER,
        notes: "",
        createdAt: T_LATE,
      },
    ],
    depreciations: [],
  };
}

// "Lonely" asset detail: a single impairment on an otherwise-empty asset.
// The plain delete path must run with no extra confirmation dialog.
function buildLonelyAssetDetail(companyId: number) {
  return {
    ...buildAsset(companyId, FAKE_LONELY_ASSET_ID, "Asset Cascade UI Lonely"),
    components: [],
    schedule: [],
    impairments: [
      {
        id: FAKE_LONELY_IMPAIRMENT_ID,
        eventDate: "2099-06-30",
        recoverableAmount: "5000.00",
        lossAmount: "500.00",
        journalEntryId: FAKE_JE_LONELY,
        notes: "",
        createdAt: T_EARLY,
      },
    ],
    revaluations: [],
    disposals: [],
    depreciations: [],
  };
}

async function mockAssetReads(page: Page, companyId: number): Promise<void> {
  await page.route("**/api/fixed-assets?**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        buildAsset(companyId, FAKE_ASSET_ID, "Asset Cascade UI Chain"),
        buildAsset(companyId, FAKE_LONELY_ASSET_ID, "Asset Cascade UI Lonely"),
      ]),
    });
  });
  await page.route(`**/api/fixed-assets/${FAKE_ASSET_ID}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildChainedAssetDetail(companyId)),
    });
  });
  await page.route(
    `**/api/fixed-assets/${FAKE_LONELY_ASSET_ID}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildLonelyAssetDetail(companyId)),
      });
    },
  );
  await page.route("**/api/asset-categories?**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

interface DeleteCall {
  url: string;
  cascade: boolean;
}

// Stubs DELETE on the impairment-events route. Records each call (with the
// cascade flag observed) so the test can assert the UI hit the right route.
// Returns 204 by default; pass `respond` to override (e.g. for the 409 case).
async function stubImpairmentDelete(
  page: Page,
  id: number,
  calls: DeleteCall[],
  respond?: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(
    `**/api/impairment-events/${id}**`,
    async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const url = route.request().url();
      const cascade = /[?&]cascade=(true|1|yes)\b/.test(url);
      calls.push({ url, cascade });
      if (respond) {
        await respond(route);
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    },
  );
}

test.describe("Fixed Assets cascade-delete UI for asset event chains", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("clicking delete on an event with later siblings opens the cascade confirmation, and confirming sends ?cascade=true", async ({
    page,
  }) => {
    const { companyId } = await seedAndLogin(page);
    await mockAssetReads(page, companyId);

    const calls: DeleteCall[] = [];
    await stubImpairmentDelete(page, FAKE_EARLIER_IMPAIRMENT_ID, calls);

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

    // The cascade confirmation must open *instead* of firing the delete.
    const cascadeDialog = page.locator(
      '[data-testid="dialog-asset-event-cascade-confirm"]',
    );
    await expect(cascadeDialog).toBeVisible({ timeout: 5_000 });

    // The message must name the count of later events (2: revaluation + disposal).
    const msg = page.locator('[data-testid="text-asset-event-cascade-message"]');
    await expect(msg).toContainText("2");

    // The confirm button must be clearly labelled with the same count.
    const confirmBtn = page.locator(
      '[data-testid="button-asset-event-cascade-confirm"]',
    );
    await expect(confirmBtn).toContainText("2");

    // No DELETE was sent yet — opening the dialog must not pre-fire the request.
    expect(calls).toHaveLength(0);

    await confirmBtn.click();

    // After confirming, exactly one DELETE …?cascade=true must have been sent.
    await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(1);
    expect(calls[0].cascade).toBe(true);

    // The cascade confirmation dialog closes after a successful response.
    await expect(cascadeDialog).toHaveCount(0);

    // A single success toast must fire (Radix Toast Root has role="status"
    // for the default "foreground" type) and its description must name how
    // many later events were reversed (2 here) so the user has a single,
    // clear summary of what was undone — no per-event success toasts.
    const successToast = page
      .getByRole("status")
      .filter({ hasText: "تم حذف الحدث" });
    await expect(successToast).toHaveCount(1);
    await expect(successToast).toContainText("2");

    // No destructive "خطأ" toast may have fired alongside the success path.
    await expect(
      page.getByRole("status").filter({ hasText: "خطأ" }),
    ).toHaveCount(0);
  });

  test("cancelling the cascade dialog sends no DELETE and leaves the row in place", async ({
    page,
  }) => {
    const { companyId } = await seedAndLogin(page);
    await mockAssetReads(page, companyId);

    const calls: DeleteCall[] = [];
    await stubImpairmentDelete(page, FAKE_EARLIER_IMPAIRMENT_ID, calls);

    await page.goto(`/app/fixed-assets#asset-${FAKE_ASSET_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.locator('[data-testid="dialog-asset-detail"]'),
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="tab-detail-impairments"]').click();

    const row = page.locator(
      `[data-testid="row-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
    );
    await expect(row).toBeVisible({ timeout: 10_000 });

    await page
      .locator(
        `[data-testid="button-delete-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
      )
      .click();

    const cascadeDialog = page.locator(
      '[data-testid="dialog-asset-event-cascade-confirm"]',
    );
    await expect(cascadeDialog).toBeVisible({ timeout: 5_000 });

    await page
      .locator('[data-testid="button-asset-event-cascade-cancel"]')
      .click();

    await expect(cascadeDialog).toHaveCount(0);

    // No DELETE must have been sent and the row must still be there.
    expect(calls).toHaveLength(0);
    await expect(row).toBeVisible();
  });

  test("event with no later siblings deletes immediately via the plain (non-cascade) route", async ({
    page,
  }) => {
    const { companyId } = await seedAndLogin(page);
    await mockAssetReads(page, companyId);

    const calls: DeleteCall[] = [];
    await stubImpairmentDelete(page, FAKE_LONELY_IMPAIRMENT_ID, calls);

    await page.goto(`/app/fixed-assets#asset-${FAKE_LONELY_ASSET_ID}`, {
      waitUntil: "domcontentloaded",
    });

    const detailDialog = page.locator('[data-testid="dialog-asset-detail"]');
    await expect(detailDialog).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="tab-detail-impairments"]').click();
    const row = page.locator(
      `[data-testid="row-impairment-${FAKE_LONELY_IMPAIRMENT_ID}"]`,
    );
    await expect(row).toBeVisible({ timeout: 10_000 });

    await page
      .locator(
        `[data-testid="button-delete-impairment-${FAKE_LONELY_IMPAIRMENT_ID}"]`,
      )
      .click();

    // No cascade confirmation must appear — the plain delete path is unchanged.
    await expect(
      page.locator('[data-testid="dialog-asset-event-cascade-confirm"]'),
    ).toHaveCount(0);

    // The plain DELETE (no cascade flag) must have been sent exactly once.
    await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(1);
    expect(calls[0].cascade).toBe(false);
  });

  test("a 409 from the cascade route surfaces in the existing conflict modal (atomic abort)", async ({
    page,
  }) => {
    const { companyId } = await seedAndLogin(page);
    await mockAssetReads(page, companyId);

    const conflictMessage =
      "لا يمكن حذف خسارة الانخفاض ضمن سلسلة التراجع لأن قيدها المحاسبي مرتبط بسجلات أخرى: فاتورة #909";

    const calls: DeleteCall[] = [];
    await stubImpairmentDelete(
      page,
      FAKE_EARLIER_IMPAIRMENT_ID,
      calls,
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: conflictMessage }),
        });
      },
    );

    await page.goto(`/app/fixed-assets#asset-${FAKE_ASSET_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.locator('[data-testid="dialog-asset-detail"]'),
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="tab-detail-impairments"]').click();
    await expect(
      page.locator(
        `[data-testid="row-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
      ),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .locator(
        `[data-testid="button-delete-impairment-${FAKE_EARLIER_IMPAIRMENT_ID}"]`,
      )
      .click();
    await expect(
      page.locator('[data-testid="dialog-asset-event-cascade-confirm"]'),
    ).toBeVisible({ timeout: 5_000 });
    await page
      .locator('[data-testid="button-asset-event-cascade-confirm"]')
      .click();

    // The cascade dialog closes and the existing 409 conflict modal opens
    // with the server message verbatim — same modal task #263 ships.
    await expect(
      page.locator('[data-testid="dialog-asset-event-cascade-confirm"]'),
    ).toHaveCount(0);
    const conflictDialog = page.locator(
      '[data-testid="dialog-asset-event-delete-conflict"]',
    );
    await expect(conflictDialog).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator(
        '[data-testid="text-asset-event-delete-conflict-message"]',
      ),
    ).toHaveText(conflictMessage);

    // Exactly one DELETE was sent and it carried the cascade flag.
    expect(calls).toHaveLength(1);
    expect(calls[0].cascade).toBe(true);

    // No success toast may have fired — the cascade was atomically refused.
    await expect(
      page.getByRole("status").filter({ hasText: /^تم$/ }),
    ).toHaveCount(0);
  });
});
