import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { storage } from "../storage";
import { withCompanyScope, withRlsBypass } from "../db";

/**
 * Task #275 regression: `deleteDepreciationRun` must roll back the per-asset
 * `accum_depreciation` deltas inside the same transaction that reverses the
 * journal entry, the run, and the postings. Pre-#275 the asset-balance
 * update ran in a `for` loop outside that transaction, so a mid-flight
 * failure left the JE/run/postings deleted while the asset balance stayed
 * stale.
 *
 * Driving storage directly (instead of through the HTTP layer) keeps the
 * auth surface out of the picture so the test can focus on the storage
 * method's transaction boundary.
 */

let pgc: pg.Client;
let companyId: number;
let assetId: number;
let triggerName: string;

const TAG = `t275_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  // Dedicated connection (separate from Drizzle's pool) so the trigger DDL
  // and inspection SELECTs are not part of the transaction under test. RLS
  // bypass so workspace_isolation policies don't filter out our SELECTs.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test");
  pgc = new pg.Client({ connectionString: dbUrl });
  await pgc.connect();
  await pgc.query(`SET app.rls_bypass = 'on'`);

  triggerName = `t275_dep_rollback_${TAG}`;

  // Minimal seed: company + 7 account stubs + asset_category + fixed_asset
  // via raw SQL with RLS bypass. Skips the IFRS chart-of-accounts seed the
  // public posting routes would otherwise demand.
  const co = await pgc.query<{ id: number }>(
    `INSERT INTO companies (name, functional_currency, currency_symbol, is_default, is_active)
     VALUES ($1, 'USD', '$', false, true)
     RETURNING id`,
    [`Task275 Co ${TAG}`],
  );
  companyId = co.rows[0].id;

  const accountIds: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = await pgc.query<{ id: number }>(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, false, true)
       RETURNING id`,
      [
        companyId,
        `7${i}50-${TAG}`,
        `حساب ${i}`,
        `Account ${i}`,
        i < 4 ? "asset" : i < 6 ? "expense" : "equity",
        i < 4 ? "non_current_asset" : i < 6 ? "operating_expense" : "equity",
      ],
    );
    accountIds.push(a.rows[0].id);
  }

  const cat = await pgc.query<{ id: number }>(
    `INSERT INTO asset_categories
       (company_id, name, measurement_model, default_useful_life_months,
        default_method, asset_cost_account_id, accumulated_dep_account_id,
        dep_expense_account_id, accumulated_imp_account_id, imp_loss_account_id,
        reval_surplus_account_id, gain_loss_disposal_account_id)
     VALUES ($1, $2, 'cost', 60, 'straight_line',
             $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [companyId, `Cat ${TAG}`, ...accountIds],
  );
  const categoryId = cat.rows[0].id;

  // Opening balance > run total so the rollback exercises a clean
  // 500 - 120 = 380 (rather than being clamped to zero by Math.max).
  const asset = await pgc.query<{ id: number }>(
    `INSERT INTO fixed_assets
       (company_id, category_id, code, name, acquisition_date, in_service_date,
        currency, tx_cost, fx_rate, cost, residual, useful_life_months,
        method, measurement_model, status, accum_depreciation)
     VALUES ($1, $2, $3, $4, '2099-01-01', '2099-01-01',
             'USD', '10000.00', '1', '10000.00', '0', 60,
             'straight_line', 'cost', 'active', '500.00')
     RETURNING id`,
    [companyId, categoryId, `A-${TAG}`, `Asset ${TAG}`],
  );
  assetId = asset.rows[0].id;
});

afterAll(async () => {
  try {
    if (triggerName) {
      await pgc.query(`DROP TRIGGER IF EXISTS ${triggerName} ON fixed_assets;`);
      await pgc.query(`DROP FUNCTION IF EXISTS ${triggerName}_fn();`);
    }
  } catch {
    /* connection may already be unusable */
  }
  await pgc.end().catch(() => {});
});

async function readAccum(): Promise<string> {
  const r = await pgc.query<{ accum: string }>(
    `SELECT accum_depreciation::text AS accum FROM fixed_assets WHERE id = $1`,
    [assetId],
  );
  return r.rows[0].accum;
}

async function rowExists(table: string, id: number): Promise<boolean> {
  const r = await pgc.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return r.rowCount! > 0;
}

async function installFailingTrigger(): Promise<void> {
  // Per-asset-scoped: only fires on a *decrease* of accum_depreciation
  // for our seed asset, so parallel tests touching other rows are unaffected.
  await pgc.query(`
    CREATE OR REPLACE FUNCTION ${triggerName}_fn() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.id = ${assetId}
         AND NEW.accum_depreciation < OLD.accum_depreciation THEN
        RAISE EXCEPTION 'task-275 forced rollback failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pgc.query(`
    DROP TRIGGER IF EXISTS ${triggerName} ON fixed_assets;
    CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON fixed_assets
      FOR EACH ROW EXECUTE FUNCTION ${triggerName}_fn();
  `);
}

async function dropFailingTrigger(): Promise<void> {
  await pgc.query(`DROP TRIGGER IF EXISTS ${triggerName} ON fixed_assets;`);
  await pgc.query(`DROP FUNCTION IF EXISTS ${triggerName}_fn();`);
}

describe("StorageImpl.deleteDepreciationRun is atomic with the JE reversal (task #275)", () => {
  it("rolls back the JE/run/postings when the per-asset balance update fails mid-flight", async () => {
    // Seed JE + posted depreciation_run + posting under RLS bypass so the
    // workspace_isolation policies don't reject the inserts.
    const { runId, journalEntryId, postingId } = await withRlsBypass(
      "test:seed-task-275",
      async () => {
        const { db } = await import("../db");
        const { journalEntries, journalLines, depreciationRuns, depreciationPostings, accounts } =
          await import("@shared/schema");
        const { eq } = await import("drizzle-orm");

        const [acc1, acc2] = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.companyId, companyId))
          .limit(2);

        const [je] = await db
          .insert(journalEntries)
          .values({
            companyId,
            reference: `JE-DEP-${TAG}`,
            description: `Dep run JE ${TAG}`,
            source: "manual",
          })
          .returning();
        await db.insert(journalLines).values([
          { companyId, journalEntryId: je.id, accountId: acc1.id, debit: "100", credit: "0" },
          { companyId, journalEntryId: je.id, accountId: acc2.id, debit: "0", credit: "100" },
        ]);

        const [run] = await db
          .insert(depreciationRuns)
          .values({
            companyId,
            year: 2099,
            month: 3,
            status: "posted",
            totalAmount: "120.00",
            journalEntryId: je.id,
            postedAt: new Date(),
          })
          .returning();

        const [posting] = await db
          .insert(depreciationPostings)
          .values({
            companyId,
            runId: run.id,
            assetId,
            amount: "120.00",
          })
          .returning();

        return { runId: run.id, journalEntryId: je.id, postingId: posting.id };
      },
    );

    const startingAccum = await readAccum();
    expect(startingAccum).toBe("500.00");

    // Phase 1: trigger ON. Pre-#275 the JE/run/postings would already be
    // committed by the time the asset-balance loop ran and tripped the
    // trigger; the assertions below would fail. With the rollback inside
    // the same tx, every write is undone together.
    await installFailingTrigger();

    let threw: unknown = null;
    try {
      await withCompanyScope(companyId, () =>
        storage.deleteDepreciationRun(companyId, runId),
      );
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(String((threw as Error)?.message ?? "")).toMatch(/task-275 forced rollback failure/);

    expect(await rowExists("depreciation_runs", runId)).toBe(true);
    expect(await rowExists("journal_entries", journalEntryId)).toBe(true);
    expect(await rowExists("depreciation_postings", postingId)).toBe(true);
    expect(await readAccum()).toBe(startingAccum);

    // Phase 2: trigger OFF. Replay must succeed; balance drops by the run total.
    await dropFailingTrigger();

    await withCompanyScope(companyId, () =>
      storage.deleteDepreciationRun(companyId, runId),
    );

    expect(await rowExists("depreciation_runs", runId)).toBe(false);
    expect(await rowExists("journal_entries", journalEntryId)).toBe(false);
    expect(await rowExists("depreciation_postings", postingId)).toBe(false);
    expect(await readAccum()).toBe("380.00");
  });
});
