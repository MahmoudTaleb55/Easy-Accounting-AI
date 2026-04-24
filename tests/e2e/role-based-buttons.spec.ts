import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Role-based button gating regression net.
 *
 * The dashboard hides write-side power behind two React guards (see
 * `client/src/components/auth/write-guard.tsx`):
 *
 *   • <WriteGuard>  — accountants and owners pass; viewers see the wrapped
 *                     button disabled with a "read-only" tooltip.
 *   • <OwnerGuard>  — only owners pass; everyone else sees the wrapped
 *                     button disabled with an "owner-only" tooltip.
 *
 * If a refactor of the role model accidentally drops the wrapper from a
 * write-surface button, viewers and accountants would silently regain the
 * ability to fire mutations whose 403s would only surface as toast errors.
 * This spec freezes the contract: for each role, every button listed in
 * the task description must either be enabled (when the role is allowed)
 * or wrapped in the *correct* guard with the *correct* tooltip text.
 *
 * Auth + seed for this spec are handled once by `role-based-buttons.setup.ts`,
 * which provisions one user per role inside a shared workspace and writes
 * a per-role storage state file. Each `test.describe` block then loads the
 * matching state via `test.use({ storageState })`.
 */

const ROLE_FILES = {
  owner: ".playwright/role-owner.json",
  accountant: ".playwright/role-accountant.json",
  viewer: ".playwright/role-viewer.json",
} as const;

// Strings come from `useReadOnlyMessage` / `useOwnerOnlyMessage` (English locale).
const READ_ONLY_TOOLTIP = "You don't have permission to make changes here";
const OWNER_ONLY_TOOLTIP = "Only the workspace owner can do this";

async function gotoApp(page: Page, urlPath: string) {
  // Pin locale + theme so the tooltip text we assert below is in English.
  await page.addInitScript(() => {
    window.localStorage.setItem("app.locale", "en");
    window.localStorage.setItem("app.theme", "light");
  });
  await page.goto(urlPath, { waitUntil: "networkidle" });
}

/**
 * Find the role-guard wrapper that immediately contains the named button.
 * Using a `:has()` filter scopes us to the right wrapper when several
 * guarded buttons live on the same page.
 */
function guardWrapper(
  page: Page,
  buttonTestId: string,
  guardTestId: "write-guard-disabled" | "owner-guard-disabled",
): Locator {
  return page.locator(
    `[data-testid="${guardTestId}"]:has([data-testid="${buttonTestId}"])`,
  );
}

async function expectGuarded(
  page: Page,
  buttonTestId: string,
  guardTestId: "write-guard-disabled" | "owner-guard-disabled",
  tooltipText: string,
) {
  const wrapper = guardWrapper(page, buttonTestId, guardTestId);
  await expect(
    wrapper,
    `expected ${buttonTestId} to be wrapped in ${guardTestId}`,
  ).toBeVisible();

  const button = page.locator(`[data-testid="${buttonTestId}"]`).first();
  await expect(button, `${buttonTestId} should render disabled`).toBeDisabled();

  // Hover the wrapper span (the TooltipTrigger) so the role-explainer
  // tooltip surfaces, then assert its content matches the expected role
  // message. Radix portals the tooltip to <body>, so we look for a global
  // role="tooltip" element with the expected text.
  await wrapper.first().hover();
  await expect(
    page.locator('[role="tooltip"]', { hasText: tooltipText }).first(),
  ).toBeVisible();
}

/**
 * Assert a button is NOT wrapped in any role-guard tooltip wrapper.
 * Other ancestors are fine — for example HR's payroll button is also
 * `forceDisabled` while the preview computes — but it should never be
 * inside a `[data-testid="*-guard-disabled"]` span for the role under test.
 */
async function expectUnguarded(page: Page, buttonTestId: string) {
  const button = page.locator(`[data-testid="${buttonTestId}"]`).first();
  await expect(button, `${buttonTestId} should be visible`).toBeVisible();
  const wrappedByRoleGuard = await button.evaluate((el) => {
    return Boolean(
      el.closest(
        '[data-testid="write-guard-disabled"], [data-testid="owner-guard-disabled"]',
      ),
    );
  });
  expect(
    wrappedByRoleGuard,
    `${buttonTestId} should NOT be wrapped in a role guard for the active role`,
  ).toBe(false);
}

test.describe("role-based button gating @rbac", () => {
  // ----------------------------------------------------------------------
  // OWNER — every gated button must be present and untouched by either
  // guard, and (where seed data permits) freely clickable.
  // ----------------------------------------------------------------------
  test.describe("owner sees every gated button enabled", () => {
    test.use({ storageState: ROLE_FILES.owner });

    test("transactions: 'Add transaction' is enabled", async ({ page }) => {
      await gotoApp(page, "/app/transactions");
      await expectUnguarded(page, "button-add-transaction");
      await expect(
        page.locator('[data-testid="button-add-transaction"]').first(),
      ).toBeEnabled();
    });

    test("journal: 'New entry' is enabled", async ({ page }) => {
      await gotoApp(page, "/app/journal");
      await expectUnguarded(page, "button-new-entry");
      await expect(page.locator('[data-testid="button-new-entry"]').first()).toBeEnabled();
    });

    test("hr: 'Run payroll' is enabled (employee seeded)", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-payroll"]').click();
      const button = page.locator('[data-testid="button-run-payroll"]').first();
      await expect(button).toBeVisible();
      await expectUnguarded(page, "button-run-payroll");
      await expect(button).toBeEnabled();
    });

    test("settings: save, add company, add fx, delete fx are all enabled", async ({ page }) => {
      await gotoApp(page, "/app/settings");

      // Save settings — wrapped in OwnerGuard, must not be disabled by it.
      await expectUnguarded(page, "button-save-settings");
      await expect(
        page.locator('[data-testid="button-save-settings"]').first(),
      ).toBeEnabled();

      // Owner sees the Companies + FX panels (gated by <OwnerOnly>).
      await expect(page.locator('[data-testid="card-settings-companies"]')).toBeVisible();
      await expectUnguarded(page, "button-add-company");
      await expect(
        page.locator('[data-testid="button-add-company"]').first(),
      ).toBeEnabled();

      await expect(page.locator('[data-testid="card-settings-fx"]')).toBeVisible();
      await expectUnguarded(page, "button-save-fx");
      await expect(page.locator('[data-testid="button-save-fx"]').first()).toBeEnabled();

      // The seeded FX rate gives us at least one delete button to assert against.
      const fxDelete = page.locator('[data-testid^="button-delete-fx-"]').first();
      await expect(fxDelete).toBeVisible();
      await expect(fxDelete).toBeEnabled();
    });

    test("fixed-assets: companies + fx tabs are visible and gated buttons are enabled", async ({ page }) => {
      // Fixed Assets is the *second* surface that exposes the workspace's
      // Companies and FX panels — see `client/src/pages/fixed-assets.tsx`.
      // Non-owners get the entire pair of tabs swapped for an empty state,
      // owners get them as full subtabs. We assert both halves of that
      // contract here so a regression on either surface fails loudly.
      await gotoApp(page, "/app/fixed-assets");

      // Owner-only tabs render.
      await expect(page.locator('[data-testid="tab-companies"]')).toBeVisible();
      await expect(page.locator('[data-testid="tab-fx"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="empty-owner-only-fa-companies-fx"]'),
      ).toHaveCount(0);

      // Companies tab → Add company button is the same gated control as on
      // /app/settings, but rendered inside a different parent.
      await page.locator('[data-testid="tab-companies"]').click();
      await expectUnguarded(page, "button-add-company");
      await expect(
        page.locator('[data-testid="button-add-company"]').first(),
      ).toBeEnabled();

      // FX tab → save + per-row delete buttons are owner-guarded too.
      await page.locator('[data-testid="tab-fx"]').click();
      await expectUnguarded(page, "button-save-fx");
      await expect(page.locator('[data-testid="button-save-fx"]').first()).toBeEnabled();
      const fxDelete = page.locator('[data-testid^="button-delete-fx-"]').first();
      await expect(fxDelete).toBeVisible();
      await expect(fxDelete).toBeEnabled();
    });
  });

  // ----------------------------------------------------------------------
  // ACCOUNTANT — write surfaces (Transactions, Journal, HR) are enabled,
  // but owner-only surfaces (Save settings, Add company, FX) are either
  // disabled with the owner-only tooltip (Save settings) or completely
  // hidden behind the OwnerOnly fallback (Companies + FX panels).
  // ----------------------------------------------------------------------
  test.describe("accountant can write but cannot manage workspace", () => {
    test.use({ storageState: ROLE_FILES.accountant });

    test("transactions: 'Add transaction' stays enabled", async ({ page }) => {
      await gotoApp(page, "/app/transactions");
      await expectUnguarded(page, "button-add-transaction");
      await expect(
        page.locator('[data-testid="button-add-transaction"]').first(),
      ).toBeEnabled();
    });

    test("journal: 'New entry' stays enabled", async ({ page }) => {
      await gotoApp(page, "/app/journal");
      await expectUnguarded(page, "button-new-entry");
      await expect(page.locator('[data-testid="button-new-entry"]').first()).toBeEnabled();
    });

    test("hr: 'Run payroll' stays enabled", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-payroll"]').click();
      const button = page.locator('[data-testid="button-run-payroll"]').first();
      await expect(button).toBeVisible();
      await expectUnguarded(page, "button-run-payroll");
      await expect(button).toBeEnabled();
    });

    test("settings: save is owner-guarded; companies + fx panels are hidden", async ({ page }) => {
      await gotoApp(page, "/app/settings");

      await expectGuarded(
        page,
        "button-save-settings",
        "owner-guard-disabled",
        OWNER_ONLY_TOOLTIP,
      );

      // <OwnerOnly> swaps the entire Companies + FX cards for an empty state,
      // so accountants never even render the add/delete buttons. That is a
      // valid form of gating — strictly stronger than tooltip-disable — and
      // we verify both the empty state and the absence of the gated buttons.
      await expect(page.locator('[data-testid="empty-owner-only-companies-fx"]')).toBeVisible();
      await expect(page.locator('[data-testid="card-settings-companies"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="card-settings-fx"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="button-add-company"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="button-save-fx"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-delete-fx-"]')).toHaveCount(0);
    });

    test("fixed-assets: companies + fx tabs are hidden, gated buttons absent", async ({ page }) => {
      await gotoApp(page, "/app/fixed-assets");

      // The owner-only Tabs are hidden for accountants (canManage=false), and
      // the page falls back to a single read-only EmptyState explainer.
      await expect(page.locator('[data-testid="tab-companies"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="tab-fx"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="empty-owner-only-fa-companies-fx"]'),
      ).toBeVisible();

      // No way to reach the gated controls — confirm they don't render either.
      await expect(page.locator('[data-testid="button-add-company"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="button-save-fx"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-delete-fx-"]')).toHaveCount(0);
    });
  });

  // ----------------------------------------------------------------------
  // VIEWER — every gated write button must be disabled with a read-only
  // tooltip. The owner-only Save settings surface keeps the owner-only
  // tooltip (not the read-only one), because <OwnerGuard> is the stricter
  // of the two and viewers fail it for the same reason as accountants.
  // ----------------------------------------------------------------------
  test.describe("viewer is locked out of every write button", () => {
    test.use({ storageState: ROLE_FILES.viewer });

    test("transactions: 'Add transaction' is read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/transactions");
      await expectGuarded(
        page,
        "button-add-transaction",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );
    });

    test("journal: 'New entry' is read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/journal");
      await expectGuarded(page, "button-new-entry", "write-guard-disabled", READ_ONLY_TOOLTIP);
    });

    test("hr: 'Run payroll' is read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-payroll"]').click();
      await expectGuarded(
        page,
        "button-run-payroll",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );
    });

    test("settings: save is owner-guarded; companies + fx panels are hidden", async ({ page }) => {
      await gotoApp(page, "/app/settings");

      await expectGuarded(
        page,
        "button-save-settings",
        "owner-guard-disabled",
        OWNER_ONLY_TOOLTIP,
      );

      await expect(page.locator('[data-testid="empty-owner-only-companies-fx"]')).toBeVisible();
      await expect(page.locator('[data-testid="button-add-company"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="button-save-fx"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-delete-fx-"]')).toHaveCount(0);
    });

    test("fixed-assets: companies + fx tabs are hidden, gated buttons absent", async ({ page }) => {
      // Viewers fail the same `canManage` check as accountants on this page,
      // so the owner-only tabs and the buttons they hold are never rendered.
      await gotoApp(page, "/app/fixed-assets");

      await expect(page.locator('[data-testid="tab-companies"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="tab-fx"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="empty-owner-only-fa-companies-fx"]'),
      ).toBeVisible();

      await expect(page.locator('[data-testid="button-add-company"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="button-save-fx"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-delete-fx-"]')).toHaveCount(0);
    });
  });
});
