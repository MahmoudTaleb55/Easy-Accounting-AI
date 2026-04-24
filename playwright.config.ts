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
  ],
});
