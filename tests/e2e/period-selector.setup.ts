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
 * One-time auth + seed setup for the period-selector spec.
 *
 * The spec drives the global PeriodChip (today/week/month/quarter/ytd +
 * compare-to-previous) across Insights cockpit/alerts/cash/budget tabs,
 * the HR Payroll preview, and the Fixed Assets register. For the spec
 * to assert that figures actually change between periods (not just that
 * controls re-render), the workspace must contain:
 *
 *   • a couple of transactions (so the Insights health/KPI panel computes
 *     non-zero figures and re-fetches when the period changes);
 *   • one active employee (so the Payroll preview table — which is the
 *     gate for `text-payroll-period`, `text-total-net`, and the
 *     `text-delta-*` totals row — actually renders);
 *   • multiple fixed assets seeded at strategically distributed
 *     acquisition dates so that the visible-asset count differs between
 *     periods (today/week/ytd vs month vs quarter), letting us prove
 *     the period filter is actually doing work.
 *
 * Asset seed dates are written to `.playwright/period-selector-fixtures.json`
 * so the spec uses identical strings when computing expected counts —
 * both the setup and the spec invoke `new Date()` close in time, but
 * persisting the canonical strings removes any chance of drift.
 *
 * We sign the test user in the same way the dashboard-shell setup does:
 * by inserting the user + a passport session row directly and signing the
 * `connect.sid` cookie with `SESSION_SECRET`. The dev server's cookie is
 * marked `Secure`, which a browser would normally refuse over HTTP, so we
 * sidestep the round-trip by minting both cookies ourselves.
 */

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

const TEST_EMAIL = "e2e-period-selector@example.test";
const TEST_PASSWORD = "playwright-period-pw-2026";
const STORAGE_PATH = path.resolve(".playwright/period-selector-state.json");
const FIXTURES_PATH = path.resolve(".playwright/period-selector-fixtures.json");

function isoDate(d: Date): string {
  // YYYY-MM-DD in UTC — matches how the schema stores `acquisition_date`
  // and how the AssetRegister parses dates back out via `new Date(string)`.
  return d.toISOString().slice(0, 10);
}

setup("authenticate + seed period-selector fixtures", async ({ page }) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for the period-selector setup.");
  if (!COOKIE_SECRET) throw new Error("SESSION_SECRET must be set for the period-selector setup.");

  // Compute fixture dates relative to now. Layered by visibility:
  //   • old      → before "today" → in every period
  //   • todayD   → today (00:00 UTC) → in every period (acq <= period.end)
  //   • next     → today + 1 day → outside today/week/ytd, inside month
  //                (when next is in same month) and quarter
  //   • far      → today + 50 days → outside today/week/month/ytd, inside
  //                quarter (provided we're not in the last ~40 days of a
  //                quarter; this is acceptable for our 24-04-2026 test
  //                horizon and is verified by the spec's own derivation)
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);
  const farUTC = new Date(todayUTC.getTime() + 50 * 24 * 60 * 60 * 1000);
  const oldUTC = new Date(Date.UTC(2020, 0, 1));

  const assetSeed = [
    { code: "FA-OLD",   name: "Pre-period asset",       acq: isoDate(oldUTC) },
    { code: "FA-TODAY", name: "Today asset",            acq: isoDate(todayUTC) },
    { code: "FA-NEXT",  name: "Just-after-today asset", acq: isoDate(tomorrowUTC) },
    { code: "FA-FAR",   name: "Future-quarter asset",   acq: isoDate(farUTC) },
  ];

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const existing = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [TEST_EMAIL])
    ).rows[0];
    if (existing) {
      userId = existing.id;
      await client.query(
        `UPDATE users SET password_hash=$1, first_name='E2E', last_name='Period' WHERE id=$2`,
        [passwordHash, userId],
      );
    } else {
      userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
         VALUES ($1, $2, $3, 'E2E', 'Period', 'en')`,
        [userId, TEST_EMAIL, passwordHash],
      );
    }

    // ---- (b) Ensure the user owns a workspace ----
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
      companyRow = (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
           VALUES ('E2E Period Co', $1, 'USD', '$', true)
           RETURNING id`,
          [userId],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), userId, companyRow.id],
      );
    }
    companyId = Number(companyRow.id);

    // ---- (c) Reset the workspace's seed data so the spec is deterministic ----
    // Delete in dependency order to avoid FK violations.
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [companyId]);
    await client.query(
      `DELETE FROM fixed_assets WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM asset_categories WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM attendance WHERE employee_id IN (SELECT id FROM employees WHERE company_id = $1)`,
      [companyId],
    );
    await client.query(`DELETE FROM employees WHERE company_id = $1`, [companyId]);
    // Accounts: drop only the placeholder we inject below (idempotent reseed).
    await client.query(
      `DELETE FROM accounts WHERE company_id = $1 AND code = $2`,
      [companyId, `${companyId}-FA`],
    );

    // ---- (d) Seed transactions ----
    await client.query(
      `INSERT INTO transactions (company_id, type, amount, description, category) VALUES
         ($1, 'income',  '4500.00', 'Period selector revenue', 'Revenue'),
         ($1, 'expense', '1100.00', 'Period selector rent',    'Rent'),
         ($1, 'income',  '900.00',  'Period selector workshop','Revenue')`,
      [companyId],
    );

    // ---- (e) Seed one active employee ----
    // hireDate is in the past so end-of-service / leave accruals compute > 0.
    await client.query(
      `INSERT INTO employees (company_id, full_name, job_title, hire_date,
                              base_salary, allowances, is_national, is_active)
       VALUES ($1, 'Period Tester', 'QA Lead', '2024-01-15',
               '6000.00', '500.00', true, true)`,
      [companyId],
    );

    // ---- (f) Seed an asset category + fixed assets at distributed dates ----
    // Asset categories require seven GL account ids. We re-use one minimal
    // placeholder account for all seven slots — the spec doesn't post real
    // depreciation, it only reads the register, so this is enough for the
    // category-validation guard on POST /api/fixed-assets.
    const accountRow = (
      await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
         VALUES ($1, $2, 'حساب اختبار', 'Test Account', 'asset', 'current_asset', false, true)
         RETURNING id`,
        [companyId, `${companyId}-FA`],
      )
    ).rows[0];
    const accountId = Number(accountRow.id);

    const catRow = (
      await client.query(
        `INSERT INTO asset_categories
           (company_id, name, measurement_model, default_useful_life_months, default_method,
            asset_cost_account_id, accumulated_dep_account_id, dep_expense_account_id,
            accumulated_imp_account_id, imp_loss_account_id, reval_surplus_account_id,
            gain_loss_disposal_account_id)
         VALUES ($1, 'E2E Equipment', 'cost', 60, 'straight_line',
                 $2, $2, $2, $2, $2, $2, $2)
         RETURNING id`,
        [companyId, accountId],
      )
    ).rows[0];
    const categoryId = Number(catRow.id);

    for (const a of assetSeed) {
      await client.query(
        `INSERT INTO fixed_assets
           (company_id, category_id, code, name, acquisition_date, in_service_date,
            currency, tx_cost, fx_rate, cost, residual, useful_life_months, method,
            measurement_model, status, location, custodian)
         VALUES ($1, $2, $3, $4, $5, $5,
                 'USD', '3000.00', '1', '3000.00', '0', 36, 'straight_line',
                 'cost', 'active', 'HQ', 'QA')`,
        [companyId, categoryId, a.code, a.name, a.acq],
      );
    }
  } finally {
    await client.end();
  }

  // ---- (g) Forge a passport session row + signed connect.sid cookie ----
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
          last_name: "Period",
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

  // ---- (h) Plant the cookie + persist the active company in localStorage ----
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
  // for /api/companies to return before the period-driven queries can run
  // with the right `X-Company-Id` header.
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.evaluate((id) => {
    window.localStorage.setItem("active_company_id", String(id));
  }, companyId);

  // ---- (i) Confirm the session is real before saving storageState ----
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

  // ---- (j) Persist canonical seed dates so the spec stays in lock-step ----
  fs.writeFileSync(
    FIXTURES_PATH,
    JSON.stringify({ assetSeed }, null, 2) + "\n",
    "utf8",
  );
});
