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
 * Dedicated setup for `delivery-alert-audit.spec.ts`.
 *
 * The spec asserts on the "Dismissed by" attribution column rendered by
 * the Recent Alerts table on /app/settings/email-delivery. The audit
 * row's display name is assembled from the dismissing user's
 * first_name + last_name on the join target, so the assertion needs a
 * known user with a stable display name.
 *
 * Crucially, this setup provisions an *isolated* workspace + owner so
 * the spec does not collide with the sibling `email-delivery-alerts`
 * project — both projects wipe and seed alert rows in beforeEach, and
 * if they shared a workspace the parallel run would race (one test's
 * resetAlertState would delete the other's freshly-seeded alert).
 *
 * The user-creation + session-forging machinery is shared with the
 * other e2e setups via `tests/e2e/_helpers/forge-session.ts` so
 * cookie-name / secret-rotation / schema changes only need to be made
 * in one place. The workspace itself stays inline (rather than going
 * through `ensureCompany`) because this setup needs `is_default=false`
 * and an explicit `is_active=true` reset, neither of which the helper's
 * defaults provide.
 */

const COMPANY_NAME = "E2E Delivery Alert Audit Co";
const OWNER_EMAIL = "e2e-daa-owner@example.test";
const OWNER_PASSWORD = "playwright-daa-pw-owner-2026";
const OWNER_FIRST_NAME = "E2E";
const OWNER_LAST_NAME = "Daa-owner";
const STORAGE_PATH = ".playwright/daa-owner.json";
const FIXTURE_PATH = ".playwright/delivery-alert-audit-fixture.json";

setup("authenticate + seed delivery-alert-audit fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the delivery-alert-audit setup");
  requireCookieSecret("the delivery-alert-audit setup");

  let ownerUserId: string;
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // (a) Ensure the owner user exists with a known password hash and
    //     stable first/last name. The shared helper refreshes
    //     first_name/last_name on every run so the audit-table
    //     assertion (which depends on these names being exact) stays
    //     stable across re-runs.
    ownerUserId = await ensureUser(client, {
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      firstName: OWNER_FIRST_NAME,
      lastName: OWNER_LAST_NAME,
      preferredLocale: "en",
    });

    // (b) Ensure the dedicated workspace exists, owned by this owner.
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

    // (c) Owner membership in this dedicated workspace. Belt-and-braces
    //     delete any stray membership in *other* workspaces so the
    //     "first membership" fallback in resolveActiveCompanyId always
    //     lands here even when the browser's banner-dismiss flow can't
    //     pin x-company-id explicitly.
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
    await client.query(
      `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
      [ownerUserId, companyId],
    );
  } finally {
    await client.end();
  }

  // (d) Forge a session row + signed connect.sid cookie via the shared
  //     helper, then save the storage state so the spec can
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

  // (e) Persist the company id + owner user id so the spec can pin
  //     DB seeds to the right rows without rediscovering them.
  const fixturePath = path.resolve(FIXTURE_PATH);
  fs.writeFileSync(
    fixturePath,
    JSON.stringify(
      {
        companyId,
        ownerUserId,
        ownerDisplayName: `${OWNER_FIRST_NAME} ${OWNER_LAST_NAME}`,
        ownerEmail: OWNER_EMAIL,
      },
      null,
      2,
    ),
  );
});
