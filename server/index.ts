import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { rbacMiddleware, registerAuthRoutes as registerTeamRoutes } from "./auth";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerLocalAuthRoutes } from "./auth/local-routes";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "20mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Baseline security headers. We deliberately don't ship a full CSP yet — it
// needs a careful audit of Vite HMR, OpenAI image hosts, and the public
// /objects/avatars proxy — but the headers below are safe everywhere.
//
// X-Frame-Options is intentionally only set in production: the Replit
// workspace preview embeds the dev server inside a cross-origin iframe, and
// any value (DENY *or* SAMEORIGIN) breaks that preview. Production still
// gets full clickjacking protection.
const isProduction = process.env.NODE_ENV === "production";
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=(), payment=()",
  );
  if (isProduction) {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

// API access log. Intentionally does NOT capture response bodies — earlier
// versions echoed the full JSON payload (employee rows, balance sheets,
// chat messages, etc.) into the process log, which is a real PII / financial
// data leakage channel. We log the response shape (size + content type) so
// debugging timeouts/empty responses is still possible.
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let bodyByteLength = 0;
  let bodyKind: "json" | "text" | "buffer" | "stream" | "none" = "none";

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    bodyKind = "json";
    try {
      bodyByteLength = Buffer.byteLength(JSON.stringify(bodyJson) ?? "", "utf8");
    } catch {
      bodyByteLength = -1;
    }
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  const originalResSend = res.send;
  res.send = function (body, ...args) {
    if (bodyKind === "none") {
      if (Buffer.isBuffer(body)) {
        bodyKind = "buffer";
        bodyByteLength = body.length;
      } else if (typeof body === "string") {
        bodyKind = "text";
        bodyByteLength = Buffer.byteLength(body, "utf8");
      }
    }
    return originalResSend.apply(res, [body, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const bodyTag =
        bodyKind === "none"
          ? ""
          : ` :: ${bodyKind}=${bodyByteLength >= 0 ? bodyByteLength + "b" : "?"}`;
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms${bodyTag}`);
    }
  });

  next();
});

(async () => {
  // Auth must be set up BEFORE any routes that depend on session/passport.
  await setupAuth(app);
  // Local auth routes register first so our /api/auth/user shadow (which
  // accepts both OIDC and email+password sessions) wins over the blueprint's.
  registerLocalAuthRoutes(app);
  registerAuthRoutes(app);

  // Attaches `req.member` — a small in-memory projection of the active
  // user's `users` row + `memberships` role — so the `/api/auth/me`
  // identity probe can answer in one place. It does NOT gate writes;
  // write authorization on every /api/* path is enforced inside
  // registerRoutes by the canonical auth/membership system.
  app.use(rbacMiddleware());
  registerTeamRoutes(app);

  await registerRoutes(httpServer, app);

  // Apply every checked-in `migrations/*.sql` file in order, exactly once.
  // This is the first-class migration runner: adding a new SQL migration
  // only requires dropping the file in `migrations/` — no companion
  // bootstrapper needed. See server/migrate.ts for the runner's
  // idempotency contract.
  //
  // The handful of `*OnStartup` boot helpers that survive below this call
  // (`ensureEmailDeliveryAlertTablesOnStartup`,
  // `applyAccountsCodePerWorkspaceOnStartup`,
  // `applyCompanyIdNoDefaultOnStartup`) are kept on a case-by-case basis;
  // every helper that the runner has reliably superseded over multiple
  // releases has been retired (task #165).
  //
  // Migration failure is FATAL — we deliberately do NOT swallow the error.
  // The whole point of task #121 was that a silently-skipped migration lets
  // the app keep running against a drifted schema until something else
  // surfaces the gap. Aborting boot means CI / dev / deploys notice the
  // regression on the next restart instead of in production.
  try {
    const { runPendingMigrations } = await import("./migrate");
    await runPendingMigrations();
  } catch (err) {
    console.error(
      "FATAL: aborting boot — pending SQL migrations could not be applied:",
      err,
    );
    process.exit(1);
  }

  // Re-apply the alert-pipeline DDL on boot so the
  // email-delivery-alert tables materialise on dev databases and on any
  // deploy that boots ahead of the migration runner. Covers
  // `email_delivery_alert_settings` + `email_delivery_alerts` (+ their
  // two indexes) from migration 0009, the per-recipient
  // `email_delivery_alert_recipients` table (+ its two indexes) from
  // migration 0011, and the `cooldown_cleared_at` re-arm column from
  // migration 0013. Without this a fresh dev DB blows up on the first
  // read with `relation "email_delivery_alerts" does not exist`, on the
  // first dedupe lookup with `relation "email_delivery_alert_recipients"
  // does not exist`, or on the first "Re-arm" click with `column
  // "cooldown_cleared_at" does not exist`. Idempotent — the contract is
  // pinned by `tests/e2e/email-delivery-alert-bootstrap.spec.ts`.
  try {
    const { ensureEmailDeliveryAlertTablesOnStartup } = await import(
      "./auth/storage"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:email-delivery-alert-tables", () =>
      ensureEmailDeliveryAlertTablesOnStartup(),
    );
  } catch (err) {
    console.error(
      "Failed to apply email-delivery-alert (0009/0011/0013) tables:",
      err,
    );
  }

  // Re-apply migration 0010 on boot so the per-workspace `(company_id,
  // code)` UNIQUE on `accounts` materialises on dev databases (and on any
  // deploy that boots ahead of the migration runner). Without it the
  // canonical chart of accounts can only be seeded into the first
  // workspace; every subsequent company 23505s on the legacy global
  // UNIQUE on `accounts.code`. Idempotent.
  try {
    const { applyAccountsCodePerWorkspaceOnStartup } = await import(
      "./db-bootstrap-accounts-code-uq"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:accounts-code-uq", () =>
      applyAccountsCodePerWorkspaceOnStartup(),
    );
  } catch (err) {
    console.error(
      "Failed to apply accounts.code per-workspace UNIQUE migration:",
      err,
    );
  }

  // Re-apply migration 0014 on boot — drops the legacy `DEFAULT 1` on
  // `company_id` for every workspace-scoped table that still carried one
  // (accounts, journal_entries, transactions, budgets, settings,
  // employees, attendance, leaves, payroll_runs, chat_messages). Without
  // this, a route handler that forgets to scope an insert by workspace
  // silently lands the row in workspace 1 instead of failing closed —
  // task #122. Idempotent.
  try {
    const { applyCompanyIdNoDefaultOnStartup } = await import(
      "./db-bootstrap-companyid-defaults"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:companyid-defaults", () =>
      applyCompanyIdNoDefaultOnStartup(),
    );
  } catch (err) {
    console.error(
      "Failed to drop legacy company_id defaults:",
      err,
    );
  }

  // Re-apply migration 0016 on boot — adds the `company_id` column to
  // `audit_log`, backfills it from each entity table + the legacy
  // `companyId` change-set stamp, and pins it NOT NULL. The matching
  // `workspace_isolation` policy install for `audit_log` is performed
  // by `bootstrapWorkspaceRlsPolicies` below (since `audit_log` lives
  // in `RLS_TABLES`), so this helper only needs to materialise the
  // column on dev databases that boot ahead of the runner. Wrapped in
  // `withRlsBypass` because the backfill UPDATE walks every
  // workspace's audit rows. Idempotent. See task #169 and
  // docs/design/workspace-isolation-defense-in-depth.md.
  try {
    const { applyAuditLogCompanyIdOnStartup } = await import(
      "./db-bootstrap-audit-log-companyid"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:audit-log-companyid", () =>
      applyAuditLogCompanyIdOnStartup(),
    );
  } catch (err) {
    console.error(
      "Failed to bootstrap audit_log.company_id:",
      err,
    );
  }

  // Task #239 — re-apply ENABLE/FORCE RLS + the canonical
  // `workspace_isolation` policy on every workspace-scoped table from
  // the single-source-of-truth `RLS_TABLES` list. Replaces the
  // `FOREACH t IN ARRAY ARRAY[…]` block that used to live in
  // `migrations/0008_workspace_rls.sql` and the per-table install at
  // the end of `migrations/0016_audit_log_company_id.sql` so the
  // canonical clause text and the table list now exist in exactly one
  // place (`server/db-bootstrap-rls.ts`). Migration 0008 still owns the
  // one-time DDL the helper depends on (`app_api` role,
  // `current_company_id()` / `rls_is_bypassed()` helper functions);
  // the boot helper here owns the per-table loop.
  //
  // The helper runs DDL only (ALTER TABLE … ENABLE/FORCE RLS, DROP/
  // CREATE POLICY), which the connecting role (the table owner)
  // executes directly — no `withRlsBypass` wrapper is needed because
  // RLS policies aren't consulted on policy-management DDL itself.
  // Setting `app.rls_bypass = 'on'` on the same client anyway is
  // belt-and-braces in case a future addition to the helper does a
  // same-connection SELECT/UPDATE on a table whose new policy was
  // already installed earlier in the loop.
  //
  // Idempotent — DROP POLICY IF EXISTS + CREATE POLICY runs every boot
  // so a hand-edit in prod (or an older migration) that drifted from
  // canonical is automatically re-converged.
  //
  // RLS bootstrap failure is FATAL — same standard as the migration
  // runner above. `workspace_isolation` is the core tenant-boundary
  // control: if we can't (re)install it on every table in `RLS_TABLES`,
  // continuing to serve traffic risks cross-workspace data exposure on
  // any code path that relies on RLS as the last line of defense
  // (audit_log writes, the cross-workspace e2e contract, etc.). Aborting
  // boot lets CI / dev / deploys notice the regression on the next
  // restart instead of in production.
  try {
    const { bootstrapWorkspaceRlsPolicies } = await import(
      "./db-bootstrap-rls"
    );
    const { pool } = await import("./db");
    const client = await pool.connect();
    try {
      await client.query(`SET app.rls_bypass = 'on'`);
      await client.query("BEGIN");
      try {
        await bootstrapWorkspaceRlsPolicies(client);
        await client.query("COMMIT");
      } catch (innerErr) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection may be unusable; release recycles it */
        }
        throw innerErr;
      }
    } finally {
      try {
        await client.query(`RESET app.rls_bypass`);
      } catch {
        /* connection may be unusable; release recycles it */
      }
      client.release();
    }
  } catch (err) {
    console.error(
      "FATAL: aborting boot — workspace_isolation RLS policies could not be installed:",
      err,
    );
    process.exit(1);
  }

  // Bootstrap IFRS Chart of Accounts and backfill journal entries for legacy
  // data. Reads / writes across every workspace, so it runs under bypass.
  try {
    const { ensureIfrsBootstrap } = await import("./init-coa");
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:ifrs-coa", () => ensureIfrsBootstrap());
    log("IFRS chart of accounts initialized");
  } catch (err) {
    console.error("Failed to bootstrap IFRS COA:", err);
  }

  // Background sweep that turns the failure-class delivery trends into a
  // banner / email when a workspace's threshold trips. Disabled in test runs
  // so e2e specs can call the evaluator deterministically.
  if (process.env.NODE_ENV !== "test") {
    try {
      const { startEmailDeliveryAlertJob } = await import(
        "./auth/email-delivery-alerts"
      );
      startEmailDeliveryAlertJob();
    } catch (err) {
      console.error("Failed to start email delivery alert job:", err);
    }
  }

  // Production-side runtime guard for the workspace_isolation RLS policies
  // (task #238). The CI spec at
  // tests/e2e/database-rls-policy-coverage.spec.ts catches a tampered
  // policy in the test/dev DB; this sweep runs the same canonical-
  // expression detector against the *live* DB on a periodic schedule, so
  // a hand-edited `ALTER POLICY workspace_isolation … USING (true)` in
  // production is alerted on even though the spec never runs there. See
  // docs/design/workspace-isolation-defense-in-depth.md ("Production
  // drift sweep"). Disabled in test runs for the same reason as the
  // email-delivery sweep.
  if (process.env.NODE_ENV !== "test") {
    try {
      const { startRlsPolicyDriftJob } = await import(
        "./auth/rls-policy-drift-alerts"
      );
      startRlsPolicyDriftJob();
    } catch (err) {
      console.error("Failed to start RLS policy drift sweep:", err);
    }
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
