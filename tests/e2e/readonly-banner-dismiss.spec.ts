import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";
import {
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * End-to-end coverage for the viewer-role read-only banner's
 * dismiss-persists-across-reload contract.
 *
 * `client/src/components/layout/readonly-banner.tsx` reads its
 * dismissed flag through `useSessionStorageState`, so once a viewer
 * clicks the X the banner must stay hidden for the rest of the tab
 * session — including across full page reloads. A previous refactor of
 * the banner used `useState` only, so dismissing it lasted exactly one
 * render and the banner snapped back on reload. This spec freezes the
 * sessionStorage-backed contract:
 *
 *   1. A viewer-role user signs in and lands on /app.
 *   2. The banner is visible.
 *   3. The user clicks the dismiss button.
 *   4. The banner disappears immediately.
 *   5. After a full reload (same tab → same sessionStorage), the banner
 *      stays hidden — proving the dismiss flag survived the reload.
 *   6. After clearing sessionStorage and reloading (simulating a fresh
 *      tab where the per-tab sessionStorage starts empty), the banner
 *      reappears — proving the dismissal is *only* sticky for the tab
 *      that did the dismissing, not globally persisted.
 *
 * Auth + workspace are provisioned inline in `beforeAll` so the spec
 * stays self-contained: a dedicated viewer user owns a viewer-only
 * membership in a workspace whose owner is a separate seed account.
 * That isolation keeps the test independent of any sibling spec that
 * mutates the shared role-fixtures workspace.
 */

const VIEWER_EMAIL = "e2e-readonly-banner-viewer@example.test";
const VIEWER_PASSWORD = "playwright-readonly-banner-viewer-2025";
const OWNER_EMAIL = "e2e-readonly-banner-owner@example.test";
const OWNER_PASSWORD = "playwright-readonly-banner-owner-2025";
const COMPANY_NAME = "E2E Readonly Banner Co";

const BANNER = '[data-testid="banner-readonly"]';
const DISMISS = '[data-testid="button-dismiss-readonly"]';
const TOPBAR = '[data-testid="app-topbar"]';

let viewerUserId: string;

test.describe("read-only banner dismiss survives reload @rbac", () => {
  // The topbar (and so the banner row beneath it) is `hidden md:flex` —
  // a desktop viewport keeps the layout that hosts the banner mounted.
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeAll(async () => {
    const dbUrl = requireDbUrl("the readonly-banner-dismiss spec");
    requireCookieSecret("the readonly-banner-dismiss spec");

    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      // Two users: a placeholder owner that owns the workspace, and the
      // viewer-role user the spec actually signs in as. We need a real
      // owner row because `companies.owner_user_id` is non-null in this
      // schema; the viewer's role is determined entirely by their
      // `memberships.role`, not by `owner_user_id`.
      const ownerUserId = await ensureUser(client, {
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        firstName: "E2E",
        lastName: "BannerOwner",
      });
      viewerUserId = await ensureUser(client, {
        email: VIEWER_EMAIL,
        password: VIEWER_PASSWORD,
        firstName: "E2E",
        lastName: "BannerViewer",
      });

      // Idempotent workspace lookup keyed by name so re-runs converge on
      // a single canonical row instead of stacking duplicates.
      let companyRow = (
        await client.query(
          `SELECT id FROM companies WHERE name = $1 LIMIT 1`,
          [COMPANY_NAME],
        )
      ).rows[0];
      let companyId: number;
      if (companyRow) {
        companyId = Number(companyRow.id);
        await client.query(
          `UPDATE companies
              SET owner_user_id = $1,
                  functional_currency = 'USD',
                  currency_symbol = '$',
                  is_active = true
            WHERE id = $2`,
          [ownerUserId, companyId],
        );
      } else {
        companyRow = (
          await client.query(
            `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default, is_active)
             VALUES ($1, $2, 'USD', '$', false, true)
             RETURNING id`,
            [COMPANY_NAME, ownerUserId],
          )
        ).rows[0];
        companyId = Number(companyRow.id);
      }

      // Owner membership (so the workspace is "real"). Idempotent —
      // re-running the setup normalises any drifted role back to owner.
      const ownerMembership = (
        await client.query(
          `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
          [ownerUserId, companyId],
        )
      ).rows[0];
      if (ownerMembership) {
        await client.query(`UPDATE memberships SET role = 'owner' WHERE id = $1`, [
          ownerMembership.id,
        ]);
      } else {
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, role)
           VALUES ($1, $2, $3, 'owner')`,
          [crypto.randomUUID(), ownerUserId, companyId],
        );
      }

      // Viewer membership — the role under test. The banner only renders
      // when `useAuth().role === 'viewer'`, so this is the row that makes
      // the assertion meaningful.
      const viewerMembership = (
        await client.query(
          `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
          [viewerUserId, companyId],
        )
      ).rows[0];
      if (viewerMembership) {
        await client.query(`UPDATE memberships SET role = 'viewer' WHERE id = $1`, [
          viewerMembership.id,
        ]);
      } else {
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, role)
           VALUES ($1, $2, $3, 'viewer')`,
          [crypto.randomUUID(), viewerUserId, companyId],
        );
      }
    } finally {
      await client.end();
    }
  });

  test.beforeEach(async ({ page }) => {
    const dbUrl = requireDbUrl("the readonly-banner-dismiss spec");
    await page.context().clearCookies();
    await forgeSession({
      page,
      dbUrl,
      userId: viewerUserId,
      email: VIEWER_EMAIL,
      firstName: "E2E",
      lastName: "BannerViewer",
    });
  });

  async function gotoApp(page: Page) {
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    // Wait for the topbar to render — confirms the authenticated shell
    // (and so the layout that hosts the banner) has actually mounted
    // before we look for the banner. Without this the very first goto
    // can race the React tree and report "banner not visible" simply
    // because the shell hasn't hydrated yet.
    await expect(page.locator(TOPBAR)).toBeVisible({ timeout: 15_000 });
  }

  test("dismiss persists across a full page reload in the same tab", async ({ page }) => {
    await gotoApp(page);

    // The viewer must see the banner on first arrival — anything else
    // (e.g. a stale dismissed flag in sessionStorage from a prior run,
    // or the role failing to resolve to 'viewer') would make the rest
    // of the assertions vacuously true. We clear sessionStorage first
    // to guarantee a clean starting state regardless of how the test
    // runner was invoked.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(TOPBAR)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(BANNER),
      "viewer should see the read-only banner before dismissing",
    ).toBeVisible();

    // Dismiss → the banner must vanish immediately (the React state
    // update flips `dismissed` to true on the same render tick).
    await page.locator(DISMISS).click();
    await expect(
      page.locator(BANNER),
      "banner should disappear right after dismiss",
    ).toHaveCount(0);

    // The session-storage hook should write the flag synchronously in
    // its post-render effect. Wait for the round-trip to land before
    // reloading so the assertion below tests reload-persistence rather
    // than racing the effect.
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            window.sessionStorage.getItem("app.readonly_banner.dismissed"),
          ),
        {
          timeout: 5_000,
          message: "useSessionStorageState should persist the dismissed flag",
        },
      )
      .toBe("true");

    // Full reload — same tab, so sessionStorage carries over. The
    // banner must remain hidden; this is the contract the task locks in.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(TOPBAR)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(BANNER),
      "banner must stay hidden after reload because dismiss was sessionStorage-backed",
    ).toHaveCount(0);

    // Belt-and-braces: even after waiting a beat for any post-mount
    // effects (e.g. a query that flips role from null to 'viewer'), the
    // banner must still be absent. Without the sessionStorage round-trip
    // it would re-mount visible once the role resolved.
    await page.waitForTimeout(500);
    await expect(page.locator(BANNER)).toHaveCount(0);
  });

  test("clearing sessionStorage (or opening a fresh tab) re-shows the banner", async ({
    page,
  }) => {
    await gotoApp(page);

    // Dismiss in the current tab so we have a known dismissed state to
    // invalidate. We don't reload here — that flow is covered by the
    // sibling test above. Here we just need sessionStorage to hold the
    // dismissed flag before we wipe it.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(TOPBAR)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(BANNER)).toBeVisible();
    await page.locator(DISMISS).click();
    await expect(page.locator(BANNER)).toHaveCount(0);
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.sessionStorage.getItem("app.readonly_banner.dismissed"),
        ),
      )
      .toBe("true");

    // Simulate a fresh tab: sessionStorage is per-tab in the browser,
    // so opening a new tab is functionally equivalent to wiping the
    // current tab's sessionStorage. We wipe + reload because that is
    // what the underlying contract guarantees ("the rest of the tab
    // session") and is more robust than relying on Chromium's per-tab
    // sessionStorage isolation under Playwright's context model.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(TOPBAR)).toBeVisible({ timeout: 15_000 });

    await expect(
      page.locator(BANNER),
      "banner must reappear once sessionStorage is cleared (a 'fresh tab')",
    ).toBeVisible();
  });
});
