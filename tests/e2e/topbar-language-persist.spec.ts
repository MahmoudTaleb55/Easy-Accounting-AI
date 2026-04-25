import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * End-to-end coverage for the topbar language switcher.
 *
 * `client/src/components/layout/topbar.tsx#updateLocaleMut` PATCHes
 * `/api/auth/profile` whenever the user picks a new language and then
 * invalidates the `['/api/auth/user']` query so any UI driven by
 * `useAuth()` (the assistant locale, settings page, sidebar copy)
 * immediately re-fetches with the updated `preferredLocale`.
 *
 * A regression we already shipped once: the mutation's `onSuccess`
 * invalidated the wrong key (`['/api/auth/me']`) so the cached user
 * record went stale until a hard reload. This spec locks the contract
 * down end-to-end:
 *
 *   1. Pick German from the topbar's language sub-menu.
 *   2. The PATCH succeeds.
 *   3. `useAuth`'s `['/api/auth/user']` query refetches — observed via a
 *      counter of GETs to `/api/auth/user`. Under the bug this counter
 *      would not advance past the initial mount fetch.
 *   4. The server row is updated to `preferredLocale: 'de'`.
 *   5. After a full page reload:
 *        a. `/api/auth/user` still returns `preferredLocale: 'de'` —
 *           proving the choice survives reload at the source-of-truth
 *           level.
 *        b. The dashboard *renders* in German — `<html lang="de">`,
 *           `<html dir="ltr">`, and the sidebar's "Dashboard" link
 *           reads "Übersicht". This locks in the visual side of the
 *           contract, which previously regressed because `LocaleSync`
 *           used to re-apply the workspace `settings.locale` (Arabic
 *           by default) on top of the user's preference. The current
 *           `LocaleSync` prefers `useAuth().user.preferredLocale` over
 *           the org setting, and `LocaleProvider` seeds itself from
 *           `localStorage` so the German UI is visible from the very
 *           first paint after reload.
 *
 * The user-creation + session-forging machinery is shared with the other
 * e2e setups via `tests/e2e/_helpers/forge-session.ts` so cookie-name /
 * secret-rotation / schema changes only need to be made in one place.
 */

const TEST_EMAIL = "e2e-topbar-lang@example.test";
const TEST_PASSWORD = "playwright-topbar-lang-pw-2025";
const TEST_FIRST = "Playwright";
const TEST_LAST = "Lang";

async function injectFreshSession(page: Page): Promise<{ userId: string }> {
  const dbUrl = requireDbUrl("the language test");
  requireCookieSecret("the language test");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  try {
    // Idempotently ensure the language test user exists. The legacy
    // `workspace_members` mirror table was retired in 2026-04
    // (migration 0006) so we do *not* mint a `wm_id` cookie — the
    // modern auth layer reads identity straight off the passport
    // session row that `forgeSession` writes below.
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
    });
    // Reset `preferred_locale` to 'en' on every run so the test is
    // independent of prior runs that may have flipped it to German.
    // The shared `ensureUser` helper doesn't touch this column for an
    // already-existing user, so we have to pin it here.
    await client.query(
      `UPDATE users SET preferred_locale = 'en' WHERE id = $1`,
      [userId],
    );

    // The topbar's `changeLanguage` only PATCHes the profile when the
    // signed-in user has an active workspace role — `useAuth` derives
    // `role` from the active membership. Ensure the test user owns at
    // least one workspace so the mutation actually fires.
    await ensureCompany(client, {
      userId,
      companyName: "Playwright Lang Co",
    });
  } finally {
    await client.end();
  }

  await page.context().clearCookies();
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

test.describe("topbar language switcher persists the user choice", () => {
  // The topbar is `hidden md:flex` — a desktop viewport keeps the dropdown
  // mounted (the mobile bottom-tab layout doesn't include it).
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await injectFreshSession(page);
  });

  test("PATCHes /api/auth/profile, refreshes useAuth cache, survives reload", async ({ page }) => {
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    const topbar = page.locator('[data-testid="app-topbar"]');
    await expect(topbar).toBeVisible({ timeout: 15_000 });

    // Server must start with English so picking German is an unambiguous
    // change. The setup helper resets the row on every run, so this is
    // really a cross-run guard: catch a future helper change that drops
    // the reset and would silently turn this into a no-op.
    const before = await page.request.get("/api/auth/user");
    expect(before.status()).toBe(200);
    expect((await before.json())?.preferredLocale).toBe("en");

    // Track every GET to /api/auth/user — `useAuth` should refetch after
    // the mutation invalidates the cache. Counting requests is the most
    // direct signal that the invalidation key is right; if the mutation
    // invalidated the wrong key (the original bug) the count would not
    // increase even though the PATCH itself succeeded. Note: `page.request`
    // calls go through Playwright's own context, not the SPA, so this
    // counter only sees fetches the SPA itself fires.
    let userFetchCount = 0;
    page.on("request", (req) => {
      if (req.method() === "GET" && req.url().endsWith("/api/auth/user")) {
        userFetchCount += 1;
      }
    });
    // Wait for the initial mount fetch to settle so the post-mutation
    // refetch is observable as a discrete delta.
    await page
      .waitForResponse(
        (r) => r.url().endsWith("/api/auth/user") && r.request().method() === "GET",
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    const fetchesBeforeChange = userFetchCount;

    // Open profile dropdown → hover language sub-menu → pick German.
    await page.locator('[data-testid="button-profile"]').click();
    const menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible();

    const profilePatch = page.waitForResponse(
      (r) => r.url().endsWith("/api/auth/profile") && r.request().method() === "PATCH",
    );

    // The language entry is a Radix sub-trigger; hovering opens its
    // content. We scope the trigger lookup to the open menu so the
    // settings sub-trigger (which also lives under the same testid
    // namespace) cannot match by accident.
    const langTrigger = menu.locator('[data-testid^="menu-lang-"]').first().or(
      menu.getByRole("menuitem").filter({ hasText: /Language|اللغة|Sprache|Langue/ }),
    );
    await langTrigger.first().hover();
    const germanItem = page.locator('[data-testid="menu-lang-de"]');
    await expect(germanItem).toBeVisible({ timeout: 5_000 });
    await germanItem.click();

    // Confirm the server actually persisted the change.
    const patchResp = await profilePatch;
    expect(patchResp.status()).toBe(200);

    // The cached `['/api/auth/user']` query must refetch — that's the
    // contract the mutation's `onSuccess` invalidate is supposed to
    // honour. We assert via the request counter (incremented above) that
    // at least one extra GET to /api/auth/user fires after the PATCH.
    await expect
      .poll(() => userFetchCount, {
        timeout: 5_000,
        message: "useAuth should refetch /api/auth/user after language change",
      })
      .toBeGreaterThan(fetchesBeforeChange);

    // The server row reports German — this is the data the refreshed
    // cache now holds. We bypass the SPA cache and ask the server
    // directly so this assertion stays stable even if the SPA changes
    // how it surfaces preferredLocale internally.
    const userAfter = await page.request.get("/api/auth/user");
    expect(userAfter.status()).toBe(200);
    expect((await userAfter.json())?.preferredLocale).toBe("de");

    // Reload — the choice must still be applied at the source of truth
    // *and* visible in the rendered dashboard. The topbar persists the
    // user's locale preference into the user row, and `LocaleSync`
    // honours that preference over the workspace-level fallback so the
    // German UI stays put across reloads.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="app-topbar"]')).toBeVisible({
      timeout: 15_000,
    });
    const userAfterReload = await page.request.get("/api/auth/user");
    expect(userAfterReload.status()).toBe(200);
    expect((await userAfterReload.json())?.preferredLocale).toBe("de");

    // The visible UI must also reflect the user's choice, not the
    // workspace's `settings.locale` (which defaults to Arabic). We
    // assert three independent surfaces so a regression in any one of
    // them — the document attributes, the i18n dictionary lookup, or
    // the localStorage seeding inside `LocaleProvider` — fails the
    // test loudly:
    //
    //   1. `<html lang="de">` and `<html dir="ltr">` — driven by the
    //      `LocaleProvider` effect that mirrors the in-memory locale
    //      onto the document.
    //   2. The sidebar's "Dashboard" entry renders the German label
    //      "Übersicht" — driven by the `useT()` translator. This is
    //      the key signal the original bug regressed: the document
    //      attributes might have flipped to German briefly, but the
    //      sidebar copy then snapped back to Arabic when `LocaleSync`
    //      re-applied the org default.
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "de", { timeout: 10_000 });
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(
      page.locator('[data-testid="sidebar-link-nav_dashboard"]'),
    ).toContainText("Übersicht", { timeout: 10_000 });
  });
});
