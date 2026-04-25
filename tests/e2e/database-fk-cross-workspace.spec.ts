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
      // Task #93 added RLS on workspace-scoped tables. Connecting as the
      // current DATABASE_URL role happens to bypass RLS today (it's a
      // superuser in this environment), but make the dependency explicit:
      // this spec deliberately writes across two workspaces in setup, so
      // bypass the policies for the lifetime of this transaction.
      await client.query("SET LOCAL app.rls_bypass = 'on'");

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

      // ----- Cross-tenant accounts.parent_id (chart-of-accounts tree) ------
      // Migration 0005 added accounts_parent_company_fk specifically so a
      // chart-of-accounts node in workspace A can never be re-parented under
      // a node in workspace B. Without a dedicated assertion that names the
      // constraint, a future migration could silently drop it and every
      // other case here would still pass.
      const rParentInsert = await attempt(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, parent_id)
         VALUES ($1, $2, 'child', 'child', 'asset', 'current_asset', $3)`,
        [cidA, `P-${tag}`, aidB],
      );
      expect(rParentInsert.ok).toBe(false);
      if (!rParentInsert.ok) {
        expect(rParentInsert.code).toBe("23503");
        expect(rParentInsert.constraint).toBe("accounts_parent_company_fk");
      }

      // Symmetric positive control: a same-workspace re-parent UPDATE must
      // still succeed. Stand up a second account in workspace A and reparent
      // it under aidA — both live in cidA, so the composite FK is satisfied.
      const accAChild = await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
         VALUES ($1, $2, 'c', 'c', 'asset', 'current_asset') RETURNING id`,
        [cidA, `C-${tag}`],
      );
      const aidAChild: number = accAChild.rows[0].id;
      const rParentUpdate = await attempt(
        `UPDATE accounts SET parent_id = $1 WHERE id = $2`,
        [aidA, aidAChild],
      );
      expect(rParentUpdate.ok).toBe(true);

      // ----- Cross-tenant asset_categories pointer ------------------------
      // asset_categories carries seven account-id pointer columns
      // (asset_cost, accumulated_dep, dep_expense, accumulated_imp,
      // imp_loss, reval_surplus, gain_loss_disposal). Migration 0005
      // created a dedicated composite FK per pointer so an asset category
      // in workspace A can never point any of those columns at an account
      // in workspace B. Each constraint must be asserted by name —
      // otherwise a future migration that drops one would silently let
      // asset setup cross workspaces and every other case here would still
      // pass. Stand up an in-workspace account to satisfy the six pointers
      // we are *not* targeting on each attempt; only the pointer under
      // test gets aidB so PG reports that specific constraint and nothing
      // else.
      const acA2 = await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
         VALUES ($1, $2, 'x', 'x', 'asset', 'current_asset') RETURNING id`,
        [cidA, `X-${tag}`],
      );
      const xidA: number = acA2.rows[0].id;

      // One sub-case per dedicated composite FK on asset_categories.
      // The 7-tuple is (asset_cost, accum_dep, dep_expense, accum_imp,
      // imp_loss, reval_surplus, gain_loss_disposal); we set the targeted
      // slot to aidB and the rest to xidA.
      const acPointerCases: Array<{
        label: string;
        constraint: string;
        values: (number)[];
      }> = [
        {
          label: "asset_cost",
          constraint: "asset_categories_asset_cost_company_fk",
          values: [aidB, xidA, xidA, xidA, xidA, xidA, xidA],
        },
        {
          label: "accumulated_dep",
          constraint: "asset_categories_accum_dep_company_fk",
          values: [xidA, aidB, xidA, xidA, xidA, xidA, xidA],
        },
        {
          label: "dep_expense",
          constraint: "asset_categories_dep_expense_company_fk",
          values: [xidA, xidA, aidB, xidA, xidA, xidA, xidA],
        },
        {
          label: "accumulated_imp",
          constraint: "asset_categories_accum_imp_company_fk",
          values: [xidA, xidA, xidA, aidB, xidA, xidA, xidA],
        },
        {
          label: "imp_loss",
          constraint: "asset_categories_imp_loss_company_fk",
          values: [xidA, xidA, xidA, xidA, aidB, xidA, xidA],
        },
        {
          label: "reval_surplus",
          constraint: "asset_categories_reval_surplus_company_fk",
          values: [xidA, xidA, xidA, xidA, xidA, aidB, xidA],
        },
        {
          label: "gain_loss_disposal",
          constraint: "asset_categories_gain_loss_disposal_company_fk",
          values: [xidA, xidA, xidA, xidA, xidA, xidA, aidB],
        },
      ];

      for (const c of acPointerCases) {
        const r = await attempt(
          `INSERT INTO asset_categories
             (company_id, name,
              asset_cost_account_id, accumulated_dep_account_id, dep_expense_account_id,
              accumulated_imp_account_id, imp_loss_account_id, reval_surplus_account_id,
              gain_loss_disposal_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [cidA, `cat-${c.label}`, ...c.values],
        );
        expect(r.ok, `pointer ${c.label} should be rejected`).toBe(false);
        if (!r.ok) {
          expect(r.code, `pointer ${c.label} expected 23503`).toBe("23503");
          expect(r.constraint, `pointer ${c.label} constraint name`).toBe(
            c.constraint,
          );
        }
      }

      // ----- Cross-tenant fixed_assets: category in B, asset claims A ------
      // Stand up a self-contained category in workspace B so we have a real
      // B-side categoryId to dangle in front of the FK. Reuse accB for every
      // account-id pointer column (they all share the same composite-FK
      // shape; we already exercise an individual pointer above on r4).
      const catB = await client.query(
        `INSERT INTO asset_categories
           (company_id, name,
            asset_cost_account_id, accumulated_dep_account_id, dep_expense_account_id,
            accumulated_imp_account_id, imp_loss_account_id, reval_surplus_account_id,
            gain_loss_disposal_account_id)
         VALUES ($1, 'B cat', $2, $2, $2, $2, $2, $2, $2) RETURNING id`,
        [cidB, aidB],
      );
      const catBId: number = catB.rows[0].id;

      const rFa = await attempt(
        `INSERT INTO fixed_assets
           (company_id, category_id, code, name,
            acquisition_date, in_service_date, currency, tx_cost, cost,
            useful_life_months, method, status)
         VALUES ($1, $2, $3, 'cross asset', '2025-01-01', '2025-01-01',
                 'SAR', '1000', '1000', 12, 'straight_line', 'active')`,
        [cidA, catBId, `FAX-${tag}`],
      );
      expect(rFa.ok).toBe(false);
      if (!rFa.ok) {
        expect(rFa.code).toBe("23503");
        expect(rFa.constraint).toBe("fixed_assets_category_company_fk");
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

  // --------------------------------------------------------------------------
  // Task #91 extended the composite-FK pattern to HR (employees /
  // attendance / leaves / payroll_*) and to the fixed-asset child tables
  // (asset_components, depreciation_schedule, depreciation_postings,
  // impairment / revaluation / disposal events). This block exercises the
  // representative cross-workspace scenarios for each new constraint.
  // --------------------------------------------------------------------------
  test("composite FKs reject cross-workspace writes on HR + fixed-asset child tables", async () => {
    const client = await pool.connect();
    const tag = `db-fk-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await client.query("BEGIN");
      // See note in the first test: the spec writes across workspaces in
      // setup, so explicitly bypass the task-#93 RLS policies.
      await client.query("SET LOCAL app.rls_bypass = 'on'");

      // Two workspaces ------------------------------------------------------
      const a = await client.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`A-${tag}`]);
      const b = await client.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`B-${tag}`]);
      const cidA: number = a.rows[0].id;
      const cidB: number = b.rows[0].id;

      // Helper that captures FK / not-null violations into an attempt result
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

      // ---- HR setup: an employee in B + a payroll run in A --------------
      const empB = await client.query(
        `INSERT INTO employees (company_id, full_name, base_salary, hire_date)
         VALUES ($1, 'B emp', '1000', '2025-01-01') RETURNING id`,
        [cidB],
      );
      const empBId: number = empB.rows[0].id;
      const empA = await client.query(
        `INSERT INTO employees (company_id, full_name, base_salary, hire_date)
         VALUES ($1, 'A emp', '1000', '2025-01-01') RETURNING id`,
        [cidA],
      );
      const empAId: number = empA.rows[0].id;
      const runA = await client.query(
        `INSERT INTO payroll_runs (company_id, year, month) VALUES ($1, 2026, 1) RETURNING id`,
        [cidA],
      );
      const runAId: number = runA.rows[0].id;

      // attendance.(employee_id, company_id) — employee in B, row in A
      const r1 = await attempt(
        `INSERT INTO attendance (company_id, employee_id, date, status) VALUES ($1, $2, '2026-01-15', 'present')`,
        [cidA, empBId],
      );
      expect(r1.ok).toBe(false);
      if (!r1.ok) {
        expect(r1.code).toBe("23503");
        expect(r1.constraint).toBe("attendance_employee_company_fk");
      }

      // leaves.(employee_id, company_id) — employee in B, row in A
      const r2 = await attempt(
        `INSERT INTO leaves (company_id, employee_id, start_date, end_date, days)
         VALUES ($1, $2, '2026-01-10', '2026-01-12', 3)`,
        [cidA, empBId],
      );
      expect(r2.ok).toBe(false);
      if (!r2.ok) {
        expect(r2.code).toBe("23503");
        expect(r2.constraint).toBe("leaves_employee_company_fk");
      }

      // payroll_lines.(employee_id, company_id) — same workspace as run, but
      // employee belongs to B → composite FK to employees(id, company_id) trips.
      const r3 = await attempt(
        `INSERT INTO payroll_lines (company_id, payroll_run_id, employee_id, base_salary, net_pay)
         VALUES ($1, $2, $3, '1000', '900')`,
        [cidA, runAId, empBId],
      );
      expect(r3.ok).toBe(false);
      if (!r3.ok) {
        expect(r3.code).toBe("23503");
        expect(r3.constraint).toBe("payroll_lines_employee_company_fk");
      }

      // payroll_lines.(payroll_run_id, company_id) — line claims B but run is A
      const r4 = await attempt(
        `INSERT INTO payroll_lines (company_id, payroll_run_id, employee_id, base_salary, net_pay)
         VALUES ($1, $2, $3, '1000', '900')`,
        [cidB, runAId, empBId],
      );
      expect(r4.ok).toBe(false);
      if (!r4.ok) {
        expect(r4.code).toBe("23503");
        expect(r4.constraint).toBe("payroll_lines_run_company_fk");
      }

      // payroll_lines: missing company_id must fail closed (NOT NULL, no
      // default — same recipe as journal_lines).
      const r5 = await attempt(
        `INSERT INTO payroll_lines (payroll_run_id, employee_id, base_salary, net_pay)
         VALUES ($1, $2, '1000', '900')`,
        [runAId, empAId],
      );
      expect(r5.ok).toBe(false);
      if (!r5.ok) expect(r5.code).toBe("23502");

      // ---- Fixed-assets setup: a category and asset in A ------------------
      const accA = await client.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype)
         VALUES ($1, $2, 'fa', 'fa', 'asset', 'non_current_asset') RETURNING id`,
        [cidA, `FA-${tag}`],
      );
      const accAId: number = accA.rows[0].id;
      const catA = await client.query(
        `INSERT INTO asset_categories (company_id, name,
            asset_cost_account_id, accumulated_dep_account_id, dep_expense_account_id,
            accumulated_imp_account_id, imp_loss_account_id, reval_surplus_account_id,
            gain_loss_disposal_account_id)
         VALUES ($1, 'cat', $2, $2, $2, $2, $2, $2, $2) RETURNING id`,
        [cidA, accAId],
      );
      const catAId: number = catA.rows[0].id;
      const faA = await client.query(
        `INSERT INTO fixed_assets (company_id, category_id, code, name,
            acquisition_date, in_service_date, currency, tx_cost, cost,
            useful_life_months, method, status)
         VALUES ($1, $2, $3, 'A asset', '2025-01-01', '2025-01-01',
            'SAR', '1000', '1000', 12, 'straight_line', 'active') RETURNING id`,
        [cidA, catAId, `FA-${tag}`],
      );
      const faAId: number = faA.rows[0].id;
      const compA = await client.query(
        `INSERT INTO asset_components (company_id, asset_id, name, cost, useful_life_months)
         VALUES ($1, $2, 'comp', '500', 12) RETURNING id`,
        [cidA, faAId],
      );
      const compAId: number = compA.rows[0].id;
      const drA = await client.query(
        `INSERT INTO depreciation_runs (company_id, year, month) VALUES ($1, 2026, 1) RETURNING id`,
        [cidA],
      );
      const drAId: number = drA.rows[0].id;

      // asset_components.(asset_id, company_id): asset in A, component claims B
      const r6 = await attempt(
        `INSERT INTO asset_components (company_id, asset_id, name, cost, useful_life_months)
         VALUES ($1, $2, 'x', '100', 12)`,
        [cidB, faAId],
      );
      expect(r6.ok).toBe(false);
      if (!r6.ok) {
        expect(r6.code).toBe("23503");
        expect(r6.constraint).toBe("asset_components_asset_company_fk");
      }

      // depreciation_postings.(run_id, company_id): run in A, posting claims B
      const r7 = await attempt(
        `INSERT INTO depreciation_postings (company_id, run_id, asset_id, amount)
         VALUES ($1, $2, $3, '10')`,
        [cidB, drAId, faAId],
      );
      expect(r7.ok).toBe(false);
      if (!r7.ok) {
        expect(r7.code).toBe("23503");
        expect(r7.constraint).toBe("depreciation_postings_run_company_fk");
      }

      // depreciation_schedule.(component_id, company_id): nullable, but when
      // set must live in same workspace.
      const r8 = await attempt(
        `INSERT INTO depreciation_schedule
            (company_id, asset_id, component_id, period_year, period_month, planned_amount)
         VALUES ($1, $2, $3, 2026, 1, '10')`,
        [cidB, faAId, compAId],
      );
      expect(r8.ok).toBe(false);
      // The schedule asset_id FK trips first (FK to fixed_assets keyed on
      // company_id) — the row claims B but the asset lives in A. Either of
      // the asset / component FKs is acceptable here, both are valid checks.
      if (!r8.ok) {
        expect(r8.code).toBe("23503");
        expect([
          "depreciation_schedule_asset_company_fk",
          "depreciation_schedule_component_company_fk",
        ]).toContain(r8.constraint ?? "");
      }

      // impairment_events.(asset_id, company_id): asset in A, event claims B
      const r9 = await attempt(
        `INSERT INTO impairment_events (company_id, asset_id, event_date, recoverable_amount, loss_amount)
         VALUES ($1, $2, '2026-01-15', '500', '100')`,
        [cidB, faAId],
      );
      expect(r9.ok).toBe(false);
      if (!r9.ok) {
        expect(r9.code).toBe("23503");
        expect(r9.constraint).toBe("impairment_events_asset_company_fk");
      }

      // disposals.(asset_id, company_id): asset in A, disposal claims B
      const r10 = await attempt(
        `INSERT INTO disposals (company_id, asset_id, event_date, proceeds, method, gain_loss, surplus_transferred)
         VALUES ($1, $2, '2026-01-15', '0', 'sale', '0', '0')`,
        [cidB, faAId],
      );
      expect(r10.ok).toBe(false);
      if (!r10.ok) {
        expect(r10.code).toBe("23503");
        expect(r10.constraint).toBe("disposals_asset_company_fk");
      }

      // ---- documents.(journal_entry_id, company_id) ---------------------
      const jeA = await client.query(
        `INSERT INTO journal_entries (company_id, reference, description)
         VALUES ($1, $2, 'doc-fk') RETURNING id`,
        [cidA, `DOC-${tag}`],
      );
      const jeAId: number = jeA.rows[0].id;
      const r11 = await attempt(
        `INSERT INTO documents (company_id, file_name, mime_type, size_bytes, storage_path,
            status, journal_entry_id)
         VALUES ($1, 'a.pdf', 'application/pdf', 100, '/p', 'posted', $2)`,
        [cidB, jeAId],
      );
      expect(r11.ok).toBe(false);
      if (!r11.ok) {
        expect(r11.code).toBe("23503");
        expect(r11.constraint).toBe("documents_journal_entry_company_fk");
      }

      // Positive controls: same-workspace writes still succeed -------------
      const ok1 = await attempt(
        `INSERT INTO attendance (company_id, employee_id, date, status) VALUES ($1, $2, '2026-01-16', 'present')`,
        [cidA, empAId],
      );
      expect(ok1.ok).toBe(true);
      const ok2 = await attempt(
        `INSERT INTO payroll_lines (company_id, payroll_run_id, employee_id, base_salary, net_pay)
         VALUES ($1, $2, $3, '1000', '900')`,
        [cidA, runAId, empAId],
      );
      expect(ok2.ok).toBe(true);
      const ok3 = await attempt(
        `INSERT INTO impairment_events (company_id, asset_id, event_date, recoverable_amount, loss_amount)
         VALUES ($1, $2, '2026-01-17', '500', '50')`,
        [cidA, faAId],
      );
      expect(ok3.ok).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
