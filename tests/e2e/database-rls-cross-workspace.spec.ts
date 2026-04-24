import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Task #93 — workspace isolation on **reads**.
 *
 * The composite-FK spec (`database-fk-cross-workspace.spec.ts`) proves that
 * cross-workspace **writes** are physically refused at the schema layer.
 *
 * This spec proves the matching property for **reads**: a `SELECT` (or
 * `UPDATE` / `DELETE`) that "forgets" `WHERE company_id = …` returns zero
 * rows for the wrong tenant because Postgres row-level-security policies on
 * every workspace-scoped table consult `app.current_company_id` and hide
 * rows that don't match.
 *
 * The spec drives the database directly. To exercise the policies (rather
 * than silently riding the test role's superuser RLS-bypass) it first
 * `SET ROLE app_api` — the same non-superuser role the request middleware
 * switches into in `withCompanyScope` — so it sees what /api/* code sees.
 *
 * If this spec fails, defense-in-depth has regressed: someone disabled RLS
 * on a workspace-scoped table, dropped the `workspace_isolation` policy,
 * removed the `app_api` grant chain, or otherwise let the policies become
 * a no-op.
 */

const DATABASE_URL = process.env.DATABASE_URL;

test.describe("database-level workspace read isolation @db", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — DB-level RLS regression test cannot run",
  );

  let pool: pg.Pool;

  test.beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool?.end();
  });

  test("RLS hides rows from the wrong workspace on SELECT/UPDATE/DELETE", async () => {
    const client = await pool.connect();
    const tag = `db-rls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      // ----- Setup ---------------------------------------------------------
      // Drop superuser privileges for the rest of this connection's life so
      // RLS policies actually fire. SET LOCAL isn't an option here because
      // we run the setup outside any transaction (the policies must be
      // visible to autocommit DML too).
      await client.query("SET ROLE app_api");

      // We need to write across two workspaces during setup → bypass RLS.
      await client.query("SET app.rls_bypass = 'on'");
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

      const jeA = await client.query(
        `INSERT INTO journal_entries (company_id, reference, description)
         VALUES ($1, $2, 'rls-A') RETURNING id`,
        [cidA, `JEA-${tag}`],
      );
      const jeB = await client.query(
        `INSERT INTO journal_entries (company_id, reference, description)
         VALUES ($1, $2, 'rls-B') RETURNING id`,
        [cidB, `JEB-${tag}`],
      );
      const jeAId: number = jeA.rows[0].id;
      const jeBId: number = jeB.rows[0].id;

      const txA = await client.query(
        `INSERT INTO transactions (company_id, type, amount, description, category)
         VALUES ($1, 'income', '100', $2, 'sales') RETURNING id`,
        [cidA, `TXA-${tag}`],
      );
      const txB = await client.query(
        `INSERT INTO transactions (company_id, type, amount, description, category)
         VALUES ($1, 'income', '200', $2, 'sales') RETURNING id`,
        [cidB, `TXB-${tag}`],
      );
      const txAId: number = txA.rows[0].id;
      const txBId: number = txB.rows[0].id;

      // ----- Switch to "I'm logged into workspace B" mode ------------------
      await client.query("SET app.rls_bypass = 'off'");
      await client.query(`SET app.current_company_id = '${cidB}'`);

      // accounts: SELECT with no WHERE clause should only see B's row.
      // We filter by the unique tag so unrelated baseline rows from prior
      // tests don't leak into the count, but critically we never mention
      // `company_id` in the WHERE — that's the bug the policy defends.
      const accSel = await client.query(
        `SELECT id, company_id FROM accounts WHERE code LIKE $1 ORDER BY id`,
        [`%-${tag}`],
      );
      expect(accSel.rows.map((r) => r.id)).toEqual([aidB]);
      expect(accSel.rows.every((r) => r.company_id === cidB)).toBe(true);

      // journal_entries: same shape.
      const jeSel = await client.query(
        `SELECT id, company_id FROM journal_entries WHERE reference LIKE $1 ORDER BY id`,
        [`%-${tag}`],
      );
      expect(jeSel.rows.map((r) => r.id)).toEqual([jeBId]);

      // transactions: same shape.
      const txSel = await client.query(
        `SELECT id, company_id FROM transactions WHERE description LIKE $1 ORDER BY id`,
        [`%-${tag}`],
      );
      expect(txSel.rows.map((r) => r.id)).toEqual([txBId]);

      // ----- UPDATE without WHERE company_id must not touch A's rows ------
      // Touch every row visible to me (i.e. only B's), then verify that A's
      // row is unchanged.
      await client.query(
        `UPDATE accounts SET name_en = name_en || '-rls-update' WHERE code LIKE $1`,
        [`%-${tag}`],
      );

      // Briefly look across workspaces to inspect the result.
      await client.query("SET app.rls_bypass = 'on'");
      const after = await client.query(
        `SELECT id, company_id, name_en FROM accounts WHERE id IN ($1, $2) ORDER BY id`,
        [aidA, aidB],
      );
      const byId = new Map(after.rows.map((r) => [r.id, r]));
      expect(byId.get(aidA)?.name_en).toBe("a"); // A untouched
      expect(byId.get(aidB)?.name_en).toBe("b-rls-update"); // B updated

      // ----- DELETE without WHERE company_id must not touch A's rows ------
      await client.query("SET app.rls_bypass = 'off'");
      const del = await client.query(
        `DELETE FROM transactions WHERE description LIKE $1 RETURNING id`,
        [`%-${tag}`],
      );
      // Only B's tx should have been deleted.
      expect(del.rows.map((r) => r.id)).toEqual([txBId]);

      await client.query("SET app.rls_bypass = 'on'");
      const remaining = await client.query(
        `SELECT id FROM transactions WHERE id IN ($1, $2) ORDER BY id`,
        [txAId, txBId],
      );
      expect(remaining.rows.map((r) => r.id)).toEqual([txAId]); // A survived

      // ----- INSERT into the wrong workspace must fail WITH CHECK ---------
      // Logged into B, attempt to plant a row tagged for A.
      await client.query("SET app.rls_bypass = 'off'");
      let insertFailed = false;
      try {
        await client.query(
          `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
           VALUES ($1, $2, 'x', 'x', 'asset', 'current_asset')`,
          [cidA, `X-${tag}`],
        );
      } catch (err) {
        insertFailed = true;
        // 42501 = insufficient_privilege (RLS WITH CHECK violation in pg)
        const e = err as { code?: string };
        expect(e.code).toBe("42501");
      }
      expect(insertFailed).toBe(true);

      // ----- Cleanup -------------------------------------------------------
      await client.query("SET app.rls_bypass = 'on'");
      await client.query(
        `DELETE FROM accounts WHERE company_id IN ($1, $2)`,
        [cidA, cidB],
      );
      await client.query(
        `DELETE FROM journal_entries WHERE company_id IN ($1, $2)`,
        [cidA, cidB],
      );
      await client.query(
        `DELETE FROM transactions WHERE company_id IN ($1, $2)`,
        [cidA, cidB],
      );
      await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [
        cidA,
        cidB,
      ]);
    } finally {
      // Reset the connection so it returns to the pool clean.
      await client
        .query(
          "RESET ROLE; RESET app.current_company_id; RESET app.rls_bypass;",
        )
        .catch(() => undefined);
      client.release();
    }
  });
});
