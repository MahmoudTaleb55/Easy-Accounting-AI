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
        /email-delivery-alerts-side-channel\.spec\.ts/,
        /email-delivery-alert-bootstrap\.spec\.ts/,
        /email-delivery-csv-export\.spec\.ts/,
        /email-delivery-list-parity\.spec\.ts/,
        /email-delivery-filters-persist\.spec\.ts/,
        /email-delivery-count-cache\.setup\.ts/,
        /email-delivery-count-cache\.spec\.ts/,
        /delivery-alert-audit\.setup\.ts/,
        /delivery-alert-audit\.spec\.ts/,
        /payroll-journal-link\.spec\.ts/,
        /journal-entry-deeplinks\.spec\.ts/,
        /dev-only-routes-production-gate\.spec\.ts/,
        /avatar-crop\.spec\.ts/,
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
      // Filename + header-injection-guard coverage for the
      // /api/auth/email-deliveries?format=csv route. Reuses the same
      // dedicated workspace + owner storage state as the delivery-alert
      // spec (an authenticated owner is all the route needs — it does
      // not depend on any seeded delivery rows).
      name: "email-delivery-csv-export",
      testMatch: /email-delivery-csv-export\.spec\.ts/,
      dependencies: ["email-delivery-alerts-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // Recipient/role + list/count parity coverage for the rewritten
      // /api/auth/email-deliveries list query (see
      // `email-delivery-list-parity.spec.ts`). Reuses the same
      // dedicated workspace + owner storage state as the delivery-alert
      // spec, then seeds invitation + password-reset events directly so
      // the deferred recipient JOIN can be exercised in isolation.
      name: "email-delivery-list-parity",
      testMatch: /email-delivery-list-parity\.spec\.ts/,
      dependencies: ["email-delivery-alerts-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // Regression coverage for the five sticky filters on the email
      // delivery health page (recipient search, status drop-down,
      // trend-window toggle, date-range preset, custom From/To inputs).
      // All round-trip through `useSessionStorageState` — this spec
      // walks every control, reloads, and asserts they rehydrate, plus
      // exercises the helper's validator-rejects-stale-storage branch.
      // Reuses the dedicated owner storage state from
      // `email-delivery-alerts-setup` because the page is owner-only
      // and the dedicated owner has exactly one membership, which is
      // what lets the page mount without us synthesizing
      // `x-company-id` for the browser-side fetches.
      name: "email-delivery-filters-persist",
      testMatch: /email-delivery-filters-persist\.spec\.ts/,
      dependencies: ["email-delivery-alerts-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // One-time setup that provisions a *dedicated* workspace +
      // dedicated owner for the email-delivery-count-cache spec.
      // Sharing the workspace from `email-delivery-alerts-setup` would
      // race the alerts spec (which also wipes/seeds the same event
      // tables for that workspace) once Playwright starts running spec
      // projects in parallel after the shared setup finishes — this
      // dedicated setup keeps the count assertions exact.
      name: "email-delivery-count-cache-setup",
      testMatch: /email-delivery-count-cache\.setup\.ts/,
    },
    {
      // Freshness + per-filter cache-key coverage for the 5s in-memory
      // cache wrapping `countEmailDeliveriesForCompany` (see
      // server/auth/storage.ts).
      name: "email-delivery-count-cache",
      testMatch: /email-delivery-count-cache\.spec\.ts/,
      dependencies: ["email-delivery-count-cache-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // One-time setup that provisions an *isolated* workspace + owner
      // for the `delivery-alert-audit` spec. A dedicated workspace is
      // essential because the spec wipes + seeds alert rows in
      // beforeEach; sharing the workspace with the sibling
      // `email-delivery-alerts` project would race the two specs'
      // resets when Playwright runs them in parallel.
      name: "delivery-alert-audit-setup",
      testMatch: /delivery-alert-audit\.setup\.ts/,
    },
    {
      // Locks in the `Dismissed by` attribution column on the Recent
      // Alerts audit table at /app/settings/email-delivery — proves
      // the dismissed_by_user_id → users join keeps producing a real
      // display name end-to-end. See `delivery-alert-audit.spec.ts`.
      name: "delivery-alert-audit",
      testMatch: /delivery-alert-audit\.spec\.ts/,
      dependencies: ["delivery-alert-audit-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // In-process integration coverage for the email side-channel block
      // inside `evaluateEmailDeliveryAlertsForCompany`. The spec stubs
      // `globalThis.fetch` and runs the evaluator directly (no browser, no
      // dev-server route) so it can assert that `emailEnabled=true`
      // produces one Resend call per owner, persists `emailSent` /
      // `emailRecipients` on the alert row, gracefully tolerates
      // transport failures, and renders the locale-correct subject. Owns
      // its own dedicated workspace + owners (created in `beforeAll`) so
      // it never collides with the e2e `email-delivery-alerts` suite or
      // its setup project.
      name: "email-delivery-alerts-side-channel",
      testMatch: /email-delivery-alerts-side-channel\.spec\.ts/,
    },
    {
      // Defense-in-depth coverage for `ensureEmailDeliveryAlertTablesOnStartup`
      // (server/auth/storage.ts). The spec drops the `cooldown_cleared_at`
      // column from `email_delivery_alert_settings` and the
      // `email_delivery_alert_recipients` table, then re-invokes the
      // helper via `withRlsBypass` and asserts each fragment is restored
      // — pinning the contract that the helper re-stages migrations 0009,
      // 0011, and 0013 on every boot. See
      // `tests/e2e/email-delivery-alert-bootstrap.spec.ts`.
      //
      // Listed as a dependent of every other alert-pipeline project so
      // its drop + restore window can never race a sibling spec that
      // queries the same tables. The drop runs against the live DB
      // because the helper resolves `db` via `server/db.ts`'s pool at
      // module-load time, which can't be redirected to a scratch DB
      // post-import without an unrelated refactor.
      name: "email-delivery-alert-bootstrap",
      testMatch: /email-delivery-alert-bootstrap\.spec\.ts/,
      dependencies: [
        "email-delivery-alerts",
        "email-delivery-alerts-side-channel",
        "email-delivery-csv-export",
        "email-delivery-list-parity",
        "email-delivery-filters-persist",
        "email-delivery-count-cache",
        "delivery-alert-audit",
      ],
    },
    {
      // Locks the test-only `POST /api/dev/email-stub` route and the
      // `?skipCooldown=1` query parameter on the evaluator route off in
      // a production build (see
      // `tests/e2e/dev-only-routes-production-gate.spec.ts`). Runs in a
      // dedicated project because the spec sets
      // `process.env.NODE_ENV = "production"` at the top of the file —
      // isolating it in its own worker prevents that toggle from
      // bleeding into any sibling spec that imports server modules and
      // assumes `NODE_ENV !== "production"`.
      name: "dev-only-routes-production-gate",
      testMatch: /dev-only-routes-production-gate\.spec\.ts/,
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
    {
      // One-time setup that provisions a dedicated workspace and seeds
      // a posted document, posted depreciation run, and impairment
      // event — each linked to its own journal_entry — so the spec can
      // exercise every JE deep-link surface in one pass. See
      // `journal-entry-deeplinks.setup.ts`.
      name: "journal-entry-deeplinks-setup",
      testMatch: /journal-entry-deeplinks\.setup\.ts/,
    },
    {
      // Locks down the JE deep-link contract on /app/inbox and
      // /app/fixed-assets so a future refactor can't silently regress
      // these references back to plain text. See
      // `journal-entry-deeplinks.spec.ts`.
      name: "journal-entry-deeplinks",
      testMatch: /journal-entry-deeplinks\.spec\.ts/,
      dependencies: ["journal-entry-deeplinks-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: ".playwright/je-deeplinks-state.json",
      },
    },
    {
      // One-time setup that provisions a dedicated test user + workspace
      // and clears their stored avatar so the spec always begins from
      // the "no Remove-photo button" starting state. See
      // `avatar-crop.setup.ts`.
      name: "avatar-crop-setup",
      testMatch: /avatar-crop\.setup\.ts/,
    },
    {
      // Locks in the avatar cropper modal contract — Cancel must NOT
      // POST to /api/auth/profile/avatar, Use photo must POST a
      // multipart upload and surface the "Remove photo" button. See
      // `avatar-crop.spec.ts`.
      name: "avatar-crop",
      testMatch: /avatar-crop\.spec\.ts/,
      dependencies: ["avatar-crop-setup"],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: ".playwright/avatar-crop-state.json",
      },
    },
  ],
});
