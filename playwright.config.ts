import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "5000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 360, height: 720 },
  },
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
      },
  projects: [
    {
      // Catch-all for any other e2e spec that isn't part of a more
      // specialized project below (e.g. workspace-isolation,
      // insert-schemas-strip-company-id). Without this, adding
      // narrowly-scoped projects above would silently exclude these
      // from the default `npx playwright test` run.
      name: "default",
      testMatch: /.*\.spec\.ts/,
      testIgnore: [
        /mobile-overflow\.spec\.ts/,
        /dashboard-shell\.spec\.ts/,
        /period-selector\.spec\.ts/,
        /role-based-buttons\.spec\.ts/,
        /role-based-api\.spec\.ts/,
        /quick-actions\.spec\.ts/,
        /email-delivery-alerts\.spec\.ts/,
        /payroll-journal-link\.spec\.ts/,
      ],
    },
    {
      name: "mobile-overflow",
      testMatch: /mobile-overflow\.spec\.ts/,
      use: { viewport: { width: 360, height: 720 } },
    },
    {
      name: "dashboard-shell-setup",
      testMatch: /dashboard-shell\.setup\.ts/,
    },
    {
      name: "dashboard-shell",
      testMatch: /dashboard-shell\.spec\.ts/,
      dependencies: ["dashboard-shell-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: ".playwright/dashboard-state.json",
      },
    },
    {
      name: "period-selector-setup",
      testMatch: /period-selector\.setup\.ts/,
    },
    {
      name: "period-selector",
      testMatch: /period-selector\.spec\.ts/,
      dependencies: ["period-selector-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: ".playwright/period-selector-state.json",
      },
    },
    {
      name: "quick-actions-setup",
      testMatch: /quick-actions\.setup\.ts/,
    },
    {
      name: "quick-actions",
      testMatch: /quick-actions\.spec\.ts/,
      dependencies: ["quick-actions-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: ".playwright/quick-actions-state.json",
      },
    },
    {
      // One-time setup: provisions owner / accountant / viewer test users in
      // a shared workspace and writes per-role storage states under
      // .playwright/role-{role}.json.
      name: "role-based-buttons-setup",
      testMatch: /role-based-buttons\.setup\.ts/,
    },
    {
      // The spec itself loads a different storage state in each describe()
      // block, so we don't pin one here at the project level.
      name: "role-based-buttons",
      testMatch: /role-based-buttons\.spec\.ts/,
      dependencies: ["role-based-buttons-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // API-side companion to `role-based-buttons`. Reuses the same
      // owner / accountant / viewer storage states (and the shared
      // workspace seed: employee, fx rate, two accounts) to assert that
      // the server returns 403 for the wrong role on every endpoint
      // that backs a UI-gated button — see `role-based-api.spec.ts`.
      name: "role-based-api",
      testMatch: /role-based-api\.spec\.ts/,
      dependencies: ["role-based-buttons-setup"],
    },
    {
      // One-time setup that provisions a *dedicated* workspace + a
      // dedicated owner/accountant/viewer trio for the delivery-alert
      // spec. Using a workspace no other spec touches is what keeps the
      // evaluator's exact-count assertions deterministic when Playwright
      // runs spec projects in parallel — the shared workspace from
      // role-based-buttons-setup accrues invitation events from
      // role-based-api that would otherwise leak into the failure window.
      // It also keeps each role pinned to a single membership so the
      // banner's browser-side dismiss call (which can't easily set
      // x-company-id) always lands on the correct workspace.
      name: "email-delivery-alerts-setup",
      testMatch: /email-delivery-alerts\.setup\.ts/,
    },
    {
      // Evaluator + routes + banner coverage for the delivery-alert
      // pipeline (see `email-delivery-alerts.spec.ts`).
      name: "email-delivery-alerts",
      testMatch: /email-delivery-alerts\.spec\.ts/,
      dependencies: ["email-delivery-alerts-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // One-time setup that provisions a dedicated workspace and seeds a
      // posted payroll_run linked to a real journal_entry so the spec can
      // exercise the HR → Journal Entries deep-link bridge end-to-end.
      // See `payroll-journal-link.setup.ts`.
      name: "payroll-journal-link-setup",
      testMatch: /payroll-journal-link\.setup\.ts/,
    },
    {
      // Locks down the past-payroll-runs JE deep link + the
      // out-of-period banner / "Show entry" jump button on
      // /app/journal. See `payroll-journal-link.spec.ts`.
      name: "payroll-journal-link",
      testMatch: /payroll-journal-link\.spec\.ts/,
      dependencies: ["payroll-journal-link-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: ".playwright/payroll-journal-link-state.json",
      },
    },
  ],
});
