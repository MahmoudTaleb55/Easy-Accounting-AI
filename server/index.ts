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
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(self), geolocation=(), payment=()",
  );
  if (process.env.NODE_ENV === "production") {
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

  // Re-apply migration 0007 (composite FKs) BEFORE migration 0008 (RLS) so
  // that the table structure the policies attach to is in its final shape.
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

  // Re-apply migration 0009 on boot so the per-recipient alert outcome
  // table is in place before the evaluator (and its dedupe / retry passes)
  // tries to read or write it. Idempotent.
  try {
    const { applyEmailDeliveryAlertRecipientsOnStartup } = await import(
      "./auth/storage"
    );
    await applyEmailDeliveryAlertRecipientsOnStartup();
  } catch (err) {
    console.error(
      "Failed to apply email_delivery_alert_recipients migration:",
      err,
    );
  }

  // Re-apply migration 0010 on boot so the (message_id, created_at)
  // indexes that keep the /api/auth/email-deliveries/count endpoint
  // snappy on long histories materialise on dev databases and on any
  // deploy that boots ahead of the migration runner. Idempotent.
  try {
    const { applyEmailDeliveryEventCountIndexesOnStartup } = await import(
      "./auth/storage"
    );
    await applyEmailDeliveryEventCountIndexesOnStartup();
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
