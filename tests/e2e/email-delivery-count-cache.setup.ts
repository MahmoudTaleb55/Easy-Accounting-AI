import { test as setup } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import {
  ensureUser,
  forgeSession,
  requireCookieSecret,
  requireDbUrl,
} from "./_helpers/forge-session";

/**
 * Dedicated auth + workspace setup for the email-delivery-count-cache
 * spec.
 *
 * The companion `email-delivery-count-cache.spec.ts` asserts on exact
 * counts produced by `GET /api/auth/email-deliveries/count`. The count
 * helper unions both invitation and password-reset email events for a
 * workspace, so any sibling spec writing rows into either table for the
 * same workspace would silently leak into our exact-count assertions
 * when Playwright runs spec projects in parallel.
 *
 * The original draft of this spec piggybacked on the workspace from
 * `email-delivery-alerts.setup.ts`, but `email-delivery-alerts.spec.ts`
 * also wipes / seeds those same tables for that same workspace, so the
 * two specs raced when their projects ran in parallel after the shared
 * setup completed. Provisioning a fully separate workspace + owner
 * here removes that race entirely.
 *
 * The user-creation + session-forging machinery is shared with the
 * other e2e setups via `tests/e2e/_helpers/forge-session.ts` so
 * cookie-name / secret-rotation / schema changes only need to be made
 * in one place. The workspace itself stays inline (rather than going
 * through `ensureCompany`) because this setup needs `is_default=false`
 * and an explicit `is_active=true` reset, neither of which the helper's
 * defaults provide.
 */

const COMPANY_NAME = "E2E Delivery Count-Cache Co";
const OWNER_EMAIL = "e2e-edcc-owner@example.test";
const OWNER_PASSWORD = "playwright-edcc-pw-owner-2025";
const OWNER_FIRST_NAME = "E2E";
const OWNER_LAST_NAME = "Edcc-owner";
const STORAGE_PATH = ".playwright/edcc-owner.json";
const FIXTURE_PATH = ".playwright/email-delivery-count-cache-fixture.json";

setup("authenticate + seed email-delivery-count-cache fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the email-delivery-count-cache setup");
  requireCookieSecret("the email-delivery-count-cache setup");

  let ownerUserId: string;
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // (a) Ensure the dedicated owner exists with a known password hash.
    //     The shared helper refreshes the hash on every run so a
    //     rotated SESSION_SECRET can't strand the suite.
    ownerUserId = await ensureUser(client, {
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      firstName: OWNER_FIRST_NAME,
      lastName: OWNER_LAST_NAME,
    });

    // (b) Ensure the dedicated company exists, owned by the dedicated
    //     owner. Crucially, this company is *only* used by this spec —
    //     siblings never touch it, so the event log for this workspace
    //     stays deterministic.
    let companyRow = (
      await client.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [COMPANY_NAME])
    ).rows[0];
    if (companyRow) {
      companyId = Number(companyRow.id);
      await client.query(
        `UPDATE companies SET owner_user_id=$1, functional_currency='USD', currency_symbol='$', is_active=true WHERE id=$2`,
        [ownerUserId, companyId],
      );
    } else {
      companyRow = (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default, is_active)
           VALUES ($1, $2, 'USD', '$', false, true) RETURNING id`,
          [COMPANY_NAME, ownerUserId],
        )
      ).rows[0];
      companyId = Number(companyRow.id);
    }

    // (c) Owner membership in the dedicated workspace. The owner is the
    //     only member of this workspace, which is what makes the
    //     password-reset event seeds in the spec land squarely inside
    //     this workspace's count CTE (the CTE joins prt events to
    //     memberships on (user_id, company_id)).
    const existingMembership = (
      await client.query(
        `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
        [ownerUserId, companyId],
      )
    ).rows[0];
    if (existingMembership) {
      await client.query(`UPDATE memberships SET role = 'owner' WHERE id = $1`, [
        existingMembership.id,
      ]);
    } else {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, role)
         VALUES ($1, $2, $3, 'owner')`,
        [crypto.randomUUID(), ownerUserId, companyId],
      );
    }

    // Belt-and-braces: defensively delete any stray membership this
    // owner might have picked up in a *different* workspace from a
    // previous run (e.g. an earlier abandoned setup that planted them
    // in a shared company). Keeping the owner pinned to a single
    // membership keeps the server's "first membership" fallback honest
    // when the explicit x-company-id header is the only pin.
    await client.query(
      `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
      [ownerUserId, companyId],
    );
  } finally {
    await client.end();
  }

  // (d) Forge a session row + signed connect.sid cookie via the shared
  //     helper, then save a storage state the spec can
  //     `test.use({ storageState })`. Clearing cookies first matches
  //     the historical inline behaviour and keeps a stale signed sid
  //     from a prior run out of the saved state.
  await page.context().clearCookies();
  await forgeSession({
    page,
    dbUrl,
    userId: ownerUserId,
    email: OWNER_EMAIL,
    firstName: OWNER_FIRST_NAME,
    lastName: OWNER_LAST_NAME,
    storagePath: path.resolve(STORAGE_PATH),
  });

  // (e) Persist the dedicated company id + owner user id so the spec can
  //     pin DB seeds (event inserts, count probes) to the right rows
  //     without rediscovering them on every test.
  const fixturePath = path.resolve(FIXTURE_PATH);
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({ companyId, ownerUserId }, null, 2),
  );
});
