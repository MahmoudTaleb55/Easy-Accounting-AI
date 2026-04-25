import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * UI-side companion to `email-delivery-count-cache.spec.ts`.
 *
 * The sibling spec proves the *server* contract: the in-memory cache
 * wrapping `countEmailDeliveriesForCompany` is filter-aware (every
 * status / email / from / to combo gets its own cache key) and the
 * value freshens within ~5s. What it doesn't cover is the *frontend*
 * contract: when an admin tweaks a filter on
 * /app/settings/email-delivery, the row-count chip near the Download
 * CSV button must re-issue `GET /api/auth/email-deliveries/count` with
 * the new query string and re-render with the new value.
 *
 * The chip's TanStack Query queryKey on the page lists every filter
 * input by reference:
 *
 *   queryKey: [
 *     "/api/auth/email-deliveries/count",
 *     statusFilter, emailFilter, dateBounds.from, dateBounds.to,
 *   ]
 *
 * A regression that drops one of those inputs from the queryKey would
 * leave admins staring at the prior filter's number — the server-side
 * cache is doing exactly the right thing under the hood, but the UI
 * never asks again. This spec walks the status, recipient, and date
 * filters through values with deliberately distinct counts and
 * asserts the chip actually re-renders each time.
 *
 * Why we piggy-back on the dedicated workspace from
 * `email-delivery-alerts.setup.ts` (and not the existing
 * `email-delivery-count-cache-setup`):
 *
 *   * The count-cache spec wipes events for its dedicated owner in
 *     `beforeEach` — adding a sibling spec to that workspace would
 *     race those wipes if Playwright runs the projects in parallel.
 *   * The alerts setup already provisions an *isolated* workspace and
 *     a non-owner trio (owner, accountant, viewer) — none of which
 *     are touched by sibling specs that mutate password-reset events
 *     for the same workspace's owner. Anchoring our seeds on the
 *     accountant's user_id (rather than the owner's) sidesteps both
 *     the alerts spec's `WHERE user_id = <owner>` wipe AND the
 *     list-parity spec's `DELETE FROM password_reset_email_events
 *     WHERE user_id = <owner>` wipe — both of which would otherwise
 *     race our seeds when their projects run in parallel.
 *
 * Why the seeds live in a deep-past window (year 2020) and not the
 * far future: the alerts evaluator's roll-up SQL in
 * `getEmailDeliveryFailureWindow` (server/auth/storage.ts) joins the
 * shared workspace's password-reset events with
 * `created_at >= NOW() - (windowHours * INTERVAL '1 hour')` — capped
 * at 168 hours but with *no upper bound*. Future-dated rows
 * (`created_at = 2090-…`) therefore satisfy `>= NOW()` and would leak
 * into every alerts assertion that expects "no events" — accountant
 * holds a membership in the shared workspace, so the join hits.
 *
 * Anchoring the seeds in the past sidesteps this entirely: the deep-
 * past timestamp falls *outside* the alerts evaluator's window
 * (NOW() − 168h ≫ 2020) so the alerts spec's roll-up never sees them.
 * The chip's date-filter path takes the user-supplied `from`/`to` as-is
 * (no NOW() bound — see the count CTE in storage.ts ~lines 698–718) so
 * pinning the date filter to a 2020 window still surfaces every seed.
 *
 * Year 2020 also sidesteps the csv-export spec (which uses 2099 for
 * its invitation seeds) and the list-parity / alerts wipes (both of
 * which are owner-scoped, not accountant-scoped).
 */

const OWNER_STORAGE = ".playwright/edap-owner.json";
const FIXTURE_PATH = ".playwright/email-delivery-alerts-fixture.json";

// Anchor every seeded event in a deep-past window the chip can pin
// the date filter to. See the file header for why year 2020 (and not
// a future year — future rows leak into the alerts evaluator's
// `NOW() - INTERVAL` window).
const SEED_WINDOW = { from: "2020-01-01", to: "2020-12-31" };
const SEED_AT = "2020-06-15 12:00:00+00";
// A separate deep-past window with no seeds — used to prove that a
// fresh date-filter combo also re-issues the count probe (chip drops
// to "0 rows to export" rather than echoing the prior window's value).
// Year 2010 keeps it outside both the seeded window and the alerts
// evaluator's `NOW()`-bounded window.
const EMPTY_WINDOW = { from: "2010-01-01", to: "2010-12-31" };

const ACCOUNTANT_EMAIL = "e2e-edap-accountant@example.test";

interface SharedFixture {
  companyId: number;
  ownerUserId: string;
}

function readSharedFixture(): SharedFixture {
  const fixturePath = path.resolve(FIXTURE_PATH);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the email-delivery-alerts-setup project ` +
        `first (it provisions the dedicated workspace + accountant user this ` +
        `spec anchors its seeds on).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Partial<
    SharedFixture
  >;
  if (!raw.companyId || !raw.ownerUserId) {
    throw new Error(
      `${FIXTURE_PATH} missing companyId or ownerUserId`,
    );
  }
  return { companyId: raw.companyId, ownerUserId: raw.ownerUserId };
}

function requiredDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the email-delivery-count-chip-refresh spec.",
    );
  }
  return url;
}

interface SeedHandle {
  eventIds: string[];
}

/**
 * Seed N password_reset_email_events of the given `type`, anchored to
 * the accountant's user_id and timestamped inside SEED_WINDOW. Each
 * row gets a distinct `message_id` so the count CTE's
 * `DISTINCT ON (transport, dedup_key)` step keeps every row as its
 * own group (otherwise siblings sharing a message id would collapse
 * into one row and our exact-count assertions would be off by N-1).
 */
async function seedAccountantEvents(
  client: pg.Client,
  accountantUserId: string,
  type: string,
  n: number,
): Promise<string[]> {
  if (n <= 0) return [];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO password_reset_email_events
         (id, token_id, user_id, message_id, type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [
        id,
        crypto.randomUUID(),
        accountantUserId,
        `chip-refresh-${id}`,
        type,
        SEED_AT,
      ],
    );
    ids.push(id);
  }
  return ids;
}

async function deleteEventsById(eventIds: string[]): Promise<void> {
  if (!eventIds.length) return;
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    // `password_reset_email_events.id` is a varchar (not a uuid
    // column) — Drizzle's schema in `shared/models/auth.ts` uses
    // `varchar("id").primaryKey().default(sql`gen_random_uuid()`)`.
    // Pass the array as text[] so the comparison stays varchar = text
    // rather than tripping the operator-doesn't-exist mismatch.
    await client.query(
      `DELETE FROM password_reset_email_events WHERE id = ANY($1::text[])`,
      [eventIds],
    );
  } finally {
    await client.end();
  }
}

async function lookupAccountantUserId(): Promise<string> {
  const client = new pg.Client({ connectionString: requiredDbUrl() });
  await client.connect();
  try {
    const row = (
      await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
        ACCOUNTANT_EMAIL,
      ])
    ).rows[0];
    if (!row?.id) {
      throw new Error(
        `Could not find ${ACCOUNTANT_EMAIL} — the email-delivery-alerts-setup ` +
          `project must run before this spec to provision that user.`,
      );
    }
    return row.id as string;
  } finally {
    await client.end();
  }
}

/**
 * Pin locale to English + theme to light *before* the React tree
 * mounts, then navigate. The chip text we assert on is locale-specific
 * ("rows to export") — a missed locale pin would produce a confusing
 * Arabic-vs-English diff on failure. Mirrors `gotoOwnerShell` /
 * `gotoEnglishOwnerShell` in the sibling delivery specs.
 */
async function gotoEnglishOwnerShell(
  page: Page,
  route: string,
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("app.locale", "en");
    window.localStorage.setItem("app.theme", "light");
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
}

test.describe("email-delivery row-count chip refreshes per filter @count-chip", () => {
  test.use({
    storageState: OWNER_STORAGE,
    // Desktop viewport so the filter row renders side-by-side and the
    // chip + Download CSV button stay on a single line — matches the
    // viewport `email-delivery-filters-persist` uses for the same page.
    viewport: { width: 1280, height: 800 },
  });

  let accountantUserId: string;
  let seed: SeedHandle;

  test.beforeAll(async () => {
    // Sanity: the alerts setup must have run.
    readSharedFixture();
    accountantUserId = await lookupAccountantUserId();

    const client = new pg.Client({ connectionString: requiredDbUrl() });
    await client.connect();
    try {
      // Defensive: scrub any leftover seeds from a previous interrupted
      // run of this spec (matched by our distinctive `message_id`
      // prefix). Anchored on the accountant user_id so we can't
      // accidentally wipe a sibling spec's rows.
      await client.query(
        `DELETE FROM password_reset_email_events
         WHERE user_id = $1 AND message_id LIKE 'chip-refresh-%'`,
        [accountantUserId],
      );

      // Seed three buckets with deliberately distinct counts so any
      // pair of status filters produces a different chip value:
      //   delivered = 3, bounced = 2, sent = 1   (total = 6)
      // Why three instead of two: a single status pair could pass even
      // if the queryKey accidentally hard-coded the *first* status —
      // the third bucket forces the chip to actually re-resolve on
      // every change, not just on the first one.
      const ids: string[] = [];
      ids.push(
        ...(await seedAccountantEvents(client, accountantUserId, "delivered", 3)),
      );
      ids.push(
        ...(await seedAccountantEvents(client, accountantUserId, "bounced", 2)),
      );
      ids.push(
        ...(await seedAccountantEvents(client, accountantUserId, "sent", 1)),
      );
      seed = { eventIds: ids };
    } finally {
      await client.end();
    }
  });

  test.afterAll(async () => {
    if (seed?.eventIds?.length) {
      await deleteEventsById(seed.eventIds);
    }
  });

  test("chip refreshes when status, recipient, and date filters change", async ({
    page,
  }) => {
    await gotoEnglishOwnerShell(page, "/app/settings/email-delivery");

    // The page is owner-only; if the role guard fired we'd see the
    // "Not authorized" copy instead of the filter row. Asserting on
    // the page testid up front turns "auth is misconfigured" into a
    // clear failure rather than a confusing "chip never appeared".
    await expect(
      page.getByTestId("page-email-delivery"),
      "owner should land on the email-delivery page (not the forbidden message)",
    ).toBeVisible({ timeout: 15_000 });

    // ---------------------------------------------------------------
    // 1. Pin the date filter to the seeded window. The unfiltered
    //    workspace count is non-deterministic (sibling specs in the
    //    shared workspace plant + clean up rows in real time), so we
    //    narrow to a window only this spec writes into. Once the chip
    //    reflects all 6 seeded events, every subsequent assertion is
    //    grounded in a deterministic count.
    // ---------------------------------------------------------------
    await page.getByTestId("select-filter-range").click();
    await page.getByTestId("option-range-custom").click();

    const fromInput = page.getByTestId("input-filter-from");
    const toInput = page.getByTestId("input-filter-to");
    await expect(
      fromInput,
      "custom-range inputs render only when range=custom",
    ).toBeVisible();
    await fromInput.fill(SEED_WINDOW.from);
    await toInput.fill(SEED_WINDOW.to);

    const chip = page.getByTestId("text-export-count");
    await expect(
      chip,
      "the chip should mount once the count probe resolves",
    ).toBeVisible({ timeout: 15_000 });

    // 3 delivered + 2 bounced + 1 sent = 6 rows in the seeded window.
    await expect(
      chip,
      "chip must catch up to the seeded total once the date window pins our seeds",
    ).toContainText("6 rows to export", { timeout: 15_000 });

    // ---------------------------------------------------------------
    // 2. Status filter — the chip must re-issue the count probe with
    //    the new query string. If TanStack Query's queryKey dropped
    //    the status filter the cached "6" would persist.
    // ---------------------------------------------------------------
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-bounced").click();
    await expect(
      chip,
      "status=bounced should drop the chip from 6 to 2 via a fresh probe",
    ).toContainText("2 rows to export", { timeout: 10_000 });

    // Pick a *different* status with a distinct bucket count. A
    // regression that hard-coded the first non-default status into
    // the queryKey would still echo "2 rows to export" here.
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-delivered").click();
    await expect(
      chip,
      "status=delivered should change the chip to 3 — proving the queryKey reflects the LATEST status, not the first one chosen",
    ).toContainText("3 rows to export", { timeout: 10_000 });

    // The single-row bucket — locks in the singular-vs-plural label
    // branch on the chip ("1 row" not "1 rows"). A regression that
    // dropped the singular branch would surface here as a clear text
    // mismatch.
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-sent").click();
    await expect(
      chip,
      "status=sent should drop the chip to a single row (singular label)",
    ).toContainText("1 row to export", { timeout: 10_000 });

    // Reset status=all so the recipient assertion sees the full 6.
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-all").click();
    await expect(
      chip,
      "clearing the status filter should restore the full seeded total of 6",
    ).toContainText("6 rows to export", { timeout: 10_000 });

    // ---------------------------------------------------------------
    // 3. Recipient filter — the email input is debounced 250ms before
    //    `emailFilter` updates and the queryKey re-resolves. A bogus
    //    recipient must drive the chip to 0; a substring of the
    //    accountant's email must restore it to 6. Two probes here
    //    catch a regression that simply pinned `email` to a constant
    //    in the queryKey (which would echo whichever value was
    //    captured on first render).
    // ---------------------------------------------------------------
    const recipient = page.getByTestId("input-filter-email");
    await recipient.fill("no-such-recipient@nowhere.invalid");
    await expect(
      chip,
      "a recipient that matches no rows must drop the chip to 0",
    ).toContainText("0 rows to export", { timeout: 10_000 });

    // Substring match against the accountant's email — should restore
    // all 6 seeded rows. (The seeds are anchored to the accountant
    // user_id; the count CTE resolves the recipient via the users
    // join, so `recipient = accountant email`.)
    await recipient.fill("edap-accountant");
    await expect(
      chip,
      "a recipient substring that matches every seed must restore the chip to 6",
    ).toContainText("6 rows to export", { timeout: 10_000 });

    // Clear the recipient — chip stays at 6 (status is "all", date
    // window still pinned to the SEED_WINDOW year). This sanity-checks
    // the empty-input branch of the queryKey, which is a separate code
    // path from "non-empty value".
    await recipient.fill("");
    await expect(
      chip,
      "clearing the recipient input should keep the chip at the seeded total",
    ).toContainText("6 rows to export", { timeout: 10_000 });

    // ---------------------------------------------------------------
    // 4. Date filter — switch to a window with no seeds. The chip
    //    must re-issue the count probe with the new from/to and drop
    //    to 0; a regression that left `from` / `to` out of the
    //    queryKey would silently echo "6 rows to export".
    // ---------------------------------------------------------------
    await fromInput.fill(EMPTY_WINDOW.from);
    await toInput.fill(EMPTY_WINDOW.to);
    await expect(
      chip,
      "switching the date window to a range with no seeds must drop the chip to 0 — proves from/to are part of the queryKey",
    ).toContainText("0 rows to export", { timeout: 10_000 });

    // Restore the seeded window to prove the date-filter change is
    // bidirectional (a queryKey that only freshened on first change
    // would fail this second flip).
    await fromInput.fill(SEED_WINDOW.from);
    await toInput.fill(SEED_WINDOW.to);
    await expect(
      chip,
      "flipping the date window back to the seeded range must restore the chip to 6",
    ).toContainText("6 rows to export", { timeout: 10_000 });
  });
});
