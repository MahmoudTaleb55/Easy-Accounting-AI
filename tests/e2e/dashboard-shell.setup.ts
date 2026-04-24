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
 *   1. Mints the workspace-owner cookie that the legacy RBAC layer
 *      (server/auth.ts) demands for any write — signed with SESSION_SECRET.
 *   2. Inserts the dashboard test user directly into the DB with a bcrypt
 *      password hash (skips the signup rate limit entirely).
 *   3. Signs in over HTTP to populate the passport session cookie.
 *   4. Seeds a small set of transactions so the KPI strip + Recent Activity
 *      have data to render.
 *   5. Saves the resulting cookies to `.playwright/dashboard-state.json`,
 *      which the dashboard-shell spec then reuses via `storageState`.
 */

const COOKIE_NAME = "wm_id";
const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const TEST_EMAIL = "e2e-dashboard@example.test";
const TEST_PASSWORD = "playwright-dashboard-pw-2025";
const STORAGE_PATH = path.resolve(".playwright/dashboard-state.json");

function signMemberId(id: number): string {
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set for the dashboard test to mint a workspace-owner cookie.",
    );
  }
  const sig = crypto
    .createHmac("sha256", COOKIE_SECRET)
    .update(String(id))
    .digest("hex")
    .slice(0, 32);
  return `${id}.${sig}`;
}

setup("authenticate + seed dashboard fixtures", async ({ page, request }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the dashboard-shell setup.");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let ownerCookie: string;
  let userId: string;
  try {
    // ---- (a) Resolve / mint the legacy workspace-owner cookie ----
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

    // ---- (b) Ensure the test user exists with a known password ----
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

    // ---- (c) Ensure the user has at least one workspace they own ----
    let companyRow = (
      await client.query(
        `SELECT c.id FROM memberships m
         JOIN companies c ON c.id = m.company_id
         WHERE m.user_id = $1 AND m.role = 'admin'
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
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), userId, companyRow.id],
      );
    }
    const companyId = Number(companyRow.id);

    // ---- (d) Seed a deterministic transaction set ----
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

  // ---- (f) Plant both cookies (owner + session) in the browser context ----
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await page.context().addCookies([
    { name: COOKIE_NAME, value: ownerCookie, url: baseURL, sameSite: "Lax" },
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
