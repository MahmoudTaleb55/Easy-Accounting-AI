import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression net for the Journal-Entry deep-link contract that spans the
 * Inbox and Fixed-Assets pages.
 *
 * Every JE reference rendered by these pages is supposed to be a real
 * `<a href="/app/journal#je-<id>">…</a>` so an auditor can click straight
 * through to the originating entry. There is no other automated coverage
 * that asserts these are *links* (rather than plain text), and a future
 * refactor of the inbox posted strip, the fixed-assets depreciation runs
 * table, or the asset-detail dialog (history / impairments tabs) could
 * silently regress them with no test failure.
 *
 * The fixtures (a posted document, a posted depreciation run, an
 * impairment event — each linked to its own JE in the same workspace)
 * are seeded by `journal-entry-deeplinks.setup.ts`. Their canonical ids
 * are written to `.playwright/je-deeplinks-fixtures.json` so this spec
 * stays in lock-step with the seeded rows (no clock drift between
 * setup and spec).
 *
 * What we assert, surface by surface:
 *
 *   Inbox (`/app/inbox`)
 *     • The "Posted as journal entry #N" strip renders both
 *       `link-journal-entry-posted-{docId}` and `link-view-journal`
 *       as `<a>` tags whose `href` is `/app/journal#je-{postedJeId}`.
 *     • Switching the inbox filter to "Review" surfaces the
 *       "Recently posted" panel (`ZeroInboxState`) — the seeded
 *       posted document has nothing else in the queue, so flipping
 *       the filter is enough. Its row renders
 *       `link-journal-entry-recent-{docId}` as an `<a>` whose `href`
 *       is `/app/journal#je-{postedJeId}`.
 *
 *   Fixed Assets · Depreciation tab (`/app/fixed-assets#dr-{runId}`)
 *     • The past-depreciation-runs row renders
 *       `link-journal-entry-depreciation-run-{runId}` as an `<a>`
 *       whose `href` is `/app/journal#je-{depreciationJeId}`.
 *
 *   Asset Detail dialog (opened via `/app/fixed-assets#asset-{assetId}`)
 *     • The Impairments tab renders
 *       `link-journal-entry-impairment-{eventId}` as an `<a>` whose
 *       `href` is `/app/journal#je-{impairmentJeId}`.
 *     • The Revaluations tab renders
 *       `link-journal-entry-revaluation-{eventId}` as an `<a>` whose
 *       `href` is `/app/journal#je-{revaluationJeId}`.
 *     • The Disposals tab renders
 *       `link-journal-entry-disposal-{eventId}` as an `<a>` whose
 *       `href` is `/app/journal#je-{disposalJeId}`.
 *     • The History tab renders both seeded rows (depreciation +
 *       impairment) — both as `<a>` tags whose `href` resolves to
 *       `/app/journal#je-<id>` for the matching JE. The setup picks
 *       event dates that make the row order deterministic
 *       (depreciation 2099-06-28 → index 0, impairment 2099-06-30 →
 *       index 1; the revaluation 2099-07-15 and disposal 2099-07-20
 *       sort after, leaving these two indices stable).
 *
 *   The test fails if any of those references regresses to plain text
 *   (i.e. is no longer an `<a>` element) or stops resolving to
 *   `/app/journal#je-{id}`.
 */

interface Fixtures {
  companyId: number;
  assetId: number;
  runId: number;
  postingId: number;
  impairmentEventId: number;
  revaluationEventId: number;
  disposalEventId: number;
  documentId: number;
  postedJeId: number;
  depreciationJeId: number;
  impairmentJeId: number;
  revaluationJeId: number;
  disposalJeId: number;
}

function loadFixtures(): Fixtures {
  const p = path.resolve(".playwright/je-deeplinks-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

function expectedHref(jeId: number): string {
  return `/app/journal#je-${jeId}`;
}

test.describe("JE deep links across Inbox + Fixed Assets", () => {
  test("inbox posted strip + fixed-assets depreciation + asset-detail (history & impairments) all link to /app/journal#je-{id}", async ({
    page,
  }) => {
    const fx = loadFixtures();

    // ============================================================
    // 1. Inbox — Posted-as-JE strip
    // ============================================================
    await page.goto("/app/inbox");

    // The seeded workspace has exactly one document, so the inbox
    // auto-selects it on first paint and renders the detail panel
    // (which is where the "Posted as journal entry #N" strip lives).
    const docRow = page.locator(
      `[data-testid="row-document-${fx.documentId}"]`,
    );
    await expect(
      docRow,
      "the seeded posted document must appear in the inbox list",
    ).toBeVisible();

    const inboxPostedLink = page.locator(
      `[data-testid="link-journal-entry-posted-${fx.documentId}"]`,
    );
    await expect(
      inboxPostedLink,
      "the inbox 'Posted as journal entry' strip must render the JE deep link",
    ).toBeVisible();
    // We assert it is specifically an <a> (not a <span> / <button> /
    // <div>) so a future refactor that turns it back into plain text
    // visibly fails this spec.
    await expect(
      inboxPostedLink,
      "the inbox JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(inboxPostedLink).toHaveAttribute(
      "href",
      expectedHref(fx.postedJeId),
    );

    const viewJournalLink = page.locator('[data-testid="link-view-journal"]');
    await expect(
      viewJournalLink,
      "the inbox 'View' shortcut next to the strip must also be a deep link",
    ).toBeVisible();
    await expect(viewJournalLink).toHaveJSProperty("tagName", "A");
    await expect(viewJournalLink).toHaveAttribute(
      "href",
      expectedHref(fx.postedJeId),
    );

    // ---- Inbox "Recently posted" panel (ZeroInboxState) ---------
    // Flipping the filter to "Review" leaves the queue empty (the
    // only seeded document is already posted), which surfaces the
    // ZeroInboxState side panel — that is where the recent-posted
    // strip lives.
    await page.locator('[data-testid="filter-review"]').click();

    const recentList = page.locator('[data-testid="list-recent-posted"]');
    await expect(
      recentList,
      "the inbox 'Recently posted' panel must render after switching to the Review filter",
    ).toBeVisible();

    const recentLink = page.locator(
      `[data-testid="link-journal-entry-recent-${fx.documentId}"]`,
    );
    await expect(
      recentLink,
      "the recently-posted strip must render the JE deep link for the seeded document",
    ).toBeVisible();
    await expect(
      recentLink,
      "the recently-posted JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(recentLink).toHaveAttribute(
      "href",
      expectedHref(fx.postedJeId),
    );

    // ============================================================
    // 2. Fixed Assets — Depreciation runs table
    // ============================================================
    // Loading the page with `#dr-{runId}` flips the controlled tab to
    // Depreciation on first render (see `mapHashToFaTab`), so we don't
    // have to click anything to reveal the row.
    await page.goto(`/app/fixed-assets#dr-${fx.runId}`);

    const runRow = page.locator(`[data-testid="row-run-${fx.runId}"]`);
    await expect(
      runRow,
      "the seeded posted depreciation run must appear in the runs table",
    ).toBeVisible();

    const drLink = page.locator(
      `[data-testid="link-journal-entry-depreciation-run-${fx.runId}"]`,
    );
    await expect(
      drLink,
      "the depreciation runs row must render the JE deep link",
    ).toBeVisible();
    await expect(
      drLink,
      "the depreciation-runs JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(drLink).toHaveAttribute(
      "href",
      expectedHref(fx.depreciationJeId),
    );

    // ============================================================
    // 3. Asset Detail dialog — Impairments + History tabs
    // ============================================================
    // Navigating to `#asset-<id>` flips the page back to the Register
    // tab AND opens the AssetDetailDialog for that asset (the page
    // listens for the hash change after the assets query resolves).
    await page.goto(`/app/fixed-assets#asset-${fx.assetId}`);

    const detailDialog = page.locator(
      '[data-testid="dialog-asset-detail"]',
    );
    await expect(
      detailDialog,
      "the asset detail dialog must open when the page is loaded with #asset-<id>",
    ).toBeVisible();

    // ---- 3a. Impairments tab ----
    await detailDialog
      .locator('[data-testid="tab-detail-impairments"]')
      .click();

    const impairmentLink = page.locator(
      `[data-testid="link-journal-entry-impairment-${fx.impairmentEventId}"]`,
    );
    await expect(
      impairmentLink,
      "the impairments tab must render the JE deep link for the seeded event",
    ).toBeVisible();
    await expect(
      impairmentLink,
      "the impairment JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(impairmentLink).toHaveAttribute(
      "href",
      expectedHref(fx.impairmentJeId),
    );

    // ---- 3b. Revaluations tab ----
    await detailDialog
      .locator('[data-testid="tab-detail-revaluations"]')
      .click();

    const revaluationLink = page.locator(
      `[data-testid="link-journal-entry-revaluation-${fx.revaluationEventId}"]`,
    );
    await expect(
      revaluationLink,
      "the revaluations tab must render the JE deep link for the seeded event",
    ).toBeVisible();
    await expect(
      revaluationLink,
      "the revaluation JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(revaluationLink).toHaveAttribute(
      "href",
      expectedHref(fx.revaluationJeId),
    );

    // ---- 3c. Disposals tab ----
    await detailDialog
      .locator('[data-testid="tab-detail-disposals"]')
      .click();

    const disposalLink = page.locator(
      `[data-testid="link-journal-entry-disposal-${fx.disposalEventId}"]`,
    );
    await expect(
      disposalLink,
      "the disposals tab must render the JE deep link for the seeded event",
    ).toBeVisible();
    await expect(
      disposalLink,
      "the disposal JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(disposalLink).toHaveAttribute(
      "href",
      expectedHref(fx.disposalJeId),
    );

    // ---- 3d. History tab ----
    // The history tab unifies depreciations + impairments + revaluations
    // + disposals, sorted by date ascending. The setup picks
    //   depreciation date = 2099-06-28 (index 0)
    //   impairment  date = 2099-06-30 (index 1)
    // so both indices are deterministic.
    await detailDialog
      .locator('[data-testid="tab-detail-history"]')
      .click();

    const historyDepLink = page.locator(
      '[data-testid="link-journal-entry-history-0"]',
    );
    await expect(
      historyDepLink,
      "the history tab must render the depreciation row's JE deep link",
    ).toBeVisible();
    await expect(
      historyDepLink,
      "the history-row JE reference must be an <a> tag, not plain text",
    ).toHaveJSProperty("tagName", "A");
    await expect(historyDepLink).toHaveAttribute(
      "href",
      expectedHref(fx.depreciationJeId),
    );

    const historyImpLink = page.locator(
      '[data-testid="link-journal-entry-history-1"]',
    );
    await expect(
      historyImpLink,
      "the history tab must render the impairment row's JE deep link",
    ).toBeVisible();
    await expect(historyImpLink).toHaveJSProperty("tagName", "A");
    await expect(historyImpLink).toHaveAttribute(
      "href",
      expectedHref(fx.impairmentJeId),
    );
  });
});
