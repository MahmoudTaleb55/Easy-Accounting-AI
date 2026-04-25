import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
// @ts-ignore — express-session ships these without bundled types
import cookieSignature from "cookie-signature";
// @ts-ignore
import uidSafe from "uid-safe";

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
 */

const COOKIE_NAME_OWNER = "wm_id";
const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const TEST_EMAIL = "e2e-topbar@example.test";
const TEST_PASSWORD = "playwright-topbar-pw-2025";
const TEST_FIRST = "Playwright";
const TEST_LAST = "Topbar";
const FULL_NAME = `${TEST_FIRST} ${TEST_LAST}`;

function signMemberId(id: number): string {
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set so the topbar test " +
        "can mint the legacy workspace-owner cookie.",
    );
  }
  const sig = crypto
    .createHmac("sha256", COOKIE_SECRET)
    .update(String(id))
    .digest("hex")
    .slice(0, 32);
  return `${id}.${sig}`;
}

/**
 * Mint a fresh signed-in session for the seeded test user and plant the
 * cookies in the given page's context. Returns the user id so the caller
 * can assert downstream calls (e.g. /api/auth/user) against the right
 * account. Mirrors the cookie-forging trick used by `dashboard-shell.setup.ts`
 * because the dev server's `connect.sid` is `Secure` and a browser would
 * otherwise refuse to retain it over HTTP.
 */
async function injectFreshSession(page: Page): Promise<{ userId: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the topbar profile test.");
  if (!COOKIE_SECRET) throw new Error("SESSION_SECRET must be set for the topbar profile test.");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let ownerCookie: string;
  let userId: string;
  try {
    // Workspace-owner cookie demanded by the legacy RBAC layer.
    let ownerRow = (
      await client.query(
        `SELECT id FROM workspace_members WHERE role='owner' AND status='active' ORDER BY id ASC LIMIT 1`,
      )
    ).rows[0];
    if (!ownerRow) {
      ownerRow = (
        await client.query(
          `INSERT INTO workspace_members (name, email, role, status)
           VALUES ('Playwright Owner', 'playwright-owner@workspace.local', 'owner', 'active')
           RETURNING id`,
        )
      ).rows[0];
    }
    ownerCookie = signMemberId(Number(ownerRow.id));

    // Idempotently ensure the topbar test user exists with a known name + password.
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [TEST_EMAIL])
    ).rows[0];
    if (existing) {
      userId = existing.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name=$2, last_name=$3 WHERE id=$4`,
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

    // The topbar reads `useCompany`, which falls back gracefully to no companies,
    // so we deliberately skip seeding a workspace here — the profile dropdown
    // renders independently of memberships and we want this test to stay
    // narrowly focused on the topbar contract.
  } finally {
    await client.end();
  }

  // Forge a passport session row + signed connect.sid cookie.
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
  // Wipe any stale session cookie left over from a prior test that signed
  // out — otherwise the browser would still send the killed sid alongside
  // the freshly-minted one and confuse the server.
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: COOKIE_NAME_OWNER, value: ownerCookie, url: baseURL, sameSite: "Lax" },
    { name: "connect.sid", value: signedSid, url: baseURL, sameSite: "Lax" },
  ]);

  // Sanity check — fail fast if the forged session was rejected.
  const me = await page.request.get("/api/auth/user");
  if (me.status() !== 200) {
    throw new Error(
      `Expected /api/auth/user to be 200 after session injection but got ${me.status()}: ${await me.text()}`,
    );
  }

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
      await injectFreshSession(page);
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
