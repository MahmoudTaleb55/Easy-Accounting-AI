import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * End-to-end coverage for task #197 — pin the avatar crop modal's
 * Cancel / Use-photo contract so it can't silently regress.
 *
 * The cropper was added in task #146 and verified manually with a
 * one-off browser test, but no committed regression test asserted the
 * two key user-visible promises:
 *
 *   1. Choosing a file opens the cropper modal
 *      (`data-testid="dialog-avatar-cropper"`).
 *   2. Clicking **Cancel** closes the modal WITHOUT firing a
 *      `POST /api/auth/profile/avatar`. A regression that wired Cancel
 *      to upload the un-cropped original (or that fired the multipart
 *      request before the user committed) would silently send bytes
 *      every time the user changed their mind.
 *   3. Re-picking the same file re-opens the cropper, and clicking
 *      **Use photo** sends a multipart `POST /api/auth/profile/avatar`
 *      whose response body wires up the "Remove photo" button on the
 *      profile page (the visual signal that an avatar is now stored).
 *
 * Task #246 extends the same guarantee to the two *implicit* dismissal
 * paths the shadcn/Radix `Dialog` exposes through its `onOpenChange`
 * handler in `client/src/components/profile/avatar-cropper.tsx`:
 *
 *   4. Pressing **Escape** while the cropper is open also closes it
 *      WITHOUT firing the avatar POST.
 *   5. Clicking the dialog **backdrop** (the dimmed overlay outside the
 *      content area) likewise closes the cropper WITHOUT firing the
 *      avatar POST.
 *
 * Both ESC and backdrop routes flow through the same
 * `onOpenChange={(open) => { if (!open && !isProcessing) onCancel(); }}`
 * branch as the Cancel button, so any regression that re-routes that
 * branch into the upload path (e.g. wiring `onOpenChange` to commit the
 * crop, or treating "open=false" as "user accepted") would silently
 * send bytes every time the user dismisses the modal.
 *
 * The spec deliberately uses a request listener (not just
 * `waitForResponse`) for every dismissal branch — the latter only
 * proves a matching request eventually arrived, while the former
 * proves none did within the observation window.
 *
 * Setup runs in `avatar-crop.setup.ts`; this spec just consumes the
 * `.playwright/avatar-crop-state.json` storage state.
 */

const AVATAR_POST_URL = /\/api\/auth\/profile\/avatar$/;

// A real (tiny) 1×1 PNG. Decoded from base64 so the test never depends
// on runtime canvas/image generation or a fixture file on disk.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

test.describe("avatar cropper Cancel / Use photo contract", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Cancel does not upload; Use photo uploads and shows Remove photo", async ({
    page,
  }) => {
    // Force English so test IDs are the only thing we assert against;
    // the locale only changes the visible strings, not the test IDs,
    // but pinning it removes one source of cross-test interference.
    await page.addInitScript(() => {
      window.localStorage.setItem("app.locale", "en");
      window.localStorage.setItem("app.theme", "light");
    });

    await page.goto("/app/settings/profile", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="card-profile"]')).toBeVisible({
      timeout: 15_000,
    });

    // The dropzone must be on the page. The file <input> is hidden by
    // CSS but `setInputFiles` doesn't require visibility.
    await expect(page.locator('[data-testid="dropzone-avatar"]')).toBeVisible();
    const fileInput = page.locator('[data-testid="input-avatar-file"]');

    // Sanity-check the starting state: the seed wipes profile_image_url
    // to NULL, so there must be NO "Remove photo" button on first paint.
    // If a previous run leaks an avatar in, the Use-photo assertion
    // below would still pass even if the upload silently no-op'd.
    await expect(
      page.locator('[data-testid="button-remove-photo"]'),
    ).toHaveCount(0);

    // ── 1. Pick the file → cropper opens ────────────────────────────────
    await fileInput.setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    });
    await expect(
      page.locator('[data-testid="dialog-avatar-cropper"]'),
    ).toBeVisible({ timeout: 5_000 });

    // ── 2. Cancel must NOT POST ─────────────────────────────────────────
    // Install a request listener BEFORE the click so any synchronous
    // POST fired by the Cancel handler is observable. Using
    // `waitForResponse` here would be wrong: a regression could fire
    // the POST asynchronously *after* the dialog closed and we'd miss
    // it. A counter that survives a brief settling window catches both
    // immediate and deferred regressions.
    let cancelLeakedAvatarPost = 0;
    const cancelListener = (req: Request) => {
      if (req.method() === "POST" && AVATAR_POST_URL.test(req.url())) {
        cancelLeakedAvatarPost += 1;
      }
    };
    page.on("request", cancelListener);

    await page.locator('[data-testid="button-cropper-cancel"]').click();
    await expect(
      page.locator('[data-testid="dialog-avatar-cropper"]'),
    ).toBeHidden();

    // Give the page a beat to flush any deferred fetch the cancel
    // handler might have queued. 750ms is comfortably above the React
    // commit + microtask drain window without slowing the suite.
    await page.waitForTimeout(750);
    page.off("request", cancelListener);
    expect(
      cancelLeakedAvatarPost,
      "Cancelling the cropper must not POST to /api/auth/profile/avatar",
    ).toBe(0);

    // The "Remove photo" button must STILL be absent — nothing was
    // uploaded, so there is nothing to remove.
    await expect(
      page.locator('[data-testid="button-remove-photo"]'),
    ).toHaveCount(0);

    // ── 3. Re-open the cropper and confirm ──────────────────────────────
    await fileInput.setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    });
    await expect(
      page.locator('[data-testid="dialog-avatar-cropper"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Wire the response listener BEFORE the click so we can assert on
    // the request that fires and the 200 it returns.
    const avatarPost = page.waitForResponse(
      (r) => r.request().method() === "POST" && AVATAR_POST_URL.test(r.url()),
      { timeout: 15_000 },
    );

    await page.locator('[data-testid="button-cropper-confirm"]').click();
    const avatarResp = await avatarPost;

    // The request must be a multipart upload (not a JSON URL post —
    // task #106 retired that legacy shape). `getHeader` is case-
    // insensitive in Playwright, but `headers()` returns lowercase
    // keys, so we read it directly.
    const reqHeaders = avatarResp.request().headers();
    expect(reqHeaders["content-type"]).toMatch(/^multipart\/form-data/);
    expect(avatarResp.status()).toBe(200);

    const body = await avatarResp.json();
    expect(body.profileImageUrl).toMatch(/^\/objects\/avatars\//);

    // ── 4. UI signal: "Remove photo" appears once an avatar is set ──────
    // The dialog auto-closes after onCropped fires; the profile page's
    // mutation onSuccess primes the user query, which causes the
    // Remove-photo button to render.
    await expect(
      page.locator('[data-testid="dialog-avatar-cropper"]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-testid="button-remove-photo"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Escape closes the cropper without POSTing", async ({ page }) => {
    // ── Setup: open the cropper from a clean profile page ────────────────
    await openCropperOnProfilePage(page);

    // ── Install the request counter BEFORE the dismissal ─────────────────
    // Same pattern as the Cancel-button branch above: a synchronous
    // listener is the only way to catch a regression that fires the
    // POST asynchronously *after* the dialog has already closed.
    const { stop, count } = installAvatarPostCounter(page);

    // ── Press Escape — Radix routes this through onOpenChange(false) ─────
    // which the cropper's handler funnels into onCancel().
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-testid="dialog-avatar-cropper"]'),
    ).toBeHidden();

    // 750ms matches the Cancel branch's settling window — comfortably
    // above React commit + microtask drain without slowing the suite.
    await page.waitForTimeout(750);
    stop();
    expect(
      count(),
      "Pressing Escape on the cropper must not POST to /api/auth/profile/avatar",
    ).toBe(0);
  });

  test("Backdrop click closes the cropper without POSTing", async ({
    page,
  }) => {
    // ── Setup: open the cropper from a clean profile page ────────────────
    await openCropperOnProfilePage(page);

    // ── Install the request counter BEFORE the dismissal ─────────────────
    // Mirrors the Cancel and Escape branches: a request listener proves
    // *no* matching request fired, which `waitForResponse` cannot.
    const { stop, count } = installAvatarPostCounter(page);

    // ── Click the dialog backdrop ────────────────────────────────────────
    // Radix renders the overlay as a sibling of the dialog content
    // inside a portal; clicking outside the content's bounding box
    // lands on the overlay, which fires onPointerDownOutside →
    // onOpenChange(false) → the cropper's onCancel() branch. We pick a
    // point well to the LEFT of the centred content (max-w-md ≈ 448px
    // inside a 1280-wide viewport) to stay inside the visible viewport
    // without overlapping any topbar/sidebar surface.
    const content = page.locator('[data-testid="dialog-avatar-cropper"]');
    const box = await content.boundingBox();
    if (!box) {
      throw new Error(
        "Could not measure the cropper dialog content; backdrop click cannot be targeted reliably.",
      );
    }
    const clickX = Math.max(10, Math.floor(box.x / 2));
    const clickY = Math.floor(box.y + box.height / 2);
    await page.mouse.click(clickX, clickY);

    await expect(
      page.locator('[data-testid="dialog-avatar-cropper"]'),
    ).toBeHidden();

    await page.waitForTimeout(750);
    stop();
    expect(
      count(),
      "Clicking the cropper backdrop must not POST to /api/auth/profile/avatar",
    ).toBe(0);
  });
});

/**
 * Navigate to the profile page and open the avatar cropper by feeding
 * the hidden file input a tiny in-memory PNG. Centralised so the ESC
 * and backdrop tests stay focused on the dismissal contract — the
 * "picking a file opens the cropper" behaviour is already locked down
 * by the Cancel/Use-photo test above.
 *
 * Pinning locale + theme matches the original test's reasoning: it
 * removes a source of cross-test interference without changing any
 * test ID the spec relies on.
 */
async function openCropperOnProfilePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("app.locale", "en");
    window.localStorage.setItem("app.theme", "light");
  });

  await page.goto("/app/settings/profile", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="card-profile"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="dropzone-avatar"]')).toBeVisible();

  await page.locator('[data-testid="input-avatar-file"]').setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: TINY_PNG_BUFFER,
  });
  await expect(
    page.locator('[data-testid="dialog-avatar-cropper"]'),
  ).toBeVisible({ timeout: 5_000 });
}

/**
 * Wire up a synchronous `request` listener that counts every
 * `POST /api/auth/profile/avatar` the page issues until `stop()` is
 * called. Returns both the stopper and a `count()` reader so the
 * caller can assert on the final tally after a settling window.
 *
 * Lives outside the Cancel test so the ESC and backdrop branches can
 * reuse the *exact* contract the original spec pinned: count POSTs
 * with a synchronous listener (not `waitForResponse`), then settle,
 * then assert zero.
 */
function installAvatarPostCounter(page: Page): {
  stop: () => void;
  count: () => number;
} {
  let leaked = 0;
  const listener = (req: Request) => {
    if (req.method() === "POST" && AVATAR_POST_URL.test(req.url())) {
      leaked += 1;
    }
  };
  page.on("request", listener);
  return {
    stop: () => page.off("request", listener),
    count: () => leaked,
  };
}
