import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Load .env before any test module so DB-backed tests can read
    // DATABASE_URL (the vitest runner does not use the app's dotenv loader).
    setupFiles: ["./vitest.setup.ts"],
    include: ["client/src/**/*.test.{ts,tsx}", "shared/**/*.test.{ts,tsx}", "server/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "tests/e2e/**"],
    // The DB-backed and S3-backed suites connect to REMOTE services (Neon
    // Postgres, AWS S3) in beforeAll/afterAll. The default 10s hook timeout
    // is too tight for cross-region connects and cold starts, causing
    // spurious "Hook timed out" failures that are network latency, not test
    // defects. 60s accommodates a cold remote connection without masking a
    // genuinely hung test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run test FILES serially. The DB-backed integration suites all share one
    // Neon database and rely on connection-level GUCs (app.current_company_id,
    // app.rls_bypass) set by withCompanyScope / withRlsBypass. Running files
    // in parallel lets concurrent tests see each other's rows and race on
    // those GUCs — e.g. a withRlsBypass insert getting rejected because a
    // sibling test's withCompanyScope was active on a pooled connection, or a
    // cross-workspace read picking up a row another test just created. Mirrors
    // playwright.config.ts's `fullyParallel: false` for the same reason. Pure
    // unit tests are unaffected (just slightly slower overall).
    fileParallelism: false,
  },
});
