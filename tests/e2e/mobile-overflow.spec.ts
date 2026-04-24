import { test, expect, type Page } from "@playwright/test";

/**
 * Mobile horizontal-overflow regression net.
 *
 * Loads every dense-table app page at a 360px viewport in BOTH English (LTR)
 * and Arabic (RTL) and asserts that the document itself does not overflow
 * horizontally. Overflow inside an intentional scroll container (e.g. a table
 * wrapped in `.table-sticky-first` or `overflow-x-auto`) is allowed by design
 * — only the document/body overflowing the viewport fails the check.
 *
 * If this fails, a recently-added page either forgot the
 * `.table-sticky-first` wrapper around a dense table, ships a wide
 * `inline-flex` toolbar without a horizontal-scroll fallback, or skipped the
 * KPI single-column collapse at the smallest breakpoint.
 */

const APP_PATHS = [
  "/app/journal",
  "/app/reports",
  "/app/insights",
  "/app/fixed-assets",
  "/app/hr",
  "/app/accounts",
  "/app/transactions",
] as const;

// Public marketing surface — first thing prospects see on a phone. Keep this
// list in sync with `tests/mobile-overflow-check.md`. The invite token does
// not need to be valid: the page renders its accept form regardless and only
// hits the API on submit.
const PUBLIC_PATHS = [
  "/",
  "/demo",
  "/invite/sample-overflow-check-token",
] as const;

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];

// Allow 1px slack for sub-pixel rounding (scrollbar gutter, transforms, etc.).
const SLACK_PX = 1;

async function bootstrapAuthAndLocale(page: Page, locale: Locale) {
  // First request creates the workspace owner cookie automatically.
  await page.goto("/app", { waitUntil: "networkidle" });
  // Set locale BEFORE the next page navigation; the LocaleProvider reads
  // localStorage on mount and toggles <html dir="rtl"|"ltr"> accordingly.
  await page.evaluate((loc) => {
    window.localStorage.setItem("app.locale", loc);
  }, locale);
}

async function bootstrapPublicLocale(page: Page, locale: Locale) {
  // Public pages don't need the workspace cookie. Prime localStorage first so
  // the LocaleProvider picks the right dir on mount of the next navigation.
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate((loc) => {
    window.localStorage.setItem("app.locale", loc);
  }, locale);
}

async function measureOverflow(page: Page) {
  // Let any post-navigation layout settle (skeletons → content swaps).
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    innerW: window.innerWidth,
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
  }));
}

test.describe("mobile horizontal overflow @360px", () => {
  for (const locale of LOCALES) {
    test.describe(`locale=${locale}`, () => {
      test.beforeEach(async ({ page }) => {
        await bootstrapAuthAndLocale(page, locale);
      });

      for (const path of APP_PATHS) {
        test(`${path} does not overflow the document`, async ({ page }) => {
          await page.goto(path, { waitUntil: "networkidle" });
          const m = await measureOverflow(page);
          const expectedDir = locale === "ar" ? "rtl" : "ltr";
          expect(
            m.dir,
            `expected <html dir> to be ${expectedDir} for locale=${locale}, got ${m.dir}`,
          ).toBe(expectedDir);
          expect(
            m.docScrollW,
            `documentElement.scrollWidth=${m.docScrollW} exceeds viewport ${m.innerW} on ${path} (${locale}). ` +
              `A new page or toolbar likely forgot the .table-sticky-first wrapper or an overflow-x-auto fallback.`,
          ).toBeLessThanOrEqual(m.innerW + SLACK_PX);
          expect(
            m.bodyScrollW,
            `body.scrollWidth=${m.bodyScrollW} exceeds viewport ${m.innerW} on ${path} (${locale}).`,
          ).toBeLessThanOrEqual(m.innerW + SLACK_PX);
        });
      }
    });
  }

  // Public marketing surface — Landing, Demo, Invite-accept. Same 360x720
  // horizontal-overflow assertion, separate group because these pages don't
  // need (or use) the workspace owner cookie.
  for (const locale of LOCALES) {
    test.describe(`public locale=${locale}`, () => {
      test.beforeEach(async ({ page }) => {
        await bootstrapPublicLocale(page, locale);
      });

      for (const path of PUBLIC_PATHS) {
        test(`${path} does not overflow the document`, async ({ page }) => {
          await page.goto(path, { waitUntil: "networkidle" });
          const m = await measureOverflow(page);
          const expectedDir = locale === "ar" ? "rtl" : "ltr";
          expect(
            m.dir,
            `expected <html dir> to be ${expectedDir} for locale=${locale}, got ${m.dir}`,
          ).toBe(expectedDir);
          expect(
            m.docScrollW,
            `documentElement.scrollWidth=${m.docScrollW} exceeds viewport ${m.innerW} on ${path} (${locale}). ` +
              `A public marketing page is overflowing — check for wide hero images, ` +
              `un-wrapped pre/code blocks, or inline-flex toolbars without a horizontal-scroll fallback.`,
          ).toBeLessThanOrEqual(m.innerW + SLACK_PX);
          expect(
            m.bodyScrollW,
            `body.scrollWidth=${m.bodyScrollW} exceeds viewport ${m.innerW} on ${path} (${locale}).`,
          ).toBeLessThanOrEqual(m.innerW + SLACK_PX);
        });
      }
    });
  }
});
