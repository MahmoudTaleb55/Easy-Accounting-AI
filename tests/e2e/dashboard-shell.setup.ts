import { test as setup, expect } from "@playwright/test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore — express-session ships these without bundled types
import cookieSignature from "cookie-signature";
// @ts-ignore
import uidSafe from "uid-safe";

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
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const TEST_EMAIL = "e2e-dashboard@example.test";
const TEST_PASSWORD = "playwright-dashboard-pw-2025";
const STORAGE_PATH = path.resolve(".playwright/dashboard-state.json");

setup("authenticate + seed dashboard fixtures", async ({ page, request }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the dashboard-shell setup.");
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set for the dashboard-shell setup to sign the connect.sid cookie.",
    );
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [TEST_EMAIL])
    ).rows[0];
    if (existing) {
      userId = existing.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name='E2E', last_name='Dashboard' WHERE id=$2`,
        [passwordHash, userId],
      );
    } else {
      userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
         VALUES ($1, $2, $3, 'E2E', 'Dashboard', 'en')`,
        [userId, TEST_EMAIL, passwordHash],
      );
    }

    // ---- (b) Ensure the user has at least one workspace they own ----
    // Roles use the canonical enum (owner|accountant|viewer) — see
    // shared/models/auth.ts and migration 0003. Legacy 'admin' rows that
    // pre-date that migration are normalised back to 'owner' on every
    // boot by `unifyRoleEnumOnStartup`, so seeding 'owner' here keeps
    // the setup idempotent across runs.
    let companyRow = (
      await client.query(
        `SELECT c.id FROM memberships m
         JOIN companies c ON c.id = m.company_id
         WHERE m.user_id = $1 AND m.role = 'owner'
         ORDER BY m.created_at ASC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (!companyRow) {
      // Adopt an orphan seed company if available, else create a fresh one.
      const orphan = (
        await client.query(
          `SELECT id FROM companies WHERE owner_user_id IS NULL ORDER BY id ASC LIMIT 1`,
        )
      ).rows[0];
      if (orphan) {
        await client.query(`UPDATE companies SET owner_user_id=$1 WHERE id=$2`, [userId, orphan.id]);
        companyRow = orphan;
      } else {
        companyRow = (
          await client.query(
            `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
             VALUES ('E2E Dashboard Co', $1, 'USD', '$', true)
             RETURNING id`,
            [userId],
          )
        ).rows[0];
      }
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), userId, companyRow.id],
      );
    }
    const companyId = Number(companyRow.id);

    // ---- (c) Seed a deterministic transaction set ----
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [companyId]);
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

  // ---- (e) Forge a passport session row + connect.sid cookie ----
  // The session cookie is `Secure`, which a browser refuses to retain over
  // an HTTP test server. We sidestep that by inserting the session row
  // ourselves (matching express-session's `connect-pg-simple` schema) and
  // signing the cookie with the same SESSION_SECRET the server uses.
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
          first_name: "E2E",
          last_name: "Dashboard",
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
  const signedSid = "s:" + cookieSignature.sign(sessionId, COOKIE_SECRET!);

  // ---- (f) Plant the session cookie in the browser context ----
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await page.context().addCookies([
    {
      name: "connect.sid",
      value: signedSid,
      url: baseURL,
      // We deliberately store the cookie as non-Secure so the local HTTP
      // test server still receives it — the server only enforces Secure
      // on the *outbound* Set-Cookie, not on inbound requests.
      sameSite: "Lax",
    },
  ]);

  // ---- (g) Confirm the session is real before saving storageState ----
  const userIdVar = userId; // capture for closure
  const me = await page.request.get("/api/auth/user");
  if (me.status() !== 200) {
    const cookies = await page.context().cookies();
    throw new Error(
      `Expected /api/auth/user to be 200 after session injection but got ${me.status()}.\n` +
        `userId=${userIdVar} sid=${sessionId}\n` +
        `Context cookies: ${JSON.stringify(cookies)}\n` +
        `Body: ${await me.text()}`,
    );
  }

  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_PATH });
});
