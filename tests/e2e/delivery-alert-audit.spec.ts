import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { gotoWithPinnedLocale } from "./_helpers/pin-locale";

/**
 * End-to-end coverage for the "Dismissed by" attribution column on the
 * Recent Alerts audit table at /app/settings/email-delivery.
 *
 * The audit row that lists *who* silenced each alert is produced by a
 * left-join inside `listRecentEmailDeliveryAlerts` (server/auth/storage.ts):
 * email_delivery_alerts.dismissed_by_user_id → users.id, then assembled
 * into `dismissedByName` / `dismissedByEmail`. That join silently breaks
 * if either side stops being populated correctly:
 *
 *   - the dismiss handler stops setting dismissed_by_user_id (the column
 *     would still be valid SQL but every row would attribute as
 *     "Removed user"),
 *   - the column type drifts (varchar vs uuid mismatch on a future
 *     migration would coerce nulls or hard-fail the join), or
 *   - the join key changes (e.g. switched to email instead of id without
 *     backfilling).
 *
 * In every one of those failure modes the page would keep loading, but
 * the cell would either show a blank, a UUID, or a generic placeholder.
 * This spec drives the full path — seed a fired alert, dismiss it via
 * the in-app banner as the dedicated owner, then load the audit page
 * and assert the `Dismissed by` cell renders the owner's display name
 * (not a UUID, not blank, not the "Removed user" fallback).
 *
 * The spec uses its OWN dedicated workspace + owner (provisioned by
 * `delivery-alert-audit.setup.ts`) rather than piggybacking on the
 * `email-delivery-alerts` project's workspace. Sharing a workspace
 * with that project would race when Playwright runs the two projects
 * in parallel — both wipe + seed alert rows in beforeEach, so a
 * neighbour's reset can delete this spec's freshly-seeded alert
 * mid-test. The setup pins the owner's first/last name so the
 * assembled display name is deterministic.
 */

const OWNER_STORAGE = ".playwright/daa-owner.json";

interface SharedFixture {
  companyId: number;
  ownerUserId: string;
  ownerDisplayName: string;
  ownerEmail: string;
}

let cachedShared: SharedFixture | null = null;

function readSharedFixture(): SharedFixture {
  const fixturePath = path.resolve(".playwright/delivery-alert-audit-fixture.json");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the delivery-alert-audit-setup project first ` +
        `(it persists the dedicated company id + owner user id this spec relies on).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Partial<SharedFixture>;
  if (!raw.companyId || !raw.ownerUserId || !raw.ownerDisplayName || !raw.ownerEmail) {
    throw new Error(
      `delivery-alert-audit-fixture.json missing companyId, ownerUserId, ownerDisplayName, or ownerEmail`,
    );
  }
  return {
    companyId: raw.companyId,
    ownerUserId: raw.ownerUserId,
    ownerDisplayName: raw.ownerDisplayName,
    ownerEmail: raw.ownerEmail,
  };
}

async function getShared(): Promise<SharedFixture> {
  if (cachedShared) return cachedShared;
  cachedShared = readSharedFixture();
  return cachedShared;
}

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set for the delivery-alert-audit spec.");
  return url;
}

/**
 * Wipe alert state for the dedicated workspace so each test starts from
 * a known floor (no leftover alert rows from sibling specs that share
 * the workspace, e.g. `email-delivery-alerts.spec.ts`).
 */
async function resetAlertState(): Promise<void> {
  const { companyId } = await getShared();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM email_delivery_alerts WHERE company_id = $1`,
      [companyId],
    );
    await client.query(
      `DELETE FROM email_delivery_alert_settings WHERE company_id = $1`,
      [companyId],
    );
  } finally {
    await client.end();
  }
}

/** Insert a fired (un-dismissed) alert directly so the banner has
 *  something to render without driving the evaluator. Returns the
 *  generated alert id so the audit-table assertion can target the
 *  exact row. */
async function seedAlert(): Promise<{ id: string }> {
  const { companyId } = await getShared();
  const id = crypto.randomUUID();
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO email_delivery_alerts
         (id, company_id, window_hours, failure_count, send_count, reason, snapshot, email_sent, email_recipients)
       VALUES ($1, $2, 24, 7, 50, 'absolute', $3::jsonb, false, 0)`,
      [id, companyId, JSON.stringify({ bounced: 5, complained: 1, send_failed: 1 })],
    );
  } finally {
    await client.end();
  }
  return { id };
}

async function gotoOwnerShell(page: Page, route: string): Promise<void> {
  // Pin locale (via the `?lang=en` URL override) + theme so the audit-
  // table headings render in English and the "Removed user" fallback
  // string (Arabic vs English) is unambiguous if our assertion happens
  // to fall back.
  //
  // The dedicated owner that backs `OWNER_STORAGE` has
  // `preferred_locale='ar'`, so the older `addInitScript("app.locale",
  // "en")` pattern would be clobbered by `LocaleSync`'s server-
  // preference reconciliation moments after first paint. The shared
  // `gotoWithPinnedLocale` helper uses the URL override that survives
  // both `LocaleProvider` initialization AND `LocaleSync`'s early-
  // return guard — see that helper for the full rationale.
  await gotoWithPinnedLocale(page, route);
}

test.describe("delivery-alert audit attribution @alerts", () => {
  test.use({
    storageState: OWNER_STORAGE,
    // The audit table lives on a desktop settings page; pin a wide
    // viewport so columns aren't collapsed by responsive overrides.
    viewport: { width: 1280, height: 800 },
  });

  test.beforeEach(async () => {
    await resetAlertState();
  });

  test("dismissing the banner attributes the audit row to the dismissing user", async ({
    page,
  }) => {
    const shared = await getShared();
    // 1. Seed a fired alert in the dedicated workspace.
    const seeded = await seedAlert();

    // 2. Dismiss it via the in-app banner so the dismiss path that
    //    populates dismissed_by_user_id with req.user.id runs end-to-end.
    //    (Hitting the API directly would still set the column, but the
    //    task explicitly calls for a banner-driven dismiss.)
    await gotoOwnerShell(page, "/app");
    const banner = page.locator('[data-testid="banner-email-delivery-alert"]');
    await expect(banner, "banner should appear for the owner with an active alert").toBeVisible({
      timeout: 15_000,
    });
    await page.locator('[data-testid="button-dismiss-email-delivery-alert"]').click();
    await expect(banner, "banner should unmount after dismiss").toBeHidden({
      timeout: 10_000,
    });

    // 3. Load the audit page and find the row for the seeded alert.
    await gotoOwnerShell(page, "/app/settings/email-delivery");
    const row = page.locator(`[data-testid="row-recent-alert-${seeded.id}"]`);
    await expect(row, "the dismissed alert should appear in the audit table").toBeVisible({
      timeout: 15_000,
    });

    // 4. The "Dismissed by" cell must show the owner's display name —
    //    not a UUID, not blank, not the "Removed user" placeholder.
    //    Asserting on `toHaveText` (exact match) catches any of those
    //    failure modes in a single check.
    const cell = page.locator(`[data-testid="text-dismissed-by-${seeded.id}"]`);
    await expect(
      cell,
      "Dismissed by cell should render the user's display name (not a UUID or blank)",
    ).toHaveText(shared.ownerDisplayName, { timeout: 10_000 });

    // Belt-and-braces: defend against a future regression that swaps
    // the display-name assembly for an email-only fallback (the cell
    // would *also* be non-empty in that case, but it would no longer
    // match the user's name). Calling out both fallbacks explicitly
    // gives a sharper error message when the join breaks.
    const cellText = (await cell.textContent())?.trim() ?? "";
    expect(cellText, "cell must not be blank").not.toBe("");
    expect(cellText, "cell must not surface the raw UUID").not.toContain(shared.ownerUserId);
    expect(cellText, "cell must not surface the email fallback").not.toContain(shared.ownerEmail);
    expect(cellText, "cell must not surface the removed-user placeholder").not.toContain(
      "Removed user",
    );

    // 5. The companion `text-dismissed-at` cell must also be present,
    //    confirming the join didn't drop the row entirely (a hidden
    //    failure mode where the leftJoin silently filters when the FK
    //    type drifts to a non-nullable shape).
    await expect(
      page.locator(`[data-testid="text-dismissed-at-${seeded.id}"]`),
      "the dismissed-at sub-line should also render — proves the row survived the join",
    ).toBeVisible();
  });
});
