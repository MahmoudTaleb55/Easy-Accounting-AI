import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * End-to-end coverage for the topbar profile menu.
 *
 * The profile dropdown is the only UI surface that confirms *who* the user
 * is signed in as and gives them a one-click "Sign out". A future refactor
 * of `client/src/components/layout/topbar.tsx` or `useAuth` could silently
 * break either side of this contract — the rest of the dashboard would
 * keep rendering, masking the regression. This spec asserts:
 *
 *   1. The dropdown shows `[data-testid="text-user-name"]` with the
 *      seeded user's full name.
 *   2. The dropdown shows `[data-testid="text-user-email"]` with the
 *      seeded user's email.
 *   3. Clicking `[data-testid="menu-signout"]` POSTs to
 *      `/api/auth/signout`, the server clears the session
 *      (`/api/auth/user` → 401), and the SPA lands on `/signin`.
 *
 * The same flow runs in both English and Arabic to prove the menu — which
 * relies on logical (`me-2`) properties — does not visually overflow under
 * RTL mirroring. Each test mints a fresh passport session because sign-out
 * destroys the session row, so a shared `storageState` would only be valid
 * for the first test in a worker.
 *
 * The user-creation + session-forging machinery is shared with the other
 * e2e setups via `tests/e2e/_helpers/forge-session.ts` so cookie-name /
 * secret-rotation / schema changes only need to be made in one place.
 */

const TEST_EMAIL = "e2e-topbar@example.test";
const TEST_PASSWORD = "playwright-topbar-pw-2025";
const TEST_FIRST = "Playwright";
const TEST_LAST = "Topbar";
const FULL_NAME = `${TEST_FIRST} ${TEST_LAST}`;

/**
 * Mint a fresh signed-in session for the seeded test user and plant the
 * cookies in the given page's context. Returns the user id so the caller
 * can assert downstream calls (e.g. /api/auth/user) against the right
 * account.
 *
 * The legacy `workspace_members` mirror table — and the `wm_id` cookie
 * that signed against it — were retired in migration 0006, so we no
 * longer mint that companion cookie. The modern auth layer reads
 * identity straight off the passport session row that `forgeSession`
 * writes below.
 *
 * The caller passes the locale they're about to render under so we can
 * pin `users.preferred_locale` to the same value. Without this, the SPA's
 * `LocaleSync` (in `client/src/components/layout/main-layout.tsx`) would
 * read the user's stored `preferredLocale` from `/api/auth/user` and call
 * `setLocale()` with it, overriding whatever the test seeded into
 * `localStorage["app.locale"]`. The user-row preference always wins for
 * authenticated views, so the test must mirror its choice into the row.
 */
async function injectFreshSession(
  page: Page,
  preferredLocale: "en" | "ar",
): Promise<{ userId: string }> {
  const dbUrl = requireDbUrl("the topbar profile test");
  requireCookieSecret("the topbar profile test");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  try {
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
    });
    // Pin the user's stored preferred locale to the variant under test
    // so `LocaleSync` doesn't override the localStorage-seeded value
    // (see the doc comment above for the full rationale).
    await client.query(`UPDATE users SET preferred_locale = $1 WHERE id = $2`, [
      preferredLocale,
      userId,
    ]);
    // The topbar reads `useCompany`, which falls back gracefully to no
    // companies, so we deliberately skip seeding a workspace here — the
    // profile dropdown renders independently of memberships and we want
    // this test to stay narrowly focused on the topbar contract.
  } finally {
    await client.end();
  }

  // Wipe any stale session cookie left over from a prior test that signed
  // out — otherwise the browser would still send the killed sid alongside
  // the freshly-minted one and confuse the server.
  await page.context().clearCookies();

  // Forge a passport session row + signed connect.sid cookie. No
  // `storagePath` is provided because each test in this spec mints its
  // own session (sign-out destroys the row), so persisting state across
  // tests would defeat the test's premise.
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
  });

  return { userId };
}

const LOCALES: { locale: "en" | "ar"; dir: "ltr" | "rtl" }[] = [
  { locale: "en", dir: "ltr" },
  { locale: "ar", dir: "rtl" },
];

for (const { locale, dir } of LOCALES) {
  test.describe(`topbar profile menu — ${locale}`, () => {
    // The topbar is `hidden md:flex` — at the default 360px mobile viewport
    // the bottom-tab layout takes over and the dropdown we're asserting
    // against simply isn't mounted. Force a desktop width so the topbar is
    // the active chrome.
    test.use({ viewport: { width: 1280, height: 800 } });

    test.beforeEach(async ({ page }) => {
      await injectFreshSession(page, locale);
      await page.addInitScript((loc) => {
        window.localStorage.setItem("app.locale", loc);
        window.localStorage.setItem("app.theme", "light");
      }, locale);
    });

    test("shows signed-in identity and signs out cleanly", async ({ page }) => {
      // Land on a page that mounts the topbar. The dashboard is the canonical
      // host; we wait for the topbar itself rather than KPI data so the test
      // doesn't depend on the (intentionally empty) workspace seed.
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const topbar = page.locator('[data-testid="app-topbar"]');
      await expect(topbar).toBeVisible({ timeout: 15_000 });

      // Sanity-check that the locale actually applied — Arabic coverage is
      // pointless if the SPA fell back to English.
      const htmlDir = await page.evaluate(() => document.documentElement.dir);
      expect(htmlDir).toBe(dir);

      // Open the profile dropdown. The topbar owns the canonical
      // `text-user-name` / `text-user-email` testids — the sidebar uses its
      // own `text-sidebar-user-*` namespace — so we can locate them at the
      // page level without scoping to the menu portal.
      await page.locator('[data-testid="button-profile"]').click();
      const menu = page.locator('[role="menu"]').first();
      await expect(menu).toBeVisible();

      const userName = page.locator('[data-testid="text-user-name"]');
      const userEmail = page.locator('[data-testid="text-user-email"]');
      await expect(userName).toBeVisible();
      await expect(userEmail).toBeVisible();
      await expect(userName).toHaveText(FULL_NAME);
      await expect(userEmail).toHaveText(TEST_EMAIL);

      // Catch a regression that would let the dropdown overflow the
      // viewport edge under RTL — the menu lives behind `me-2` logical
      // properties that mirror automatically, but a hard-coded `mr-2`
      // sneaking back in would push it off-screen on the opposite side.
      const menuBox = await menu.boundingBox();
      const viewport = page.viewportSize();
      expect(menuBox, "profile dropdown should have a bounding box").not.toBeNull();
      if (menuBox && viewport) {
        expect(menuBox.x).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 1);
      }

      // Click "Sign out" and assert it actually POSTs to /api/auth/signout.
      const signoutResponse = page.waitForResponse(
        (r) => r.url().endsWith("/api/auth/signout") && r.request().method() === "POST",
      );
      await page.locator('[data-testid="menu-signout"]').click();
      const resp = await signoutResponse;
      expect(resp.status()).toBe(200);

      // The SPA hard-redirects to /signin once the mutation resolves.
      await page.waitForURL((url) => url.pathname === "/signin", { timeout: 10_000 });
      expect(new URL(page.url()).pathname).toBe("/signin");

      // The server must consider the session cleared — a fresh request to
      // the auth probe should now return 401, regardless of whatever
      // residual cookie the browser is still holding.
      const after = await page.request.get("/api/auth/user");
      expect(after.status()).toBe(401);
    });
  });
}
