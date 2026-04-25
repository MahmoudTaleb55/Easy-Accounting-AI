import { test, expect } from "@playwright/test";
import pg from "pg";
import { requireDbUrl } from "./_helpers/forge-session";

/**
 * Regression net for task #218: the `POST /api/companies` workspace-
 * bootstrap path used to commit the company row + its seeded chart of
 * accounts inside one transaction and *then* — outside that
 * transaction — issue a separate `createMembership` call to wire the
 * caller in as the workspace owner. If that second write blew up
 * (network blip, RLS regression, future unique-constraint hiccup),
 * the request 500'd to the user but the new company + its CoA tree
 * had already been committed with no membership. The workspace
 * became invisible to its creator (the `/api/companies` list is
 * filtered by membership), and the seeded accounts were effectively
 * orphaned in the database.
 *
 * The fix pulls the membership insert into the same transaction as
 * the company + CoA seed via a new optional `ownerMembership`
 * parameter on `DatabaseStorage.createCompany`. If the membership
 * write fails for any reason, the whole bootstrap rolls back so the
 * user does not end up with a stranded workspace they can never see.
 *
 * This spec exercises that guarantee end-to-end: it calls the storage
 * method directly (in-process — same approach as
 * `dev-only-routes-production-gate.spec.ts`) and forces the
 * membership write to fail with a real Postgres-level NOT NULL
 * violation by passing `userId: null`. The assertion is that no
 * stranded `companies` row remains in the database after the call
 * rejects.
 *
 * Why call the storage method directly rather than `POST
 * /api/companies` over HTTP: the route always passes a well-formed
 * `userId` (the signed-in user), so producing a membership-write
 * failure through the HTTP surface would require either monkey-
 * patching the auth layer or installing a deliberate fault injector
 * in the production code path. Calling the storage method directly
 * with a sentinel `null` userId is the smallest possible reproduction
 * — it keeps the production code path completely untouched while
 * still exercising the actual `db.transaction` rollback semantics
 * that protect the user from the original bug.
 */

const DB_URL = requireDbUrl("companies-create-rollback regression spec");
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FORCED_FAILURE_NAME = `RBA Rollback Sentinel ${RUN_TAG}`;

let client: pg.Client;

test.describe.configure({ mode: "serial" });

test.describe("POST /api/companies rolls back on owner-link failure @companies-rollback", () => {
  test.beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
  });

  test.afterAll(async () => {
    if (client) {
      // Belt-and-suspenders cleanup. The whole point of this spec is
      // that the company row should *not* be committed, but if the
      // fix ever regresses we still want sibling specs to come up
      // clean rather than tripping over a sentinel-named row.
      await client.query(
        `DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name = $1)`,
        [FORCED_FAILURE_NAME],
      );
      await client.query(
        `DELETE FROM settings WHERE company_id IN (SELECT id FROM companies WHERE name = $1)`,
        [FORCED_FAILURE_NAME],
      );
      await client.query(
        `DELETE FROM memberships WHERE company_id IN (SELECT id FROM companies WHERE name = $1)`,
        [FORCED_FAILURE_NAME],
      );
      await client.query(`DELETE FROM companies WHERE name = $1`, [FORCED_FAILURE_NAME]);
      await client.end();
    }
  });

  test("a forced membership-write failure leaves no stranded company row behind", async () => {
    // Confirm no row with the sentinel name exists yet from a prior
    // failed run.
    const beforeSentinel = Number(
      (
        await client.query(`SELECT count(*)::int AS c FROM companies WHERE name = $1`, [
          FORCED_FAILURE_NAME,
        ])
      ).rows[0].c,
    );
    expect(beforeSentinel, "sentinel row must not pre-exist from a prior failed run").toBe(0);

    // Import the storage layer in-process and call createCompany with
    // a forced-failure ownerMembership: userId is `null`, which the
    // DB rejects on the `memberships.user_id NOT NULL` column. Drizzle
    // forwards the value as-is to Postgres, so the failure surfaces
    // at the DB driver level — exactly the class of failure the fix
    // is meant to roll back from.
    const { storage } = await import("../../server/storage");
    await expect(
      storage.createCompany(
        {
          name: FORCED_FAILURE_NAME,
          functionalCurrency: "USD",
          currencySymbol: "$",
          isDefault: false,
          isActive: true,
          ownerUserId: null,
        },
        // Cast through `unknown` because the option's TS type
        // intentionally requires a non-null `userId`; we are
        // deliberately violating the contract here to simulate a
        // runtime failure (e.g. a future RLS regression or a
        // unique-constraint hiccup) and verify the rollback.
        { ownerMembership: { userId: null as unknown as string, role: "owner" } },
      ),
    ).rejects.toThrow();

    // The actual assertion: no row matching our unique sentinel name
    // remains. Before the fix, the company + CoA seed committed inside
    // the first transaction and the membership insert was a separate
    // write — so a forced membership failure would leave a row
    // matching the sentinel name in place. With the fix, both writes
    // share a transaction and the failure rolls everything back.
    //
    // We deliberately do NOT assert on a global `companies` row count
    // here: parallel e2e workers may legitimately create or destroy
    // unrelated workspaces during this test, which would make a strict
    // count comparison flaky without changing what we actually care
    // about. The sentinel-name check is per-run unique (RUN_TAG above)
    // so it isolates this spec from sibling specs while still catching
    // the bug.
    const afterSentinel = Number(
      (
        await client.query(`SELECT count(*)::int AS c FROM companies WHERE name = $1`, [
          FORCED_FAILURE_NAME,
        ])
      ).rows[0].c,
    );
    expect(
      afterSentinel,
      `no companies row with the sentinel name '${FORCED_FAILURE_NAME}' may remain after a forced owner-link failure`,
    ).toBe(0);

    // Also verify the chart-of-accounts seed was rolled back — this
    // is the second half of the orphan story. If the company row is
    // gone but the accounts rows survived under the gone company id,
    // we still have orphans (and a future workspace that reused the
    // serial id would silently inherit a stranger's accounts).
    const orphanAccounts = Number(
      (
        await client.query(
          `SELECT count(*)::int AS c FROM accounts a
           LEFT JOIN companies c ON c.id = a.company_id
           WHERE c.id IS NULL`,
        )
      ).rows[0].c,
    );
    expect(
      orphanAccounts,
      `no orphan accounts rows may remain after a forced owner-link failure (found ${orphanAccounts})`,
    ).toBe(0);
  });
});
