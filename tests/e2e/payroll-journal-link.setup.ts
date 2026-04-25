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
 * One-time auth + seed setup for the `payroll-journal-link` spec.
 *
 * The spec exercises the HR → Journal Entries deep-link bridge: it loads
 * /app/hr, clicks the JE link in the past-payroll-runs row, and asserts
 * the URL becomes `/app/journal#je-<id>`, the matching `card-entry-<id>`
 * is in view, and that switching the period chip to a range that excludes
 * the entry surfaces the `banner-linked-entry-out-of-period` hint with a
 * working "Show entry" jump button.
 *
 * To get to that point we need a workspace that contains at least one
 * `payroll_runs` row whose `journal_entry_id` resolves to a real
 * `journal_entries` row — and the JE's `entry_date` must sit *inside*
 * the default `month` PeriodChip range so the deep-link initially lands
 * with no banner showing. The spec then switches to `today` to push the
 * entry out of the active period and assert the banner.
 *
 * What this seeder does, in order:
 *   (a) Inserts (or refreshes) a known test user with a bcrypt password.
 *   (b) Ensures that user owns a fresh workspace via `memberships`.
 *   (c) Wipes every prior payroll/journal/account/employee row this
 *       seeder has previously left in the workspace so re-runs are
 *       deterministic. (FK order: payroll_lines → payroll_runs,
 *       journal_lines → journal_entries, employees, accounts.)
 *   (d) Inserts two workspace-scoped accounts (cash + accrued salaries)
 *       — `accounts.code` is globally UNIQUE, so the codes are salted
 *       with the workspace id to stay collision-free even if another
 *       suite shares the database.
 *   (e) Inserts one active employee so the seeded run looks realistic.
 *   (f) Inserts a balanced two-line `journal_entries` row dated to the
 *       15th (or 16th, when "today" *is* the 15th) of the current month
 *       at 12:00 UTC. This guarantees the entry sits in the default
 *       `month` period (no banner on first load) AND that switching to
 *       the `today` period in the spec excludes it (banner appears).
 *   (g) Inserts a posted `payroll_runs` row pointing at that JE — this
 *       is the row the spec will click `link-journal-entry-{runId}` on.
 *   (h) Forges a passport session, plants the connect.sid cookie, and
 *       pre-seeds `active_company_id` in localStorage so the very first
 *       `/api/hr/payroll/runs` query in the spec uses the right scope.
 *   (i) Persists the run id, JE id, and the canonical entry-date string
 *       to `.playwright/payroll-journal-link-fixtures.json` so the spec
 *       reads back the same identifiers (no clock drift between setup
 *       and spec).
 *
 * The session-cookie + passport-row machinery is shared with the other
 * e2e setups via `tests/e2e/_helpers/forge-session.ts`.
 */

const TEST_EMAIL = "e2e-payroll-journal-link@example.test";
const TEST_PASSWORD = "playwright-payroll-link-pw-2026";
const STORAGE_PATH = path.resolve(".playwright/payroll-journal-link-state.json");
const FIXTURES_PATH = path.resolve(
  ".playwright/payroll-journal-link-fixtures.json",
);

/** YYYY-MM-DD for a Date in UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

setup("authenticate + seed payroll-journal-link fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the payroll-journal-link setup");
  requireCookieSecret("the payroll-journal-link setup");

  // Pick an entry date inside the current calendar month that is NOT today.
  // The default PeriodChip range is `month`, so the entry must fall inside
  // that window (no banner on first load). The spec then switches to the
  // `today` range — which spans only today — so any non-today date in the
  // current month will be excluded and the banner will surface. Day 15 is
  // always present in every month; if we happen to be running on the 15th
  // we fall back to the 16th (also always present). Noon UTC keeps the
  // date stable across local time zones.
  const now = new Date();
  const todayDayUtc = now.getUTCDate();
  const entryDay = todayDayUtc === 15 ? 16 : 15;
  const entryDateUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), entryDay, 12, 0, 0),
  );
  const entryDateStr = isoDate(entryDateUtc);

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  let runId: number;
  let journalEntryId: number;
  try {
    // ---- (a) Ensure the test user exists with a known password ----
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "E2E",
      lastName: "PayrollLink",
    });

    // ---- (b) Ensure the user owns a workspace ----
    // We deliberately do NOT adoptOrphan: this suite creates its own
    // private workspace so other suites can't leave residual rows in
    // it that would confuse the past-payroll-runs query.
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E Payroll Journal Link Co",
    });

    // ---- (c) Reset workspace seed in dependency order ----
    // payroll_lines → payroll_runs (FK on payroll_run_id, employee_id)
    // journal_lines → journal_entries (FK on journal_entry_id, account_id)
    // employees                       (FK from payroll_lines.employee_id)
    // accounts                        (FK from journal_lines.account_id)
    await client.query(
      `DELETE FROM payroll_lines WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM payroll_runs WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM journal_lines WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM journal_entries WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM attendance WHERE employee_id IN
         (SELECT id FROM employees WHERE company_id = $1)`,
      [companyId],
    );
    await client.query(
      `DELETE FROM employees WHERE company_id = $1`,
      [companyId],
    );
    // accounts.code is globally UNIQUE, so we drop *only* the placeholder
    // codes this suite owns — leaving other workspaces' charts untouched.
    await client.query(
      `DELETE FROM accounts WHERE company_id = $1 AND code LIKE $2`,
      [companyId, `PJL-${companyId}-%`],
    );

    // ---- (d) Seed two workspace-scoped accounts for the JE legs ----
    const cashRow = (
      await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
         VALUES ($1, $2, 'النقدية', 'Cash', 'asset', 'current_asset', false, true)
         RETURNING id`,
        [companyId, `PJL-${companyId}-CASH`],
      )
    ).rows[0];
    const cashId = Number(cashRow.id);
    const payableRow = (
      await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
         VALUES ($1, $2, 'رواتب مستحقة', 'Salaries Payable', 'liability', 'current_liability', false, true)
         RETURNING id`,
        [companyId, `PJL-${companyId}-PAY`],
      )
    ).rows[0];
    const payableId = Number(payableRow.id);

    // ---- (e) Seed one active employee so the row looks plausible ----
    await client.query(
      `INSERT INTO employees (company_id, full_name, job_title, hire_date,
                              base_salary, allowances, is_national, is_active)
       VALUES ($1, 'Payroll Link Tester', 'QA', '2024-01-15',
               '5000.00', '500.00', true, true)`,
      [companyId],
    );

    // ---- (f) Insert the journal entry + balanced lines ----
    // The reference is salted with the workspace id + a fresh timestamp
    // so re-runs of this suite never collide with leftover JE references
    // from prior runs in other workspaces.
    const jeReference = `JE-PJL-${companyId}-${Date.now()}`;
    const jeRow = (
      await client.query(
        `INSERT INTO journal_entries
           (company_id, reference, entry_date, description, source)
         VALUES ($1, $2, $3, $4, 'manual')
         RETURNING id`,
        [
          companyId,
          jeReference,
          entryDateUtc.toISOString(),
          `Payroll JE for ${entryDateStr}`,
        ],
      )
    ).rows[0];
    journalEntryId = Number(jeRow.id);
    await client.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, account_id, debit, credit, description)
       VALUES
         ($1, $2, $3, '5000.00', '0',       'Salaries payment'),
         ($1, $2, $4, '0',       '5000.00', 'Salaries payable')`,
      [companyId, journalEntryId, cashId, payableId],
    );

    // ---- (g) Insert the posted payroll run pointing at the JE ----
    // Year/month set to 2099 + a stable month so this row never collides
    // with any "real" payroll run a future test might post for the
    // current calendar period.
    const runRow = (
      await client.query<{ id: number }>(
        `INSERT INTO payroll_runs
           (company_id, year, month, status, total_gross, total_net, journal_entry_id)
         VALUES ($1, 2099, 4, 'posted', '5000.00', '5000.00', $2)
         RETURNING id`,
        [companyId, journalEntryId],
      )
    ).rows[0];
    runId = Number(runRow.id);
  } finally {
    await client.end();
  }

  // ---- (h) Forge a passport session + plant cookie + persist state ----
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: "E2E",
    lastName: "PayrollLink",
    storagePath: STORAGE_PATH,
    baseURL,
    afterCookiesPlanted: async (p) => {
      // Pre-seed `active_company_id` so the very first authenticated
      // render in the spec already targets the right workspace —
      // otherwise CompanyProvider has to resolve the active company
      // via /api/companies and the past-payroll-runs query can briefly
      // fire against the wrong scope.
      await p.goto(baseURL, { waitUntil: "domcontentloaded" });
      await p.evaluate((id) => {
        window.localStorage.setItem("active_company_id", String(id));
      }, companyId);
    },
  });

  // ---- (i) Persist canonical fixture ids so the spec stays in lock-step ----
  fs.mkdirSync(path.dirname(FIXTURES_PATH), { recursive: true });
  fs.writeFileSync(
    FIXTURES_PATH,
    JSON.stringify(
      { runId, journalEntryId, companyId, entryDateStr },
      null,
      2,
    ) + "\n",
    "utf8",
  );
});
