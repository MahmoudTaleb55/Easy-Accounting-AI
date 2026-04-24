import { test, expect, type Page, type Request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
} from "date-fns";

/**
 * End-to-end coverage for the global PeriodChip selector.
 *
 * The chip lives in three pages — Insights cockpit/alerts/cash/budget,
 * HR Payroll preview, and the Fixed Assets register — and is the only
 * piece of UI that drives the date-range query keys for the underlying
 * queries. A regression in the wiring would silently desync the figures
 * users see, with no automated net to catch it. This spec asserts:
 *
 *   1. Switching the chip to today / week / month / quarter / ytd causes
 *      Insights cockpit to fire `/api/insights/health` with the matching
 *      ISO start/end query params (mirroring the date-fns boundaries the
 *      PeriodProvider derives).
 *   2. The same period-driven re-fetch happens on the Insights alerts
 *      and cash-forecast tabs, and the budget tab re-fetches with the
 *      (year, month) derived from `period.end`.
 *   3. The HR Payroll preview's `text-payroll-period` re-renders to the
 *      (Arabic month, year) derived from `period.end`, AND the underlying
 *      `/api/hr/payroll/preview` request fires with the matching numeric
 *      year + month for every chip option.
 *   4. The Fixed Assets register's visible asset count actually changes
 *      between periods — proving the period filter is doing work, not
 *      just keeping the totals row mounted. Seed dates (see
 *      `period-selector.setup.ts`) place assets at boundaries so today/
 *      week/ytd, month, and quarter have different counts.
 *   5. With compare-to-previous toggled on, every page renders at least
 *      one `text-delta-*` chip — KPI deltas on Insights, total-net delta
 *      on Payroll, and the cost/NBV deltas in the Asset Register footer.
 *
 * Auth + seed are handled by `period-selector.setup.ts`, which signs the
 * test user in and seeds the fixtures listed above. Asset seed dates are
 * persisted to `.playwright/period-selector-fixtures.json` so this spec
 * computes expected counts from the same canonical strings the setup
 * inserted (no clock drift between setup + spec).
 */

type PeriodKey = "today" | "week" | "month" | "quarter" | "ytd";
const PERIODS: PeriodKey[] = ["today", "week", "month", "quarter", "ytd"];

// Match the boundaries computed inside `client/src/contexts/period-context.tsx`
// — same date-fns options, same weekStartsOn — so the ISO strings the spec
// expects line up exactly with what the page asks the API for.
function rangeFor(key: PeriodKey, now: Date = new Date()): { start: Date; end: Date } {
  switch (key) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "week":
      return {
        start: startOfWeek(now, { weekStartsOn: 6 }),
        end: endOfWeek(now, { weekStartsOn: 6 }),
      };
    case "month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "quarter":
      return { start: startOfQuarter(now), end: endOfQuarter(now) };
    case "ytd":
      return { start: startOfYear(now), end: endOfDay(now) };
  }
}

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function expectedPayrollLabel(key: PeriodKey, now: Date = new Date()): string {
  const r = rangeFor(key, now);
  return `${MONTHS_AR[r.end.getMonth()]} ${r.end.getFullYear()}`;
}

function expectedYearMonth(key: PeriodKey, now: Date = new Date()): { year: number; month: number } {
  const r = rangeFor(key, now);
  return { year: r.end.getFullYear(), month: r.end.getMonth() + 1 };
}

async function ensureCompareOn(page: Page) {
  // The PeriodProvider defaults `compareToPrevious` to true, but a previous
  // navigation in the same browser context could have turned it off.
  const cb = page.locator('[data-testid="label-page-compare"] input[type="checkbox"]');
  if (!(await cb.isChecked())) await cb.check();
}

// ---------------------------------------------------------------------------
// Request capture helper. Records every matching request the page fires so we
// can replay-assert on params after each chip change.
// ---------------------------------------------------------------------------

type Captured = { url: URL };
function captureRequests(page: Page, predicate: (u: URL) => boolean): Captured[] {
  const out: Captured[] = [];
  page.on("request", (req: Request) => {
    try {
      const u = new URL(req.url());
      if (predicate(u)) out.push({ url: u });
    } catch {
      /* non-http(s) — ignore */
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Asset fixture loader. We read the canonical seed dates that the setup
// inserted so the count expectations don't drift relative to seeding.
// ---------------------------------------------------------------------------

type AssetSeed = { code: string; name: string; acq: string };
function loadAssetSeed(): AssetSeed[] {
  const p = path.resolve(".playwright/period-selector-fixtures.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return raw.assetSeed as AssetSeed[];
}

function expectedAssetCount(key: PeriodKey, seed: AssetSeed[]): number {
  const r = rangeFor(key);
  // Mirrors `inPeriod` in client/src/pages/fixed-assets.tsx:
  //   acq <= period.end && status !== 'disposed'
  // All seeded assets have status='active', so only the date predicate
  // matters here.
  return seed.filter((a) => new Date(a.acq).getTime() <= r.end.getTime()).length;
}

test.describe("global period selector", () => {
  // -----------------------------------------------------------------------
  // INSIGHTS — cockpit health endpoint re-fetches per period
  // -----------------------------------------------------------------------
  test("Insights cockpit re-fetches the health query for every period", async ({ page }) => {
    const healthRequests = captureRequests(
      page,
      (u) => u.pathname === "/api/insights/health" && u.searchParams.has("start"),
    );

    await page.goto("/app/insights");
    await page
      .locator('[data-testid="text-health-score"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    const select = page.locator('[data-testid="select-period-chip"]');
    for (const key of PERIODS) {
      const r = rangeFor(key);
      const expectedStart = r.start.toISOString();
      const expectedEnd = r.end.toISOString();

      await select.selectOption(key);

      await expect
        .poll(
          () =>
            healthRequests.some(
              (q) =>
                q.url.searchParams.get("start") === expectedStart &&
                q.url.searchParams.get("end") === expectedEnd,
            ),
          {
            timeout: 10_000,
            message:
              `Expected /api/insights/health to be re-fetched for period=${key} ` +
              `with start=${expectedStart} end=${expectedEnd}.`,
          },
        )
        .toBe(true);

      // The score panel must stay mounted (i.e. the new fetch resolved into
      // a render, not a permanent skeleton).
      await expect(page.locator('[data-testid="text-health-score"]')).toBeVisible();
    }
  });

  // -----------------------------------------------------------------------
  // INSIGHTS — alerts + cash-forecast tabs re-fetch per period
  // -----------------------------------------------------------------------
  test("Insights alerts + cash-forecast tabs re-fetch per period", async ({ page }) => {
    const alertReqs = captureRequests(
      page,
      (u) => u.pathname === "/api/insights/alerts" && u.searchParams.has("start"),
    );
    const cashReqs = captureRequests(
      page,
      (u) => u.pathname === "/api/insights/cash-forecast" && u.searchParams.has("start"),
    );

    await page.goto("/app/insights");

    const select = page.locator('[data-testid="select-period-chip"]');

    // --- alerts tab ---
    await page.locator('[data-testid="tab-alerts"]').click();
    for (const key of PERIODS) {
      const r = rangeFor(key);
      await select.selectOption(key);
      await expect
        .poll(
          () =>
            alertReqs.some(
              (q) =>
                q.url.searchParams.get("start") === r.start.toISOString() &&
                q.url.searchParams.get("end") === r.end.toISOString(),
            ),
          {
            timeout: 10_000,
            message: `Expected /api/insights/alerts to refetch for period=${key}.`,
          },
        )
        .toBe(true);
    }

    // --- cash-forecast tab ---
    await page.locator('[data-testid="tab-cash"]').click();
    for (const key of PERIODS) {
      const r = rangeFor(key);
      await select.selectOption(key);
      await expect
        .poll(
          () =>
            cashReqs.some(
              (q) =>
                q.url.searchParams.get("start") === r.start.toISOString() &&
                q.url.searchParams.get("end") === r.end.toISOString(),
            ),
          {
            timeout: 10_000,
            message: `Expected /api/insights/cash-forecast to refetch for period=${key}.`,
          },
        )
        .toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // INSIGHTS — budget tab re-fetches with (year, month) from period.end
  // -----------------------------------------------------------------------
  test("Insights budget tab re-fetches with (year, month) per period", async ({ page }) => {
    const budgetReqs = captureRequests(
      page,
      (u) => u.pathname === "/api/insights/budget-vs-actual" && u.searchParams.has("year"),
    );

    await page.goto("/app/insights");
    await page.locator('[data-testid="tab-budget"]').click();

    const select = page.locator('[data-testid="select-period-chip"]');
    for (const key of PERIODS) {
      const ym = expectedYearMonth(key);
      await select.selectOption(key);
      await expect
        .poll(
          () =>
            budgetReqs.some(
              (q) =>
                Number(q.url.searchParams.get("year")) === ym.year &&
                Number(q.url.searchParams.get("month")) === ym.month,
            ),
          {
            timeout: 10_000,
            message:
              `Expected /api/insights/budget-vs-actual to refetch for period=${key} ` +
              `with year=${ym.year} month=${ym.month}.`,
          },
        )
        .toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // INSIGHTS — KPI delta lines render when compare is on
  // -----------------------------------------------------------------------
  test("Insights cockpit renders KPI delta lines when compare is on", async ({ page }) => {
    await page.goto("/app/insights");
    await page
      .locator('[data-testid="text-health-score"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    await ensureCompareOn(page);
    // Force a known period so the previous-range fetch has time to settle.
    await page.locator('[data-testid="select-period-chip"]').selectOption("month");

    // pickDelta() in insights.tsx renders one `text-delta-${label}` per KPI
    // card with a non-undefined `previous`. We assert at least one shows up
    // — the Arabic labels are awkward to address by exact testid, so we
    // match by the shared prefix.
    await expect(
      page.locator('[data-testid^="text-delta-"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // -----------------------------------------------------------------------
  // HR PAYROLL — label re-derives AND request params change per period
  // -----------------------------------------------------------------------
  test("HR Payroll preview re-derives label + API params for every period", async ({ page }) => {
    const payrollReqs = captureRequests(
      page,
      (u) => u.pathname === "/api/hr/payroll/preview" && u.searchParams.has("year"),
    );

    await page.goto("/app/hr");
    await page.locator('[data-testid="tab-payroll"]').click();
    await page
      .locator('[data-testid="text-payroll-period"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    const select = page.locator('[data-testid="select-period-chip"]');
    for (const key of PERIODS) {
      const ym = expectedYearMonth(key);
      const expectedLabel = expectedPayrollLabel(key);

      await select.selectOption(key);

      // The visible header must reflect the period's end-of-window.
      await expect(page.locator('[data-testid="text-payroll-period"]')).toContainText(
        expectedLabel,
        { timeout: 5_000 },
      );

      // The underlying request must use matching numeric year + month —
      // proving the new label corresponds to a real backend re-fetch
      // rather than a stale cached preview.
      await expect
        .poll(
          () =>
            payrollReqs.some(
              (q) =>
                Number(q.url.searchParams.get("year")) === ym.year &&
                Number(q.url.searchParams.get("month")) === ym.month,
            ),
          {
            timeout: 10_000,
            message:
              `Expected /api/hr/payroll/preview to refetch for period=${key} ` +
              `with year=${ym.year} month=${ym.month}.`,
          },
        )
        .toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // HR PAYROLL — totals delta line renders when compare is on
  // -----------------------------------------------------------------------
  test("HR Payroll totals show a delta line when compare is on", async ({ page }) => {
    await page.goto("/app/hr");
    await page.locator('[data-testid="tab-payroll"]').click();
    await page
      .locator('[data-testid="text-payroll-period"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    await ensureCompareOn(page);
    await page.locator('[data-testid="select-period-chip"]').selectOption("month");

    // The seeded employee guarantees `lines.length > 0`, so the totals
    // grid + delta row mount once the previous-range preview resolves.
    await expect(page.locator('[data-testid="text-total-net"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="text-delta-net"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  // -----------------------------------------------------------------------
  // FIXED ASSETS — register count actually changes between periods
  // -----------------------------------------------------------------------
  test("Fixed Assets register filters assets by period", async ({ page }) => {
    const seed = loadAssetSeed();

    // We need the period boundaries to put the seeded assets into at least
    // two different buckets — otherwise this assertion can't tell whether
    // the filter is doing work. The setup picks dates that are designed
    // to spread across today/week/ytd vs month vs quarter, so the counts
    // should naturally vary; if the system clock lands on a quarter
    // boundary we surface that explicitly rather than silently passing.
    const distinctCounts = new Set(PERIODS.map((k) => expectedAssetCount(k, seed)));
    expect(
      distinctCounts.size,
      `Seed dates produced identical asset counts across all periods (${[...distinctCounts]}). ` +
        `Adjust period-selector.setup.ts so today/week/month/quarter/ytd diverge.`,
    ).toBeGreaterThan(1);

    await page.goto("/app/fixed-assets");
    await page
      .locator('[data-testid="text-totals-count"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    const totalsCount = page.locator('[data-testid="text-totals-count"]');
    const select = page.locator('[data-testid="select-period-chip"]');
    for (const key of PERIODS) {
      const expected = expectedAssetCount(key, seed);
      await select.selectOption(key);
      // The footer renders `الإجمالي ({filtered.length})` — assert the
      // numeric count matches the period filter exactly.
      await expect(totalsCount, `period=${key}`).toContainText(`(${expected})`, {
        timeout: 5_000,
      });
      await expect(page.locator('[data-testid="text-totals-cost"]')).toBeVisible();
      await expect(page.locator('[data-testid="text-totals-nbv"]')).toBeVisible();
    }
  });

  // -----------------------------------------------------------------------
  // FIXED ASSETS — footer delta lines render when compare is on
  // -----------------------------------------------------------------------
  test("Fixed Assets register footer shows delta lines when compare is on", async ({ page }) => {
    await page.goto("/app/fixed-assets");
    await page
      .locator('[data-testid="text-totals-count"]')
      .waitFor({ state: "visible", timeout: 15_000 });

    await ensureCompareOn(page);
    await page.locator('[data-testid="select-period-chip"]').selectOption("month");

    // The previous-period totals are computed client-side from the same
    // assets list — no extra network round trip — so deltas should mount
    // as soon as `compareToPrevious` is true.
    await expect(page.locator('[data-testid="text-delta-cost"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-delta-nbv"]')).toBeVisible();
  });
});
