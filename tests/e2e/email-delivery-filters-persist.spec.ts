import { test, expect, type Page } from "@playwright/test";
import { gotoWithPinnedLocale } from "./_helpers/pin-locale";

/**
 * Regression coverage for the five sticky filters on the email delivery
 * health page (`/app/settings/email-delivery`):
 *
 *   - recipient search          → sessionStorage `email-delivery:recipient`
 *   - status drop-down          → sessionStorage `email-delivery:status-filter`
 *   - trend-window toggle       → sessionStorage `email-delivery:trend-window`
 *   - date-range preset         → sessionStorage `email-delivery:range`
 *   - custom From / To inputs   → sessionStorage `email-delivery:range-from`
 *                                                 `email-delivery:range-to`
 *
 * All five round-trip through the shared `useSessionStorageState` helper
 * (`client/src/hooks/use-session-storage-state.ts`). A future refactor of
 * that helper or a rename of any storage key could silently regress every
 * filter at once. This spec walks through the controls, reloads the page,
 * and asserts the values come back in both the UI *and* sessionStorage —
 * so a regression can't sneak past by hydrating one side correctly while
 * dropping the other.
 *
 * The spec also pokes a known-bad value into one of the storage keys
 * (`email-delivery:range-from`) and asserts that on the next reload the
 * page falls back to the empty default instead of leaking the bad value
 * into the From input. That exercises the helper's validator-rejects-
 * stale-storage path, which is the same path that protects every other
 * key from a stale or hand-edited entry.
 *
 * We piggy-back on the dedicated workspace + owner storage state from
 * `email-delivery-alerts.setup.ts`. That setup pins the owner to a
 * single membership in an isolated workspace, which is what lets the
 * page mount without us having to synthesize an `x-company-id` header
 * for the browser-side fetches the page makes.
 */

const OWNER_STORAGE = ".playwright/edap-owner.json";

const KEYS = {
  recipient: "email-delivery:recipient",
  status: "email-delivery:status-filter",
  trendWindow: "email-delivery:trend-window",
  range: "email-delivery:range",
  rangeFrom: "email-delivery:range-from",
  rangeTo: "email-delivery:range-to",
} as const;

// Concrete values we'll set through the UI. Pinning a recipient that the
// dedicated workspace's deliveries endpoint will return zero rows for is
// fine — we're asserting on the *filter state*, not the result list.
const RECIPIENT = "alice-sticky-filter@example.test";
const STATUS = "bounced";
const TREND_WINDOW = "30";
const RANGE_PRESET = "custom";
const FROM_DATE = "2025-01-01";
const TO_DATE = "2025-12-31";

/**
 * Pin locale to English (via the `?lang=en` URL override) + theme to
 * light *before* the React tree mounts, then navigate. The status /
 * range labels we assert on are locale-specific ("Bounced", "Custom
 * range"), so a missed locale pin would produce confusing
 * Arabic-vs-English diffs on failure.
 *
 * The dedicated owner that backs `OWNER_STORAGE` has
 * `preferred_locale='ar'`, so the older `addInitScript("app.locale",
 * "en")` pattern would be clobbered by `LocaleSync`'s server-preference
 * reconciliation moments after first paint. The shared
 * `gotoWithPinnedLocale` helper uses the URL override that survives
 * both `LocaleProvider` initialization AND `LocaleSync`'s early-return
 * guard — see that helper for the full rationale.
 */
async function gotoEnglishOwnerShell(page: Page, route: string): Promise<void> {
  await gotoWithPinnedLocale(page, route);
}

async function readStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => window.sessionStorage.getItem(k), key);
}

async function writeStorage(page: Page, key: string, raw: string): Promise<void> {
  await page.evaluate(
    ({ k, v }) => window.sessionStorage.setItem(k, v),
    { k: key, v: raw },
  );
}

test.describe("email-delivery filters persist across reload @sticky-filters", () => {
  test.use({
    storageState: OWNER_STORAGE,
    // Desktop viewport so the filter row renders side-by-side and the
    // trend-window toggle isn't collapsed into a different layout.
    viewport: { width: 1280, height: 800 },
  });

  test("all five filters round-trip through sessionStorage", async ({ page }) => {
    await gotoEnglishOwnerShell(page, "/app/settings/email-delivery");

    // The page is owner-only; if the role guard fired we'd see the
    // "Not authorized" copy instead of the filter row. Asserting on the
    // page testid up front turns "auth is misconfigured" into a clear
    // failure rather than a confusing "filters never appeared".
    await expect(
      page.getByTestId("page-email-delivery"),
      "owner should land on the email-delivery page (not the forbidden message)",
    ).toBeVisible({ timeout: 15_000 });

    // ---------------------------------------------------------------
    // 1. Drive every sticky control through the UI so each setter writes
    //    to sessionStorage via the shared hook.
    // ---------------------------------------------------------------

    // (a) Recipient search.
    const recipientInput = page.getByTestId("input-filter-email");
    await expect(recipientInput).toBeVisible();
    await recipientInput.fill(RECIPIENT);

    // (b) Status drop-down. Radix Select renders the options into a
    //     portal once the trigger is clicked.
    await page.getByTestId("select-filter-status").click();
    await page.getByTestId(`option-status-${STATUS}`).click();

    // (c) Date-range preset. Switching to "custom" reveals the From/To
    //     inputs we set next.
    await page.getByTestId("select-filter-range").click();
    await page.getByTestId(`option-range-${RANGE_PRESET}`).click();

    // (d) Custom From / To.
    const fromInput = page.getByTestId("input-filter-from");
    const toInput = page.getByTestId("input-filter-to");
    await expect(fromInput, "custom-range inputs render only when range=custom").toBeVisible();
    await fromInput.fill(FROM_DATE);
    await toInput.fill(TO_DATE);

    // (e) Trend-window toggle. The whole trends card only mounts once
    //     the trends query resolves; wait for that before clicking.
    const trendToggle = page.getByTestId(`toggle-trend-window-${TREND_WINDOW}`);
    await expect(trendToggle, "trends card should mount for the owner").toBeVisible({
      timeout: 15_000,
    });
    await trendToggle.click();
    await expect(
      trendToggle,
      "the clicked toggle item should report itself as the active selection",
    ).toHaveAttribute("data-state", "on");

    // The hook's setter effect writes JSON.stringify(value) to
    // sessionStorage. Poll the keys before reload so a flaky write would
    // surface as a sharper failure than the post-reload assertion alone.
    await expect
      .poll(async () => readStorage(page, KEYS.recipient))
      .toBe(JSON.stringify(RECIPIENT));
    await expect.poll(async () => readStorage(page, KEYS.status)).toBe(JSON.stringify(STATUS));
    await expect
      .poll(async () => readStorage(page, KEYS.trendWindow))
      .toBe(JSON.stringify(TREND_WINDOW));
    await expect.poll(async () => readStorage(page, KEYS.range)).toBe(JSON.stringify(RANGE_PRESET));
    await expect.poll(async () => readStorage(page, KEYS.rangeFrom)).toBe(JSON.stringify(FROM_DATE));
    await expect.poll(async () => readStorage(page, KEYS.rangeTo)).toBe(JSON.stringify(TO_DATE));

    // ---------------------------------------------------------------
    // 2. Reload and assert every value comes back in the UI. This is
    //    the contract the task asks us to lock in.
    // ---------------------------------------------------------------
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-email-delivery")).toBeVisible({ timeout: 15_000 });

    // (a) Recipient — controlled input value reflects the hydrated state.
    await expect(
      page.getByTestId("input-filter-email"),
      "recipient search should rehydrate from sessionStorage",
    ).toHaveValue(RECIPIENT);

    // (b) Status — the trigger renders the SelectValue child (label
    //     text). We pinned locale=en so "Bounced" is stable.
    await expect(
      page.getByTestId("select-filter-status"),
      "status drop-down should rehydrate to the chosen value",
    ).toContainText("Bounced");

    // (c) Date-range preset.
    await expect(
      page.getByTestId("select-filter-range"),
      "date-range preset should rehydrate to Custom range",
    ).toContainText("Custom range");

    // (d) Custom From / To inputs. The fact that these are visible at
    //     all proves the preset rehydrated as "custom" — they only
    //     render in that branch.
    await expect(
      page.getByTestId("input-filter-from"),
      "custom From input should rehydrate with the persisted date",
    ).toHaveValue(FROM_DATE);
    await expect(
      page.getByTestId("input-filter-to"),
      "custom To input should rehydrate with the persisted date",
    ).toHaveValue(TO_DATE);

    // (e) Trend window — the matching ToggleGroupItem reports itself as
    //     active via data-state="on". Wait for the trends card to mount
    //     again first.
    const rehydratedToggle = page.getByTestId(`toggle-trend-window-${TREND_WINDOW}`);
    await expect(rehydratedToggle).toBeVisible({ timeout: 15_000 });
    await expect(
      rehydratedToggle,
      "trend-window toggle should rehydrate to the persisted window",
    ).toHaveAttribute("data-state", "on");

    // Belt-and-braces: the *other* trend-window options must NOT report
    // themselves as active. Without this assertion a regression that
    // hydrated the toggle group to its default ("7") *and* left "30"
    // checked from the previous render would still pass the single-
    // attribute check above on slow CI.
    await expect(page.getByTestId("toggle-trend-window-7")).toHaveAttribute(
      "data-state",
      "off",
    );
    await expect(page.getByTestId("toggle-trend-window-1")).toHaveAttribute(
      "data-state",
      "off",
    );

    // ---------------------------------------------------------------
    // 3. Validator-rejects-stale-storage path. Poke a calendar-
    //    impossible date into the From key and reload — the page must
    //    fall back to the empty default rather than leak "2026-99-99"
    //    into the date input. We keep the range preset as "custom" so
    //    the From input is rendered and we can read its value.
    //
    //    `isStoredDateString` rejects malformed shapes *and* dates that
    //    don't round-trip through Date (e.g. month 99, Feb 31), so this
    //    is the exact branch we want to lock in. The hook's catch path
    //    also handles non-JSON entries, so passing the bad value as a
    //    bare string (no JSON.stringify) covers both fall-through arms
    //    of the helper at once.
    // ---------------------------------------------------------------
    await writeStorage(page, KEYS.rangeFrom, "2026-99-99");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("page-email-delivery")).toBeVisible({ timeout: 15_000 });

    // Range preset should still be "custom" (its own storage key is
    // untouched), so the From input is rendered.
    await expect(page.getByTestId("select-filter-range")).toContainText("Custom range");
    await expect(
      page.getByTestId("input-filter-from"),
      "a calendar-impossible stored date must NOT leak into the From input — the helper should fall back to the empty default",
    ).toHaveValue("");

    // The To input persisted normally — assert it to make sure the
    // fallback only ate the bad key and didn't take the whole row down
    // with it.
    await expect(
      page.getByTestId("input-filter-to"),
      "the sibling To input should still rehydrate from its own (valid) storage key",
    ).toHaveValue(TO_DATE);
  });
});
