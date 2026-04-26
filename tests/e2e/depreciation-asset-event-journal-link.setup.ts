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
 * One-time auth + seed setup for the
 * `depreciation-asset-event-journal-link` spec.
 *
 * Sibling to `payroll-journal-link.setup.ts` — that suite locks the
 * "From: …" badge contract for the `payroll_run` branch of
 * `JournalEntrySourceKind` (server/storage.ts → buildJournalSourceLinkMap,
 * shared/schema.ts). This setup seeds the four remaining branches in
 * one workspace so the spec can prove the badge renders + disappears
 * cleanly for `depreciation_run`, `impairment`, `revaluation`, and
 * `disposal` on every JE-bearing surface (`/app/journal` row, JE detail
 * dialog, Recent admin activity feed on `/app/settings`).
 *
 * What this seeder does, in order:
 *   (a) Inserts (or refreshes) a known test user with a bcrypt password.
 *   (b) Ensures that user owns a fresh, isolated workspace via
 *       `memberships` (no `adoptOrphan` — we don't want sibling specs'
 *       leftover data to pollute the slice(0,5) admin-activity feed).
 *   (c) Wipes every prior fixture row this seeder has previously left
 *       in the workspace, in dependency order so the FK chain holds.
 *   (d) Inserts the 7 GL accounts the `asset_categories` FK chain
 *       requires, plus an asset_category and a single fixed_asset row
 *       so the impairment / revaluation / disposal events can FK back
 *       to a real asset.
 *   (e) Inserts four balanced two-line JEs dated to a non-today day
 *       inside the current calendar month (15th, or 16th when today
 *       *is* the 15th, at 12:00 UTC). The current-month date keeps
 *       them inside the default `month` PeriodChip range so they
 *       render on first paint of `/app/journal` without any deep-link
 *       gymnastics.
 *   (f) Inserts one upstream row per JE — depreciation_run, impairment,
 *       revaluation, disposal — each carrying `journal_entry_id` so
 *       `buildJournalSourceLinkMap` joins them back onto the JE. We
 *       deliberately do NOT insert any `depreciation_postings` for the
 *       seeded run because (i) the badge only needs the run row and
 *       (ii) postings would FK-block the upstream-delete leg of the
 *       spec.
 *   (g) Forges a passport session, plants the connect.sid cookie, and
 *       pre-seeds `active_company_id` in localStorage so the very
 *       first authenticated render in the spec already targets the
 *       right workspace.
 *   (h) Persists every fixture id (companyId, assetId, runId per kind,
 *       JE id per kind) to `.playwright/depreciation-asset-event-journal-link-fixtures.json`
 *       so the spec drives every assertion with the exact ids inserted.
 */

const TEST_EMAIL = "e2e-deprec-asset-je-link@example.test";
const TEST_PASSWORD = "playwright-deprec-asset-je-link-pw-2026";
const STORAGE_PATH = path.resolve(
  ".playwright/depreciation-asset-event-journal-link-state.json",
);
const FIXTURES_PATH = path.resolve(
  ".playwright/depreciation-asset-event-journal-link-fixtures.json",
);

/** YYYY-MM-DD for a Date in UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

setup(
  "authenticate + seed depreciation/asset-event journal-link fixtures",
  async ({ page }) => {
    const dbUrl = requireDbUrl("the depreciation-asset-event-journal-link setup");
    requireCookieSecret("the depreciation-asset-event-journal-link setup");

    // Pick an entry date inside the current calendar month that is NOT today
    // — same trick used by `payroll-journal-link.setup.ts`. The default
    // PeriodChip range on /app/journal is `month`, so the entry date must
    // sit inside that window for the JE cards to render on first paint.
    // Day 15 is always present in every month; if today happens to be the
    // 15th we fall back to the 16th (also always present). Noon UTC keeps
    // the date stable across local time zones.
    const now = new Date();
    const todayDayUtc = now.getUTCDate();
    const entryDay = todayDayUtc === 15 ? 16 : 15;
    const entryDateUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), entryDay, 12, 0, 0),
    );
    const entryDateStr = isoDate(entryDateUtc);
    const entryYear = entryDateUtc.getUTCFullYear();
    const entryMonth = entryDateUtc.getUTCMonth() + 1; // 1..12 for db column

    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    let userId: string;
    let companyId: number;
    let assetId: number;
    let depreciationRunId: number;
    let impairmentEventId: number;
    let revaluationEventId: number;
    let disposalEventId: number;
    let depreciationJeId: number;
    let impairmentJeId: number;
    let revaluationJeId: number;
    let disposalJeId: number;
    try {
      // ---- (a) Ensure the test user exists with a known password ----
      userId = await ensureUser(client, {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        firstName: "E2E",
        lastName: "DeprecAssetJeLink",
      });

      // ---- (b) Ensure the user owns a fresh isolated workspace ----
      // No adoptOrphan: the slice(0,5) admin-activity feed on
      // /app/settings would otherwise mix our seeded JEs with stale
      // entries another suite left behind.
      companyId = await ensureCompany(client, {
        userId,
        role: "owner",
        companyName: "E2E Depreciation+AssetEvent JE Link Co",
      });

      // ---- (c) Reset workspace seed in dependency order ----
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
      // depreciation_postings → depreciation_runs (composite FK). We don't
      // insert any postings, but a previous run of this seeder might have
      // left rows behind via a manual fix-up — drop defensively in dep
      // order anyway.
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
      // asset_categories owns 7 FKs into accounts; drop categories
      // before the placeholder accounts can go.
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
      // accounts.code is globally UNIQUE, so we drop *only* the
      // placeholder codes this suite owns — leaving other workspaces'
      // charts untouched.
      await client.query(
        `DELETE FROM accounts WHERE company_id = $1 AND code LIKE $2`,
        [companyId, `DAJL-${companyId}-%`],
      );

      // ---- (d) Seed the 7 GL accounts asset_categories needs --------
      // Pure placeholders — the spec asserts nothing about GL semantics,
      // only that the FK chain on fixed_assets / asset_categories
      // resolves so the upstream rows can be inserted.
      const accountIds: number[] = [];
      const accountSpecs: Array<{
        slot: string;
        type: string;
        subtype: string;
      }> = [
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
              `DAJL-${companyId}-${spec.slot}`,
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
              dep_expense_account_id, accumulated_imp_account_id,
              imp_loss_account_id, reval_surplus_account_id,
              gain_loss_disposal_account_id)
           VALUES ($1, $2, 'cost', 60, 'straight_line',
                   $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            companyId,
            `DAJL Category ${companyId}`,
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
             (company_id, category_id, code, name, acquisition_date,
              in_service_date, currency, tx_cost, fx_rate, cost, residual,
              useful_life_months, method, measurement_model, status)
           VALUES ($1, $2, $3, 'Depreciation+Event Link Asset',
                   '2099-01-01', '2099-01-01',
                   'USD', '12000.00', '1', '12000.00', '0', 60,
                   'straight_line', 'cost', 'active')
           RETURNING id`,
          [companyId, categoryId, `DAJL-A-${companyId}`],
        )
      ).rows[0];
      assetId = Number(asset.id);

      // ---- (e) Insert four balanced two-line JEs --------------------
      // The legs use the asset_cost / accum_dep accounts arbitrarily —
      // the spec asserts only that the JE id round-trips through the
      // source-link badge, so the leg accounts don't need to match the
      // semantically-correct GL pairing for each event kind.
      const insertJe = async (reference: string, description: string) => {
        const jeRow = (
          await client.query<{ id: number }>(
            `INSERT INTO journal_entries
               (company_id, reference, entry_date, description, source)
             VALUES ($1, $2, $3, $4, 'manual')
             RETURNING id`,
            [companyId, reference, entryDateUtc.toISOString(), description],
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

      // Reference is salted with the workspace id + a fresh timestamp
      // so re-runs of this suite never collide with leftover JE
      // references from prior runs in other workspaces.
      const stamp = Date.now();
      depreciationJeId = await insertJe(
        `JE-DAJL-DR-${companyId}-${stamp}`,
        `Depreciation JE for ${entryDateStr}`,
      );
      impairmentJeId = await insertJe(
        `JE-DAJL-IMP-${companyId}-${stamp + 1}`,
        `Impairment JE for ${entryDateStr}`,
      );
      revaluationJeId = await insertJe(
        `JE-DAJL-REV-${companyId}-${stamp + 2}`,
        `Revaluation JE for ${entryDateStr}`,
      );
      disposalJeId = await insertJe(
        `JE-DAJL-DIS-${companyId}-${stamp + 3}`,
        `Disposal JE for ${entryDateStr}`,
      );

      // ---- (f) Insert the upstream rows pointing back at each JE ----
      // depreciation_runs → JE-DR. We use the entry-date's year/month so
      // the badge label ("Depreciation MMM YYYY") naturally matches the
      // entry's calendar period.
      const drRow = (
        await client.query<{ id: number }>(
          `INSERT INTO depreciation_runs
             (company_id, year, month, status, total_amount,
              journal_entry_id, posted_at)
           VALUES ($1, $2, $3, 'posted', '100.00', $4, NOW())
           RETURNING id`,
          [companyId, entryYear, entryMonth, depreciationJeId],
        )
      ).rows[0];
      depreciationRunId = Number(drRow.id);

      // impairment_events → JE-IMP
      const impRow = (
        await client.query<{ id: number }>(
          `INSERT INTO impairment_events
             (company_id, asset_id, event_date, recoverable_amount,
              loss_amount, journal_entry_id)
           VALUES ($1, $2, $3, '5000.00', '500.00', $4)
           RETURNING id`,
          [companyId, assetId, entryDateStr, impairmentJeId],
        )
      ).rows[0];
      impairmentEventId = Number(impRow.id);

      // revaluation_events → JE-REV
      const revRow = (
        await client.query<{ id: number }>(
          `INSERT INTO revaluation_events
             (company_id, asset_id, event_date, fair_value, method,
              surplus_delta, pl_impact, journal_entry_id)
           VALUES ($1, $2, $3, '13000.00', 'elimination',
                   '1000.00', '0', $4)
           RETURNING id`,
          [companyId, assetId, entryDateStr, revaluationJeId],
        )
      ).rows[0];
      revaluationEventId = Number(revRow.id);

      // disposals → JE-DIS. We do NOT flip fixed_assets.status to
      // 'disposed' so the asset stays insertable for the other event
      // tables (and so future maintenance of this seeder doesn't have
      // to re-flip it after a deletion).
      const dispRow = (
        await client.query<{ id: number }>(
          `INSERT INTO disposals
             (company_id, asset_id, event_date, proceeds, method,
              gain_loss, journal_entry_id)
           VALUES ($1, $2, $3, '8000.00', 'sale', '500.00', $4)
           RETURNING id`,
          [companyId, assetId, entryDateStr, disposalJeId],
        )
      ).rows[0];
      disposalEventId = Number(dispRow.id);
    } finally {
      await client.end();
    }

    // ---- (g) Forge a passport session + plant cookie + persist state ----
    const baseURL = `http://127.0.0.1:${process.env.PORT || "5000"}`;
    await forgeSession({
      page,
      dbUrl,
      userId,
      email: TEST_EMAIL,
      firstName: "E2E",
      lastName: "DeprecAssetJeLink",
      storagePath: STORAGE_PATH,
      baseURL,
      afterCookiesPlanted: async (p) => {
        // Pre-seed `active_company_id` so the very first authenticated
        // render in the spec already targets the right workspace.
        await p.goto(baseURL, { waitUntil: "domcontentloaded" });
        await p.evaluate((id) => {
          window.localStorage.setItem("active_company_id", String(id));
        }, companyId);
      },
    });

    // ---- (h) Persist canonical fixture ids ----
    fs.mkdirSync(path.dirname(FIXTURES_PATH), { recursive: true });
    fs.writeFileSync(
      FIXTURES_PATH,
      JSON.stringify(
        {
          companyId,
          assetId,
          entryDateStr,
          depreciationRunId,
          impairmentEventId,
          revaluationEventId,
          disposalEventId,
          depreciationJeId,
          impairmentJeId,
          revaluationJeId,
          disposalJeId,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  },
);
