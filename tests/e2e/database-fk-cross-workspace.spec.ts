import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Database-level workspace isolation regression net.
 *
 * The route-layer guard (task #52, exercised by `workspace-isolation.spec.ts`)
 * is the friendly first line. Task #70 added a second, lower line of defence:
 * composite foreign keys keyed on `(id, company_id)` that physically refuse
 * cross-tenant writes regardless of route code.
 *
 * This spec drives the database directly (no HTTP, no storage layer) so it
 * fails the moment the constraints — or the `journal_lines.company_id`
 * column they depend on — are dropped, even if every API test still passes
 * because the route guard happens to catch the same scenario higher up.
 *
 * If this spec fails, defense-in-depth has regressed: someone removed a
 * UNIQUE (id, company_id) constraint, a composite foreign key, or the
 * NOT NULL constraint that forces `journal_lines.company_id` to be set
 * explicitly on every insert.
 */

const DATABASE_URL = process.env.DATABASE_URL;

test.describe("database-level workspace isolation @db", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — DB-level FK regression test cannot run",
  );

  let pool: pg.Pool;

  test.beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool?.end();
  });

  test("composite FKs reject cross-workspace writes (and a missing companyId on journal_lines fails closed)", async () => {
    const client = await pool.connect();
    const tag = `db-fk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await client.query("BEGIN");

      // ----- Setup: two workspaces, one account in each, one JE in A. ------
      const a = await client.query(
        `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
        [`A-${tag}`],
      );
      const b = await client.query(
        `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
        [`B-${tag}`],
      );
      const cidA: number = a.rows[0].id;
      const cidB: number = b.rows[0].id;

      const accA = await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
         VALUES ($1, $2, 'a', 'a', 'asset', 'current_asset') RETURNING id`,
        [cidA, `A-${tag}`],
      );
      const accB = await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
         VALUES ($1, $2, 'b', 'b', 'asset', 'current_asset') RETURNING id`,
        [cidB, `B-${tag}`],
      );
      const aidA: number = accA.rows[0].id;
      const aidB: number = accB.rows[0].id;

      const je = await client.query(
        `INSERT INTO journal_entries (company_id, reference, description)
         VALUES ($1, $2, 'fk-test') RETURNING id`,
        [cidA, `JE-${tag}`],
      );
      const jeId: number = je.rows[0].id;

      // Run each insert in its own savepoint so a single FK rejection doesn't
      // poison the surrounding transaction.
      async function attempt(
        sql: string,
        params: unknown[],
      ): Promise<{ ok: true } | { ok: false; code: string; constraint?: string }> {
        await client.query("SAVEPOINT s");
        try {
          await client.query(sql, params);
          await client.query("RELEASE SAVEPOINT s");
          return { ok: true };
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT s");
          const e = err as { code?: string; constraint?: string };
          return { ok: false, code: e.code ?? "", constraint: e.constraint };
        }
      }

      // ----- Cross-tenant journal_line: account in B, JE in A ---------------
      const r1 = await attempt(
        `INSERT INTO journal_lines (company_id, journal_entry_id, account_id, debit, credit)
         VALUES ($1, $2, $3, '10', '0')`,
        [cidA, jeId, aidB],
      );
      expect(r1.ok).toBe(false);
      if (!r1.ok) {
        expect(r1.code).toBe("23503");
        expect(r1.constraint).toBe("journal_lines_account_company_fk");
      }

      // ----- Mismatched company_id: row claims B but JE is A ----------------
      const r2 = await attempt(
        `INSERT INTO journal_lines (company_id, journal_entry_id, account_id, debit, credit)
         VALUES ($1, $2, $3, '10', '0')`,
        [cidB, jeId, aidB],
      );
      expect(r2.ok).toBe(false);
      if (!r2.ok) {
        expect(r2.code).toBe("23503");
        expect(r2.constraint).toBe("journal_lines_je_company_fk");
      }

      // ----- Cross-tenant budget: account in B, budget in A -----------------
      const r3 = await attempt(
        `INSERT INTO budgets (company_id, account_id, year, month, amount)
         VALUES ($1, $2, 2026, 1, '0')`,
        [cidA, aidB],
      );
      expect(r3.ok).toBe(false);
      if (!r3.ok) {
        expect(r3.code).toBe("23503");
        expect(r3.constraint).toBe("budgets_account_company_fk");
      }

      // ----- Cross-tenant asset_categories pointer ------------------------
      // Eight account-id pointer columns; we test one (gain_loss_disposal)
      // since they all share the same shape.
      const acA2 = await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
         VALUES ($1, $2, 'x', 'x', 'asset', 'current_asset') RETURNING id`,
        [cidA, `X-${tag}`],
      );
      const xidA: number = acA2.rows[0].id;
      const r4 = await attempt(
        `INSERT INTO asset_categories
           (company_id, name,
            asset_cost_account_id, accumulated_dep_account_id, dep_expense_account_id,
            accumulated_imp_account_id, imp_loss_account_id, reval_surplus_account_id,
            gain_loss_disposal_account_id)
         VALUES ($1, 'cat', $2, $2, $2, $2, $2, $2, $3)`,
        [cidA, xidA, aidB],
      );
      expect(r4.ok).toBe(false);
      if (!r4.ok) {
        expect(r4.code).toBe("23503");
        expect(r4.constraint).toBe(
          "asset_categories_gain_loss_disposal_company_fk",
        );
      }

      // ----- Missing journal_lines.company_id must fail closed --------------
      // The migration drops the column default precisely so a forgotten
      // companyId cannot silently default to workspace 1. Confirm the schema
      // matches that intent.
      const r5 = await attempt(
        `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
         VALUES ($1, $2, '10', '0')`,
        [jeId, aidA],
      );
      expect(r5.ok).toBe(false);
      if (!r5.ok) {
        // 23502 = not_null_violation
        expect(r5.code).toBe("23502");
      }

      // ----- Same-workspace insert is still accepted (positive control) -----
      const r6 = await attempt(
        `INSERT INTO journal_lines (company_id, journal_entry_id, account_id, debit, credit)
         VALUES ($1, $2, $3, '10', '0')`,
        [cidA, jeId, aidA],
      );
      expect(r6.ok).toBe(true);
    } finally {
      // Roll the whole setup back so the test leaves no trace.
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
