import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Response } from "express";

/**
 * M1 verification — avatar storage against REAL S3 (through the app's own
 * functions). Companion to document-storage-s3.test.ts.
 *
 * Exercises the real exported avatar-storage functions end-to-end:
 *   saveAvatarFile  -> PutObject (private, SSE-AES256), returns /objects URL
 *   serveAvatar     -> GetObject, streams exact bytes + correct Content-Type
 *   missing avatar  -> serveAvatar throws { code: "NOT_FOUND" }
 *   pruning         -> uploading a new avatar for the same user removes the old
 *
 * Gated on OBJECT_STORAGE_PROVIDER=s3 + AWS_S3_BUCKET; skips cleanly otherwise.
 * Run under the non-root easy-accounting-dev IAM profile so a pass also proves
 * the least-privilege policy (incl. s3:ListBucket, used by avatar pruning).
 */

const S3_CONFIGURED =
  process.env.OBJECT_STORAGE_PROVIDER === "s3" &&
  Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_S3_BUCKET.trim());

const d = S3_CONFIGURED ? describe : describe.skip;

const TAG = `s3av_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_USER_ID = `test-user-${TAG}`;

// Smallest valid PNGs (distinct bytes -> distinct sha256 -> distinct keys).
// 1x1 red and 1x1 blue PNGs.
const PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let avatarStorage: typeof import("../services/avatar-storage");

/** Minimal Express Response stub that captures headers + the body buffer. */
function makeResStub(): { res: Response; getBody: () => Buffer | null; getHeader: (k: string) => string | undefined } {
  const headers: Record<string, string> = {};
  let body: Buffer | null = null;
  const res = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(chunk?: Buffer) {
      if (chunk) body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    },
  } as unknown as Response;
  return {
    res,
    getBody: () => body,
    getHeader: (k: string) => headers[k.toLowerCase()],
  };
}

beforeAll(async () => {
  if (!S3_CONFIGURED) return;
  avatarStorage = await import("../services/avatar-storage");
});

afterAll(async () => {
  // The last upload's prune sweep removes prior avatars for this user; the
  // final avatar is left behind. Best-effort: we can't easily delete it via
  // the public API (no delete export), so uploads live under a unique
  // per-test user id to avoid clutter. Nothing to assert here.
});

d("avatar-storage against real S3 (M1)", () => {
  it("uploads a private avatar and serves the exact bytes back", async () => {
    const saved = await avatarStorage.saveAvatarFile({
      userId: TEST_USER_ID,
      buffer: PNG_RED,
      mimeType: "image/png",
    });
    // Public-facing URL goes through the authenticated backend route, not a
    // public bucket URL.
    expect(saved.publicUrl).toContain(`/objects/avatars/`);
    expect(saved.objectName).toMatch(/^avatars\/.+\/[0-9a-f]{64}\.png$/);

    const { res, getBody, getHeader } = makeResStub();
    await avatarStorage.serveAvatar(saved.publicUrl, res);
    const body = getBody();
    expect(body).not.toBeNull();
    expect(Buffer.compare(body!, PNG_RED)).toBe(0);
    expect(getHeader("content-type")).toBe("image/png");
  });

  it("throws NOT_FOUND when serving a missing avatar", async () => {
    const missing = `/objects/avatars/${encodeURIComponent(TEST_USER_ID)}/${"0".repeat(64)}.png`;
    let caught: any = null;
    try {
      const { res } = makeResStub();
      await avatarStorage.serveAvatar(missing, res);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("NOT_FOUND");
  });

  it("prunes the previous avatar when a new one is uploaded for the same user", async () => {
    // First avatar (red).
    const first = await avatarStorage.saveAvatarFile({
      userId: TEST_USER_ID,
      buffer: PNG_RED,
      mimeType: "image/png",
    });
    // Second avatar (blue) — different bytes, different key; prune should
    // delete the red one.
    const second = await avatarStorage.saveAvatarFile({
      userId: TEST_USER_ID,
      buffer: PNG_BLUE,
      mimeType: "image/png",
    });
    expect(second.objectName).not.toBe(first.objectName);

    // The new one is served.
    const live = makeResStub();
    await avatarStorage.serveAvatar(second.publicUrl, live.res);
    expect(Buffer.compare(live.getBody()!, PNG_BLUE)).toBe(0);

    // The old one is gone (pruned).
    let caught: any = null;
    try {
      const stale = makeResStub();
      await avatarStorage.serveAvatar(first.publicUrl, stale.res);
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBe("NOT_FOUND");
  });
});
