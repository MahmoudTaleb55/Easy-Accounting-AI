import { test, expect } from "@playwright/test";
import pg from "pg";
import { requireDbUrl } from "./_helpers/forge-session";

/**
 * Regression net for task #274 — the signup-bootstrap half of the same
 * orphan-workspace bug task #218 fixed for the `POST /api/companies`
 * route handler.
 *
 * `authBizStorage.bootstrapWorkspaceForUser` (the helper called from
 * the signup / OIDC-callback paths in `server/auth/local-routes.ts`)
 * used to commit the new workspace + its settings + its seeded chart
 * of accounts inside one transaction and *then* — outside that
 * transaction — issue a separate `createMembership` call to wire the
 * brand-new user in as the owner. If that second write blew up
 * (network blip, RLS regression, future unique-constraint hiccup),
 * the freshly bootstrapped workspace had already been committed with
 * no membership. The user finished signup but their `/api/companies`
 * list (filtered by membership) came back empty, and the seeded
 * accounts were effectively orphaned in the database.
 *
 * The fix mirrors the #218 shape: `createCompanyForOwner` now accepts
 * the same optional `ownerMembership` parameter as
 * `DatabaseStorage.createCompany`, and `bootstrapWorkspaceForUser`
 * passes it through so the company + settings + CoA seed + owner-link
 * membership all share a single `db.transaction(...)`. If the
 * membership write fails for any reason, the whole bootstrap rolls
 * back so the user does not end up with a stranded workspace they
 * can never see.
 *
 * This spec exercises that guarantee end-to-end: it calls
 * `authBizStorage.createCompanyForOwner` directly (in-process — same
 * approach as `companies-create-rollback.spec.ts`) and forces the
 * membership write to fail with a real Postgres-level NOT NULL
 * violation by passing `userId: null` inside `ownerMembership`. The
 * assertion is that no stranded `companies` row, `settings` row, or
 * seeded `accounts` rows remain in the database after the call
 * rejects.
 *
 * Why call the storage method directly rather than driving the signup
 * route over HTTP: the signup handler always passes a well-formed
 * `userId` (the just-created auth row), so producing a membership-
 * write failure through the HTTP surface would require either monkey-
 * patching the auth layer or installing a deliberate fault injector
 * in the production code path. Calling the storage method directly
 * with a sentinel `null` userId in the membership opts is the
 * smallest possible reproduction — it keeps the production code path
 * completely untouched while still exercising the actual
 * `db.transaction` rollback semantics that protect the user from the
 * original bug.
 */

const DB_URL = requireDbUrl("bootstrap-workspace-rollback regression spec");
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FORCED_FAILURE_NAME = `RBA Bootstrap Rollback Sentinel ${RUN_TAG}`;

let client: pg.Client;

test.describe.configure({ mode: "serial" });

test.describe("bootstrapWorkspaceForUser rolls back on owner-link failure @companies-rollback", () => {
  test.beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
  });

  test.afterAll(async () => {
    if (client) {
      // Belt-and-suspenders cleanup. The whole point of this spec is
      // that nothing should be committed for the sentinel name, but
      // if the fix ever regresses we still want sibling specs to come
      // up clean rather than tripping over a sentinel-named row.
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

  test("a forced membership-write failure leaves no stranded company / settings / accounts rows behind", async () => {
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

    // Import the auth storage layer in-process and call
    // createCompanyForOwner — the helper bootstrapWorkspaceForUser
    // funnels through — with a forced-failure ownerMembership: the
    // membership.userId is `null`, which the DB rejects on the
    // `memberships.user_id NOT NULL` column. Drizzle forwards the
    // value as-is to Postgres, so the failure surfaces at the DB
    // driver level — exactly the class of failure the fix is meant
    // to roll back from.
    //
    // Note we still pass a real string for the company's
    // `ownerUserId` argument: the bug under test is the membership
    // write, not the workspace insert. We want the workspace insert
    // and CoA seed to succeed inside the transaction so we can then
    // observe the rollback when the membership insert fails.
    const { authBizStorage } = await import("../../server/auth/storage");
    await expect(
      authBizStorage.createCompanyForOwner(
        // A syntactically valid but obviously-not-a-real-user id —
        // companies.owner_user_id is nullable so this is just a
        // marker that lets us confirm rollback scope without coupling
        // the test to any seeded user fixture.
        "rba-bootstrap-rollback-sentinel-user",
        FORCED_FAILURE_NAME,
        {
          // Cast through `unknown` because the option's TS type
          // intentionally requires a non-null `userId`; we are
          // deliberately violating the contract here to simulate a
          // runtime failure (e.g. a future RLS regression or a
          // unique-constraint hiccup) and verify the rollback.
          ownerMembership: { userId: null as unknown as string, role: "owner" },
        },
      ),
    ).rejects.toThrow();

    // The actual assertion: no row matching our unique sentinel name
    // remains. Before the fix, the company + settings + CoA seed
    // committed inside the first transaction and the membership
    // insert was a separate write — so a forced membership failure
    // would leave a row matching the sentinel name in place. With
    // the fix, all four writes share a transaction and the failure
    // rolls everything back.
    //
    // We deliberately do NOT assert on a global `companies` row count
    // here: parallel e2e workers may legitimately create or destroy
    // unrelated workspaces during this test, which would make a
    // strict count comparison flaky without changing what we
    // actually care about. The sentinel-name check is per-run unique
    // (RUN_TAG above) so it isolates this spec from sibling specs
    // while still catching the bug.
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

    // Also verify the chart-of-accounts seed and settings row were
    // rolled back — these are the second and third halves of the
    // orphan story. If the company row is gone but the accounts
    // rows survived under the gone company id, we still have
    // orphans (and a future workspace that reused the serial id
    // would silently inherit a stranger's accounts). Same logic
    // applies to a stranded settings row.
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

    const orphanSettings = Number(
      (
        await client.query(
          `SELECT count(*)::int AS c FROM settings s
           LEFT JOIN companies c ON c.id = s.company_id
           WHERE c.id IS NULL`,
        )
      ).rows[0].c,
    );
    expect(
      orphanSettings,
      `no orphan settings rows may remain after a forced owner-link failure (found ${orphanSettings})`,
    ).toBe(0);
  });
});
