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
 * One-time auth + seed setup for the quick-actions spec.
 *
 * The spec drives every quick-action item exposed by the topbar's
 * "Quick create" dropdown — `quick-new-tx`, `quick-new-je`, `quick-new-acc` —
 * end-to-end: it opens the dropdown, clicks the item, lands on the target
 * page, opens that page's "Add" dialog, fills a minimal valid form, and
 * confirms the record was created.
 *
 * For each of those create paths the workspace needs:
 *
 *   • a fresh, isolated workspace owned by this test user (so other specs
 *     can't leave noise that throws off "row appeared after submit"
 *     assertions);
 *   • two non-header GL accounts so the journal-entry create dialog has
 *     something to pick on each line and can satisfy the balanced-debits/
 *     credits refinement on `createJournalEntrySchema`. Account `code` is
 *     GLOBALLY unique (see migration 0005), so we namespace the seeded
 *     codes with the workspace id and re-home any stray rows from a
 *     previous run before re-using them.
 *
 * Account ids are persisted to `.playwright/quick-actions-fixtures.json`
 * so the spec can populate the JE form's account selects without having
 * to re-fetch them through the UI.
 *
 * Auth is forged the same way the dashboard-shell / period-selector
 * setups do it: insert the user + a passport session row directly,
 * then sign the connect.sid cookie with `SESSION_SECRET`. The dev
 * server's outbound cookie is `Secure`, which a browser refuses to
 * keep over HTTP, so we mint both cookies ourselves.
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const TEST_EMAIL = "e2e-quick-actions@example.test";
const TEST_PASSWORD = "playwright-quick-actions-pw-2026";
const STORAGE_PATH = path.resolve(".playwright/quick-actions-state.json");
const FIXTURES_PATH = path.resolve(".playwright/quick-actions-fixtures.json");

setup("authenticate + seed quick-actions fixtures", async ({ page }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the quick-actions setup.");
  if (!COOKIE_SECRET) {
    throw new Error(
      "SESSION_SECRET (or WM_COOKIE_SECRET) must be set for the quick-actions setup to sign the connect.sid cookie.",
    );
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  let cashAccountId: number;
  let revenueAccountId: number;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [TEST_EMAIL])
    ).rows[0];
    if (existing) {
      userId = existing.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name='E2E', last_name='QuickActions' WHERE id=$2`,
        [passwordHash, userId],
      );
    } else {
      userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
         VALUES ($1, $2, $3, 'E2E', 'QuickActions', 'en')`,
        [userId, TEST_EMAIL, passwordHash],
      );
    }

    // ---- (b) Ensure the user owns a workspace ----
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
      companyRow = (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
           VALUES ('E2E Quick Actions Co', $1, 'USD', '$', false)
           RETURNING id`,
          [userId],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), userId, companyRow.id],
      );
    }
    companyId = Number(companyRow.id);

    // ---- (c) Reset the workspace's seed data so the spec is deterministic ----
    // Each spec run asserts a fresh count delta (e.g. "exactly one tx after
    // submit") — start from a clean slate. Delete in dependency order so the
    // composite FKs from journal_lines back to accounts/journal_entries
    // don't reject the wipe.
    await client.query(
      `DELETE FROM journal_lines WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM journal_entries WHERE company_id = $1`,
      [companyId],
    );
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [companyId]);
    // Drop only the two seeded posting accounts (code is GLOBALLY unique;
    // we namespace by company id so a stray row from a previous run with a
    // different company id can be re-homed below instead of duplicated).
    const cashCode = `QA-CASH-${companyId}`;
    const revCode = `QA-REV-${companyId}`;

    // ---- (d) Seed two non-header accounts the JE dialog can pick from ----
    // The journal create form filters out header accounts, so both must
    // have isHeader=false. One is an asset (debit-natural) and one is a
    // revenue (credit-natural) so the spec posts a textbook
    // debit-cash / credit-revenue entry.
    const seedAccount = async (
      code: string,
      nameAr: string,
      nameEn: string,
      type: string,
      subtype: string,
    ): Promise<number> => {
      const row = (
        await client.query(`SELECT id, company_id FROM accounts WHERE code = $1 LIMIT 1`, [code])
      ).rows[0];
      if (row) {
        if (Number(row.company_id) !== companyId) {
          await client.query(`UPDATE accounts SET company_id = $1 WHERE id = $2`, [
            companyId,
            row.id,
          ]);
        }
        await client.query(
          `UPDATE accounts SET name_ar = $1, name_en = $2, type = $3, subtype = $4,
                               is_header = false, is_active = true WHERE id = $5`,
          [nameAr, nameEn, type, subtype, row.id],
        );
        return Number(row.id);
      }
      const inserted = (
        await client.query(
          `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, false, true) RETURNING id`,
          [companyId, code, nameAr, nameEn, type, subtype],
        )
      ).rows[0];
      return Number(inserted.id);
    };
    cashAccountId = await seedAccount(
      cashCode,
      "نقدية اختبار",
      "QA Cash",
      "asset",
      "current_asset",
    );
    revenueAccountId = await seedAccount(
      revCode,
      "إيرادات اختبار",
      "QA Revenue",
      "revenue",
      "operating_revenue",
    );
  } finally {
    await client.end();
  }

  // ---- (e) Forge a passport session row + signed connect.sid cookie ----
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
          last_name: "QuickActions",
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
  const signedSid = "s:" + cookieSignature.sign(sessionId, COOKIE_SECRET);

  // ---- (f) Plant the cookie + persist the active company in localStorage ----
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await page.context().addCookies([
    {
      name: "connect.sid",
      value: signedSid,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);

  // Pre-seed `active_company_id` so the CompanyProvider doesn't have to wait
  // for /api/companies to settle before the topbar's quick-create dropdown
  // mounts and the X-Company-Id header is attached to mutation requests.
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.evaluate((id) => {
    window.localStorage.setItem("active_company_id", String(id));
  }, companyId);

  // ---- (g) Confirm the session is real before saving storageState ----
  const me = await page.request.get("/api/auth/user");
  if (me.status() !== 200) {
    throw new Error(
      `Expected /api/auth/user to be 200 after session injection but got ${me.status()}.\n` +
        `userId=${userId} sid=${sessionId}\n` +
        `Body: ${await me.text()}`,
    );
  }

  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_PATH });

  // ---- (h) Persist the seeded account ids so the JE spec can use them ----
  fs.writeFileSync(
    FIXTURES_PATH,
    JSON.stringify({ companyId, cashAccountId, revenueAccountId }, null, 2) + "\n",
    "utf8",
  );
});
