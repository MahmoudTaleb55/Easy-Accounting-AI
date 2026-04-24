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
    // The same employee is reused as the FK target for the seeded leave +
    // payroll-run rows below, so both per-row delete buttons can render.
    let employeeId: number;
    const empExists = (
      await client.query(`SELECT id FROM employees WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (empExists) {
      employeeId = Number(empExists.id);
    } else {
      employeeId = Number(
        (
          await client.query(
            `INSERT INTO employees (company_id, full_name, job_title, hire_date, base_salary, allowances, is_national, is_active)
             VALUES ($1, 'Role Test Employee', 'Tester', '2024-01-01', '5000', '0', true, true)
             RETURNING id`,
            [companyId],
          )
        ).rows[0].id,
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

    // ---- (d.0) Accounts required by the API-level role spec --------------
    // Two accounts (one asset / current asset, one revenue / operating
    // revenue) so role-based-api.spec.ts can post a balanced journal entry
    // for the owner success path. Codes are scoped to this workspace by
    // embedding the company id; uniqueness on accounts is now per
    // (company_id, code), so the conflict target matches that constraint.
    const cashCode = `RB-CASH-${companyId}`;
    const revCode = `RB-REV-${companyId}`;
    await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, $2, 'صندوق', 'Cash', 'asset', 'current_asset', false, true)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, cashCode],
    );
    await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, $2, 'إيرادات', 'Revenue', 'revenue', 'operating_revenue', false, true)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, revCode],
    );

    // Salaries & Wages account (code 6010 — see shared/coa-seed.ts /
    // SALARIES_EXPENSE_CODE). The HR payroll-run handler refuses to post
    // when this account is missing, so seeding it here is what lets the
    // owner-success path of POST /api/hr/payroll/run actually run.
    await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, '6010', 'الرواتب والأجور', 'Salaries & Wages', 'expense', 'operating_expense', false, true)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId],
    );

    // ---- (d.1) Chart of accounts for the workspace ----
    // Per-row write buttons on Fixed Assets / Journal pages need real GL
    // accounts wired into an asset_category and into manual journal lines.
    // The `accounts.code` column is GLOBALLY unique (see migration 0005),
    // so codes are namespaced with an "E2EROL-" prefix to coexist with the
    // numeric COA seeded for other workspaces.
    interface AccountSeed {
      code: string;
      nameEn: string;
      nameAr: string;
      type: "asset" | "liability" | "equity" | "revenue" | "expense";
      subtype: string;
    }
    const accountSeeds: AccountSeed[] = [
      { code: "E2EROL-1110", nameEn: "Cash", nameAr: "نقدية", type: "asset", subtype: "cash" },
      { code: "E2EROL-4100", nameEn: "Sales", nameAr: "مبيعات", type: "revenue", subtype: "operating" },
      { code: "E2EROL-1610", nameEn: "PPE Cost", nameAr: "أصول ثابتة - تكلفة", type: "asset", subtype: "ppe" },
      { code: "E2EROL-1611", nameEn: "Accumulated Depreciation", nameAr: "مجمع الإهلاك", type: "asset", subtype: "ppe" },
      { code: "E2EROL-1612", nameEn: "Accumulated Impairment", nameAr: "مجمع الانخفاض", type: "asset", subtype: "ppe" },
      { code: "E2EROL-6610", nameEn: "Depreciation Expense", nameAr: "مصروف الإهلاك", type: "expense", subtype: "operating" },
      { code: "E2EROL-6611", nameEn: "Impairment Loss", nameAr: "خسارة انخفاض القيمة", type: "expense", subtype: "operating" },
      { code: "E2EROL-3210", nameEn: "Revaluation Surplus", nameAr: "فائض إعادة التقييم", type: "equity", subtype: "reserves" },
      { code: "E2EROL-7110", nameEn: "Gain/Loss on Disposal", nameAr: "أرباح/خسائر استبعاد", type: "revenue", subtype: "non_operating" },
    ];
    const accountIds = new Map<string, number>();
    for (const a of accountSeeds) {
      const existing = (
        await client.query(`SELECT id, company_id FROM accounts WHERE code = $1 LIMIT 1`, [a.code])
      ).rows[0];
      if (existing) {
        // The code is globally unique so a stray row from a previous test
        // run (different company) would silently break our composite FKs;
        // re-home it to this workspace so the seed is self-healing.
        if (Number(existing.company_id) !== companyId) {
          await client.query(`UPDATE accounts SET company_id = $1 WHERE id = $2`, [companyId, existing.id]);
        }
        accountIds.set(a.code, Number(existing.id));
      } else {
        const inserted = (
          await client.query(
            `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, false, true) RETURNING id`,
            [companyId, a.code, a.nameAr, a.nameEn, a.type, a.subtype],
          )
        ).rows[0];
        accountIds.set(a.code, Number(inserted.id));
      }
    }
    const accId = (code: string) => {
      const id = accountIds.get(code);
      if (!id) throw new Error(`Missing seeded account ${code}`);
      return id;
    };

    // ---- (d.2) One asset category so `button-add-asset` is enabled ----
    // The category is also the FK target for the fixed_asset row seeded
    // below so the per-row impairment/revaluation/dispose/delete buttons
    // can be exercised under each role.
    let categoryId: number;
    const catExists = (
      await client.query(`SELECT id FROM asset_categories WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (catExists) {
      categoryId = Number(catExists.id);
    } else {
      categoryId = Number(
        (
          await client.query(
            `INSERT INTO asset_categories (
               company_id, name, measurement_model, default_useful_life_months, default_method,
               asset_cost_account_id, accumulated_dep_account_id, dep_expense_account_id,
               accumulated_imp_account_id, imp_loss_account_id, reval_surplus_account_id,
               gain_loss_disposal_account_id
             ) VALUES ($1, 'Role Test Category', 'cost', 60, 'straight_line', $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              companyId,
              accId("E2EROL-1610"),
              accId("E2EROL-1611"),
              accId("E2EROL-6610"),
              accId("E2EROL-1612"),
              accId("E2EROL-6611"),
              accId("E2EROL-3210"),
              accId("E2EROL-7110"),
            ],
          )
        ).rows[0].id,
      );
    }

    // ---- (d.3) One active fixed asset → renders the per-row action row ----
    // Status `active` is required so the impairment/revaluation/dispose
    // buttons are not `forceDisabled` (see fixed-assets.tsx around L333).
    // Filter on status='active' so a stale disposed/depreciated row from a
    // previous run doesn't satisfy the existence check and skip the insert.
    const assetExists = (
      await client.query(
        `SELECT id FROM fixed_assets WHERE company_id = $1 AND status = 'active' LIMIT 1`,
        [companyId],
      )
    ).rows[0];
    if (!assetExists) {
      await client.query(
        `INSERT INTO fixed_assets (
           company_id, category_id, code, name, acquisition_date, in_service_date,
           currency, tx_cost, fx_rate, cost, residual, useful_life_months, method,
           measurement_model, status, location
         ) VALUES ($1, $2, 'FA-E2E-001', 'Role Test Asset', '2024-06-01', '2024-06-01',
           'USD', '12000', '1', '12000', '0', 60, 'straight_line', 'cost', 'active', '')`,
        [companyId, categoryId],
      );
    }

    // ---- (d.4) One transaction → renders `button-delete-{txId}` ----
    // The transactions list is period-filtered on the client; using today
    // keeps the row visible under the default current-month period chip.
    const today = new Date().toISOString().slice(0, 10);
    const txExists = (
      await client.query(`SELECT id FROM transactions WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (!txExists) {
      await client.query(
        `INSERT INTO transactions (company_id, type, amount, description, category, date)
         VALUES ($1, 'expense', '50.00', 'Role Test Transaction', 'office', $2::timestamp)`,
        [companyId, today],
      );
    }

    // ---- (d.5) One MANUAL journal entry → renders the delete button ----
    // The journal page only renders `button-delete-entry-{id}` when the
    // entry's source is NOT 'transaction'. The auto-posted JE created by
    // the transaction above has source='transaction' and would not match,
    // so a stand-alone manual entry is seeded explicitly. Two lines (one
    // debit, one credit) are required by the schema's balance refinement.
    const jeExists = (
      await client.query(
        `SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'manual' LIMIT 1`,
        [companyId],
      )
    ).rows[0];
    if (!jeExists) {
      const ref = `JE-E2E-${Date.now()}`;
      const je = (
        await client.query(
          `INSERT INTO journal_entries (company_id, reference, entry_date, description, source)
           VALUES ($1, $2, $3::timestamp, 'Role Test Manual Entry', 'manual') RETURNING id`,
          [companyId, ref, today],
        )
      ).rows[0];
      const jeId = Number(je.id);
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, $3, '100.00', '0', 'debit cash'),
                ($1, $2, $4, '0', '100.00', 'credit sales')`,
        [companyId, jeId, accId("E2EROL-1110"), accId("E2EROL-4100")],
      );
    }

    // ---- (d.6) One leave row → renders `button-delete-leave-{id}` ----
    const leaveExists = (
      await client.query(`SELECT id FROM leaves WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (!leaveExists) {
      await client.query(
        `INSERT INTO leaves (company_id, employee_id, start_date, end_date, days, type, status, notes)
         VALUES ($1, $2, '2024-07-01', '2024-07-03', 3, 'annual', 'approved', '')`,
        [companyId, employeeId],
      );
    }

    // ---- (d.7) One posted payroll run → renders the delete button ----
    const runExists = (
      await client.query(`SELECT id FROM payroll_runs WHERE company_id = $1 LIMIT 1`, [companyId])
    ).rows[0];
    if (!runExists) {
      await client.query(
        `INSERT INTO payroll_runs (company_id, year, month, status, total_gross, total_net, journal_entry_id)
         VALUES ($1, 2024, 6, 'posted', '5000.00', '4500.00', NULL)`,
        [companyId],
      );
    }
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
