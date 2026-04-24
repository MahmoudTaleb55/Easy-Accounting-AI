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
 * One-time auth + seed setup for the role-based-buttons spec.
 *
 * Three users are created (or refreshed in place) — owner, accountant and
 * viewer — all with memberships in the same shared company so the read
 * surface is identical across roles. Only the membership role differs, and
 * therefore only the *gating* of write buttons differs. That isolation lets
 * the spec assert exactly the role contract: which buttons each role sees as
 * disabled, and which tooltip the disabled wrapper carries.
 *
 * What this does for each role:
 *   1. Inserts (or refreshes) the user with a known bcrypt password hash.
 *   2. Inserts (or refreshes) the user's membership in the shared workspace
 *      with the canonical role enum (owner | accountant | viewer) — the
 *      legacy admin/reviewer/readonly enum was retired in migration 0003,
 *      so anything outside that enum gets normalised back to "viewer" by
 *      `mapRole` and silently breaks owner/accountant gating. The
 *      `memberships` row is the single source of truth — the legacy
 *      `workspace_members` mirror table was dropped in migration 0006.
 *   3. Forges a passport session row + signs the connect.sid cookie so the
 *      browser context is "logged in" without ever calling /api/auth/signin
 *      (which is rate-limited per IP).
 *   4. Writes the per-role storage state to .playwright/role-{role}.json,
 *      which the spec then loads via `test.use({ storageState })`.
 *
 * Shared seed data (one employee, one FX rate) is also inserted so the HR
 * payroll preview returns at least one line and the FX panel has a row to
 * delete — both required to assert the *enabled* state for the owner.
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

interface RoleSpec {
  /** Canonical workspace role enum (owner|accountant|viewer) — see
   *  shared/models/auth.ts and migration 0003. */
  role: "owner" | "accountant" | "viewer";
  email: string;
  password: string;
  storagePath: string;
}

const COMPANY_NAME = "E2E Roles Co";
const ROLE_SPECS: RoleSpec[] = [
  {
    role: "owner",
    email: "e2e-role-owner@example.test",
    password: "playwright-role-pw-owner-2025",
    storagePath: ".playwright/role-owner.json",
  },
  {
    role: "accountant",
    email: "e2e-role-accountant@example.test",
    password: "playwright-role-pw-accountant-2025",
    storagePath: ".playwright/role-accountant.json",
  },
  {
    role: "viewer",
    email: "e2e-role-viewer@example.test",
    password: "playwright-role-pw-viewer-2025",
    storagePath: ".playwright/role-viewer.json",
  },
];

setup("authenticate + seed role-based fixtures", async ({ page }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the role-based-buttons setup.");
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set for the role-based-buttons setup to sign the connect.sid cookie.",
    );
  }

  const userIds = new Map<string, string>();
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // ---- (a) Ensure each user exists with a known password hash ----
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
          [passwordHash, `Role-${spec.role}`, uid],
        );
      } else {
        uid = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
           VALUES ($1, $2, $3, 'E2E', $4, 'en')`,
          [uid, spec.email, passwordHash, `Role-${spec.role}`],
        );
      }
      userIds.set(spec.role, uid);
    }

    // ---- (b) Ensure the shared company exists, owned by the owner user ----
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

    // ---- (c) Memberships per role (admin / accountant / readonly) ----
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
    }

    // ---- (d) Seed minimal data so non-RBAC disable conditions don't fire ----
    // The Run Payroll button is `forceDisabled` when the company has no
    // payroll lines (no employees → no preview). One employee is enough for
    // the preview to produce a line so the owner sees the button enabled.
    const empExists = (
      await client.query(`SELECT id FROM employees WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (!empExists) {
      await client.query(
        `INSERT INTO employees (company_id, full_name, job_title, hire_date, base_salary, allowances, is_national, is_active)
         VALUES ($1, 'Role Test Employee', 'Tester', '2024-01-01', '5000', '0', true, true)`,
        [companyId],
      );
    }

    // The FX delete button only renders when the FX rate list is non-empty.
    const fxExists = (
      await client.query(`SELECT id FROM fx_rates WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (!fxExists) {
      await client.query(
        `INSERT INTO fx_rates (company_id, from_currency, to_currency, rate_date, rate)
         VALUES ($1, 'EUR', 'USD', '2025-01-01', '1.10')`,
        [companyId],
      );
    }

    // Two accounts (one asset / current asset, one revenue / operating
    // revenue) so the API-side role spec can post a balanced journal entry
    // for the owner success path. Uses idempotent codes scoped to this
    // shared E2E workspace; the global UNIQUE constraint on accounts.code
    // is satisfied by including the company id in the code itself.
    const cashCode = `RB-CASH-${companyId}`;
    const revCode = `RB-REV-${companyId}`;
    await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, $2, 'صندوق', 'Cash', 'asset', 'current_asset', false, true)
       ON CONFLICT (code) DO NOTHING`,
      [companyId, cashCode],
    );
    await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, $2, 'إيرادات', 'Revenue', 'revenue', 'operating_revenue', false, true)
       ON CONFLICT (code) DO NOTHING`,
      [companyId, revCode],
    );

    // Salaries & Wages account (code 6010 — see shared/coa-seed.ts /
    // SALARIES_EXPENSE_CODE). The HR payroll-run handler refuses to post
    // when this account is missing, so seeding it here is what lets the
    // owner-success path of POST /api/hr/payroll/run actually run.
    await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, '6010', 'الرواتب والأجور', 'Salaries & Wages', 'expense', 'operating_expense', false, true)
       ON CONFLICT (code) DO NOTHING`,
      [companyId],
    );
  } finally {
    await client.end();
  }

  // ---- (e) For each role: forge a session, plant cookies, save state ----
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
              last_name: `Role-${spec.role}`,
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

      // Reset the test page's cookie jar between roles so each saved state
      // contains exactly one user's cookies and nothing leaks across roles.
      await page.context().clearCookies();
      await page.context().addCookies([
        { name: "connect.sid", value: signedSid, url: baseURL, sameSite: "Lax" },
      ]);

      // Confirm the session is real before saving — catches typos in the
      // session payload shape, a wrong SESSION_SECRET, etc.
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

  // ---- (f) Persist the shared company id so role-based-api can pin it ----
  // The role-based-api spec calls POST /api/companies as part of the owner
  // success path, which adds a *second* workspace to the owner. After that
  // creation, `cid(req)` for subsequent owner calls would resolve to
  // whichever workspace `attachMembership` picks first — flipping mid-suite
  // and breaking the GET /api/accounts and GET /api/auth/members lookups
  // the spec does later. Writing the company id here lets the spec set
  // `x-company-id` on every call so the active workspace stays pinned to
  // the shared E2E company regardless of what other tests in the run do
  // (creating workspaces, deleting accounts, etc.).
  const fixturePath = path.resolve(".playwright/role-shared-fixture.json");
  fs.writeFileSync(fixturePath, JSON.stringify({ companyId }, null, 2));
});
