import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Arabic-locale mirror of `email-delivery-count-chip-refresh.spec.ts`.
 *
 * The sibling English spec walks the status / recipient / date filters
 * on /app/settings/email-delivery and asserts the row-count chip near
 * the Download CSV button re-issues `GET /api/auth/email-deliveries/count`
 * with the new query string. To keep its assertions on exact strings
 * deterministic it pins the page locale to English ("6 rows to export",
 * "1 row to export", etc.).
 *
 * The same chip also has Arabic branches in the page (see
 * `client/src/pages/settings/email-delivery.tsx` near the
 * `data-testid="text-export-count"` span):
 *
 *   exportAtCap
 *     ? ar
 *       ? `+${exportCap.toLocaleString("ar")} صفًا`              // capped >= 10000
 *       : `${exportCap.toLocaleString("en")}+ rows`
 *     : ar
 *       ? `${exportRowCount.toLocaleString("ar")} صفًا للتصدير`  // singular & plural
 *       : `${exportRowCount.toLocaleString("en")} ${exportRowCount === 1 ? "row" : "rows"} to export`
 *
 * A regression in the Arabic branch — wrong copy, wrong digit script
 * (Latin "6" vs Arabic-Indic "٦"), or a missing word — would silently
 * ship to RTL customers because the English spec never exercises the
 * Arabic locale at all. This spec closes that gap by mirroring the
 * same status / recipient / date filter walk under
 * `localStorage.app.locale = "ar"` and asserting the literal Arabic
 * chip strings the page produces today.
 *
 * The capped (`>= cap`) branch is exercised via a `page.route`
 * stub that overrides the count endpoint to return `count >= cap`.
 * Seeding 10,000 real password-reset events to drive the live branch
 * would dwarf the rest of the suite's runtime and add no signal —
 * the chip's only contract for that branch is the static template
 * string, which the route stub exercises end-to-end.
 *
 * Test isolation versus the English mirror:
 *   - We use a different `message_id` prefix (`chip-refresh-ar-`) so
 *     each spec's defensive `WHERE message_id LIKE …` cleanup only
 *     wipes its own rows.
 *   - We anchor seeds in a *different deep-past year* (2021 vs the
 *     English spec's 2020). Both years sit outside the alerts
 *     evaluator's `NOW() - INTERVAL` window so neither mirror's
 *     rows leak into the alerts spec's roll-up — and pinning
 *     non-overlapping date filters means the two specs can run in
 *     parallel without their counts polluting each other's chip
 *     assertions on the shared accountant user_id.
 *   - The "empty window" we flip the date filter to is also
 *     non-overlapping (year 2011 vs the English spec's 2010) for the
 *     same reason.
 *
 * See the English mirror's file header for the full rationale on
 * anchoring seeds on the *accountant* user_id (rather than the
 * owner's) — it sidesteps the alerts and list-parity specs'
 * owner-scoped wipes that would otherwise race our seeds when
 * Playwright runs sibling projects in parallel.
 */

const OWNER_STORAGE = ".playwright/edap-owner.json";
const FIXTURE_PATH = ".playwright/email-delivery-alerts-fixture.json";

// Anchor every seeded event in a deep-past window non-overlapping with
// the English mirror's 2020 window. See the file header for the rationale.
const SEED_WINDOW = { from: "2021-01-01", to: "2021-12-31" };
const SEED_AT = "2021-06-15 12:00:00+00";
// A separate deep-past window with no seeds — used to prove that a
// fresh date-filter combo also re-issues the count probe. Year 2011
// keeps it outside both the seeded window and the English mirror's
// 2010 empty window (so the two specs can't interfere when run in
// parallel) AND outside the alerts evaluator's `NOW()`-bounded window.
const EMPTY_WINDOW = { from: "2011-01-01", to: "2011-12-31" };

const ACCOUNTANT_EMAIL = "e2e-edap-accountant@example.test";

// Distinctive prefix for the defensive cleanup. Keeping it disjoint
// from the English mirror's `chip-refresh-%` LIKE pattern (so the
// English mirror's `WHERE message_id LIKE 'chip-refresh-%'` cleanup
// can't accidentally wipe our seeds when both specs run in parallel).
// `chip-ar-refresh-` deliberately starts with a different stem than
// `chip-refresh-` so the SQL `LIKE` predicates from both specs are
// mutually exclusive.
const MESSAGE_ID_PREFIX = "chip-ar-refresh-";

// Arabic chip literals — these mirror exactly what
// `client/src/pages/settings/email-delivery.tsx` renders today.
// Written with explicit JS unicode escapes for the Arabic words so the
// assertions are unambiguous in review tools / diffs that may not
// render RTL text correctly inline.
//
// SAFAN = "صفًا" (U+0635 U+0641 U+064B U+0627) — the plural-marker form
//         used by the chip's normal branch ("<N> صفًا للتصدير").
// LIL_TASDEER = " للتصدير" — leading space + "for export".
const SAFAN = "\u0635\u0641\u064B\u0627"; // صفًا
const LIL_TASDEER = " \u0644\u0644\u062A\u0635\u062F\u064A\u0631"; // " للتصدير"

// The chip computes the digit run via `Number.toLocaleString("ar")`.
// Chromium's full ICU treats bare "ar" as a Latin-numbering locale
// (i.e. "6" / "10,000" — *not* "٦" / "١٠٬٠٠٠"); the Arabic-Indic
// numbering system would need to be requested explicitly via a
// `-u-nu-arab` extension or `numberingSystem: "arab"` option. We
// assert what the chip *actually* renders today rather than what an
// arabophone reader might *expect*, so a future change that switches
// the chip to Arabic-Indic digits has to update this spec in lockstep
// (which is the regression-detection signal we want).
function chipPlural(latinDigits: string): string {
  return `${latinDigits} ${SAFAN}${LIL_TASDEER}`;
}
function chipCapped(latinDigits: string): string {
  return `+${latinDigits} ${SAFAN}`;
}

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
      "DATABASE_URL must be set for the email-delivery-count-chip-refresh-ar spec.",
    );
  }
  return url;
}

interface SeedHandle {
  eventIds: string[];
}

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
        `${MESSAGE_ID_PREFIX}${id}`,
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
 * Pin locale to Arabic + theme to light *before* the React tree mounts,
 * then navigate. The chip text we assert on is locale-specific
 * ("صفًا للتصدير") — a missed locale pin would surface as a confusing
 * English-vs-Arabic diff on failure. Mirrors the English spec's
 * `gotoEnglishOwnerShell` helper.
 *
 * Setting `app.locale` at module-load time also flips
 * `HAD_PRELOADED_LOCALE` in `client/src/components/layout/main-layout.tsx`
 * to true, which suppresses `LocaleSync` from clobbering our seeded
 * value with the user's server-side `preferredLocale` on the first
 * `/api/auth/user` resolution.
 */
async function gotoArabicOwnerShell(
  page: Page,
  route: string,
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("app.locale", "ar");
    window.localStorage.setItem("app.theme", "light");
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
}

test.describe("email-delivery row-count chip Arabic copy stays accurate @count-chip-ar", () => {
  test.use({
    storageState: OWNER_STORAGE,
    // Desktop viewport so the filter row renders side-by-side and the
    // chip + Download CSV button stay on a single line — matches the
    // viewport the English mirror uses for the same page.
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
      // run of *this* spec (matched by our distinctive `message_id`
      // prefix). Anchored on the accountant user_id AND our prefix so
      // we can't accidentally wipe the English mirror's rows (which
      // use a different prefix on the same user_id).
      await client.query(
        `DELETE FROM password_reset_email_events
         WHERE user_id = $1 AND message_id LIKE $2`,
        [accountantUserId, `${MESSAGE_ID_PREFIX}%`],
      );

      // Same bucket shape as the English mirror so the filter walk is
      // structurally identical:
      //   delivered = 3, bounced = 2, sent = 1   (total = 6)
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

  test("chip Arabic strings track filter changes (singular, plural, zero)", async ({
    page,
  }) => {
    await gotoArabicOwnerShell(page, "/app/settings/email-delivery");

    // The page is owner-only; if the role guard fired we'd see the
    // forbidden Arabic copy ("غير مصرح") instead of the filter row.
    // Asserting on the page testid up front turns "auth is
    // misconfigured" into a clear failure rather than a confusing
    // "chip never appeared".
    await expect(
      page.getByTestId("page-email-delivery"),
      "owner should land on the email-delivery page (not the forbidden message)",
    ).toBeVisible({ timeout: 15_000 });

    // Sanity check the page actually flipped to Arabic — otherwise
    // chip assertions further down would all fail with a confusing
    // "expected Arabic, saw English" diff. `<html dir>` is the cleanest
    // signal because LocaleProvider sets it on every locale change.
    await expect(
      page.locator("html"),
      "page should mount in RTL (Arabic) locale",
    ).toHaveAttribute("dir", "rtl");

    // ---------------------------------------------------------------
    // 1. Pin the date filter to the seeded window (year 2021).
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
    // Asserts the chip renders the Arabic plural-marker template
    // ("<N> صفًا للتصدير") around the digit Chromium produces today.
    await expect(
      chip,
      "chip should render the Arabic plural template once the date window pins our seeds",
    ).toContainText(chipPlural("6"), { timeout: 15_000 });

    // ---------------------------------------------------------------
    // 2. Status filter — chip must re-resolve in Arabic too.
    // ---------------------------------------------------------------
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-bounced").click();
    await expect(
      chip,
      "status=bounced should drop the Arabic chip from 6 to 2",
    ).toContainText(chipPlural("2"), { timeout: 10_000 });

    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-delivered").click();
    await expect(
      chip,
      "status=delivered should change the Arabic chip to 3 — proving the queryKey reflects the LATEST status, not the first one chosen",
    ).toContainText(chipPlural("3"), { timeout: 10_000 });

    // The single-row bucket — locks in the Arabic singular render of
    // the chip. Today the chip uses the same template (`صفًا للتصدير`)
    // for both 1 and N (English has the singular branch via
    // `exportRowCount === 1 ? "row" : "rows"`, but the Arabic branch
    // collapses both into `صفًا للتصدير`). Any future change that
    // introduces a real singular form (`صف للتصدير`) without updating
    // this assertion would surface here as a clear text mismatch.
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-sent").click();
    await expect(
      chip,
      "status=sent should drop the Arabic chip to a single row (singular branch — currently shares the plural template)",
    ).toContainText(chipPlural("1"), { timeout: 10_000 });

    // Reset status=all so the recipient assertion sees the full 6.
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId("option-status-all").click();
    await expect(
      chip,
      "clearing the status filter should restore the full seeded total of 6",
    ).toContainText(chipPlural("6"), { timeout: 10_000 });

    // ---------------------------------------------------------------
    // 3. Recipient filter — debounced 250ms before `emailFilter`
    //    updates and the queryKey re-resolves. A bogus recipient must
    //    drive the chip to 0; a substring of the accountant's email
    //    must restore it to 6.
    // ---------------------------------------------------------------
    const recipient = page.getByTestId("input-filter-email");
    await recipient.fill("no-such-recipient@nowhere.invalid");
    await expect(
      chip,
      "a recipient that matches no rows must drop the Arabic chip to 0",
    ).toContainText(chipPlural("0"), { timeout: 10_000 });

    await recipient.fill("edap-accountant");
    await expect(
      chip,
      "a recipient substring that matches every seed must restore the Arabic chip to 6",
    ).toContainText(chipPlural("6"), { timeout: 10_000 });

    await recipient.fill("");
    await expect(
      chip,
      "clearing the recipient input should keep the Arabic chip at the seeded total",
    ).toContainText(chipPlural("6"), { timeout: 10_000 });

    // ---------------------------------------------------------------
    // 4. Date filter — switch to a window with no seeds. Chip must
    //    re-issue the count probe and drop to 0.
    // ---------------------------------------------------------------
    await fromInput.fill(EMPTY_WINDOW.from);
    await toInput.fill(EMPTY_WINDOW.to);
    await expect(
      chip,
      "switching the date window to a range with no seeds must drop the Arabic chip to 0 — proves from/to are part of the queryKey",
    ).toContainText(chipPlural("0"), { timeout: 10_000 });

    await fromInput.fill(SEED_WINDOW.from);
    await toInput.fill(SEED_WINDOW.to);
    await expect(
      chip,
      "flipping the date window back to the seeded range must restore the Arabic chip to 6",
    ).toContainText(chipPlural("6"), { timeout: 10_000 });
  });

  test("chip Arabic capped (>10,000) branch renders the +10,000 صفًا template", async ({
    page,
  }) => {
    // Seeding 10,000 real password_reset_email_events to drive the
    // capped branch live would dwarf the rest of the suite's runtime.
    // The chip's only contract for that branch is the static template
    // string; intercepting the count probe with a `count >= cap`
    // payload exercises the same render path end-to-end (React tree,
    // locale switch, `toLocaleString("ar")` digit shaping) without
    // the seed cost.
    await page.route("**/api/auth/email-deliveries/count*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 25_000, cap: 10_000 }),
      });
    });

    await gotoArabicOwnerShell(page, "/app/settings/email-delivery");

    await expect(
      page.getByTestId("page-email-delivery"),
      "owner should land on the email-delivery page",
    ).toBeVisible({ timeout: 15_000 });

    const chip = page.getByTestId("text-export-count");
    await expect(
      chip,
      "the chip should mount once the (stubbed) count probe resolves",
    ).toBeVisible({ timeout: 15_000 });

    // The capped branch in the page renders
    //   `+${exportCap.toLocaleString("ar")} صفًا`
    // For `cap = 10_000` Chromium's full ICU treats bare "ar" as a
    // Latin-numbering locale (no `-u-nu-arab` extension) and produces
    // "10,000" rather than "١٠٬٠٠٠". A regression that translated or
    // dropped the trailing "صفًا" — or that swapped the digit script
    // without keeping the chip's localization options in sync — would
    // surface here as a clear mismatch.
    await expect(
      chip,
      "Arabic capped chip should read '+10,000 صفًا' once count >= cap",
    ).toContainText(chipCapped("10,000"), { timeout: 15_000 });

    // The cap-warning hint below the chip is also an Arabic branch in
    // the page. Locking it in alongside the chip catches a regression
    // where someone swaps the chip's plural marker but forgets to keep
    // the hint copy in sync.
    await expect(
      page.getByTestId("hint-export-cap"),
      "the cap-warning hint should be visible whenever the chip is in its capped branch",
    ).toBeVisible({ timeout: 5_000 });
  });
});
