import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, withCompanyScope, withRlsBypass } from "../../server/db";
import { storage } from "../../server/storage";
import { authBizStorage } from "../../server/auth/storage";
import { accounts, companies, settings } from "@shared/schema";

/**
 * Task #221 — runtime companion to the static `withWorkspaceCreation`
 * lint at `tests/e2e/db-isolation-allowlist.spec.ts`.
 *
 * Background: every workspace-creation path (`storage.createCompany`,
 * `authBizStorage.createCompanyForOwner`, plus any future bulk-import or
 * admin "clone workspace" flow) must wrap its insert + seed work in
 * `withWorkspaceCreation(...)`. The wrapper opens a fresh client with
 * `app.rls_bypass = 'on'` so the seed chart-of-accounts + settings rows
 * — which live under the *new* company id, not the caller's active
 * `app.current_company_id` — clear the workspace_isolation policy's
 * `WITH CHECK` clause on `accounts` / `settings`.
 *
 * The static lint at `tests/e2e/db-isolation-allowlist.spec.ts` already
 * rejects any `*.insert(companies)` call that doesn't sit textually
 * inside a `withWorkspaceCreation(...)` block, but it only scans
 * `server/`. A one-off script, a new background worker outside
 * `server/`, or a dynamically-built insert string would slip past it.
 *
 * This spec closes that loophole at runtime: it drives the real
 * `createCompany` / `createCompanyForOwner` entry points from inside an
 * existing workspace's `withCompanyScope(otherCompanyId)` and verifies
 * that the new workspace lands with its full bootstrap (settings +
 * seeded chart of accounts) under the new company id. If a future
 * regression strips `withWorkspaceCreation` from either entry point,
 * the very first seed insert (accounts / settings under the new cid)
 * is rejected by the workspace_isolation policy with `42501` and the
 * surrounding transaction rolls back — both of those failure modes
 * surface as the test below failing, even if the static check were
 * somehow bypassed.
 *
 * Tagged @db so it runs alongside the rest of the database-level
 * regression net.
 */

const DATABASE_URL = process.env.DATABASE_URL;

test.describe("workspace creation runtime guard @db", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — workspace-creation runtime guard cannot run",
  );

  test("creating a workspace from inside another workspace's scope fully bootstraps the new workspace", async () => {
    // Tag every row this spec creates so the cleanup at the bottom can
    // tear them down even if an assertion mid-test throws.
    const tag = `wc-runtime-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // ----- Setup -------------------------------------------------------
    // Stand up the "host" workspace whose RLS scope every later
    // workspace-creation call will run inside. The bypass wrapper here
    // is the legitimate way to write into a workspace that doesn't yet
    // exist as far as the caller's `app.current_company_id` is
    // concerned — and matches how the production boot path bootstraps
    // the very first workspace.
    const hostCompanyId = await withRlsBypass(
      "test:setup-host-workspace",
      async () => {
        const [host] = await db
          .insert(companies)
          .values({
            name: `host-${tag}`,
            functionalCurrency: "USD",
            currencySymbol: "$",
            isDefault: false,
            isActive: true,
          })
          .returning();
        return host.id;
      },
    );

    // We capture the new ids inside the scoped block but assert on them
    // outside, with bypass on, so the assertions cannot accidentally
    // ride the bypass that would let a regressed `createCompany` look
    // like it succeeded.
    let createCompanyId: number | undefined;
    let createForOwnerId: number | undefined;

    try {
      // ----- The actual exercise -------------------------------------
      // Every db. call inside this block runs as `app_api` with
      // `app.current_company_id = hostCompanyId` and
      // `app.rls_bypass = 'off'`. That means: a workspace-creation
      // path that forgets `withWorkspaceCreation` will hit the
      // workspace_isolation `WITH CHECK` on the very first
      // `accounts` / `settings` insert (the new cid does not match
      // the active GUC) and the surrounding transaction rolls back.
      await withCompanyScope(hostCompanyId, async () => {
        // Path 1: the `POST /api/companies` entry point — the most
        // common way an authenticated owner spawns a second
        // workspace from inside their first one.
        const created = await storage.createCompany({
          name: `created-${tag}`,
          functionalCurrency: "USD",
          currencySymbol: "$",
          isDefault: false,
          isActive: true,
        });
        createCompanyId = created.id;
        // Sanity: the new id must differ from the active scope's id —
        // otherwise the test isn't actually exercising the cross-
        // workspace insert that the wrapper exists to permit.
        expect(created.id).not.toBe(hostCompanyId);

        // Path 2: the signup-time bootstrap. We don't have a real
        // user session here, but `createCompanyForOwner` only stores
        // `ownerUserId` as an opaque varchar — there's no FK — so a
        // synthesized id exercises the same insert + seed shape.
        const owned = await authBizStorage.createCompanyForOwner(
          `test-owner-${tag}`,
          `owned-${tag}`,
          { currencyCode: "USD" },
        );
        createForOwnerId = owned.id;
        expect(owned.id).not.toBe(hostCompanyId);
      });

      // ----- Assertions ------------------------------------------------
      // Read back through bypass so the assertions see the canonical
      // cross-workspace truth, not a window filtered by the caller's
      // active scope.
      await withRlsBypass("test:verify-new-workspaces", async () => {
        // Both new companies must exist with their assigned ids.
        const newCompanies = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(eq(companies.id, createCompanyId!));
        expect(newCompanies.map((c) => c.name)).toEqual([`created-${tag}`]);

        const ownedCompanies = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(eq(companies.id, createForOwnerId!));
        expect(ownedCompanies.map((c) => c.name)).toEqual([`owned-${tag}`]);

        // The seed chart of accounts must have landed under each new
        // company id — *not* silently dropped by the workspace_isolation
        // policy because the wrapper was missing. The exact seed row
        // count drifts as the canonical CoA grows; a meaningful
        // double-digit count is the right shape-only assertion.
        const createdAccounts = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.companyId, createCompanyId!));
        expect(createdAccounts.length).toBeGreaterThan(20);

        const ownedAccounts = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.companyId, createForOwnerId!));
        expect(ownedAccounts.length).toBeGreaterThan(20);

        // The signup-time bootstrap also writes a per-workspace
        // settings row. If `withWorkspaceCreation` is dropped, the
        // settings insert is the first WITH CHECK rejection in
        // `createCompanyForOwner` and the surrounding transaction
        // rolls back, so this row is the canary for that path.
        const ownedSettings = await db
          .select({ companyId: settings.companyId })
          .from(settings)
          .where(eq(settings.companyId, createForOwnerId!));
        expect(ownedSettings.map((s) => s.companyId)).toEqual([
          createForOwnerId,
        ]);
      });
    } finally {
      // ----- Cleanup ---------------------------------------------------
      // Tear everything down through bypass so we can reach across
      // every workspace this test touched. Order matters: settings +
      // accounts before companies because the `accounts` row carries
      // a FK-shaped `company_id` (no DB FK today, but ordering keeps
      // the cleanup correct if one is added later).
      await withRlsBypass("test:cleanup-workspace-creation-runtime", async () => {
        const ids = [hostCompanyId, createCompanyId, createForOwnerId].filter(
          (v): v is number => typeof v === "number",
        );
        for (const id of ids) {
          await db.delete(settings).where(eq(settings.companyId, id));
          await db.delete(accounts).where(eq(accounts.companyId, id));
          await db.delete(companies).where(eq(companies.id, id));
        }
      });
    }
  });
});
