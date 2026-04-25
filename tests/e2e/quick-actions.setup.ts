import { test as setup } from "@playwright/test";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

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
 *     unique per workspace (see migration 0010), so we namespace the
 *     seeded codes with the workspace id and re-home any stray rows from
 *     a previous run before re-using them.
 *
 * Account ids are persisted to `.playwright/quick-actions-fixtures.json`
 * so the spec can populate the JE form's account selects without having
 * to re-fetch them through the UI.
 *
 * The user-creation + session-forging machinery is shared with the other
 * e2e setups via `tests/e2e/_helpers/forge-session.ts` so cookie-name /
 * secret-rotation / schema changes only need to be made in one place.
 * The dev server's outbound `connect.sid` cookie is `Secure`, which a
 * browser refuses to keep over HTTP, so the helper mints both the
 * passport session row and a non-Secure inbound cookie for us.
 */

const TEST_EMAIL = "e2e-quick-actions@example.test";
const TEST_PASSWORD = "playwright-quick-actions-pw-2026";
const TEST_FIRST = "E2E";
const TEST_LAST = "QuickActions";
const STORAGE_PATH = path.resolve(".playwright/quick-actions-state.json");
const FIXTURES_PATH = path.resolve(".playwright/quick-actions-fixtures.json");

setup("authenticate + seed quick-actions fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the quick-actions setup");
  requireCookieSecret("the quick-actions setup");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  let cashAccountId: number;
  let revenueAccountId: number;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: TEST_FIRST,
      lastName: TEST_LAST,
    });

    // ---- (b) Ensure the user owns a workspace ----
    companyId = await ensureCompany(client, {
      userId,
      companyName: "E2E Quick Actions Co",
    });

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
    // Drop only the two seeded posting accounts (code is unique per
    // workspace; we namespace by company id so a stray row from a
    // previous run with a different company id can be re-homed below
    // instead of duplicated).
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

  // ---- (e) Forge a passport session via the shared helper ----
  // The helper plants the signed `connect.sid` cookie into the page
  // context, verifies `/api/auth/user` returns 200, and persists the
  // resulting storage state. Pre-seed `active_company_id` in the
  // `afterCookiesPlanted` hook so the CompanyProvider doesn't have to
  // wait for `/api/companies` to settle before the topbar's quick-create
  // dropdown mounts and the X-Company-Id header is attached to mutation
  // requests.
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
    storagePath: STORAGE_PATH,
    baseURL,
    afterCookiesPlanted: async (p) => {
      await p.goto(baseURL, { waitUntil: "domcontentloaded" });
      await p.evaluate((id) => {
        window.localStorage.setItem("active_company_id", String(id));
      }, companyId);
    },
  });

  // ---- (f) Persist the seeded account ids so the JE spec can use them ----
  fs.writeFileSync(
    FIXTURES_PATH,
    JSON.stringify({ companyId, cashAccountId, revenueAccountId }, null, 2) + "\n",
    "utf8",
  );
});
