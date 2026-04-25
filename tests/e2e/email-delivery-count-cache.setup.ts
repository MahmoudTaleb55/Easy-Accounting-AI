import { test as setup } from "@playwright/test";
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
 * Dedicated auth + workspace setup for the email-delivery-count-cache
 * spec.
 *
 * The companion `email-delivery-count-cache.spec.ts` asserts on exact
 * counts produced by `GET /api/auth/email-deliveries/count`. The count
 * helper unions both invitation and password-reset email events for a
 * workspace, so any sibling spec writing rows into either table for the
 * same workspace would silently leak into our exact-count assertions
 * when Playwright runs spec projects in parallel.
 *
 * The original draft of this spec piggybacked on the workspace from
 * `email-delivery-alerts.setup.ts`, but `email-delivery-alerts.spec.ts`
 * also wipes / seeds those same tables for that same workspace, so the
 * two specs raced when their projects ran in parallel after the shared
 * setup completed. Provisioning a fully separate workspace + owner
 * here removes that race entirely.
 *
 * Mirrors the cookie-forging approach used by the sibling delivery
 * setups (forge a session row + signed connect.sid cookie, save a
 * storage state file the spec can `test.use({ storageState })`).
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const COMPANY_NAME = "E2E Delivery Count-Cache Co";
const OWNER_EMAIL = "e2e-edcc-owner@example.test";
const OWNER_PASSWORD = "playwright-edcc-pw-owner-2025";
const STORAGE_PATH = ".playwright/edcc-owner.json";
const FIXTURE_PATH = ".playwright/email-delivery-count-cache-fixture.json";

setup("authenticate + seed email-delivery-count-cache fixtures", async ({ page }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL must be set for the email-delivery-count-cache setup.",
    );
  }
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set so the email-delivery-count-cache setup can sign the connect.sid cookie.",
    );
  }

  let ownerUserId: string;
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // (a) Ensure the dedicated owner exists with a known password hash.
    //     Refresh the hash on every run so a rotated SESSION_SECRET
    //     can't strand the suite.
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const existingOwner = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [OWNER_EMAIL])
    ).rows[0];
    if (existingOwner) {
      ownerUserId = existingOwner.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name='E2E', last_name='Edcc-owner' WHERE id=$2`,
        [passwordHash, ownerUserId],
      );
    } else {
      ownerUserId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
         VALUES ($1, $2, $3, 'E2E', 'Edcc-owner', 'en')`,
        [ownerUserId, OWNER_EMAIL, passwordHash],
      );
    }

    // (b) Ensure the dedicated company exists, owned by the dedicated
    //     owner. Crucially, this company is *only* used by this spec —
    //     siblings never touch it, so the event log for this workspace
    //     stays deterministic.
    let companyRow = (
      await client.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [COMPANY_NAME])
    ).rows[0];
    if (companyRow) {
      companyId = Number(companyRow.id);
      await client.query(
        `UPDATE companies SET owner_user_id=$1, functional_currency='USD', currency_symbol='$', is_active=true WHERE id=$2`,
        [ownerUserId, companyId],
      );
    } else {
      companyRow = (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default, is_active)
           VALUES ($1, $2, 'USD', '$', false, true) RETURNING id`,
          [COMPANY_NAME, ownerUserId],
        )
      ).rows[0];
      companyId = Number(companyRow.id);
    }

    // (c) Owner membership in the dedicated workspace. The owner is the
    //     only member of this workspace, which is what makes the
    //     password-reset event seeds in the spec land squarely inside
    //     this workspace's count CTE (the CTE joins prt events to
    //     memberships on (user_id, company_id)).
    const existingMembership = (
      await client.query(
        `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
        [ownerUserId, companyId],
      )
    ).rows[0];
    if (existingMembership) {
      await client.query(`UPDATE memberships SET role = 'owner' WHERE id = $1`, [
        existingMembership.id,
      ]);
    } else {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'owner')`,
        [crypto.randomUUID(), ownerUserId, companyId],
      );
    }

    // Belt-and-braces: defensively delete any stray membership this
    // owner might have picked up in a *different* workspace from a
    // previous run (e.g. an earlier abandoned setup that planted them
    // in a shared company). Keeping the owner pinned to a single
    // membership keeps the server's "first membership" fallback honest
    // when the explicit x-company-id header is the only pin.
    await client.query(
      `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
      [ownerUserId, companyId],
    );
  } finally {
    await client.end();
  }

  // (d) Forge a session row + signed connect.sid cookie, then save a
  //     storage state the spec can `test.use({ storageState })`.
  const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  const sessionsClient = new pg.Client({ connectionString: dbUrl });
  await sessionsClient.connect();
  try {
    const sessionId = await uidSafe(24);
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
            sub: ownerUserId,
            email: OWNER_EMAIL,
            first_name: "E2E",
            last_name: "Edcc-owner",
            profile_image_url: null,
          },
        },
      },
    };
    await sessionsClient.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::json, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sessionId, JSON.stringify(sessionPayload), sessionExpire],
    );
    const signedSid = "s:" + cookieSignature.sign(sessionId, COOKIE_SECRET!);

    await page.context().clearCookies();
    await page.context().addCookies([
      { name: "connect.sid", value: signedSid, url: baseURL, sameSite: "Lax" },
    ]);

    // Confirm the session is real before saving — catches typos in the
    // payload shape and a wrong SESSION_SECRET.
    const me = await page.request.get("/api/auth/user");
    if (me.status() !== 200) {
      throw new Error(
        `/api/auth/user expected 200 for the count-cache owner but got ${me.status()}: ${await me.text()}`,
      );
    }

    const storagePath = path.resolve(STORAGE_PATH);
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    await page.context().storageState({ path: storagePath });
  } finally {
    await sessionsClient.end();
  }

  // (e) Persist the dedicated company id + owner user id so the spec can
  //     pin DB seeds (event inserts, count probes) to the right rows
  //     without rediscovering them on every test.
  const fixturePath = path.resolve(FIXTURE_PATH);
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({ companyId, ownerUserId }, null, 2),
  );
});
