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
 * End-to-end coverage for task #106 — uploading an avatar from the profile
 * page (instead of pasting a publicly-reachable image URL).
 *
 * The contract pinned here:
 *
 *   1. The legacy "Profile image URL" text input is gone — non-technical
 *      users would never have a public URL to paste.
 *   2. POST /api/auth/profile/avatar accepts a multipart upload, stores
 *      the bytes in object storage, and returns the updated user with
 *      `profileImageUrl` pointing at /objects/avatars/<userId>/<sha>.<ext>.
 *   3. That URL is then served back by GET /objects/:objectPath(*) with
 *      the right content type so the topbar avatar can render it. The
 *      object is stamped with a public ACL so it works without a session.
 *   4. The server rejects non-image MIME types with 400 + a clear message.
 *   5. The server rejects > 2 MB uploads with 400 + a clear message.
 *   6. PATCH /api/auth/profile { profileImageUrl: null } clears the image
 *      and the "Remove photo" button drives that path from the UI.
 *
 * A regression in any of these would silently degrade the profile page
 * (the rest of the dashboard would keep rendering), which is exactly the
 * shape of bug an e2e probe is best at catching.
 */

const TEST_EMAIL = "e2e-avatar@example.test";
const TEST_PASSWORD = "playwright-avatar-pw-2026";
const TEST_FIRST = "Avatar";
const TEST_LAST = "Tester";
const STORAGE_PATH = path.resolve(".playwright/avatar-upload-state.json");

// A real (tiny) 1×1 PNG. Decoded from base64 so the test never depends on
// runtime canvas/image generation.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

async function seedAndLogin(page: Page): Promise<{ userId: string }> {
  const dbUrl = requireDbUrl("the avatar-upload spec");
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
    await ensureCompany(client, {
      userId,
      companyName: "Avatar Upload Test Co",
    });
    // Reset the avatar so each run starts from a known clean slate
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

test.describe("profile avatar upload", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("uploads, serves, validates, and removes the avatar", async ({ page }) => {
    const { userId } = await seedAndLogin(page);

    // Force English so the toast assertions don't rely on Arabic text.
    await page.addInitScript(() => {
      window.localStorage.setItem("app.locale", "en");
      window.localStorage.setItem("app.theme", "light");
    });

    await page.goto("/app/settings/profile", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="card-profile"]')).toBeVisible({
      timeout: 15_000,
    });

    // The legacy URL input must be gone — that was the whole point of the
    // task. If a future regression brings it back the test fails loudly.
    await expect(
      page.locator('[data-testid="input-profile-image-url"]'),
    ).toHaveCount(0);

    const chooseBtn = page.locator('[data-testid="button-choose-photo"]');
    await expect(chooseBtn).toBeVisible();
    await expect(page.locator('[data-testid="dropzone-avatar"]')).toBeVisible();

    // ── Happy path: upload a 1×1 PNG ──────────────────────────────────────
    const fileInput = page.locator('[data-testid="input-avatar-file"]');
    await fileInput.setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    });

    // Picking a file no longer uploads directly — it opens a crop modal.
    // Confirm the cropper is up, then commit the (un-zoomed) crop.
    await expect(page.locator('[data-testid="dialog-avatar-cropper"]')).toBeVisible({
      timeout: 5_000,
    });
    await page.locator('[data-testid="button-cropper-confirm"]').click();

    // Wait for the avatar mutation to land — easiest proxy is the user
    // probe returning a non-null profileImageUrl.
    await expect
      .poll(
        async () => {
          const r = await page.request.get("/api/auth/user");
          if (r.status() !== 200) return null;
          const body = await r.json();
          return body.profileImageUrl as string | null;
        },
        { timeout: 10_000 },
      )
      .toMatch(/^\/objects\/avatars\//);

    const after = await page.request.get("/api/auth/user").then((r) => r.json());
    const avatarUrl: string = after.profileImageUrl;
    expect(avatarUrl.startsWith(`/objects/avatars/${encodeURIComponent(userId)}/`)).toBe(true);

    // Serving route returns the bytes with the right content type. The
    // body length will NOT match the original 1×1 PNG: the client now
    // re-encodes the cropped 512×512 region as a fresh PNG before upload.
    const fetched = await page.request.get(avatarUrl);
    expect(fetched.status()).toBe(200);
    expect(fetched.headers()["content-type"]).toBe("image/png");
    const fetchedBody = await fetched.body();
    expect(fetchedBody.length).toBeGreaterThan(0);
    // PNG signature — proves the served bytes are still a valid PNG.
    expect(fetchedBody.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    // Avatars are stored with a public ACL — anonymous (no-cookie) clients
    // can render them. This is the contract the topbar <img> relies on.
    const anon = await page.context().browser()!.newContext();
    try {
      const direct = await anon.request.get(
        new URL(avatarUrl, page.url()).toString(),
      );
      expect(direct.status()).toBe(200);
      expect(direct.headers()["content-type"]).toBe("image/png");
    } finally {
      await anon.close();
    }

    // Reload — "Remove photo" only renders once an avatar is set.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="button-remove-photo"]')).toBeVisible({
      timeout: 10_000,
    });

    // ── Server-side validation: non-image MIME ────────────────────────────
    const txt = await page.request.post("/api/auth/profile/avatar", {
      multipart: {
        file: {
          name: "note.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello world", "utf8"),
        },
      },
    });
    expect(txt.status()).toBe(400);
    expect((await txt.json()).message).toMatch(/image uploads/i);

    // ── Server-side validation: forged Content-Type (task #146) ───────────
    // A motivated user can rename a script `.png` and lie about the
    // mimeType in the multipart envelope. The server must sniff the
    // actual bytes and reject anything that isn't really one of our four
    // accepted image formats — otherwise the bytes would land in object
    // storage and be re-served as `Content-Type: image/png`.
    const renamedText = await page.request.post("/api/auth/profile/avatar", {
      multipart: {
        file: {
          name: "totally-an-image.png",
          mimeType: "image/png",
          buffer: Buffer.from("#!/bin/sh\necho not really a png\n", "utf8"),
        },
      },
    });
    expect(renamedText.status()).toBe(400);
    expect((await renamedText.json()).message).toMatch(/image uploads/i);

    // The forged upload must NOT have changed the stored avatar URL.
    const stillSame = await page.request
      .get("/api/auth/user")
      .then((r) => r.json());
    expect(stillSame.profileImageUrl).toBe(avatarUrl);

    // Same idea but with the JPEG MIME claim and a text body — covers
    // the second branch of the magic-bytes check.
    const renamedJpeg = await page.request.post("/api/auth/profile/avatar", {
      multipart: {
        file: {
          name: "selfie.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("not a jpeg either, just plain text", "utf8"),
        },
      },
    });
    expect(renamedJpeg.status()).toBe(400);
    expect((await renamedJpeg.json()).message).toMatch(/image uploads/i);

    // ── Server-side validation: > 2 MB image ──────────────────────────────
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1024, 0xff); // ~2.001 MB
    const big = await page.request.post("/api/auth/profile/avatar", {
      multipart: {
        file: { name: "big.png", mimeType: "image/png", buffer: huge },
      },
    });
    expect(big.status()).toBe(400);
    expect((await big.json()).message).toMatch(/2 MB/i);

    // ── Defence in depth: the public proxy is scoped to avatars/ only ─────
    // Other private object classes (e.g. /objects/uploads/<id>) must not be
    // serveable through the same route, even with a valid session.
    const stray = await page.request.get("/objects/uploads/whatever.bin");
    expect(stray.status()).toBe(404);

    // A path-traversal attempt that climbs out of avatars/ via segments
    // must also fail (the entityId is parsed verbatim — no resolution).
    const traversal = await page.request.get(
      "/objects/avatars/../private-thing",
    );
    expect([400, 404]).toContain(traversal.status());

    // ── Remove path ───────────────────────────────────────────────────────
    await page.locator('[data-testid="button-remove-photo"]').click();
    await expect
      .poll(
        async () => {
          const r = await page.request.get("/api/auth/user");
          const body = await r.json();
          return body.profileImageUrl;
        },
        { timeout: 10_000 },
      )
      .toBeNull();

    // The Remove button should disappear once there's no avatar to remove.
    await expect(page.locator('[data-testid="button-remove-photo"]')).toHaveCount(0);
  });
});
