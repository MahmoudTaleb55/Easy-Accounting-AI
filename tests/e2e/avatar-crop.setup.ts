import { test as setup } from "@playwright/test";
import path from "node:path";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * One-time auth + seed setup for the `avatar-crop` spec.
 *
 * Background — why a setup project instead of an inline `seedAndLogin`
 * helper inside the spec:
 *   • Lifts the test user + workspace insert into a single one-shot
 *     setup project so the spec stays focused on the cropper contract
 *     it pins.
 *   • Mirrors the dashboard-shell.setup.ts / journal-entry-deeplinks
 *     .setup.ts pattern other recent suites adopted, which keeps
 *     follow-up suites consistent.
 *
 * What this does:
 *   1. Inserts the avatar-crop test user with a known bcrypt password
 *      hash (skips the signup rate limit).
 *   2. Ensures the user owns at least one workspace via `memberships`.
 *   3. Resets `users.profile_image_url` to NULL so the spec always
 *      starts from a clean slate (the Cancel-must-not-upload assertion
 *      depends on the "Remove photo" button NOT being there yet).
 *   4. Forges a passport session, plants the signed `connect.sid`
 *      cookie into the browser context, verifies `/api/auth/user`
 *      returns 200, and persists the storage state to
 *      `.playwright/avatar-crop-state.json` for the spec to reuse via
 *      `storageState`.
 */

const TEST_EMAIL = "e2e-avatar-crop@example.test";
const TEST_PASSWORD = "playwright-avatar-crop-pw-2026";
const TEST_FIRST = "Crop";
const TEST_LAST = "Tester";
const STORAGE_PATH = path.resolve(".playwright/avatar-crop-state.json");

setup("authenticate + seed avatar-crop fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the avatar-crop setup");
  requireCookieSecret("the avatar-crop setup");

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
      role: "owner",
      companyName: "E2E Avatar Crop Co",
    });
    // Reset the avatar so the very first paint of /app/settings/profile
    // does NOT render the "Remove photo" button — the cancel-vs-confirm
    // assertions rely on that initial absence.
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
});
