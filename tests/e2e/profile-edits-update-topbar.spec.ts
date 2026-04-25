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
 * End-to-end coverage for task #108 — when the user edits their profile
 * at /app/settings/profile, the topbar dropdown is supposed to reflect
 * the change immediately, with no full page reload. Two contracts are
 * pinned here:
 *
 *   1. Saving a new first/last name on the profile form updates the
 *      topbar's `[data-testid="text-user-name"]` without reloading the
 *      SPA. We prove the SPA stayed mounted by stamping a sentinel onto
 *      `window` before the edit and asserting it survives afterwards —
 *      a hard reload would wipe it.
 *
 *   2. Uploading a new avatar from the profile dropzone bumps the
 *      topbar avatar's `<img src>` to the freshly-stored
 *      /objects/avatars/... URL, again with no full reload.
 *
 * Background drift note (kept in the test rather than buried in a
 * commit so future readers see it next to the assertion):
 * The original task description referenced an "avatar URL" text input
 * with a `[data-testid="error-profile-image-url"]` inline validator.
 * Task #106 replaced that legacy URL input with the file dropzone the
 * profile page ships today, so this spec exercises the upload path
 * instead. We still pin the legacy input as gone (count === 0) so any
 * future regression that brings it back without a wired-up validator
 * fails this test loudly.
 */

const TEST_EMAIL = "e2e-profile-topbar@example.test";
const TEST_PASSWORD = "playwright-profile-topbar-pw-2026";
const TEST_FIRST = "Original";
const TEST_LAST = "Initial";
const STORAGE_PATH = path.resolve(".playwright/profile-edits-topbar-state.json");

// A real (tiny) 1×1 PNG — same buffer the avatar-upload spec uses. Decoded
// from base64 so the test never depends on runtime canvas/image generation
// or on a fixture file being present on disk.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

async function seedAndLogin(page: Page): Promise<{ userId: string }> {
  const dbUrl = requireDbUrl("the profile-edits-update-topbar spec");
  const client = new pg.Client({ connectionString: dbUrl });
  let userId: string;
  await client.connect();
  try {
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
    });
    await ensureCompany(client, {
      userId,
      companyName: "Profile Edits Topbar Co",
    });
    // Reset the avatar so the run starts from a known, image-less state
    // regardless of what a previous run left behind.
    await client.query(
      `UPDATE users SET profile_image_url = NULL WHERE id = $1`,
      [userId],
    );
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
  });

  return { userId };
}

test.describe("profile edits flow into the topbar", () => {
  // The topbar is `hidden md:flex` — at the default 360px mobile viewport
  // the bottom-tab layout takes over and the dropdown we're asserting
  // against simply isn't mounted. Force a desktop width so the topbar is
  // the active chrome.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("first/last name and avatar updates surface in the topbar without a reload", async ({
    page,
  }) => {
    await seedAndLogin(page);

    // Force English so the toast/save button assertions don't have to
    // double up for Arabic.
    await page.addInitScript(() => {
      window.localStorage.setItem("app.locale", "en");
      window.localStorage.setItem("app.theme", "light");
    });

    await page.goto("/app/settings/profile", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="card-profile"]')).toBeVisible({
      timeout: 15_000,
    });

    // Pin the legacy URL input as removed. The original task description
    // referenced this input + an inline error testid, but the profile
    // page now uses a file dropzone (see drift note at the top of this
    // file). If a future change brings the URL input back without a
    // wired validator, this assertion catches it.
    await expect(
      page.locator('[data-testid="input-profile-image-url"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="error-profile-image-url"]'),
    ).toHaveCount(0);

    // Plant a sentinel on window so we can prove the SPA never did a
    // full reload between the edit and the topbar assertion. A hard
    // navigation would wipe `__profileEditSentinel`; a client-side
    // cache update keeps it around.
    await page.evaluate(() => {
      (window as unknown as { __profileEditSentinel?: number })
        .__profileEditSentinel = Date.now();
    });

    // ── 1. Open the topbar dropdown and capture the *original* identity ──
    const profileBtn = page.locator('[data-testid="button-profile"]');
    await profileBtn.click();
    let menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="text-user-name"]')).toHaveText(
      `${TEST_FIRST} ${TEST_LAST}`,
    );
    // Close the menu before interacting with the form behind it.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // ── 2. Edit first/last name and save ─────────────────────────────────
    const NEW_FIRST = "Renamed";
    const NEW_LAST = "Player";
    const firstInput = page.locator('[data-testid="input-first-name"]');
    const lastInput = page.locator('[data-testid="input-last-name"]');
    await firstInput.fill(NEW_FIRST);
    await lastInput.fill(NEW_LAST);

    // The contract under test is "PATCH /api/auth/profile happens and
    // the topbar reflects it without a reload". Wait for the network
    // round-trip explicitly so we don't race the cache-seed.
    const profilePatch = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/profile") &&
        r.request().method() === "PATCH",
    );
    await page.locator('[data-testid="button-save-profile"]').click();
    const patchResp = await profilePatch;
    expect(patchResp.status()).toBe(200);
    const patchBody = await patchResp.json();
    expect(patchBody.firstName).toBe(NEW_FIRST);
    expect(patchBody.lastName).toBe(NEW_LAST);

    // The card itself is bound to the same `useAuth` user, so it's a
    // good cheap signal that the React Query cache flipped over before
    // we re-open the topbar dropdown.
    await expect(page.locator('[data-testid="text-profile-name"]')).toHaveText(
      `${NEW_FIRST} ${NEW_LAST}`,
    );

    // ── 3. Topbar dropdown reflects the new name (no reload) ─────────────
    await profileBtn.click();
    menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="text-user-name"]')).toHaveText(
      `${NEW_FIRST} ${NEW_LAST}`,
    );

    // The sentinel must still be on `window` — proves the SPA did not
    // do a full reload between the form submit and this assertion.
    const sentinelAfterName = await page.evaluate(
      () =>
        (window as unknown as { __profileEditSentinel?: number })
          .__profileEditSentinel,
    );
    expect(typeof sentinelAfterName).toBe("number");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // ── 4. Upload an avatar from the dropzone ────────────────────────────
    const avatarPost = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/profile/avatar") &&
        r.request().method() === "POST",
    );
    await page.locator('[data-testid="input-avatar-file"]').setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    });
    const avatarResp = await avatarPost;
    expect(avatarResp.status()).toBe(200);
    const avatarBody = await avatarResp.json();
    const newAvatarUrl: string = avatarBody.profileImageUrl;
    expect(newAvatarUrl).toMatch(/^\/objects\/avatars\//);

    // ── 5. Topbar avatar <img src> updates without a reload ──────────────
    // The trigger button renders a 7×7 Avatar with an <img> bound to
    // `user.profileImageUrl`. Once React Query flips the cache the
    // <AvatarImage> mounts inside the trigger.
    const triggerImg = profileBtn.locator("img");
    await expect(triggerImg).toHaveAttribute("src", newAvatarUrl, {
      timeout: 10_000,
    });

    // The dropdown also renders a larger 9×9 avatar in its label row;
    // both should resolve to the same fresh URL.
    await profileBtn.click();
    menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible();
    const menuImg = menu.locator("img");
    await expect(menuImg).toHaveAttribute("src", newAvatarUrl);

    // Sentinel still alive → the avatar update also did not trigger a
    // full reload.
    const sentinelAfterAvatar = await page.evaluate(
      () =>
        (window as unknown as { __profileEditSentinel?: number })
          .__profileEditSentinel,
    );
    expect(sentinelAfterAvatar).toBe(sentinelAfterName);
  });
});
