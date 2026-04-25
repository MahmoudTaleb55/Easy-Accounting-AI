import { test as setup } from "@playwright/test";
import fs from "node:fs";
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
 * The session-cookie + passport-row machinery is shared with the
 * dashboard-shell setup via `tests/e2e/_helpers/forge-session.ts`.
 */

const TEST_EMAIL = "e2e-period-selector@example.test";
const TEST_PASSWORD = "playwright-period-pw-2026";
const STORAGE_PATH = path.resolve(".playwright/period-selector-state.json");
const FIXTURES_PATH = path.resolve(
  ".playwright/period-selector-fixtures.json",
);

function isoDate(d: Date): string {
  // YYYY-MM-DD in UTC — matches how the schema stores `acquisition_date`
  // and how the AssetRegister parses dates back out via `new Date(string)`.
  return d.toISOString().slice(0, 10);
}

setup("authenticate + seed period-selector fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the period-selector setup");
  requireCookieSecret("the period-selector setup");

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
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrowUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);
  const farUTC = new Date(todayUTC.getTime() + 50 * 24 * 60 * 60 * 1000);
  const oldUTC = new Date(Date.UTC(2020, 0, 1));

  const assetSeed = [
    { code: "FA-OLD", name: "Pre-period asset", acq: isoDate(oldUTC) },
    { code: "FA-TODAY", name: "Today asset", acq: isoDate(todayUTC) },
    { code: "FA-NEXT", name: "Just-after-today asset", acq: isoDate(tomorrowUTC) },
    { code: "FA-FAR", name: "Future-quarter asset", acq: isoDate(farUTC) },
  ];

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "E2E",
      lastName: "Period",
    });

    // ---- (b) Ensure the user owns a workspace ----
    // Roles use the canonical enum (owner|accountant|viewer) — see
    // shared/models/auth.ts and migration 0003. That migration rewrites
    // any legacy 'admin' membership to 'owner' once per database, so
    // seeding 'admin' here would make the next run's lookup miss and
    // silently insert a brand-new workspace, leaking the previous one.
    // Stick to the canonical 'owner' role.
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E Period Co",
    });

    // ---- (b.1) Clean up any workspaces leaked by past runs of the
    // pre-fix setup. Before this file was corrected, each run inserted
    // a fresh `companies` row (because the role-enum normaliser rewrote
    // the previous 'admin' membership to 'owner', so the role='admin'
    // lookup missed). Those leaked workspaces all belong to *this* test
    // user; consolidate by deleting their seed data + memberships +
    // company rows so the user only owns the canonical workspace.
    const stragglers = (
      await client.query(
        `SELECT c.id FROM memberships m
         JOIN companies c ON c.id = m.company_id
         WHERE m.user_id = $1 AND m.role = 'owner' AND c.id <> $2`,
        [userId, companyId],
      )
    ).rows.map((r: { id: number | string }) => Number(r.id));
    for (const strayId of stragglers) {
      // Delete in dependency order, mirroring the per-run reset below.
      await client.query(
        `DELETE FROM attendance WHERE employee_id IN (SELECT id FROM employees WHERE company_id = $1)`,
        [strayId],
      );
      await client.query(`DELETE FROM employees WHERE company_id = $1`, [strayId]);
      await client.query(`DELETE FROM fixed_assets WHERE company_id = $1`, [strayId]);
      await client.query(`DELETE FROM asset_categories WHERE company_id = $1`, [strayId]);
      await client.query(`DELETE FROM transactions WHERE company_id = $1`, [strayId]);
      await client.query(`DELETE FROM accounts WHERE company_id = $1`, [strayId]);
      await client.query(`DELETE FROM memberships WHERE company_id = $1`, [strayId]);
      await client.query(`DELETE FROM companies WHERE id = $1`, [strayId]);
    }

    // ---- (c) Reset the workspace's seed data so the spec is deterministic ----
    // Delete in dependency order to avoid FK violations.
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [
      companyId,
    ]);
    await client.query(`DELETE FROM fixed_assets WHERE company_id = $1`, [
      companyId,
    ]);
    await client.query(`DELETE FROM asset_categories WHERE company_id = $1`, [
      companyId,
    ]);
    await client.query(
      `DELETE FROM attendance WHERE employee_id IN (SELECT id FROM employees WHERE company_id = $1)`,
      [companyId],
    );
    await client.query(`DELETE FROM employees WHERE company_id = $1`, [
      companyId,
    ]);
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

  // ---- (g) Forge a passport session + plant cookie + persist state ----
  // Uses the shared helper, with an `afterCookiesPlanted` hook so we can
  // pre-seed `active_company_id` in localStorage between cookie planting
  // and the /api/auth/user verification — that way the very first
  // authenticated render in the spec already targets the right scope.
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: "E2E",
    lastName: "Period",
    storagePath: STORAGE_PATH,
    baseURL,
    afterCookiesPlanted: async (p) => {
      // Pre-seed `active_company_id` so the CompanyProvider doesn't have
      // to wait for /api/companies to return before the period-driven
      // queries can run with the right `X-Company-Id` header.
      await p.goto(baseURL, { waitUntil: "domcontentloaded" });
      await p.evaluate((id) => {
        window.localStorage.setItem("active_company_id", String(id));
      }, companyId);
    },
  });

  // ---- (h) Persist canonical seed dates so the spec stays in lock-step ----
  fs.writeFileSync(
    FIXTURES_PATH,
    JSON.stringify({ assetSeed }, null, 2) + "\n",
    "utf8",
  );
});
