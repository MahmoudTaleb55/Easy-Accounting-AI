import { test, expect } from "@playwright/test";
import pg from "pg";
import { requireDbUrl } from "./_helpers/forge-session";

/**
 * Regression net for task #339 — the orphan-adoption *half* of the
 * single-transaction guarantee task #274 added to
 * `authBizStorage.bootstrapWorkspaceForUser`.
 *
 * `bootstrapWorkspaceForUser` has two branches. The new-workspace
 * branch (taken when no orphan seed companies are left in the DB)
 * funnels through `createCompanyForOwner` and is already covered by
 * `tests/e2e/bootstrap-workspace-rollback.spec.ts`. The
 * orphan-adoption branch — taken on the very first signup against a
 * fresh deploy that still has the legacy seed workspaces with
 * `owner_user_id IS NULL` — does its own pair of writes inline:
 *
 *   1. UPDATE companies SET owner_user_id = $newUserId WHERE id = …
 *   2. INSERT INTO memberships (user_id, company_id, role) VALUES …
 *
 * Pre-#274 the membership insert lived *outside* the transaction that
 * stamped the owner_user_id, so a failure on step 2 (network blip,
 * future RLS regression, future unique-constraint hiccup) committed
 * step 1 anyway. The orphan workspace ended up "claimed" by a user
 * who had no membership row — invisible to that user via the
 * membership-filtered `/api/companies` list, and impossible for any
 * subsequent first-signup to re-adopt because `owner_user_id IS NULL`
 * was no longer true. A workspace stranded forever.
 *
 * The fix wraps both writes in a single `db.transaction(...)` so a
 * step-2 failure rolls back the step-1 update. This spec pins that
 * guarantee end-to-end:
 *
 *   - Pre-stage a sentinel orphan company (`owner_user_id` NULL) and
 *     stash any other ambient orphans so the function under test sees
 *     ours as the only adoption candidate.
 *   - Install a CHECK constraint on `memberships` that rejects any
 *     insert with our sentinel `user_id`. The constraint is scoped to
 *     a single per-run sentinel value so it cannot interfere with any
 *     other concurrent test fixture.
 *   - Call `authBizStorage.bootstrapWorkspaceForUser` with that same
 *     sentinel `user_id`. Step 1 issues a real
 *     `owner_user_id NULL → sentinel` update; step 2's INSERT trips
 *     the CHECK constraint at the DB driver level — exactly the
 *     class of failure the fix is meant to roll back from.
 *   - Assert the sentinel company's `owner_user_id` is back to NULL,
 *     proving the step-1 update was rolled back alongside the failed
 *     step-2 insert. (Pre-fix, step 1 would have committed and the
 *     sentinel column would now hold the sentinel user id.)
 *
 * Why a CHECK constraint instead of the `userId: null` shortcut the
 * sibling specs use: those specs exercise paths whose pre-fix bug
 * stranded a freshly *created* company row, so a missing row is the
 * proof of rollback. Here the bug instead stranded a column *update*
 * on a pre-existing row, so the assertion has to be "the update is
 * gone" — which only has signal if the update tried to write a
 * non-NULL value in the first place. Passing `userId: null` would
 * make step 1 a `NULL → NULL` no-op and the post-test assertion would
 * pass even with the transaction split back open, defeating the
 * purpose of the regression net. The CHECK constraint approach lets
 * us drive a real owner-stamp through step 1 while still
 * deterministically failing step 2.
 *
 * Why call the storage method directly rather than driving the signup
 * route over HTTP: same reason as the sibling specs — the production
 * signup handler always passes a well-formed `userId` (the just-
 * created auth row), so producing a membership-write failure through
 * the HTTP surface would require monkey-patching the auth layer or
 * installing a fault injector in the production code path. Combining
 * an in-process call with a per-run sentinel CHECK constraint is the
 * smallest possible reproduction — it keeps the production code path
 * completely untouched while still exercising the actual
 * `db.transaction` rollback semantics that protect users from the
 * original bug.
 */

const DB_URL = requireDbUrl("orphan-adoption-rollback regression spec");
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SENTINEL_COMPANY_NAME = `RBA Orphan Adoption Rollback Sentinel ${RUN_TAG}`;
const SENTINEL_USER_ID = `rba-orphan-adoption-rollback-sentinel-user-${RUN_TAG}`;
// A second sentinel string used purely to "park" any ambient orphan
// companies (e.g. left behind by a sibling spec that crashed mid-run)
// so that our spec sees a deterministic single-orphan landscape and
// cleanup can find and restore them again afterwards.
const STASH_OWNER_USER_ID = `rba-orphan-adoption-rollback-stash-${RUN_TAG}`;
// Per-run constraint name so two concurrent runs (or a leftover from a
// prior crashed run) cannot collide on the constraint namespace.
const CHECK_CONSTRAINT_NAME = `temp_orphan_rollback_block_${RUN_TAG.replace(
  /[^a-zA-Z0-9]/g,
  "_",
)}`;

let client: pg.Client;
let constraintInstalled = false;
let stashApplied = false;

test.describe.configure({ mode: "serial" });

test.describe("bootstrapWorkspaceForUser orphan-adoption rolls back on owner-link failure @companies-rollback", () => {
  test.beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();

    // Step A — park any ambient orphan companies under a per-run
    // sentinel owner so the function under test sees only our sentinel
    // orphan as an adoption candidate. Without this, a sibling test
    // fixture's leftover orphan could be processed first and mask the
    // signal we're trying to observe (the function would still throw,
    // but on the wrong row, and our sentinel orphan would never have
    // its update attempted — the assertion would pass tautologically).
    await client.query(
      `UPDATE companies SET owner_user_id = $1 WHERE owner_user_id IS NULL`,
      [STASH_OWNER_USER_ID],
    );
    stashApplied = true;

    // Step B — install the per-sentinel CHECK constraint on
    // memberships. Scoped to our sentinel `user_id` so it cannot trip
    // any other test fixture's writes. NOT VALID skips the existing-
    // rows scan (no existing row could match anyway, the sentinel
    // includes a per-run RUN_TAG) but still enforces the predicate on
    // every subsequent insert.
    await client.query(
      `ALTER TABLE memberships ADD CONSTRAINT ${CHECK_CONSTRAINT_NAME} ` +
        `CHECK (user_id <> $$${SENTINEL_USER_ID}$$) NOT VALID`,
    );
    constraintInstalled = true;

    // Step C — seed the sentinel orphan company. owner_user_id is
    // explicitly NULL so the function under test will pick it up as
    // an orphan to adopt. is_active defaults to true; is_default to
    // false; functional_currency / currency_symbol have defaults.
    await client.query(
      `INSERT INTO companies (name, owner_user_id) VALUES ($1, NULL)`,
      [SENTINEL_COMPANY_NAME],
    );
  });

  test.afterAll(async () => {
    if (!client) return;
    // Belt-and-suspenders teardown. Each step is wrapped in its own
    // try/catch so a failure in one cleanup step does not skip the
    // others — leaving a sentinel CHECK constraint or a stash mark
    // behind would poison subsequent runs.
    if (constraintInstalled) {
      try {
        await client.query(
          `ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ${CHECK_CONSTRAINT_NAME}`,
        );
      } catch {
        // best-effort
      }
    }
    try {
      await client.query(
        `DELETE FROM memberships WHERE user_id = $1`,
        [SENTINEL_USER_ID],
      );
    } catch {
      // best-effort
    }
    try {
      await client.query(
        `DELETE FROM accounts WHERE company_id IN (SELECT id FROM companies WHERE name = $1)`,
        [SENTINEL_COMPANY_NAME],
      );
    } catch {
      // best-effort
    }
    try {
      await client.query(
        `DELETE FROM settings WHERE company_id IN (SELECT id FROM companies WHERE name = $1)`,
        [SENTINEL_COMPANY_NAME],
      );
    } catch {
      // best-effort
    }
    try {
      await client.query(
        `DELETE FROM memberships WHERE company_id IN (SELECT id FROM companies WHERE name = $1)`,
        [SENTINEL_COMPANY_NAME],
      );
    } catch {
      // best-effort
    }
    try {
      await client.query(
        `DELETE FROM companies WHERE name = $1`,
        [SENTINEL_COMPANY_NAME],
      );
    } catch {
      // best-effort
    }
    if (stashApplied) {
      // Restore any orphan companies we parked under STASH_OWNER_USER_ID
      // back to owner_user_id IS NULL so the database state is exactly
      // what we found it in. Scoped by the per-run sentinel so we
      // can't accidentally clobber a real owner_user_id that some
      // other test set.
      try {
        await client.query(
          `UPDATE companies SET owner_user_id = NULL WHERE owner_user_id = $1`,
          [STASH_OWNER_USER_ID],
        );
      } catch {
        // best-effort
      }
    }
    await client.end();
  });

  test("a forced membership-write failure leaves the sentinel orphan's owner_user_id NULL", async () => {
    // Sanity: our sentinel orphan exists and is, in fact, the only
    // orphan visible to the function under test. If the stash step in
    // beforeAll was a no-op (e.g. another orphan slipped in between
    // beforeAll and here), we'd want the test to fail loudly here
    // rather than produce a confusing assertion failure later.
    const sentinelRow = (
      await client.query(
        `SELECT id, owner_user_id FROM companies WHERE name = $1`,
        [SENTINEL_COMPANY_NAME],
      )
    ).rows[0] as { id: number; owner_user_id: string | null } | undefined;
    expect(sentinelRow, "sentinel orphan company must exist").toBeTruthy();
    expect(
      sentinelRow!.owner_user_id,
      "sentinel orphan company must start with owner_user_id IS NULL",
    ).toBeNull();

    const orphanCount = Number(
      (
        await client.query(
          `SELECT count(*)::int AS c FROM companies WHERE owner_user_id IS NULL`,
        )
      ).rows[0].c,
    );
    expect(
      orphanCount,
      "exactly one orphan company should be visible during this spec — " +
        "ambient orphans should have been stashed in beforeAll",
    ).toBe(1);

    // No membership for the sentinel user can pre-exist (the user id
    // is per-run unique, so any row matching it is a leak from a
    // prior failed run we'd want to know about).
    const beforeMembershipCount = Number(
      (
        await client.query(
          `SELECT count(*)::int AS c FROM memberships WHERE user_id = $1`,
          [SENTINEL_USER_ID],
        )
      ).rows[0].c,
    );
    expect(
      beforeMembershipCount,
      "sentinel user id must not have any memberships from a prior failed run",
    ).toBe(0);

    // Drive the orphan-adoption branch in-process. The function will:
    //   1. SELECT the sentinel orphan,
    //   2. open a db.transaction(...),
    //   3. UPDATE companies SET owner_user_id = SENTINEL_USER_ID,
    //   4. INSERT INTO memberships (user_id = SENTINEL_USER_ID, …)
    //      — rejected by the CHECK constraint installed in beforeAll,
    //   5. transaction rolls back,
    //   6. function rejects.
    //
    // Pre-#274, the INSERT would have lived outside the transaction
    // that owned the UPDATE, so step 3 would have committed before
    // step 4's failure surfaced — the sentinel column would now read
    // SENTINEL_USER_ID instead of NULL.
    const { authBizStorage } = await import("../../server/auth/storage");
    await expect(
      authBizStorage.bootstrapWorkspaceForUser(
        SENTINEL_USER_ID,
        `Orphan Adoption Sentinel ${RUN_TAG}`,
      ),
    ).rejects.toThrow();

    // The actual assertion: the sentinel orphan's owner_user_id is
    // back to NULL, proving the step-1 UPDATE was rolled back when
    // the step-2 INSERT failed. This is the bit that would regress
    // if a future refactor ever splits the two writes apart again.
    const afterRow = (
      await client.query(
        `SELECT owner_user_id FROM companies WHERE name = $1`,
        [SENTINEL_COMPANY_NAME],
      )
    ).rows[0] as { owner_user_id: string | null } | undefined;
    expect(
      afterRow,
      "sentinel orphan company row must still exist (the UPDATE was rolled back, not the row)",
    ).toBeTruthy();
    expect(
      afterRow!.owner_user_id,
      `sentinel orphan's owner_user_id must still be NULL after the forced ` +
        `owner-link failure — finding '${afterRow?.owner_user_id}' instead means ` +
        `the orphan-adoption UPDATE was committed independently of the ` +
        `membership INSERT, exactly the bug task #274 fixed`,
    ).toBeNull();

    // Belt-and-suspenders: no membership row was created for the
    // sentinel user id either. If one survives, the INSERT half of
    // the transaction somehow committed (impossible if the rollback
    // path works, but cheap to verify and useful as an early warning
    // if the CHECK constraint ever stops firing for some unrelated
    // reason).
    const afterMembershipCount = Number(
      (
        await client.query(
          `SELECT count(*)::int AS c FROM memberships WHERE user_id = $1`,
          [SENTINEL_USER_ID],
        )
      ).rows[0].c,
    );
    expect(
      afterMembershipCount,
      "no memberships row may remain for the sentinel user id after rollback",
    ).toBe(0);
  });
});
