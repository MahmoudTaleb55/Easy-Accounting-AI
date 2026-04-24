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
 * Dedicated auth + workspace setup for the email-delivery-alerts spec.
 *
 * The companion `email-delivery-alerts.spec.ts` asserts on exact failure
 * counts and on the evaluator's structured outcome under each threshold
 * configuration. Sharing a workspace with any sibling spec that records
 * delivery activity (e.g. `role-based-api.spec.ts` mints invitations,
 * which append rows to `invitation_email_events` that fall inside the
 * 24h evaluator window) makes those count assertions non-deterministic
 * when Playwright runs spec projects in parallel.
 *
 * The same problem also breaks the banner-dismiss flow: the shared owner
 * accrues additional memberships as sibling specs create workspaces
 * (`POST /api/companies` in `role-based-api`), and the browser-side
 * dismiss call — which can't easily set `x-company-id` — silently routes
 * to the wrong workspace, returning 404 and leaving the banner visible.
 *
 * To remove both failure modes this setup provisions an *isolated*
 * workspace + a dedicated owner / accountant / viewer trio whose only
 * membership is in that workspace. Storage states are saved under
 * `.playwright/edap-{role}.json` and the company id + owner user id are
 * persisted to `.playwright/email-delivery-alerts-fixture.json` so the
 * spec can pin DB seeds to the right rows. Mirrors the cookie-forging
 * approach used by `role-based-buttons.setup.ts`.
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

interface RoleSpec {
  role: "owner" | "accountant" | "viewer";
  email: string;
  password: string;
  storagePath: string;
}

const COMPANY_NAME = "E2E Delivery Alerts Co";
const ROLE_SPECS: RoleSpec[] = [
  {
    role: "owner",
    email: "e2e-edap-owner@example.test",
    password: "playwright-edap-pw-owner-2025",
    storagePath: ".playwright/edap-owner.json",
  },
  {
    role: "accountant",
    email: "e2e-edap-accountant@example.test",
    password: "playwright-edap-pw-accountant-2025",
    storagePath: ".playwright/edap-accountant.json",
  },
  {
    role: "viewer",
    email: "e2e-edap-viewer@example.test",
    password: "playwright-edap-pw-viewer-2025",
    storagePath: ".playwright/edap-viewer.json",
  },
];

setup("authenticate + seed email-delivery-alerts fixtures", async ({ page }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the email-delivery-alerts setup.");
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set so the email-delivery-alerts setup can sign the connect.sid cookie.",
    );
  }

  const userIds = new Map<string, string>();
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // (a) Ensure each user exists with a known password hash. We refresh
    //     the hash on every run so a rotated SESSION_SECRET won't strand
    //     the suite.
    for (const spec of ROLE_SPECS) {
      const passwordHash = await bcrypt.hash(spec.password, 10);
      const existing = (
        await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [spec.email])
      ).rows[0];
      let uid: string;
      if (existing) {
        uid = existing.id;
        await client.query(
          `UPDATE users SET password_hash=$1, first_name='E2E', last_name=$2 WHERE id=$3`,
          [passwordHash, `Edap-${spec.role}`, uid],
        );
      } else {
        uid = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
           VALUES ($1, $2, $3, 'E2E', $4, 'en')`,
          [uid, spec.email, passwordHash, `Edap-${spec.role}`],
        );
      }
      userIds.set(spec.role, uid);
    }

    // (b) Ensure the dedicated company exists, owned by the dedicated owner.
    //     Crucially, this company is *only* used by this spec — sibling
    //     specs (role-based-api, etc.) never touch it, so the
    //     invitation/password-reset event log for this workspace stays
    //     deterministic.
    const ownerUserId = userIds.get("owner")!;
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

    // (c) Memberships — one per role in this isolated workspace. Each user
    //     only ever belongs to *this* company, so the server's "first
    //     membership" fallback in `resolveActiveCompanyId` always lands on
    //     the right workspace even when the browser can't pin
    //     `x-company-id` (the banner's dismiss call is the relevant case).
    for (const spec of ROLE_SPECS) {
      const uid = userIds.get(spec.role)!;
      const existingMembership = (
        await client.query(
          `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
          [uid, companyId],
        )
      ).rows[0];
      if (existingMembership) {
        await client.query(`UPDATE memberships SET role = $1 WHERE id = $2`, [
          spec.role,
          existingMembership.id,
        ]);
      } else {
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, role)
           VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), uid, companyId, spec.role],
        );
      }

      // Belt-and-braces: defensively delete any stray membership this user
      // might have picked up in a *different* workspace from a previous run
      // (e.g. an earlier abandoned setup that planted them in a shared
      // company). Keeping the user pinned to a single membership is what
      // makes the browser-side dismiss flow deterministic.
      await client.query(
        `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
        [uid, companyId],
      );
    }
  } finally {
    await client.end();
  }

  // (d) For each role: forge a session row + signed connect.sid cookie,
  //     then save a storage state the spec can `test.use({ storageState })`.
  const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  const sessionsClient = new pg.Client({ connectionString: dbUrl });
  await sessionsClient.connect();
  try {
    for (const spec of ROLE_SPECS) {
      const uid = userIds.get(spec.role)!;
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
              sub: uid,
              email: spec.email,
              first_name: "E2E",
              last_name: `Edap-${spec.role}`,
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
          `/api/auth/user expected 200 for ${spec.role} but got ${me.status()}: ${await me.text()}`,
        );
      }

      const storagePath = path.resolve(spec.storagePath);
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      await page.context().storageState({ path: storagePath });
    }
  } finally {
    await sessionsClient.end();
  }

  // (e) Persist the dedicated company id + owner user id so the spec can
  //     pin DB seeds (password-reset event inserts, alert seedAlert) to
  //     the right rows without rediscovering them on every test.
  const fixturePath = path.resolve(".playwright/email-delivery-alerts-fixture.json");
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({ companyId, ownerUserId: userIds.get("owner") }, null, 2),
  );
});
