import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
// @ts-ignore — express-session ships these without bundled types
import cookieSignature from "cookie-signature";
// @ts-ignore
import uidSafe from "uid-safe";

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
 *   5. After a full page reload, `/api/auth/user` still returns
 *      `preferredLocale: 'de'` — proving the choice survives reload at
 *      the source-of-truth level. (The visible RTL/LTR + sidebar copy
 *      on the dashboard is driven separately by `LocaleSync` reading
 *      org settings, so we deliberately do not assert on `<html lang>`
 *      after reload — that would be testing a different system.)
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const TEST_EMAIL = "e2e-topbar-lang@example.test";
const TEST_PASSWORD = "playwright-topbar-lang-pw-2025";
const TEST_FIRST = "Playwright";
const TEST_LAST = "Lang";

async function injectFreshSession(page: Page): Promise<{ userId: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the language test.");
  if (!COOKIE_SECRET) throw new Error("SESSION_SECRET must be set for the language test.");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  try {
    // Idempotently ensure the language test user exists, and crucially
    // *reset* their preferred_locale to 'en' on every run so the test
    // is independent of prior runs that may have flipped it to German.
    // The legacy `workspace_members` mirror table was retired in
    // 2026-04 (migration 0006) so we do *not* mint a `wm_id` cookie —
    // the modern auth layer reads identity straight off the passport
    // session row we forge below.
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [TEST_EMAIL])
    ).rows[0];
    if (existing) {
      userId = existing.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name=$2, last_name=$3, preferred_locale='en' WHERE id=$4`,
        [passwordHash, TEST_FIRST, TEST_LAST, userId],
      );
    } else {
      userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
         VALUES ($1, $2, $3, $4, $5, 'en')`,
        [userId, TEST_EMAIL, passwordHash, TEST_FIRST, TEST_LAST],
      );
    }

    // The topbar's `changeLanguage` only PATCHes the profile when the
    // signed-in user has an active workspace role — `useAuth` derives
    // `role` from the active membership. Ensure the test user owns at
    // least one workspace so the mutation actually fires.
    const existingMembership = (
      await client.query(
        `SELECT c.id FROM memberships m
         JOIN companies c ON c.id = m.company_id
         WHERE m.user_id = $1 AND m.role = 'owner'
         ORDER BY m.created_at ASC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (!existingMembership) {
      const company = (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
           VALUES ($1, $2, 'USD', '$', true)
           RETURNING id`,
          ["Playwright Lang Co", userId],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), userId, company.id],
      );
    }
  } finally {
    await client.end();
  }

  const sessionId = await uidSafe(24);
  const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
  const sessionExpire = new Date(Date.now() + sessionTtlMs);
  const sessionPayload = {
    cookie: {
      originalMaxAge: sessionTtlMs,
      expires: sessionExpire.toISOString(),
      httpOnly: true,
      path: "/",
      secure: true,
    },
    passport: {
      user: {
        _local: true,
        claims: {
          sub: userId,
          email: TEST_EMAIL,
          first_name: TEST_FIRST,
          last_name: TEST_LAST,
          profile_image_url: null,
        },
      },
    },
  };
  const reopen = new pg.Client({ connectionString: dbUrl });
  await reopen.connect();
  try {
    await reopen.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::json, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sessionId, JSON.stringify(sessionPayload), sessionExpire],
    );
  } finally {
    await reopen.end();
  }
  const signedSid = "s:" + cookieSignature.sign(sessionId, COOKIE_SECRET);

  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "connect.sid", value: signedSid, url: baseURL, sameSite: "Lax" },
  ]);

  const me = await page.request.get("/api/auth/user");
  if (me.status() !== 200) {
    throw new Error(
      `Expected /api/auth/user to be 200 after session injection but got ${me.status()}: ${await me.text()}`,
    );
  }

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

    // Reload — the choice must still be applied at the source of truth.
    // The topbar persists the user's locale preference into the user
    // row; that is what survives the reload regardless of whatever
    // workspace-level locale fallback `LocaleSync` later applies on top.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="app-topbar"]')).toBeVisible({
      timeout: 15_000,
    });
    const userAfterReload = await page.request.get("/api/auth/user");
    expect(userAfterReload.status()).toBe(200);
    expect((await userAfterReload.json())?.preferredLocale).toBe("de");
  });
});
