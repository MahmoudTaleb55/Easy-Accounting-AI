import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import {
  ensureCompany,
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";
import { gotoWithPinnedLocale } from "./_helpers/pin-locale";

/**
 * Regression net for Task #267 — the `<JournalEntryRefLink>` wrapper is
 * the safety net that keeps a user from dead-ending when they tap a JE
 * link on Transactions, Inbox, HR/Payroll, Fixed Assets, or the AI
 * Assistant *after* the linked journal entry has been cascade-reversed.
 *
 * The risk this spec pins down is a future refactor that swaps the
 * wrapper back to a plain `<Link href={`/app/journal#je-${id}`}>` on any
 * of those surfaces. That would silently re-introduce the broken-link
 * UX (clicking lands on the JE page, the JE no longer exists, scroll-to
 * happens against nothing, no fallback dialog). The unit-level coverage
 * for the wrapper itself does not exercise the cross-page surface, so
 * without this end-to-end the regression would not fail any committed
 * test.
 *
 * What we exercise:
 *   1. Seed a workspace, two GL accounts, and a manually-posted JE.
 *   2. Insert a `payroll_runs` row directly that points at the JE via
 *      its `journal_entry_id` column. HR/Payroll is the chosen
 *      "non-journal" surface — its JE chip is rendered through
 *      `<JournalEntryRefLink>` (see hr.tsx → PayrollTab) and, unlike
 *      Transactions (where `journalEntryId` is derived from a join on
 *      `source_transaction_id`), the column is persisted on the source
 *      row. That persistence is what lets the "JE is gone but the
 *      source row still references it" state actually exist on screen.
 *   3. Open `/app/hr`, switch to the payroll tab, and assert the chip
 *      renders as a *live* link (no `-reversed` test-id suffix and no
 *      `data-reversed="true"` attribute).
 *   4. Hit `DELETE /api/journal-entries/:id` directly — sidesteps the
 *      cascade-reverse helper's source-row delete so the payroll_run
 *      row survives pointing at a now-vanished JE. The route writes a
 *      `delete` audit row in the same transaction (storage.ts →
 *      `deleteJournalEntry` task #222), which is what the tombstone
 *      dialog reads back via `/api/audit/journal_entry/:id/with-reversal`.
 *   5. Reload + re-open the payroll tab and assert the chip has
 *      *swapped* into the reversed branch (test-id now has the
 *      `-reversed` suffix and carries `data-reversed="true"`).
 *   6. Click the reversed chip and assert `dialog-entry-reversed` opens
 *      and shows real audit content (the timeline isn't in its empty
 *      state). That last leg is the load-bearing assertion: it proves
 *      the wrapper is wired to `ReversedJournalEntryDialog`, which is
 *      wired to `HistoryTimeline` with `includeReversal`, which hits
 *      the reversal-aware audit endpoint on the server.
 *
 * Auth — uses the shared `forgeSession` helper rather than driving the
 * public signup endpoint so re-runs don't trip the signup rate
 * limiter, matching the pattern in `account-ledger-jump-nearest.spec.ts`.
 */

const TEST_EMAIL = "e2e-je-ref-link-crosspage@example.test";
const TEST_PASSWORD = "playwright-je-ref-link-crosspage-pw-2026";
const BASE_URL = `http://127.0.0.1:${process.env.PORT || "5000"}`;

interface Seed {
  companyId: number;
  payrollRunId: number;
  journalEntryId: number;
}

/**
 * Stand up a deterministic workspace for the spec — idempotent across
 * runs so we can re-execute without leaking state. The cross-page chip
 * branch under test only needs:
 *   • two distinct GL accounts (debit + credit) so the JE balances
 *   • one journal_entries row + matching journal_lines rows
 *   • one payroll_runs row whose `journal_entry_id` column points at
 *     the JE above
 * No employees / payroll_lines / IFRS chart of accounts needed because
 * the page only renders the run row's status + JE chip on the payroll
 * tab.
 */
async function seedWorkspace(page: Page): Promise<Seed> {
  const dbUrl = requireDbUrl("journal-entry-ref-link-cross-page spec");
  requireCookieSecret("journal-entry-ref-link-cross-page spec");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let companyId: number;
  let payrollRunId: number;
  let journalEntryId: number;
  try {
    const userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "JE",
      lastName: "RefLinkCrossPage",
      preferredLocale: "en",
    });
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E JE RefLink Cross-Page Co",
    });

    // Reset between runs in dependency order so the FK chain holds:
    // payroll_runs → journal_entries (via journal_entry_id, no cascade),
    // journal_lines → journal_entries (composite FK).
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
    // accounts.code is globally UNIQUE — drop only the placeholder codes
    // this suite owns so we don't trample sibling specs.
    await client.query(
      `DELETE FROM accounts WHERE company_id = $1 AND code LIKE $2`,
      [companyId, `JERLCP-${companyId}-%`],
    );

    // Two GL accounts so the JE has a real debit + credit pair. The
    // `payrollRuns` row only needs the JE id; the lines exist just so
    // the JE itself is well-formed (and so the dialog has something
    // meaningful to show in the snapshot delete-audit row).
    const debitAccountId = Number(
      (
        await client.query<{ id: number }>(
          `INSERT INTO accounts
             (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
           VALUES ($1, $2, 'نقدية اختبار', 'Test Cash', 'asset', 'current_asset', false, true)
           RETURNING id`,
          [companyId, `JERLCP-${companyId}-CASH`],
        )
      ).rows[0].id,
    );
    const creditAccountId = Number(
      (
        await client.query<{ id: number }>(
          `INSERT INTO accounts
             (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
           VALUES ($1, $2, 'رواتب مستحقة اختبار', 'Test Salaries Payable',
                   'liability', 'current_liability', false, true)
           RETURNING id`,
          [companyId, `JERLCP-${companyId}-SALPAY`],
        )
      ).rows[0].id,
    );

    journalEntryId = Number(
      (
        await client.query<{ id: number }>(
          `INSERT INTO journal_entries
             (company_id, reference, entry_date, description, source)
           VALUES ($1, $2, NOW(), $3, 'manual')
           RETURNING id`,
          [
            companyId,
            `JE-CROSSPAGE-${Date.now()}`,
            "Cross-page JE link regression seed",
          ],
        )
      ).rows[0].id,
    );
    await client.query(
      `INSERT INTO journal_lines
         (company_id, journal_entry_id, account_id, debit, credit, description)
       VALUES
         ($1, $2, $3, '1000.00', '0',     'Salary expense'),
         ($1, $2, $4, '0',       '1000.00','Salary payable')`,
      [companyId, journalEntryId, debitAccountId, creditAccountId],
    );

    // The HR PayrollTab renders this row in its "past runs" table and
    // keys the JE chip's test-id by the payroll_run id.
    payrollRunId = Number(
      (
        await client.query<{ id: number }>(
          `INSERT INTO payroll_runs
             (company_id, year, month, status, total_gross, total_net, journal_entry_id)
           VALUES ($1, 2099, 1, 'posted', '1000.00', '900.00', $2)
           RETURNING id`,
          [companyId, journalEntryId],
        )
      ).rows[0].id,
    );

    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL,
      firstName: "JE",
      lastName: "RefLinkCrossPage",
      baseURL: BASE_URL,
      afterCookiesPlanted: async (p) => {
        await p.goto(BASE_URL, { waitUntil: "domcontentloaded" });
        await p.evaluate((id) => {
          window.localStorage.setItem("active_company_id", String(id));
        }, companyId);
      },
    });
  } finally {
    await client.end();
  }

  return { companyId, payrollRunId, journalEntryId };
}

test.describe("JournalEntryRefLink cross-page tombstone @ui", () => {
  test("HR/Payroll JE chip swaps to reversed dialog after the JE is deleted", async ({
    page,
  }) => {
    const seed = await seedWorkspace(page);

    // Pin the SPA to English so the wrapper renders the English
    // "reversed" hint and the dialog's English copy. The HR page chrome
    // is hard-coded Arabic but every test-id we drive the assertions
    // off (`tab-payroll`, `link-journal-entry-<id>`, `dialog-entry-reversed`,
    // `reversed-entry-history`, `history-empty`) is locale-independent.
    await gotoWithPinnedLocale(page, "/app/hr", { locale: "en" });
    await page
      .getByTestId("hr-page")
      .waitFor({ state: "visible", timeout: 15_000 });

    // Switch to the payroll tab — the past-runs table (and therefore
    // the JE chip) only mounts inside `<TabsContent value="payroll">`.
    await page.getByTestId("tab-payroll").click();

    // Live branch: the chip must render as an ordinary deep-link to
    // the JE page. The wrapper exposes the reversed branch under a
    // `-reversed` test-id suffix and stamps `data-reversed="true"`,
    // so the live branch is "the test-id without the suffix is
    // visible AND it has no data-reversed attribute".
    const liveChip = page.getByTestId(`link-journal-entry-${seed.payrollRunId}`);
    await expect(liveChip).toBeVisible({ timeout: 15_000 });
    await expect(liveChip).toHaveAttribute("href", `/app/journal#je-${seed.journalEntryId}`);
    await expect(liveChip).not.toHaveAttribute("data-reversed", "true");
    await expect(
      page.getByTestId(`link-journal-entry-${seed.payrollRunId}-reversed`),
    ).toHaveCount(0);

    // Direct DELETE — bypasses `reverseAutoPostedJournalEntry` so the
    // payroll_run row survives pointing at a vanished JE. That's the
    // exact post-cascade state on screen for any source-row table that
    // persists `journal_entry_id` (payroll_runs, depreciation_runs,
    // impairment_events, revaluation_events, disposals, documents,
    // sales_invoices). The route writes a `delete` audit row in the
    // same transaction so the tombstone dialog has reversal audit
    // content to render.
    const del = await page.request.delete(
      `/api/journal-entries/${seed.journalEntryId}`,
      { headers: { "x-company-id": String(seed.companyId) } },
    );
    expect(
      del.status(),
      `expected DELETE /api/journal-entries/${seed.journalEntryId} → 204, got ${del.status()}: ${await del.text()}`,
    ).toBe(204);

    // Reload so the React Query cache for `/api/journal-entries`
    // refetches against the now-empty list. Without the reload the
    // cached list still includes the deleted JE id and the chip would
    // continue to render the live branch (which is the wrapper's
    // "treat data not loaded yet as live" guard, intentional).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("hr-page")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("tab-payroll").click();

    // Reversed branch: the chip's test-id picks up the `-reversed`
    // suffix, the underlying element is a button (not an anchor) so
    // there's no `href`, and `data-reversed="true"` is set.
    const reversedChip = page.getByTestId(
      `link-journal-entry-${seed.payrollRunId}-reversed`,
    );
    await expect(reversedChip).toBeVisible({ timeout: 15_000 });
    await expect(reversedChip).toHaveAttribute("data-reversed", "true");
    await expect(
      page.getByTestId(`link-journal-entry-${seed.payrollRunId}`),
    ).toHaveCount(0);

    // Clicking the reversed chip must surface the local tombstone
    // dialog — the whole point of the wrapper is to never let the
    // click 404. The dialog body re-uses `HistoryTimeline` mounted
    // with `includeReversal`, which hits
    // `/api/audit/journal_entry/:id/with-reversal`.
    await reversedChip.click();
    const dialog = page.getByTestId("dialog-entry-reversed");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The dialog must carry the JE id chip in its title so auditors
    // can confirm which entry they're looking at even though the row
    // no longer exists in the GL.
    await expect(dialog).toContainText(`JE #${seed.journalEntryId}`);

    // The reversal audit timeline must render real content (not the
    // empty placeholder). The `delete` audit row written by the
    // route's transaction is what the timeline shows here — if a
    // future refactor stops writing that row, or stops routing the
    // dialog through the reversal-aware endpoint, this assertion
    // fails.
    const history = dialog.getByTestId("reversed-entry-history");
    await expect(history).toBeVisible();
    const timeline = history.getByTestId("history-timeline");
    await expect(timeline).toBeVisible({ timeout: 10_000 });
    await expect(
      history.getByTestId("history-empty"),
      "the reversal-aware audit endpoint must surface the delete audit row written by the JE delete route",
    ).toHaveCount(0);
  });
});
