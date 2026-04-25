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
    "camera=(), microphone=(self), geolocation=(), payment=()",
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

  // Apply every checked-in `migrations/*.sql` file in order, exactly once,
  // before any of the per-migration boot helpers below. This is the
  // first-class migration runner; the bootstrap helpers that follow are
  // belt-and-suspenders for tables / indexes that the runner has already
  // brought into shape (kept until they can be retired one by one).
  // Adding a new SQL migration only requires dropping the file in
  // `migrations/` — no companion bootstrapper needed. See
  // server/migrate.ts for the runner's idempotency contract.
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

  // Defensive re-apply of migration 0007 (composite FKs). The runner above
  // already applies 0007 on first boot; this stays as a safety net for
  // databases that pre-date the runner and may have been bootstrapped
  // out-of-order in the past.
  try {
    const { applyExtendedCompositeFksOnStartup } = await import(
      "./db-bootstrap-composite-fks"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:composite-fks", () =>
      applyExtendedCompositeFksOnStartup(),
    );
  } catch (err) {
    console.error("Failed to apply extended composite FK migration:", err);
  }

  // Re-apply migration 0005 on boot so the email-delivery-alert tables
  // (`email_delivery_alert_settings`, `email_delivery_alerts`, and the two
  // per-company indexes) materialise on dev databases and on any deploy
  // that boots ahead of the migration runner. Without this a fresh dev DB
  // — and the e2e suite at `tests/e2e/email-delivery-alerts.spec.ts` —
  // blows up on the first read with `relation "email_delivery_alerts"
  // does not exist`. Idempotent.
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
      "Failed to apply email_delivery_alerts (migration 0005) tables:",
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

  // Re-apply migration 0008 on boot so RLS policies materialise on dev
  // databases and on any deploy that boots ahead of the migration runner.
  // Must run BEFORE any bootstrap that writes to RLS-protected tables —
  // those bootstraps wrap themselves in `withRlsBypass`. Idempotent — see
  // docs/design/workspace-isolation-defense-in-depth.md.
  try {
    const { applyWorkspaceRlsOnStartup } = await import(
      "./db-bootstrap-rls"
    );
    await applyWorkspaceRlsOnStartup();
  } catch (err) {
    console.error("Failed to apply workspace RLS migration:", err);
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

  // Normalise any membership/invitation rows that still carry the legacy
  // role vocabulary (admin/reviewer/readonly) onto the canonical
  // owner|accountant|viewer enum. Idempotent — see migration 0003.
  // Touches non-RLS tables (memberships/invitations) but bypass keeps the
  // pattern consistent across boot helpers.
  try {
    const { unifyRoleEnumOnStartup } = await import("./auth/storage");
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:role-enum", () =>
      unifyRoleEnumOnStartup(),
    );
  } catch (err) {
    console.error("Failed to normalise role enum:", err);
  }

  // Re-apply migration 0006 on boot so the retired `workspace_members`
  // mirror table never lingers in dev databases or in deploys that boot
  // ahead of the migration runner. Idempotent.
  try {
    const { dropWorkspaceMembersMirrorOnStartup } = await import("./auth/storage");
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:drop-workspace-members-mirror", () =>
      dropWorkspaceMembersMirrorOnStartup(),
    );
  } catch (err) {
    console.error("Failed to drop workspace_members mirror:", err);
  }

  // Re-apply migrations 0009, 0011 and 0013 on boot so the per-recipient
  // alert outcome table — and the one-shot `cooldown_cleared_at` "Re-arm"
  // column — are in place before the evaluator (and its dedupe / retry
  // passes) tries to read or write them. Idempotent. The 0013 piece is
  // defense-in-depth against the duplicate-prefix migration bug fixed in
  // task #161 (cooldown_cleared started life sharing a `0008_` prefix
  // with `0008_workspace_rls.sql`).
  try {
    const { applyEmailDeliveryAlertRecipientsOnStartup } = await import(
      "./auth/storage"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:email-delivery-alert-recipients", () =>
      applyEmailDeliveryAlertRecipientsOnStartup(),
    );
  } catch (err) {
    console.error(
      "Failed to apply email_delivery_alert_recipients migration:",
      err,
    );
  }

  // Re-apply migration 0012 on boot so the (message_id, created_at)
  // indexes that keep the /api/auth/email-deliveries/count endpoint
  // snappy on long histories materialise on dev databases and on any
  // deploy that boots ahead of the migration runner. Idempotent.
  try {
    const { applyEmailDeliveryEventCountIndexesOnStartup } = await import(
      "./auth/storage"
    );
    const { withRlsBypass } = await import("./db");
    await withRlsBypass("bootstrap:email-delivery-event-count-indexes", () =>
      applyEmailDeliveryEventCountIndexesOnStartup(),
    );
  } catch (err) {
    console.error(
      "Failed to apply email-delivery event count indexes migration:",
      err,
    );
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
