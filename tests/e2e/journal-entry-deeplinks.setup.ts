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
 * One-time auth + seed setup for the `journal-entry-deeplinks` spec.
 *
 * The spec locks in the JE deep-link contract that crosses the Inbox
 * and Fixed-Assets pages: every JE reference is a real `<a>` whose
 * `href` is `/app/journal#je-<id>`. A future refactor of the inbox
 * posted strip, the fixed-assets depreciation runs table, or the
 * asset-detail dialog (history / impairments tabs) could silently
 * regress these into plain text — and there is no other automated
 * coverage that would catch it. This setup seeds the minimum data the
 * spec needs to assert each link in turn:
 *
 *   (a) A workspace owned by a fresh test user.
 *   (b) Six JEs (one per JE-bearing surface the spec covers):
 *         • JE-A backs a `documents` row in status='posted' (inbox
 *           detail strip + inbox "Recently posted" panel).
 *         • JE-B backs a posted `depreciation_runs` row + its
 *           `depreciation_postings` row (fixed-assets depreciation tab
 *           + asset-detail history tab).
 *         • JE-C backs an `impairment_events` row (asset-detail
 *           impairments tab + history tab).
 *         • JE-D backs a `revaluation_events` row (asset-detail
 *           revaluations tab + history tab).
 *         • JE-E backs a `disposals` row (asset-detail disposals tab
 *           + history tab).
 *         • JE-F has `source_transaction_id` set to a seeded
 *           `transactions` row (transaction detail dialog "Posted as
 *           JE-…" badge — task #192). A second `transactions` row is
 *           seeded with no JE so the spec can also assert the badge is
 *           hidden when no link exists.
 *   (c) The single asset_category + 7 GL accounts the FK chain on
 *       fixed_assets requires, plus a single fixed_assets row.
 *   (d) A passport session forged + planted in the browser context
 *       with `active_company_id` pre-seeded so the very first
 *       authenticated render hits the right workspace scope.
 *   (e) A fixtures JSON written under `.playwright/` so the spec
 *       drives the deep links with the exact ids that were inserted
 *       (no clock drift between setup and spec).
 *
 * Re-runs are deterministic: every prior row this seeder owns in the
 * workspace is wiped in dependency order before re-seeding. Account
 * codes are salted with the workspace id so they never collide with
 * the globally-unique `accounts.code` column when other suites share
 * the database.
 */

const TEST_EMAIL = "e2e-je-deeplinks@example.test";
const TEST_PASSWORD = "playwright-je-deeplinks-pw-2026";
const STORAGE_PATH = path.resolve(".playwright/je-deeplinks-state.json");
const FIXTURES_PATH = path.resolve(".playwright/je-deeplinks-fixtures.json");

setup("authenticate + seed JE deep-link fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the journal-entry-deeplinks setup");
  requireCookieSecret("the journal-entry-deeplinks setup");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  let userId: string;
  let companyId: number;
  let assetId: number;
  let runId: number;
  let postingId: number;
  let impairmentEventId: number;
  let revaluationEventId: number;
  let disposalEventId: number;
  let documentId: number;
  let txWithJeId: number;
  let txNoJeId: number;
  let postedJeId: number; // JE-A
  let depreciationJeId: number; // JE-B
  let impairmentJeId: number; // JE-C
  let revaluationJeId: number; // JE-D
  let disposalJeId: number; // JE-E
  let txJeId: number; // JE-F
  try {
    // ---- (a) Ensure the test user + workspace exist ----
    userId = await ensureUser(client, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      firstName: "E2E",
      lastName: "JeLinks",
    });
    companyId = await ensureCompany(client, {
      userId,
      role: "owner",
      companyName: "E2E JE Deep-Links Co",
    });

    // ---- Reset the workspace seed in dependency order ---------------
    // documents references journal_entries via composite FK.
    await client.query(`DELETE FROM documents WHERE company_id = $1`, [
      companyId,
    ]);
    // Fixed-asset event tables FK back to fixed_assets + journal_entries.
    await client.query(
      `DELETE FROM impairment_events WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM revaluation_events WHERE company_id = $1`,
      [companyId],
    );
    await client.query(`DELETE FROM disposals WHERE company_id = $1`, [
      companyId,
    ]);
    // depreciation_postings → depreciation_runs (composite FK)
    await client.query(
      `DELETE FROM depreciation_postings WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM depreciation_schedule WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM depreciation_runs WHERE company_id = $1`,
      [companyId],
    );
    // asset_components → fixed_assets (composite FK)
    await client.query(
      `DELETE FROM asset_components WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM fixed_assets WHERE company_id = $1`,
      [companyId],
    );
    // asset_categories owns 7 FKs into accounts; drop categories before
    // accounts so the placeholder accounts can go.
    await client.query(
      `DELETE FROM asset_categories WHERE company_id = $1`,
      [companyId],
    );
    // journal_lines → journal_entries (composite FK).
    await client.query(
      `DELETE FROM journal_lines WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM journal_entries WHERE company_id = $1`,
      [companyId],
    );
    // `transactions` is wiped after journal_entries because the JE row
    // carries `source_transaction_id` — there is no FK today, but
    // dropping the JEs first keeps the data state internally consistent
    // even if a future migration adds one.
    await client.query(
      `DELETE FROM transactions WHERE company_id = $1`,
      [companyId],
    );
    // accounts.code is globally UNIQUE, so we drop *only* the placeholder
    // codes this suite owns — leaving other workspaces' charts untouched.
    await client.query(
      `DELETE FROM accounts WHERE company_id = $1 AND code LIKE $2`,
      [companyId, `JEDL-${companyId}-%`],
    );

    // ---- (c) Seed the 7 GL accounts asset_categories needs ---------
    // We don't depreciate or post anything for real here — these are
    // pure placeholders so the FK chain on fixed_assets resolves.
    const accountIds: number[] = [];
    const accountSpecs: Array<{ slot: string; type: string; subtype: string }> = [
      { slot: "ASSET-COST", type: "asset", subtype: "non_current_asset" },
      { slot: "ACCUM-DEP", type: "asset", subtype: "non_current_asset" },
      { slot: "DEP-EXPENSE", type: "expense", subtype: "operating_expense" },
      { slot: "ACCUM-IMP", type: "asset", subtype: "non_current_asset" },
      { slot: "IMP-LOSS", type: "expense", subtype: "operating_expense" },
      { slot: "REVAL-SURPLUS", type: "equity", subtype: "equity" },
      { slot: "GAIN-LOSS-DISPOSAL", type: "equity", subtype: "equity" },
    ];
    for (const spec of accountSpecs) {
      const row = (
        await client.query<{ id: number }>(
          `INSERT INTO accounts
             (company_id, code, name_ar, name_en, type, subtype,
              is_header, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, false, true)
           RETURNING id`,
          [
            companyId,
            `JEDL-${companyId}-${spec.slot}`,
            `حساب ${spec.slot}`,
            `Account ${spec.slot}`,
            spec.type,
            spec.subtype,
          ],
        )
      ).rows[0];
      accountIds.push(Number(row.id));
    }
    const [
      assetCostId,
      accumDepId,
      depExpenseId,
      accumImpId,
      impLossId,
      revalSurplusId,
      gainLossDisposalId,
    ] = accountIds;

    const cat = (
      await client.query<{ id: number }>(
        `INSERT INTO asset_categories
           (company_id, name, measurement_model, default_useful_life_months,
            default_method, asset_cost_account_id, accumulated_dep_account_id,
            dep_expense_account_id, accumulated_imp_account_id, imp_loss_account_id,
            reval_surplus_account_id, gain_loss_disposal_account_id)
         VALUES ($1, $2, 'cost', 60, 'straight_line',
                 $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          companyId,
          `JEDL Category ${companyId}`,
          assetCostId,
          accumDepId,
          depExpenseId,
          accumImpId,
          impLossId,
          revalSurplusId,
          gainLossDisposalId,
        ],
      )
    ).rows[0];
    const categoryId = Number(cat.id);

    const asset = (
      await client.query<{ id: number }>(
        `INSERT INTO fixed_assets
           (company_id, category_id, code, name, acquisition_date, in_service_date,
            currency, tx_cost, fx_rate, cost, residual, useful_life_months,
            method, measurement_model, status)
         VALUES ($1, $2, $3, 'JE Link Asset', '2099-01-01', '2099-01-01',
                 'USD', '12000.00', '1', '12000.00', '0', 60,
                 'straight_line', 'cost', 'active')
         RETURNING id`,
        [companyId, categoryId, `JEDL-A-${companyId}`],
      )
    ).rows[0];
    assetId = Number(asset.id);

    // ---- (b) Seed three balanced JEs --------------------------------
    // Helper: insert a balanced two-line JE and return its id. Uses the
    // first two seeded accounts (asset_cost / accum_dep) as the legs —
    // the spec does not assert any GL semantics, only that the JE id
    // round-trips through the deep link, so the leg accounts are
    // arbitrary as long as both live in this workspace.
    const insertJe = async (
      reference: string,
      description: string,
      opts: {
        source?: string;
        sourceTransactionId?: number | null;
      } = {},
    ) => {
      const jeRow = (
        await client.query<{ id: number }>(
          `INSERT INTO journal_entries
             (company_id, reference, entry_date, description, source,
              source_transaction_id)
           VALUES ($1, $2, '2099-06-15T12:00:00Z', $3, $4, $5)
           RETURNING id`,
          [
            companyId,
            reference,
            description,
            opts.source ?? "manual",
            opts.sourceTransactionId ?? null,
          ],
        )
      ).rows[0];
      const jeId = Number(jeRow.id);
      await client.query(
        `INSERT INTO journal_lines
           (company_id, journal_entry_id, account_id, debit, credit, description)
         VALUES
           ($1, $2, $3, '100.00', '0',      'debit leg'),
           ($1, $2, $4, '0',      '100.00', 'credit leg')`,
        [companyId, jeId, assetCostId, accumDepId],
      );
      return jeId;
    };

    postedJeId = await insertJe(
      `JE-DOC-${companyId}-${Date.now()}`,
      "Inbox-posted document JE",
    );
    depreciationJeId = await insertJe(
      `JE-DR-${companyId}-${Date.now() + 1}`,
      "Depreciation run JE",
    );
    impairmentJeId = await insertJe(
      `JE-IMP-${companyId}-${Date.now() + 2}`,
      "Impairment event JE",
    );
    revaluationJeId = await insertJe(
      `JE-REV-${companyId}-${Date.now() + 3}`,
      "Revaluation event JE",
    );
    disposalJeId = await insertJe(
      `JE-DIS-${companyId}-${Date.now() + 4}`,
      "Disposal event JE",
    );

    // ---- Posted depreciation_run + posting linked to JE-B ----------
    // year=2099, month=6 → asset detail history tab will render this
    // posting on date 2099-06-28.
    const runRow = (
      await client.query<{ id: number }>(
        `INSERT INTO depreciation_runs
           (company_id, year, month, status, total_amount, journal_entry_id,
            posted_at)
         VALUES ($1, 2099, 6, 'posted', '100.00', $2, NOW())
         RETURNING id`,
        [companyId, depreciationJeId],
      )
    ).rows[0];
    runId = Number(runRow.id);

    const postingRow = (
      await client.query<{ id: number }>(
        `INSERT INTO depreciation_postings
           (company_id, run_id, asset_id, amount)
         VALUES ($1, $2, $3, '100.00')
         RETURNING id`,
        [companyId, runId, assetId],
      )
    ).rows[0];
    postingId = Number(postingRow.id);

    // ---- impairment_events linked to JE-C --------------------------
    // event_date = '2099-06-30' so it sorts AFTER the depreciation
    // posting (date 2099-06-28) in the asset-detail history tab —
    // making `link-journal-entry-history-0` deterministically the
    // depreciation row and `link-journal-entry-history-1` the
    // impairment row.
    const impEvent = (
      await client.query<{ id: number }>(
        `INSERT INTO impairment_events
           (company_id, asset_id, event_date, recoverable_amount,
            loss_amount, journal_entry_id)
         VALUES ($1, $2, '2099-06-30', '5000.00', '500.00', $3)
         RETURNING id`,
        [companyId, assetId, impairmentJeId],
      )
    ).rows[0];
    impairmentEventId = Number(impEvent.id);

    // ---- revaluation_events linked to JE-D --------------------------
    // event_date = '2099-07-15' so it sorts AFTER the impairment row
    // in the unified history feed → existing history-0 (depreciation
    // 2099-06-28) and history-1 (impairment 2099-06-30) indices stay
    // stable for the original assertions.
    const revEvent = (
      await client.query<{ id: number }>(
        `INSERT INTO revaluation_events
           (company_id, asset_id, event_date, fair_value, method,
            surplus_delta, pl_impact, journal_entry_id)
         VALUES ($1, $2, '2099-07-15', '13000.00', 'elimination',
                 '1000.00', '0', $3)
         RETURNING id`,
        [companyId, assetId, revaluationJeId],
      )
    ).rows[0];
    revaluationEventId = Number(revEvent.id);

    // ---- disposals linked to JE-E ----------------------------------
    // event_date = '2099-07-20' (latest in the seeded asset history).
    // We insert the row directly — we do NOT flip fixed_assets.status
    // to 'disposed' so the asset stays visible / openable in the
    // register and its detail dialog still surfaces every tab.
    const dispEvent = (
      await client.query<{ id: number }>(
        `INSERT INTO disposals
           (company_id, asset_id, event_date, proceeds, method,
            gain_loss, journal_entry_id)
         VALUES ($1, $2, '2099-07-20', '8000.00', 'sale',
                 '500.00', $3)
         RETURNING id`,
        [companyId, assetId, disposalJeId],
      )
    ).rows[0];
    disposalEventId = Number(dispEvent.id);

    // ---- Posted document linked to JE-A ----------------------------
    // The inbox auto-selects the first row, so a single posted document
    // is enough to render the "Posted as journal entry #N" strip on
    // first paint without any extra clicks.
    const extracted = {
      vendor: "JE Link Vendor",
      invoiceNumber: "INV-LINK-001",
      documentDate: "2099-06-15",
      currency: "USD",
      subtotal: 100,
      vatAmount: 0,
      vatRate: 0,
      total: 100,
      paymentMethod: "cash",
      category: "office",
      documentType: "invoice",
      language: "en",
      lineItems: [],
      confidence: 0.99,
      notes: null,
    };
    const docRow = (
      await client.query<{ id: number }>(
        `INSERT INTO documents
           (company_id, file_name, mime_type, size_bytes, storage_path,
            status, extracted_json, journal_entry_id, uploaded_by,
            uploaded_at, extracted_at, posted_at)
         VALUES ($1, 'je-link-receipt.pdf', 'application/pdf', 1024,
                 '/tmp/je-link-receipt.pdf', 'posted', $2::jsonb, $3, $4,
                 NOW(), NOW(), NOW())
         RETURNING id`,
        [companyId, JSON.stringify(extracted), postedJeId, userId],
      )
    ).rows[0];
    documentId = Number(docRow.id);

    // ---- Two transactions + JE-F linked to the first via -----------
    // `source_transaction_id`. The transaction list page filters by
    // the active period (defaults to "month"), so both rows use NOW()
    // to land inside whatever calendar month the test runs in. The
    // descriptions are unique so the spec's row locators never collide
    // with sibling test data.
    const txWithJeRow = (
      await client.query<{ id: number }>(
        `INSERT INTO transactions
           (company_id, type, amount, description, category, date)
         VALUES ($1, 'expense', '42.00',
                 'JE Link Tx With JE', 'office', NOW())
         RETURNING id`,
        [companyId],
      )
    ).rows[0];
    txWithJeId = Number(txWithJeRow.id);

    const txNoJeRow = (
      await client.query<{ id: number }>(
        `INSERT INTO transactions
           (company_id, type, amount, description, category, date)
         VALUES ($1, 'income', '99.00',
                 'JE Link Tx No JE', 'sales', NOW())
         RETURNING id`,
        [companyId],
      )
    ).rows[0];
    txNoJeId = Number(txNoJeRow.id);

    // JE-F: source='transaction' + source_transaction_id matches the
    // first txn so `getTransactions` joins the JE id/reference back
    // onto the row and the detail dialog renders the badge.
    txJeId = await insertJe(
      `JE-TX-${companyId}-${Date.now() + 5}`,
      "Auto-posted txn JE",
      { source: "transaction", sourceTransactionId: txWithJeId },
    );
  } finally {
    await client.end();
  }

  // ---- (d) Forge the passport session + plant the cookie ----------
  const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  await forgeSession({
    page,
    dbUrl,
    userId,
    email: TEST_EMAIL,
    firstName: "E2E",
    lastName: "JeLinks",
    storagePath: STORAGE_PATH,
    baseURL,
    afterCookiesPlanted: async (p) => {
      // Pre-seed `active_company_id` so the first authenticated render
      // already targets the right workspace — otherwise the inbox /
      // fixed-assets queries can briefly fire against a stale scope
      // while CompanyProvider resolves /api/companies.
      await p.goto(baseURL, { waitUntil: "domcontentloaded" });
      await p.evaluate((id) => {
        window.localStorage.setItem("active_company_id", String(id));
      }, companyId);
    },
  });

  // ---- (e) Persist canonical fixture ids --------------------------
  fs.mkdirSync(path.dirname(FIXTURES_PATH), { recursive: true });
  fs.writeFileSync(
    FIXTURES_PATH,
    JSON.stringify(
      {
        companyId,
        assetId,
        runId,
        postingId,
        impairmentEventId,
        revaluationEventId,
        disposalEventId,
        documentId,
        txWithJeId,
        txNoJeId,
        postedJeId,
        depreciationJeId,
        impairmentJeId,
        revaluationJeId,
        disposalJeId,
        txJeId,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
});
