import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression net for the HR → Journal Entries deep-link bridge introduced
 * with the past-payroll-runs JE column.
 *
 * The bridge is the single piece of UI that lets an auditor jump from a
 * posted payroll run on /app/hr straight to the matching auto-posted JE
 * on /app/journal — and have it scrolled into view, even when the JE
 * sits outside the active period filter. A future refactor of either
 * the past-payroll-runs table on /app/hr or the deep-link / period /
 * banner machinery on /app/journal could quietly break that flow with
 * no automated coverage to catch it. This spec locks down:
 *
 *   1. Clicking `link-journal-entry-{runId}` in the past-payroll-runs
 *      row navigates to `/app/journal#je-{jeId}`.
 *   2. The matching `card-entry-{jeId}` is rendered + visible (the
 *      Journal Entries page always renders the deep-linked entry, even
 *      when it falls outside the active period filter).
 *   3. Switching the PeriodChip to a range that excludes the entry
 *      surfaces the `banner-linked-entry-out-of-period` hint.
 *   4. Clicking the banner's "Show entry" button (`button-jump-linked-entry`)
 *      still scrolls the same `card-entry-{jeId}` into view.
 *
 * Auth + seed are handled by `payroll-journal-link.setup.ts`, which
 * forges a session and inserts a posted payroll run linked to a
 * balanced journal entry dated to a non-today day inside the current
 * calendar month. The setup writes the canonical run id, JE id, and
 * entry-date string to `.playwright/payroll-journal-link-fixtures.json`
 * so this spec drives the deep link with the exact ids that were
 * inserted (no clock drift between setup + spec).
 */

interface Fixtures {
  runId: number;
  journalEntryId: number;
  companyId: number;
  entryDateStr: string;
}

function loadFixtures(): Fixtures {
  const p = path.resolve(".playwright/payroll-journal-link-fixtures.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as Fixtures;
}

test.describe("payroll → journal-entry deep link", () => {
  test("clicks JE link, asserts deep link + card visibility, then exercises the out-of-period banner", async ({
    page,
  }) => {
    const fx = loadFixtures();

    // ---- Land on /app/hr → Payroll tab ----
    await page.goto("/app/hr");
    // The Payroll tab carries the past-payroll-runs table; on first paint
    // the Employees tab is selected by default.
    await page.locator('[data-testid="tab-payroll"]').click();

    const row = page.locator(`[data-testid="row-payroll-run-${fx.runId}"]`);
    await expect(
      row,
      "the seeded posted payroll run must appear in the past-payroll-runs table",
    ).toBeVisible();

    const jeLink = page.locator(
      `[data-testid="link-journal-entry-${fx.runId}"]`,
    );
    await expect(
      jeLink,
      "the past-payroll-runs row must surface the JE deep link",
    ).toBeVisible();
    await expect(jeLink).toHaveText(`JE-${fx.journalEntryId}`);

    // ---- Click the JE deep link ----
    await jeLink.click();

    // ---- (1) The URL must become /app/journal#je-<id> ----
    await page.waitForURL(`**/app/journal#je-${fx.journalEntryId}`);
    expect(
      new URL(page.url()).pathname,
      "deep link must land on the journal entries page",
    ).toBe("/app/journal");
    expect(
      new URL(page.url()).hash,
      "deep link must carry the JE id in the hash",
    ).toBe(`#je-${fx.journalEntryId}`);

    // ---- (2) The matching card-entry-<id> must be visible ----
    const card = page.locator(`[data-testid="card-entry-${fx.journalEntryId}"]`);
    await expect(
      card,
      "the deep-linked JE card must render even after navigation",
    ).toBeVisible();

    // The deep-link effect on the page also pulses a highlight ring on the
    // resolved card (`data-highlighted="true"` for ~2.4s). We assert it as
    // proof the page actually resolved the hash to a concrete entry rather
    // than just rendering whatever happened to fit in the period.
    await expect(
      card,
      "the page must mark the deep-linked card as highlighted on arrival",
    ).toHaveAttribute("data-highlighted", "true");

    // The seeded entry sits inside the default `month` period, so the
    // out-of-period banner must NOT show on first arrival — that asserts
    // the period filter actually included the entry on its own merits and
    // not via the always-render-deep-linked-entry fallback.
    await expect(
      page.locator('[data-testid="banner-linked-entry-out-of-period"]'),
      "no out-of-period banner should appear when the entry is in the active period",
    ).toHaveCount(0);

    // ---- (3) Switch the period chip to `today` to exclude the entry ----
    // The seeded JE date is the 15th (or 16th when today is the 15th) of
    // the current month at 12:00 UTC, so it definitionally falls outside
    // the `today` range — and the banner must surface.
    const periodSelect = page.locator('[data-testid="select-period-chip"]');
    await expect(periodSelect).toBeVisible();
    await periodSelect.selectOption("today");

    const banner = page.locator(
      '[data-testid="banner-linked-entry-out-of-period"]',
    );
    await expect(
      banner,
      "switching to a period that excludes the deep-linked entry must surface the banner",
    ).toBeVisible();

    // ---- (4) Click "Show entry" — the card must still be reachable ----
    // Even with the period filter excluding the entry, the page keeps the
    // deep-linked card mounted so the jump button can scroll to it. We
    // assert the click re-pulses the highlight ring as confirmation that
    // the click reached the right card.
    await page.locator('[data-testid="button-jump-linked-entry"]').click();
    await expect(
      card,
      "the deep-linked card must still be visible after the period filter excluded it",
    ).toBeVisible();
    await expect(
      card,
      "the jump button must re-pulse the highlight ring on the resolved card",
    ).toHaveAttribute("data-highlighted", "true");
  });

  test("source-link badge: JE row + detail dialog both surface the back-link to the payroll run", async ({
    page,
  }) => {
    const fx = loadFixtures();

    // Land directly on /app/journal — the seeded JE sits inside the
    // default `month` period so we should be able to find both the row
    // card and the source-link badge without any deep link / period
    // gymnastics.
    await page.goto("/app/journal");

    const card = page.locator(`[data-testid="card-entry-${fx.journalEntryId}"]`);
    await expect(card, "the seeded JE card must render in the list").toBeVisible();

    // (1) The JE row in the main list must surface the source-link badge
    // with the canonical (no-surface) test id, pointing back to the
    // seeded payroll run on /app/hr#pr-<runId>.
    const rowBadge = card.locator(
      `[data-testid="link-je-source-payroll_run-${fx.runId}"]`,
    );
    await expect(
      rowBadge,
      "the JE row must surface the From: Payroll back-link",
    ).toBeVisible();
    await expect(rowBadge).toHaveAttribute("href", `/app/hr#pr-${fx.runId}`);

    // (2) Open the JE detail dialog and assert the same badge appears in
    // its header — this is the surface the task added so users can
    // follow the back-link from the drawer too. The `surface=detail`
    // suffix in the test id is what keeps the row + dialog badges from
    // colliding while both are mounted.
    await card.locator(`[data-testid="link-entry-${fx.journalEntryId}"]`).click();
    const dialog = page.locator('[data-testid="dialog-entry-detail"]');
    await expect(dialog, "the JE detail dialog must open").toBeVisible();
    const dialogBadge = dialog.locator(
      `[data-testid="link-je-source-detail-payroll_run-${fx.runId}"]`,
    );
    await expect(
      dialogBadge,
      "the JE detail dialog must surface the same back-link badge as the row",
    ).toBeVisible();
    await expect(dialogBadge).toHaveAttribute("href", `/app/hr#pr-${fx.runId}`);

    // (3) The Recent admin-activity feed on /app/settings reuses JE rows
    // through `SecurityCompliance`. After the same setup, that feed
    // should also surface the badge for the seeded payroll-linked JE,
    // proving the extracted component reaches the second JE-row surface.
    await page.goto("/app/settings");
    const adminRow = page.locator(
      `[data-testid="row-admin-activity-${fx.journalEntryId}"]`,
    );
    await expect(
      adminRow,
      "the seeded JE must appear in the Recent admin activity feed",
    ).toBeVisible();
    const adminBadge = adminRow.locator(
      `[data-testid="link-je-source-admin-activity-payroll_run-${fx.runId}"]`,
    );
    await expect(
      adminBadge,
      "the admin-activity row must surface the same back-link badge",
    ).toBeVisible();
    await expect(adminBadge).toHaveAttribute("href", `/app/hr#pr-${fx.runId}`);
  });
});
