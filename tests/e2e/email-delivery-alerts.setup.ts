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
 * Dedicated auth + workspace setup for the email-delivery-alerts spec.
 *
 * The companion `email-delivery-alerts.spec.ts` asserts on exact failure
 * counts and on the evaluator's structured outcome under each threshold
 * configuration. Sharing a workspace with any sibling spec that records
 * delivery activity (e.g. `role-based-api.spec.ts` mints invitations,
 * which append rows to `invitation_email_events` that fall inside the
 * 24h evaluator window) makes those count assertions non-deterministic
 * when Playwright runs spec projects in parallel.
 *
 * The same problem also breaks the banner-dismiss flow: the shared owner
 * accrues additional memberships as sibling specs create workspaces
 * (`POST /api/companies` in `role-based-api`), and the browser-side
 * dismiss call — which can't easily set `x-company-id` — silently routes
 * to the wrong workspace, returning 404 and leaving the banner visible.
 *
 * To remove both failure modes this setup provisions an *isolated*
 * workspace + a dedicated owner / accountant / viewer trio whose only
 * membership is in that workspace. Storage states are saved under
 * `.playwright/edap-{role}.json` and the company id + owner user id are
 * persisted to `.playwright/email-delivery-alerts-fixture.json` so the
 * spec can pin DB seeds to the right rows.
 *
 * The user-creation + session-forging machinery is shared with the other
 * e2e setups via `tests/e2e/_helpers/forge-session.ts` so cookie-name /
 * secret-rotation / schema changes only need to be made in one place.
 */

interface RoleSpec {
  role: "owner" | "accountant" | "viewer";
  email: string;
  password: string;
  storagePath: string;
}

const COMPANY_NAME = "E2E Delivery Alerts Co";
const ROLE_SPECS: RoleSpec[] = [
  {
    role: "owner",
    email: "e2e-edap-owner@example.test",
    password: "playwright-edap-pw-owner-2025",
    storagePath: ".playwright/edap-owner.json",
  },
  {
    role: "accountant",
    email: "e2e-edap-accountant@example.test",
    password: "playwright-edap-pw-accountant-2025",
    storagePath: ".playwright/edap-accountant.json",
  },
  {
    role: "viewer",
    email: "e2e-edap-viewer@example.test",
    password: "playwright-edap-pw-viewer-2025",
    storagePath: ".playwright/edap-viewer.json",
  },
];

setup("authenticate + seed email-delivery-alerts fixtures", async ({ page }) => {
  const dbUrl = requireDbUrl("the email-delivery-alerts setup");
  requireCookieSecret("the email-delivery-alerts setup");

  const userIds = new Map<string, string>();
  let companyId: number;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // (a) Ensure each user exists with a known password hash. The shared
    //     `ensureUser` refreshes the bcrypt hash on every run so a rotated
    //     SESSION_SECRET won't strand the suite.
    //
    //     Preferred locale is forced to 'ar' on every run for these
    //     dedicated users — never 'en'. The banner-renders test pins the
    //     locale to English via the `?lang=en` URL override (see
    //     `gotoOwnerShell` in the spec) and asserts on the English
    //     headline. If the stored `preferred_locale` were 'en', the
    //     assertion would still pass even when the URL-override mechanism
    //     is broken (LocaleSync would cheerfully adopt 'en' from the
    //     user's profile and nobody would notice). Forcing 'ar' here
    //     makes the URL override the load-bearing piece, so a future
    //     regression in `getUrlLocaleOverride()` / `LocaleSync` actually
    //     fails the test. We pass the choice through `ensureUser`'s
    //     `preferredLocale` option so the row is rewritten on both the
    //     fresh-insert and refresh paths — a re-run after a sibling spec
    //     (or this same suite) flipped the row to 'en' still starts from
    //     the Arabic baseline this guardrail depends on.
    for (const spec of ROLE_SPECS) {
      const uid = await ensureUser(client, {
        email: spec.email,
        password: spec.password,
        firstName: "E2E",
        lastName: `Edap-${spec.role}`,
        preferredLocale: "ar",
      });
      userIds.set(spec.role, uid);
    }

    // (b) Ensure the dedicated company exists, owned by the dedicated owner.
    //     Crucially, this company is *only* used by this spec — sibling
    //     specs (role-based-api, etc.) never touch it, so the
    //     invitation/password-reset event log for this workspace stays
    //     deterministic.
    //
    //     We deliberately keep this lookup keyed by company *name*
    //     (rather than delegating to the helper's `ensureCompany`) for
    //     two reasons:
    //       • A name-anchored upsert is the most defensive across re-runs
    //         even if a prior run renamed the row.
    //       • This setup needs `is_default=false` and an explicit
    //         `is_active=true` reset, neither of which the helper
    //         defaults to.
    const ownerUserId = userIds.get("owner")!;
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

    // (c) Memberships — one per role in this isolated workspace. Each user
    //     only ever belongs to *this* company, so the server's "first
    //     membership" fallback in `resolveActiveCompanyId` always lands on
    //     the right workspace even when the browser can't pin
    //     `x-company-id` (the banner's dismiss call is the relevant case).
    for (const spec of ROLE_SPECS) {
      const uid = userIds.get(spec.role)!;
      const existingMembership = (
        await client.query(
          `SELECT id FROM memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
          [uid, companyId],
        )
      ).rows[0];
      if (existingMembership) {
        await client.query(`UPDATE memberships SET role = $1 WHERE id = $2`, [
          spec.role,
          existingMembership.id,
        ]);
      } else {
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, role)
           VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), uid, companyId, spec.role],
        );
      }

      // Belt-and-braces: defensively delete any stray membership this user
      // might have picked up in a *different* workspace from a previous run
      // (e.g. an earlier abandoned setup that planted them in a shared
      // company). Keeping the user pinned to a single membership is what
      // makes the browser-side dismiss flow deterministic.
      await client.query(
        `DELETE FROM memberships WHERE user_id = $1 AND company_id <> $2`,
        [uid, companyId],
      );
    }
  } finally {
    await client.end();
  }

  // (d) For each role: forge a passport session row + signed connect.sid
  //     cookie via the shared helper, then save a storage state the spec
  //     can `test.use({ storageState })`. We clear the page's cookie jar
  //     between roles so each saved state contains exactly one user's
  //     cookies and nothing leaks across roles.
  for (const spec of ROLE_SPECS) {
    const uid = userIds.get(spec.role)!;
    await page.context().clearCookies();
    await forgeSession({
      page,
      dbUrl,
      userId: uid,
      email: spec.email,
      firstName: "E2E",
      lastName: `Edap-${spec.role}`,
      storagePath: path.resolve(spec.storagePath),
    });
  }

  // (e) Persist the dedicated company id + owner user id so the spec can
  //     pin DB seeds (password-reset event inserts, alert seedAlert) to
  //     the right rows without rediscovering them on every test.
  const fixturePath = path.resolve(".playwright/email-delivery-alerts-fixture.json");
  fs.writeFileSync(
    fixturePath,
    JSON.stringify({ companyId, ownerUserId: userIds.get("owner") }, null, 2),
  );
});
