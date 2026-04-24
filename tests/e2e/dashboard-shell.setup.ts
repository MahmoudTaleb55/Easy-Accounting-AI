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
 * One-time auth + seed setup for the dashboard-shell spec.
 *
 * Why a setup project instead of `beforeAll`?
 * - The signup endpoint is rate-limited to 8/hour per IP, so we must not
 *   re-sign-up on every test or worker.
 * - We want a stable user + transaction set so the visual snapshots and
 *   contrast checks have something to render against.
 *
 * What this does:
 *   1. Inserts the dashboard test user directly into the DB with a bcrypt
 *      password hash (skips the signup rate limit entirely).
 *   2. Ensures the user owns a workspace via a `memberships` row — that
 *      single canonical row is what the server reads to derive role on
 *      every request (the legacy `workspace_members` mirror was retired).
 *   3. Forges a passport session row + signs the connect.sid cookie so the
 *      browser context is "logged in" without ever calling /api/auth/signin.
 *   4. Seeds a small set of transactions so the KPI strip + Recent Activity
 *      have data to render.
 *   5. Saves the resulting cookies to `.playwright/dashboard-state.json`,
 *      which the dashboard-shell spec then reuses via `storageState`.
 *
 * The auth-cookie + session-row machinery in steps (2)/(3)/(5) lives in
 * `tests/e2e/_helpers/forge-session.ts` and is shared with other e2e
 * setups so cookie-name / secret-rotation / schema changes only need to
 * be made in one place.
 */

const TEST_EMAIL = "e2e-dashboard@example.test";
const TEST_PASSWORD = "playwright-dashboard-pw-2025";
const STORAGE_PATH = path.resolve(".playwright/dashboard-state.json");

setup("authenticate + seed dashboard fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the dashboard-shell setup");
  requireCookieSecret("the dashboard-shell setup");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "E2E",
      lastName: "Dashboard",
    });

    // ---- (b) Ensure the user has at least one workspace they own ----
    // Roles use the canonical enum (owner|accountant|viewer) — see
    // shared/models/auth.ts and migration 0003. Legacy 'admin' rows that
    // pre-date that migration are normalised back to 'owner' on every
    // boot by `unifyRoleEnumOnStartup`, so seeding 'owner' here keeps
    // the setup idempotent across runs.
    const companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E Dashboard Co",
      adoptOrphan: true,
    });

    // ---- (c) Seed a deterministic transaction set ----
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [
      companyId,
    ]);
    await client.query(
      `INSERT INTO transactions (company_id, type, amount, description, category) VALUES
       ($1, 'income',  '5000.00', 'Consulting revenue', 'Revenue'),
       ($1, 'expense', '1200.00', 'Office rent',        'Rent'),
       ($1, 'expense',  '320.00', 'Cloud hosting',      'SaaS'),
       ($1, 'income',   '850.00', 'Workshop fee',       'Revenue')`,
      [companyId],
    );
  } finally {
    await client.end();
  }

  // ---- (d) Forge a passport session + plant the cookie + persist state ----
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: "E2E",
    lastName: "Dashboard",
    storagePath: STORAGE_PATH,
  });
});
