import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Item #6 (tenant isolation) — RUNTIME proof.
 *
 * The repo already has STATIC guards: db-isolation-allowlist.spec.ts (every
 * db/storage import is audited) and database-rls-policy-coverage.spec.ts (the
 * policy text matches canonical). What was missing is a BEHAVIOURAL test that
 * drives the real pinned-client + RLS path and shows that a session scoped to
 * workspace A genuinely cannot see or write workspace B's rows.
 *
 * This is the crown-jewel property of a multi-tenant ERP: cross-company data
 * must never leak. We assert it against a live database through
 * withCompanyScope / withRlsBypass (server/db.ts) — not a mock — so the RLS
 * policies installed by the boot sequence are actually exercised.
 *
 * Requires DATABASE_URL and the RLS bootstrap (app_api role +
 * workspace_isolation policies) to have run at least once against the target
 * DB. Skips cleanly when no database is configured.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const TAG = `iso_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Deferred server-module imports (see banking test for the rationale: ../db
// throws at import time when DATABASE_URL is unset).
let dbmod: typeof import("../db");
let schema: typeof import("@shared/schema");
let eq: typeof import("drizzle-orm").eq;

let pgc: pg.Client;
let companyA: number;
let companyB: number;
let accountAId: number;
let accountBId: number;

beforeAll(async () => {
  if (!HAS_DB) return;
  dbmod = await import("../db");
  schema = await import("@shared/schema");
  ({ eq } = await import("drizzle-orm"));

  pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  await pgc.query(`SET app.rls_bypass = 'on'`);

  // Two independent workspaces, each with one account.
  const mkCompany = async (name: string) => {
    const r = await pgc.query<{ id: number }>(
      `INSERT INTO companies (name, functional_currency, currency_symbol, is_default, is_active)
       VALUES ($1, 'USD', '$', false, true) RETURNING id`,
      [name],
    );
    return r.rows[0].id;
  };
  companyA = await mkCompany(`ISO-A ${TAG}`);
  companyB = await mkCompany(`ISO-B ${TAG}`);

  const mkAccount = async (companyId: number, code: string) => {
    const r = await pgc.query<{ id: number }>(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, is_header, is_active)
       VALUES ($1, $2, $3, $3, 'asset', 'current_asset', false, true) RETURNING id`,
      [companyId, code, `Acct ${code}`],
    );
    return r.rows[0].id;
  };
  accountAId = await mkAccount(companyA, `A-${TAG}`);
  accountBId = await mkAccount(companyB, `B-${TAG}`);
});

afterAll(async () => {
  if (!HAS_DB) return;
  await pgc.end().catch(() => {});
});

d("cross-workspace isolation is enforced by RLS at runtime (item #6)", () => {
  it("a session scoped to A sees ONLY A's accounts, never B's (read isolation)", async () => {
    const rows = await dbmod.withCompanyScope(companyA, async () => {
      const { db } = await import("../db");
      // Deliberately NO `where(company_id)` filter — the whole point is that
      // RLS filters even a query that forgot to scope itself.
      return db.select({ id: schema.accounts.id, companyId: schema.accounts.companyId }).from(schema.accounts);
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(accountAId);
    expect(ids).not.toContain(accountBId);
    // Every visible row belongs to A.
    expect(rows.every((r) => r.companyId === companyA)).toBe(true);
  });

  it("a session scoped to A cannot fetch B's account even by its exact id", async () => {
    const rows = await dbmod.withCompanyScope(companyA, async () => {
      const { db } = await import("../db");
      return db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountBId));
    });
    expect(rows).toHaveLength(0);
  });

  it("a session scoped to A cannot INSERT a row stamped with B's company_id (WITH CHECK)", async () => {
    let threw: unknown = null;
    try {
      await dbmod.withCompanyScope(companyA, async () => {
        const { db } = await import("../db");
        await db.insert(schema.accounts).values({
          companyId: companyB, // hostile: try to plant a row in B while scoped to A
          code: `EVIL-${TAG}`,
          nameAr: "evil",
          nameEn: "evil",
          type: "asset",
          subtype: "current_asset",
          isHeader: false,
          isActive: true,
        } as any);
      });
    } catch (e) {
      threw = e;
    }
    // The workspace_isolation WITH CHECK clause must reject the write.
    expect(threw).not.toBeNull();

    // And confirm nothing was actually written under B.
    const leaked = await pgc.query(
      `SELECT 1 FROM accounts WHERE code = $1`,
      [`EVIL-${TAG}`],
    );
    expect(leaked.rowCount).toBe(0);
  });

  it("withRlsBypass can see BOTH workspaces (proves the seed is real cross-company data)", async () => {
    const rows = await dbmod.withRlsBypass("test:iso-verify-both", async () => {
      const { db } = await import("../db");
      const { inArray } = await import("drizzle-orm");
      return db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(inArray(schema.accounts.id, [accountAId, accountBId]));
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(accountAId);
    expect(ids).toContain(accountBId);
  });
});
