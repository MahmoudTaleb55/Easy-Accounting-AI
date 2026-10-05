import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Server modules (`../banking`, `../db`) are imported DYNAMICALLY inside the
 * DB-gated code below, not at the top of the file. `server/db.ts` throws at
 * module-evaluation time when DATABASE_URL is unset, so a static
 * `import ... from "../banking"` would crash the whole test file (turning a
 * legitimate skip into a hard failure) in environments without a database.
 * Deferring the import until we know HAS_DB keeps the suite green everywhere
 * while still exercising the real code when a database is present.
 */
type BankingModule = typeof import("../banking");
type DbModule = typeof import("../db");
let banking: BankingModule;
let dbmod: DbModule;

/**
 * C2 regression: `createBankTransaction` must post the bank-transaction row
 * and its balanced journal entry ATOMICALLY.
 *
 * Before the fix, JE creation ran inside a best-effort `try/catch` and the
 * bank row was inserted regardless — so a failed JE left a `bank_transactions`
 * row with `journal_entry_id = NULL`, silently unbalancing the books. It also
 * silently produced a degenerate (zero-effect) transfer when both bank
 * accounts fell back to the same fallback COA account.
 *
 * This test drives `banking.createBankTransaction` directly (not through the
 * HTTP layer) so it focuses purely on the storage/transaction boundary, using
 * the same live-Postgres + RLS-bypass-seed pattern as
 * `depreciation-run-delete-atomic-rollback.test.ts`.
 *
 * Requires a live DATABASE_URL. Skips itself with a clear message when none is
 * configured, so the suite stays green in environments without a database
 * rather than failing for an unrelated reason.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const TAG = `c2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let pgc: pg.Client;
let companyId: number;
let bankLinkedAccountId: number; // COA account linked to bankAccountA (asset 1100-ish)
let revenueAccountId: number; // counterpart for the deposit (revenue 4010-ish)
let bankAccountAId: number; // linked bank account
let bankAccountBId: number; // linked bank account (transfer target)
let bankAccountUnlinked1Id: number; // NO linked COA account
let bankAccountUnlinked2Id: number; // NO linked COA account
let jlTrigger: string;

beforeAll(async () => {
  if (!HAS_DB) return;
  // Deferred imports — safe now that we know DATABASE_URL is set.
  banking = await import("../banking");
  dbmod = await import("../db");
  const dbUrl = process.env.DATABASE_URL!;
  pgc = new pg.Client({ connectionString: dbUrl });
  await pgc.connect();
  await pgc.query(`SET app.rls_bypass = 'on'`);

  jlTrigger = `c2_jl_fail_${TAG}`;

  const co = await pgc.query<{ id: number }>(
    `INSERT INTO companies (name, functional_currency, currency_symbol, is_default, is_active)
     VALUES ($1, 'USD', '$', false, true)
     RETURNING id`,
    [`C2 Co ${TAG}`],
  );
  companyId = co.rows[0].id;

  // Two COA accounts: a bank/asset account and a revenue account.
  const bankAcc = await pgc.query<{ id: number }>(
    `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
     VALUES ($1, $2, 'البنك', 'Bank', 'asset', 'current_asset', false, true)
     RETURNING id`,
    [companyId, `1100-${TAG}`],
  );
  bankLinkedAccountId = bankAcc.rows[0].id;

  const bankAccB = await pgc.query<{ id: number }>(
    `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
     VALUES ($1, $2, 'بنك ٢', 'Bank 2', 'asset', 'current_asset', false, true)
     RETURNING id`,
    [companyId, `1101-${TAG}`],
  );
  const bankLinkedAccountBId = bankAccB.rows[0].id;

  const rev = await pgc.query<{ id: number }>(
    `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
     VALUES ($1, $2, 'إيرادات', 'Revenue', 'revenue', 'operating_revenue', false, true)
     RETURNING id`,
    [companyId, `4010-${TAG}`],
  );
  revenueAccountId = rev.rows[0].id;

  // Bank accounts. A and B are linked to distinct COA accounts; the two
  // "unlinked" ones have linked_account_id = NULL to exercise the fallback.
  const mkBank = async (name: string, linked: number | null) => {
    const r = await pgc.query<{ id: number }>(
      `INSERT INTO bank_accounts
         (company_id, name_ar, name_en, bank_name, currency, opening_balance,
          linked_account_id, is_active)
       VALUES ($1, $2, $2, 'Test Bank', 'USD', '0', $3, true)
       RETURNING id`,
      [companyId, name, linked],
    );
    return r.rows[0].id;
  };

  bankAccountAId = await mkBank(`A-${TAG}`, bankLinkedAccountId);
  bankAccountBId = await mkBank(`B-${TAG}`, bankLinkedAccountBId);
  bankAccountUnlinked1Id = await mkBank(`U1-${TAG}`, null);
  bankAccountUnlinked2Id = await mkBank(`U2-${TAG}`, null);
});

afterAll(async () => {
  if (!HAS_DB) return;
  try {
    await pgc.query(`DROP TRIGGER IF EXISTS ${jlTrigger} ON journal_lines;`);
    await pgc.query(`DROP FUNCTION IF EXISTS ${jlTrigger}_fn();`);
  } catch {
    /* connection may already be unusable */
  }
  await pgc.end().catch(() => {});
});

async function countBankTxns(): Promise<number> {
  const r = await pgc.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bank_transactions WHERE company_id = $1`,
    [companyId],
  );
  return Number(r.rows[0].n);
}

async function countJournalEntries(): Promise<number> {
  const r = await pgc.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM journal_entries WHERE company_id = $1`,
    [companyId],
  );
  return Number(r.rows[0].n);
}

d("createBankTransaction posts the bank row and its JE atomically (C2)", () => {
  it("deposit: writes a bank row linked to a balanced journal entry", async () => {
    const txn = await dbmod.withCompanyScope(companyId, () =>
      banking.createBankTransaction(companyId, {
        bankAccountId: bankAccountAId,
        txnType: "deposit",
        amount: "150.00",
        description: `C2 deposit ${TAG}`,
        counterpartAccountId: revenueAccountId,
        // txnDate maps to a `timestamp` column, so the value must be a Date —
        // this is exactly what insertBankTransactionSchema produces for the
        // real route. Passing a string here would fail Drizzle's driver
        // mapping (value.toISOString), which is a test-fidelity bug, not a
        // production one.
        txnDate: new Date("2099-01-15"),
      } as any),
    );

    // Bank row exists and is linked to a JE.
    expect(txn.journalEntryId).toBeTruthy();

    // The linked JE is balanced: debits === credits === amount.
    const lines = await pgc.query<{ debit: string; credit: string; account_id: number }>(
      `SELECT debit, credit, account_id FROM journal_lines WHERE journal_entry_id = $1 ORDER BY debit DESC`,
      [txn.journalEntryId],
    );
    expect(lines.rowCount).toBe(2);
    const totalDebit = lines.rows.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.rows.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(150, 2);
    expect(totalCredit).toBeCloseTo(150, 2);
    // Debit leg is the bank/asset account; credit leg is the revenue account.
    expect(lines.rows[0].account_id).toBe(bankLinkedAccountId);
    expect(lines.rows[1].account_id).toBe(revenueAccountId);
  });

  it("rolls back the bank row when the JE write fails mid-transaction", async () => {
    const bankBefore = await countBankTxns();
    const jeBefore = await countJournalEntries();

    // Force the JE's journal_lines insert to fail, but ONLY for this
    // company's lines, so parallel tests are unaffected.
    await pgc.query(`
      CREATE OR REPLACE FUNCTION ${jlTrigger}_fn() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.company_id = ${companyId} THEN
          RAISE EXCEPTION 'c2 forced journal_lines failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pgc.query(`
      DROP TRIGGER IF EXISTS ${jlTrigger} ON journal_lines;
      CREATE TRIGGER ${jlTrigger}
        BEFORE INSERT ON journal_lines
        FOR EACH ROW EXECUTE FUNCTION ${jlTrigger}_fn();
    `);

    let threw: unknown = null;
    try {
      await dbmod.withCompanyScope(companyId, () =>
        banking.createBankTransaction(companyId, {
          bankAccountId: bankAccountAId,
          txnType: "deposit",
          amount: "999.00",
          description: `C2 should-rollback ${TAG}`,
          counterpartAccountId: revenueAccountId,
          txnDate: new Date("2099-02-01"),
        } as any),
      );
    } catch (e) {
      threw = e;
    }

    // Remove the trigger before asserting so a failed assertion doesn't
    // poison later tests / cleanup.
    await pgc.query(`DROP TRIGGER IF EXISTS ${jlTrigger} ON journal_lines;`);
    await pgc.query(`DROP FUNCTION IF EXISTS ${jlTrigger}_fn();`);

    expect(threw).not.toBeNull();
    // The bank row must NOT have been persisted — this is the C2 regression.
    expect(await countBankTxns()).toBe(bankBefore);
    // And no orphan JE header should survive either.
    expect(await countJournalEntries()).toBe(jeBefore);
  });

  it("refuses a degenerate transfer (both legs collapse to the same fallback account)", async () => {
    const bankBefore = await countBankTxns();
    const jeBefore = await countJournalEntries();

    let threw: unknown = null;
    try {
      await dbmod.withCompanyScope(companyId, () =>
        banking.createBankTransaction(companyId, {
          bankAccountId: bankAccountUnlinked1Id,
          txnType: "transfer",
          amount: "50.00",
          description: `C2 degenerate transfer ${TAG}`,
          counterpartBankAccountId: bankAccountUnlinked2Id,
          txnDate: new Date("2099-03-01"),
        } as any),
      );
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeInstanceOf(banking.BankTransactionPostingError);
    // Nothing written.
    expect(await countBankTxns()).toBe(bankBefore);
    expect(await countJournalEntries()).toBe(jeBefore);
  });
});
