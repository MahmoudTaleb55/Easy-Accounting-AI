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

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
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

  // Bootstrap IFRS Chart of Accounts and backfill journal entries for legacy data
  try {
    const { ensureIfrsBootstrap } = await import("./init-coa");
    await ensureIfrsBootstrap();
    log("IFRS chart of accounts initialized");
  } catch (err) {
    console.error("Failed to bootstrap IFRS COA:", err);
  }

  // Normalise any membership/invitation rows that still carry the legacy
  // role vocabulary (admin/reviewer/readonly) onto the canonical
  // owner|accountant|viewer enum. Idempotent — see migration 0003.
  try {
    const { unifyRoleEnumOnStartup } = await import("./auth/storage");
    await unifyRoleEnumOnStartup();
  } catch (err) {
    console.error("Failed to normalise role enum:", err);
  }

  // Re-apply migration 0006 on boot so the retired `workspace_members`
  // mirror table never lingers in dev databases or in deploys that boot
  // ahead of the migration runner. Idempotent.
  try {
    const { dropWorkspaceMembersMirrorOnStartup } = await import("./auth/storage");
    await dropWorkspaceMembersMirrorOnStartup();
  } catch (err) {
    console.error("Failed to drop workspace_members mirror:", err);
  }

  // Re-apply migration 0007 on boot so the workspace-isolation composite
  // FKs added for HR / fixed-asset child tables / documents materialise on
  // dev databases and on any deploy that boots ahead of the migration
  // runner. Idempotent — see docs/design/workspace-isolation-defense-in-depth.md.
  try {
    const { applyExtendedCompositeFksOnStartup } = await import(
      "./db-bootstrap-composite-fks"
    );
    await applyExtendedCompositeFksOnStartup();
  } catch (err) {
    console.error("Failed to apply extended composite FK migration:", err);
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
