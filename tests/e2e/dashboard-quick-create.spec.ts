import { test, expect } from "@playwright/test";

/**
 * End-to-end coverage for the dashboard's "inactivity" attention card
 * shortcut.
 *
 * The attention queue (`client/src/components/dashboard/attention-queue.tsx`)
 * pushes an inactivity card whenever the workspace has at least one
 * transaction but none in the last 7 days. That card deep-links to
 * `/app/transactions?new=1` so the create dialog auto-opens — the same
 * shortcut behaviour as the topbar Plus-menu and the command palette.
 *
 * The topbar quick-create paths are already covered end-to-end by
 * `tests/e2e/quick-actions.spec.ts`, but no spec exercises the
 * attention-card click path. A silent regression in any of:
 *
 *   • the attention-card href (e.g. someone drops `?new=1`),
 *   • the inactivity-detection logic in the attention queue,
 *   • the destination page's `?new=1` auto-open effect (in
 *     `client/src/pages/transactions.tsx`),
 *
 * would surface immediately to every dashboard user with stale activity.
 * This spec drives the click against an isolated workspace whose only
 * transaction is older than 7 days (seeded by
 * `dashboard-quick-create.setup.ts`):
 *
 *   1. Open `/app`, wait for the attention queue to mount.
 *   2. Click the inactivity card (`attention-item-inactive-week`).
 *   3. Land on `/app/transactions` and assert the create-transaction
 *      dialog appears WITHOUT clicking the page's "Add" button — that
 *      auto-open is the entire value of the deep-link.
 *   4. Confirm the auto-open effect strips `?new=1` from the URL via a
 *      replace-navigation so a refresh / back-nav doesn't re-open it.
 */

test.describe("dashboard inactivity quick-create shortcut", () => {
  test("inactivity card → /app/transactions → dialog auto-opens", async ({
    page,
  }) => {
    await page.goto("/app", { waitUntil: "domcontentloaded" });

    // The attention queue is hydrated from `/api/insights/alerts` +
    // `/api/journal-entries` + `/api/transactions` — wait for the
    // inactivity card itself rather than the surrounding queue so a
    // sibling alert that lands first doesn't race the click.
    const inactivityCard = page.getByTestId("attention-item-inactive-week");
    await inactivityCard.waitFor({ state: "visible", timeout: 15_000 });

    // Sanity-check the href before we click — if a regression drops
    // `?new=1` the click would still navigate, but the destination page
    // wouldn't auto-open the dialog and the failure mode below would be
    // ambiguous (could be the href or the page-level effect). Asserting
    // the href first pins the regression to the right surface.
    await expect(inactivityCard).toHaveAttribute(
      "href",
      "/app/transactions?new=1",
    );

    await inactivityCard.click();

    // wouter's <Link> pushes via setLocation — no full reload, so wait
    // for the URL pathname to flip to the destination before asserting
    // the dialog.
    await expect.poll(() => new URL(page.url()).pathname).toBe(
      "/app/transactions",
    );
    await page
      .getByTestId("page-transactions")
      .waitFor({ state: "visible", timeout: 10_000 });

    // The destination page's `useEffect` reads `?new=1` and opens the
    // create dialog without any "Add" button click. That auto-open is
    // the entire payoff of the deep-link.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // …and the same effect strips `?new=1` from the URL via a
    // replace-navigation so a refresh / back-nav doesn't re-open the
    // dialog. Without this assert a regression that opened the dialog
    // but left the param in place would slip through.
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });
});
