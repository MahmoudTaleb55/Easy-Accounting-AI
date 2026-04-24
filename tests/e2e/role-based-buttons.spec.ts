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

/**
 * Wait for at least one row matching `<rowTestIdPrefix><id>` to render.
 * Per-row write/owner buttons (delete-leave-{id}, delete-{assetId}, …) only
 * exist once their parent row is hydrated by react-query, so resolving the
 * row first keeps the button assertions deterministic.
 */
async function expectAnyRow(page: Page, rowTestIdPrefix: string) {
  const row = page.locator(`[data-testid^="${rowTestIdPrefix}"]`).first();
  await expect(
    row,
    `expected at least one row matching ${rowTestIdPrefix}* to render`,
  ).toBeVisible();
  return row;
}

test.describe("role-based button gating @rbac", () => {
  // ----------------------------------------------------------------------
  // OWNER — every gated button must be present and untouched by either
  // guard, and (where seed data permits) freely clickable.
  // ----------------------------------------------------------------------
  test.describe("owner sees every gated button enabled", () => {
    test.use({ storageState: ROLE_FILES.owner });

    test("transactions: 'Add transaction' + per-row delete are enabled", async ({ page }) => {
      await gotoApp(page, "/app/transactions");
      await expectUnguarded(page, "button-add-transaction");
      await expect(
        page.locator('[data-testid="button-add-transaction"]').first(),
      ).toBeEnabled();

      // The per-tx delete button only renders after the seeded transaction
      // row is hydrated. For owners the canWrite branch swaps the WriteGuard
      // wrapper for an AlertDialogTrigger, so the button must NOT be wrapped
      // in a guard span — `expectUnguarded` enforces that contract.
      const txDelete = page.locator('[data-testid^="button-delete-"]').first();
      await expect(txDelete).toBeVisible();
      const txButtonId = await txDelete.getAttribute("data-testid");
      await expectUnguarded(page, txButtonId!);
      await expect(txDelete).toBeEnabled();
    });

    test("journal: 'New entry' + per-row manual delete are enabled", async ({ page }) => {
      await gotoApp(page, "/app/journal");
      await expectUnguarded(page, "button-new-entry");
      await expect(page.locator('[data-testid="button-new-entry"]').first()).toBeEnabled();

      // Only manual entries render `button-delete-entry-{id}` — the
      // setup seeds exactly one such entry inside the current period.
      const jeDelete = page.locator('[data-testid^="button-delete-entry-"]').first();
      await expect(jeDelete).toBeVisible();
      const jeButtonId = await jeDelete.getAttribute("data-testid");
      await expectUnguarded(page, jeButtonId!);
      await expect(jeDelete).toBeEnabled();
    });

    test("hr employees: add + per-row delete are enabled", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-employees"]').click();
      await expectUnguarded(page, "button-add-employee");
      await expect(
        page.locator('[data-testid="button-add-employee"]').first(),
      ).toBeEnabled();

      await expectAnyRow(page, "row-employee-");
      const empDelete = page.locator('[data-testid^="button-delete-employee-"]').first();
      const empButtonId = await empDelete.getAttribute("data-testid");
      await expectUnguarded(page, empButtonId!);
      await expect(empDelete).toBeEnabled();
    });

    test("hr attendance: 'Save attendance' is unwrapped (forceDisabled allowed)", async ({ page }) => {
      // The save button is `forceDisabled` until an employee is picked. For
      // allowed roles WriteGuard renders the child unwrapped with the
      // disabled prop forwarded through, so we only assert the absence of
      // the role-guard wrapper here — it's expected to remain disabled.
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-attendance"]').click();
      await expectUnguarded(page, "button-save-attendance");
    });

    test("hr leaves: save + per-row delete are enabled / unwrapped", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-leaves"]').click();
      await expectUnguarded(page, "button-save-leave");

      await expectAnyRow(page, "row-leave-");
      const leaveDelete = page.locator('[data-testid^="button-delete-leave-"]').first();
      const leaveButtonId = await leaveDelete.getAttribute("data-testid");
      await expectUnguarded(page, leaveButtonId!);
      await expect(leaveDelete).toBeEnabled();
    });

    test("hr payroll: 'Run payroll' + per-row delete are enabled", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-payroll"]').click();
      const runBtn = page.locator('[data-testid="button-run-payroll"]').first();
      await expect(runBtn).toBeVisible();
      await expectUnguarded(page, "button-run-payroll");
      await expect(runBtn).toBeEnabled();

      await expectAnyRow(page, "row-payroll-run-");
      const runDelete = page.locator('[data-testid^="button-delete-payroll-run-"]').first();
      const runDeleteId = await runDelete.getAttribute("data-testid");
      await expectUnguarded(page, runDeleteId!);
      await expect(runDelete).toBeEnabled();
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

    test("fixed-assets register/categories/depreciation: gated buttons enabled", async ({ page }) => {
      await gotoApp(page, "/app/fixed-assets");

      // Register tab is the default landing tab. Add-asset is `forceDisabled`
      // when no categories exist; the seed creates one so it must be live.
      await page.locator('[data-testid="tab-register"]').click();
      await expectUnguarded(page, "button-add-asset");
      await expect(page.locator('[data-testid="button-add-asset"]').first()).toBeEnabled();

      // Per-row impairment/revaluation/dispose/delete are `forceDisabled`
      // when status !== 'active'. The seed asset is active, so all four
      // must render unwrapped and enabled for owners.
      await expectAnyRow(page, "row-asset-");
      const assetRow = page.locator('[data-testid^="row-asset-"]').first();
      const assetId = (await assetRow.getAttribute("data-testid"))!.replace("row-asset-", "");
      for (const action of ["impairment", "revaluation", "dispose", "delete"]) {
        const btnId = `button-${action}-${assetId}`;
        await expectUnguarded(page, btnId);
        await expect(page.locator(`[data-testid="${btnId}"]`).first()).toBeEnabled();
      }

      // Categories tab → add-category is plain WriteGuard (no forceDisabled).
      await page.locator('[data-testid="tab-categories"]').click();
      await expectUnguarded(page, "button-add-category");
      await expect(page.locator('[data-testid="button-add-category"]').first()).toBeEnabled();

      // Depreciation tab → post-dep is `forceDisabled` until the user
      // previews. For owners the WriteGuard wrapper must still be absent
      // even though the inner Button is disabled — `expectUnguarded` is
      // the right contract here.
      await page.locator('[data-testid="tab-depreciation"]').click();
      await expectUnguarded(page, "button-post-dep");
    });

    test("settings members: invite + per-row remove are enabled", async ({ page }) => {
      await gotoApp(page, "/app/settings/members");

      // Owners pass the isAdmin hard guard so the full management UI renders.
      await expect(page.locator('[data-testid="members-forbidden"]')).toHaveCount(0);
      await expectUnguarded(page, "button-send-invite");
      await expect(page.locator('[data-testid="button-send-invite"]').first()).toBeEnabled();

      // The owner themselves shows up in the members list with a remove
      // button. We don't click it (it would log us out of the workspace),
      // we just verify it's wired up without a guard wrapper.
      const removeBtn = page.locator('[data-testid^="button-remove-"]').first();
      await expect(removeBtn).toBeVisible();
      const removeId = await removeBtn.getAttribute("data-testid");
      await expectUnguarded(page, removeId!);
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

    test("transactions: header + per-row delete stay enabled", async ({ page }) => {
      await gotoApp(page, "/app/transactions");
      await expectUnguarded(page, "button-add-transaction");
      await expect(
        page.locator('[data-testid="button-add-transaction"]').first(),
      ).toBeEnabled();

      const txDelete = page.locator('[data-testid^="button-delete-"]').first();
      await expect(txDelete).toBeVisible();
      const txButtonId = await txDelete.getAttribute("data-testid");
      await expectUnguarded(page, txButtonId!);
      await expect(txDelete).toBeEnabled();
    });

    test("journal: header + per-row manual delete stay enabled", async ({ page }) => {
      await gotoApp(page, "/app/journal");
      await expectUnguarded(page, "button-new-entry");
      await expect(page.locator('[data-testid="button-new-entry"]').first()).toBeEnabled();

      const jeDelete = page.locator('[data-testid^="button-delete-entry-"]').first();
      await expect(jeDelete).toBeVisible();
      const jeButtonId = await jeDelete.getAttribute("data-testid");
      await expectUnguarded(page, jeButtonId!);
      await expect(jeDelete).toBeEnabled();
    });

    test("hr employees: add + per-row delete stay enabled", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-employees"]').click();
      await expectUnguarded(page, "button-add-employee");
      await expect(
        page.locator('[data-testid="button-add-employee"]').first(),
      ).toBeEnabled();

      await expectAnyRow(page, "row-employee-");
      const empDelete = page.locator('[data-testid^="button-delete-employee-"]').first();
      const empButtonId = await empDelete.getAttribute("data-testid");
      await expectUnguarded(page, empButtonId!);
      await expect(empDelete).toBeEnabled();
    });

    test("hr attendance + leaves: save buttons unwrapped, leave delete enabled", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-attendance"]').click();
      // forceDisabled stays in effect, but the WriteGuard wrapper must
      // not be present for accountants either.
      await expectUnguarded(page, "button-save-attendance");

      await page.locator('[data-testid="tab-leaves"]').click();
      await expectUnguarded(page, "button-save-leave");
      await expectAnyRow(page, "row-leave-");
      const leaveDelete = page.locator('[data-testid^="button-delete-leave-"]').first();
      const leaveDeleteId = await leaveDelete.getAttribute("data-testid");
      await expectUnguarded(page, leaveDeleteId!);
      await expect(leaveDelete).toBeEnabled();
    });

    test("hr payroll: 'Run payroll' + per-row delete stay enabled", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-payroll"]').click();
      const button = page.locator('[data-testid="button-run-payroll"]').first();
      await expect(button).toBeVisible();
      await expectUnguarded(page, "button-run-payroll");
      await expect(button).toBeEnabled();

      await expectAnyRow(page, "row-payroll-run-");
      const runDelete = page.locator('[data-testid^="button-delete-payroll-run-"]').first();
      const runDeleteId = await runDelete.getAttribute("data-testid");
      await expectUnguarded(page, runDeleteId!);
      await expect(runDelete).toBeEnabled();
    });

    test("fixed-assets register/categories/depreciation: gated buttons stay enabled", async ({ page }) => {
      // Accountants pass WriteGuard but fail the OwnerOnly check on the
      // companies/fx tabs. The register/categories/depreciation tabs are
      // pure write surfaces, so accountants must see the same enabled
      // state as the owner here.
      await gotoApp(page, "/app/fixed-assets");

      await page.locator('[data-testid="tab-register"]').click();
      await expectUnguarded(page, "button-add-asset");
      await expect(page.locator('[data-testid="button-add-asset"]').first()).toBeEnabled();

      await expectAnyRow(page, "row-asset-");
      const assetRow = page.locator('[data-testid^="row-asset-"]').first();
      const assetId = (await assetRow.getAttribute("data-testid"))!.replace("row-asset-", "");
      for (const action of ["impairment", "revaluation", "dispose", "delete"]) {
        const btnId = `button-${action}-${assetId}`;
        await expectUnguarded(page, btnId);
        await expect(page.locator(`[data-testid="${btnId}"]`).first()).toBeEnabled();
      }

      await page.locator('[data-testid="tab-categories"]').click();
      await expectUnguarded(page, "button-add-category");
      await expect(page.locator('[data-testid="button-add-category"]').first()).toBeEnabled();

      await page.locator('[data-testid="tab-depreciation"]').click();
      await expectUnguarded(page, "button-post-dep");
    });

    test("settings members: page is forbidden for accountants", async ({ page }) => {
      // Members management is hard-gated on isAdmin, so non-owners get the
      // forbidden notice instead of the (otherwise WriteGuard-protected)
      // invite + remove buttons.
      await gotoApp(page, "/app/settings/members");
      await expect(page.locator('[data-testid="members-forbidden"]')).toBeVisible();
      await expect(page.locator('[data-testid="button-send-invite"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-remove-"]')).toHaveCount(0);
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

    test("transactions: header + per-row delete are read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/transactions");
      await expectGuarded(
        page,
        "button-add-transaction",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );

      // Viewers go through the non-canWrite branch which renders the
      // WriteGuard wrapper directly — exactly what `expectGuarded` checks.
      const txDelete = page.locator('[data-testid^="button-delete-"]').first();
      await expect(txDelete).toBeVisible();
      const txButtonId = await txDelete.getAttribute("data-testid");
      await expectGuarded(page, txButtonId!, "write-guard-disabled", READ_ONLY_TOOLTIP);
    });

    test("journal: header + per-row manual delete are read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/journal");
      await expectGuarded(page, "button-new-entry", "write-guard-disabled", READ_ONLY_TOOLTIP);

      const jeDelete = page.locator('[data-testid^="button-delete-entry-"]').first();
      await expect(jeDelete).toBeVisible();
      const jeButtonId = await jeDelete.getAttribute("data-testid");
      await expectGuarded(page, jeButtonId!, "write-guard-disabled", READ_ONLY_TOOLTIP);
    });

    test("hr employees: add + per-row delete are read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-employees"]').click();
      await expectGuarded(
        page,
        "button-add-employee",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );

      await expectAnyRow(page, "row-employee-");
      const empDelete = page.locator('[data-testid^="button-delete-employee-"]').first();
      const empButtonId = await empDelete.getAttribute("data-testid");
      await expectGuarded(page, empButtonId!, "write-guard-disabled", READ_ONLY_TOOLTIP);
    });

    test("hr attendance + leaves: save buttons + leave delete are read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-attendance"]').click();
      // forceDisabled + viewer role → WriteGuard renders the wrapper because
      // the role check fails first; the read-only tooltip wins over the
      // forceDisabled-only fallback (see write-guard.tsx).
      await expectGuarded(
        page,
        "button-save-attendance",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );

      await page.locator('[data-testid="tab-leaves"]').click();
      await expectGuarded(
        page,
        "button-save-leave",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );
      await expectAnyRow(page, "row-leave-");
      const leaveDelete = page.locator('[data-testid^="button-delete-leave-"]').first();
      const leaveDeleteId = await leaveDelete.getAttribute("data-testid");
      await expectGuarded(page, leaveDeleteId!, "write-guard-disabled", READ_ONLY_TOOLTIP);
    });

    test("hr payroll: 'Run payroll' + per-row delete are read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/hr");
      await page.locator('[data-testid="tab-payroll"]').click();
      await expectGuarded(
        page,
        "button-run-payroll",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );

      await expectAnyRow(page, "row-payroll-run-");
      const runDelete = page.locator('[data-testid^="button-delete-payroll-run-"]').first();
      const runDeleteId = await runDelete.getAttribute("data-testid");
      await expectGuarded(page, runDeleteId!, "write-guard-disabled", READ_ONLY_TOOLTIP);
    });

    test("fixed-assets register/categories/depreciation: gated buttons are read-only guarded", async ({ page }) => {
      await gotoApp(page, "/app/fixed-assets");

      await page.locator('[data-testid="tab-register"]').click();
      await expectGuarded(
        page,
        "button-add-asset",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );

      // Per-row buttons combine `forceDisabled={status !== 'active'}` with
      // the viewer role failing the canWrite check. The role-fail wins so
      // the WriteGuard wrapper is rendered with the read-only tooltip.
      await expectAnyRow(page, "row-asset-");
      const assetRow = page.locator('[data-testid^="row-asset-"]').first();
      const assetId = (await assetRow.getAttribute("data-testid"))!.replace("row-asset-", "");
      for (const action of ["impairment", "revaluation", "dispose", "delete"]) {
        await expectGuarded(
          page,
          `button-${action}-${assetId}`,
          "write-guard-disabled",
          READ_ONLY_TOOLTIP,
        );
      }

      await page.locator('[data-testid="tab-categories"]').click();
      await expectGuarded(
        page,
        "button-add-category",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );

      await page.locator('[data-testid="tab-depreciation"]').click();
      await expectGuarded(
        page,
        "button-post-dep",
        "write-guard-disabled",
        READ_ONLY_TOOLTIP,
      );
    });

    test("settings members: page is forbidden for viewers", async ({ page }) => {
      await gotoApp(page, "/app/settings/members");
      await expect(page.locator('[data-testid="members-forbidden"]')).toBeVisible();
      await expect(page.locator('[data-testid="button-send-invite"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-remove-"]')).toHaveCount(0);
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
