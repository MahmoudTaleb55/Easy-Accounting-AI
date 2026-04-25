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
 * Dedicated setup for `delivery-alert-audit.spec.ts`.
 *
 * The spec asserts on the "Dismissed by" attribution column rendered by
 * the Recent Alerts table on /app/settings/email-delivery. The audit
 * row's display name is assembled from the dismissing user's
 * first_name + last_name on the join target, so the assertion needs a
 * known user with a stable display name.
 *
 * Crucially, this setup provisions an *isolated* workspace + owner so
 * the spec does not collide with the sibling `email-delivery-alerts`
 * project — both projects wipe and seed alert rows in beforeEach, and
 * if they shared a workspace the parallel run would race (one test's
 * resetAlertState would delete the other's freshly-seeded alert).
 *
 * Mirrors the approach used by `email-delivery-alerts.setup.ts` and
 * `role-based-buttons.setup.ts`: forge a session row + signed
 * connect.sid cookie, save a storage state, and persist the company
 * id + owner user id to a fixture file the spec reads at runtime.
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const COMPANY_NAME = "E2E Delivery Alert Audit Co";
const OWNER_EMAIL = "e2e-daa-owner@example.test";
const OWNER_PASSWORD = "playwright-daa-pw-owner-2026";
const OWNER_FIRST_NAME = "E2E";
const OWNER_LAST_NAME = "Daa-owner";
const STORAGE_PATH = ".playwright/daa-owner.json";
const FIXTURE_PATH = ".playwright/delivery-alert-audit-fixture.json";

setup("authenticate + seed delivery-alert-audit fixtures", async ({ page }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the delivery-alert-audit setup.");
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set so the delivery-alert-audit setup can sign the connect.sid cookie.",
    );
  }

  let ownerUserId: string;
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // (a) Ensure the owner user exists with a known password hash and
    //     stable first/last name. The audit-table assertion depends on
    //     these names being exact, so refresh them on every run.
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [OWNER_EMAIL])
    ).rows[0];
    if (existing) {
      ownerUserId = existing.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name=$2, last_name=$3 WHERE id=$4`,
        [passwordHash, OWNER_FIRST_NAME, OWNER_LAST_NAME, ownerUserId],
      );
    } else {
      ownerUserId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
         VALUES ($1, $2, $3, $4, $5, 'en')`,
        [ownerUserId, OWNER_EMAIL, passwordHash, OWNER_FIRST_NAME, OWNER_LAST_NAME],
      );
    }

    // (b) Ensure the dedicated workspace exists, owned by this owner.
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

    // (c) Owner membership in this dedicated workspace. Belt-and-braces
    //     delete any stray membership in *other* workspaces so the
    //     "first membership" fallback in resolveActiveCompanyId always
    //     lands here even when the browser's banner-dismiss flow can't
    //     pin x-company-id explicitly.
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
    await client.query(
      `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
      [ownerUserId, companyId],
    );
  } finally {
    await client.end();
  }

  // (d) Forge a session row + signed connect.sid cookie, then save the
  //     storage state so the spec can `test.use({ storageState })`.
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
            first_name: OWNER_FIRST_NAME,
            last_name: OWNER_LAST_NAME,
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

    // Confirm the session is valid before saving — catches a wrong
    // SESSION_SECRET or a payload-shape regression early.
    const me = await page.request.get("/api/auth/user");
    if (me.status() !== 200) {
      throw new Error(
        `/api/auth/user expected 200 for daa-owner but got ${me.status()}: ${await me.text()}`,
      );
    }

    const storagePath = path.resolve(STORAGE_PATH);
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    await page.context().storageState({ path: storagePath });
  } finally {
    await sessionsClient.end();
  }

  // (e) Persist the company id + owner user id so the spec can pin
  //     DB seeds to the right rows without rediscovering them.
  const fixturePath = path.resolve(FIXTURE_PATH);
  fs.writeFileSync(
    fixturePath,
    JSON.stringify(
      {
        companyId,
        ownerUserId,
        ownerDisplayName: `${OWNER_FIRST_NAME} ${OWNER_LAST_NAME}`,
        ownerEmail: OWNER_EMAIL,
      },
      null,
      2,
    ),
  );
});
