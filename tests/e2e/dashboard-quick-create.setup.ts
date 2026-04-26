import { test as setup } from "@playwright/test";
import pg from "pg";
import path from "node:path";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * One-time auth + seed setup for the dashboard-quick-create spec.
 *
 * The dashboard's attention queue surfaces an "inactivity" card whenever
 * the workspace has at least one transaction but none in the last 7 days
 * (see `client/src/components/dashboard/attention-queue.tsx`). That card
 * deep-links to `/app/transactions?new=1` so the create dialog auto-opens
 * — the same shortcut behaviour as the topbar Plus-menu and command
 * palette. Only the topbar shortcut is currently exercised end-to-end
 * (`tests/e2e/quick-actions.spec.ts`); a regression in the attention-card
 * href, in the inactivity-detection logic, or in the destination page's
 * `?new=1` handling would silently break this dashboard click path.
 *
 * To exercise the inactivity card deterministically the workspace needs:
 *
 *   • a fresh, isolated workspace owned by this test user (so a sibling
 *     spec can't leave noise that flips the recent-7-days count above
 *     zero and hides the inactivity card);
 *   • exactly one transaction whose `date` column is older than 7 days,
 *     so the attention queue's `recent === 0 && txs.length > 0` branch
 *     fires. We pin the date 8 days back rather than relying on
 *     `defaultNow()` which would land the row inside the 7-day window
 *     and silently suppress the card.
 *
 * The user-creation + session-forging machinery is shared with the other
 * e2e setups via `tests/e2e/_helpers/forge-session.ts` so cookie-name /
 * secret-rotation / schema changes only need to be made in one place.
 */

const TEST_EMAIL = "e2e-dashboard-quick-create@example.test";
const TEST_PASSWORD = "playwright-dashboard-quick-create-pw-2026";
const TEST_FIRST = "E2E";
const TEST_LAST = "DashboardQuickCreate";
const STORAGE_PATH = path.resolve(
  ".playwright/dashboard-quick-create-state.json",
);

setup("authenticate + seed dashboard-quick-create fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the dashboard-quick-create setup");
  requireCookieSecret("the dashboard-quick-create setup");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
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
      companyName: "E2E Dashboard Quick Create Co",
    });

    // ---- (c) Reset the workspace's transactions so the attention-queue
    // counts are deterministic. Wipe journal_lines / journal_entries
    // first so the auto-posted JEs from previous runs don't leave dangling
    // FKs after the transactions DELETE, and so the dashboard's
    // `useDashboardJournalEntries` hook doesn't render extra
    // `pending_je` cards that could push the inactivity item past the
    // attention queue's `slice(0, 6)` cap.
    await client.query(
      `DELETE FROM journal_lines WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM journal_entries WHERE company_id = $1`,
      [companyId],
    );
    await client.query(`DELETE FROM transactions WHERE company_id = $1`, [
      companyId,
    ]);

    // ---- (d) Seed exactly one transaction older than 7 days ----
    // The attention queue's inactivity branch requires
    //   txs.length > 0 && recent-7-days count === 0
    // Pin the date 8 days back so a CI machine running on a slow clock
    // can't accidentally land the row inside the 7-day window.
    await client.query(
      `INSERT INTO transactions (company_id, type, amount, description, category, date)
       VALUES ($1, 'expense', '42.00', 'Stale activity transaction', 'Test', NOW() - INTERVAL '8 days')`,
      [companyId],
    );
  } finally {
    await client.end();
  }

  // ---- (e) Forge a passport session via the shared helper ----
  // Pre-seed `active_company_id` in the `afterCookiesPlanted` hook so
  // the CompanyProvider doesn't have to wait for `/api/companies` to
  // settle before the dashboard's attention queue mounts and renders
  // the inactivity card we're about to click.
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
});
