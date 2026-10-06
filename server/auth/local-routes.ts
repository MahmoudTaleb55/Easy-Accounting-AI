import type { Express, NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import {
  ALLOWED_AVATAR_MIME_TYPES,
  InvalidAvatarImageError,
  MAX_AVATAR_BYTES,
  saveAvatarFile,
} from "../services/avatar-storage";
import {
  signUpSchema,
  signInSchema,
  requestResetSchema,
  confirmResetSchema,
  inviteSchema,
  updateMemberRoleSchema,
  updateProfileSchema,
  changePasswordSchema,
  upsertEmailDeliveryAlertSettingsSchema,
  ROLES,
  type Role,
} from "@shared/schema";
import { authBizStorage, hashPassword, verifyPassword } from "./storage";
import { withUnscopedDb } from "../db";
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  normalizeLocale,
} from "./email";
import { createRequire } from "node:module";
import {
  evaluateEmailDeliveryAlertsForCompany,
  retryEmailDeliveryAlertRecipient,
  getDedupeHours,
  getRetryMinutes,
} from "./email-delivery-alerts";
import {
  requireAuth,
  loadMembership,
  requireRole,
  getUserIdOrThrow,
  resolveActiveCompanyId,
} from "./middleware";

/** Build a passport-compatible session payload for a local user. */
function buildLocalSession(user: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null }) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    provider: "local" as const,
  };
}

/**
 * Trusted public base URL for links embedded in outbound emails
 * (password-reset, invitation accept).
 *
 * SECURITY (scan finding, host-header injection → AUTHENTICATION_BYPASS):
 * these links MUST NOT be built from `req.get("host")` / `req.protocol`. The
 * Host header is attacker-controlled — a request with `Host: evil.com` would
 * cause a victim's password-reset email to carry `https://evil.com/reset-
 * password/<valid-token>`, handing the token to the attacker when clicked.
 * We derive the origin from server-trusted configuration instead. Matches the
 * convention already used by email-delivery-alerts.ts (PUBLIC_APP_URL) and
 * oidcAuth.ts (APP_URL).
 */
function appBaseUrl(): string {
  const base =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://localhost:5000";
  return base.replace(/\/+$/, "");
}

/**
 * Strip secret fields before returning a user row to the client.
 *
 * SECURITY (scan finding, INFORMATION_DISCLOSURE): the storage layer selects
 * the full `users` row, which includes `passwordHash`. Returning that verbatim
 * shipped the bcrypt hash to the browser on signup/signin/get-user/profile
 * responses. Always pass user rows through this before res.json().
 */
function sanitizeUser<T extends { passwordHash?: unknown } | null | undefined>(
  user: T,
): T extends null | undefined ? T : Omit<NonNullable<T>, "passwordHash"> {
  if (!user) return user as any;
  const { passwordHash: _omit, ...safe } = user as Record<string, unknown>;
  return safe as any;
}

// Hard ceiling on a single CSV export of the email-delivery feed. Surfaced
// to the client via /count so the UI can warn when the export will be
// truncated.
const EMAIL_DELIVERY_EXPORT_CAP = 10000;

/**
 * Read the dev-only `?skipCooldown` query parameter on the
 * `/api/auth/email-delivery-alerts/evaluate` route. Hard-gated to
 * non-production NODE_ENV — production builds always return `false` so a
 * real workspace cannot use the bypass to spam owners by re-firing the
 * evaluator inside the cooldown window.
 *
 * Exported so the production-gate spec can lock the gate in with a unit
 * test (see `tests/e2e/dev-only-routes-production-gate.spec.ts`).
 */
export function readDevSkipCooldownFromQuery(
  query: { skipCooldown?: unknown },
): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return query.skipCooldown === "1" || query.skipCooldown === "true";
}

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-up attempts. Please try again later." },
});
const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Please try again later." },
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests." },
});
// Confirming a reset (token + new password) is also rate limited to deter
// brute-forcing of reset tokens.
const resetConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many reset attempts. Please try again later." },
});
// Accepting an invitation token is rate limited to deter token enumeration.
const inviteAcceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many invitation attempts. Please try again later." },
});

/**
 * Send an invitation email; if the transport is not configured or the
 * send fails, log the link so an admin can recover it. Never throws.
 */
async function sendInvitationOrLog(
  inv: { id: string; email: string; role: string; companyId: number; invitedByUserId: string },
  link: string,
): Promise<{ ok: boolean }> {
  try {
    const [company, inviter] = await Promise.all([
      authBizStorage.getCompanyById(inv.companyId).catch(() => undefined),
      authBizStorage.getUserById(inv.invitedByUserId).catch(() => undefined),
    ]);
    const inviterName = inviter
      ? [inviter.firstName, inviter.lastName].filter(Boolean).join(" ").trim() || inviter.email || null
      : null;
    const result = await sendInvitationEmail({
      to: inv.email,
      link,
      role: inv.role,
      companyName: company?.name ?? null,
      inviterName,
      // Invitee may not exist yet — fall back to the inviter's locale.
      locale: normalizeLocale(inviter?.preferredLocale),
    });
    // Record an outbound-attempt row + denormalize to the invitation so the
    // UI can show a Sent/Failed badge before any webhook arrives.
    if (result.ok) {
      await Promise.all([
        authBizStorage.recordInvitationEmailEvent({
          invitationId: inv.id,
          messageId: result.id,
          type: "sent",
        }),
        authBizStorage.updateInvitationEmailMeta(inv.id, {
          messageId: result.id,
          status: "sent",
          error: null,
        }),
      ]);
    } else {
      const status = result.reason === "not_configured" ? "not_configured" : "send_failed";
      await Promise.all([
        authBizStorage.recordInvitationEmailEvent({
          invitationId: inv.id,
          type: status,
          error: result.error ?? result.reason,
        }),
        authBizStorage.updateInvitationEmailMeta(inv.id, {
          messageId: null,
          status,
          error: result.error ?? result.reason,
        }),
      ]);
    }
    if (!result.ok) {
      // Never log the tokenized invitation link in production — it would
      // let anyone with log access claim a workspace seat. Only emit
      // generic metadata in production; full link only in dev.
      if (process.env.NODE_ENV === "production") {
        if (result.reason === "not_configured") {
          console.error("[auth] invitation email not sent: transport not configured");
        } else {
          console.error(`[auth] invitation email send failed (${result.error ?? "unknown"})`);
        }
      } else {
        if (result.reason === "not_configured") {
          console.warn(`[auth] email transport not configured; invitation link for ${inv.email}: ${link}`);
        } else {
          console.error(`[auth] failed to send invitation to ${inv.email}: ${result.error}`);
        }
      }
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[auth] invitation email error for ${inv.email}:`, err);
    return { ok: false };
  }
}

function handleZod(err: unknown, res: Response): boolean {
  if (err instanceof z.ZodError) {
    res.status(400).json({ message: err.errors[0]?.message ?? "Invalid input", field: err.errors[0]?.path?.join(".") });
    return true;
  }
  return false;
}

export function registerLocalAuthRoutes(app: Express) {
  // Defense for task #321: every route registered in this file (and the
  // Resend webhook below) operates on auth-tier tables that are
  // *intentionally* out of `workspace_isolation` RLS scope (see
  // `docs/design/workspace-isolation-defense-in-depth.md` →
  // "Tables intentionally out of scope" — `users`, `memberships`,
  // `invitations`, `password_reset_*`, `email_delivery_*`, sessions).
  //
  // Because `registerLocalAuthRoutes` is mounted *before* the global
  // `/api` gate in `server/index.ts`, the global `withCompanyScope`
  // wrapper never runs for these handlers, so each `db.` call inside
  // would otherwise trip the task #193 runtime guard
  // (`WORKSPACE_ISOLATION_GUARD=throw`) and throw mid-handler.
  //
  // Mark the request as deliberate-unscoped at the very front of this
  // file's middleware chain so the runtime guard stays silent for every
  // handler below — without granting any RLS bypass. The `withUnscopedDb`
  // marker is preserved by `AsyncLocalStorage` across every async
  // continuation spawned inside `next()`, so a single mount point covers
  // the whole file. Per-handler `withUnscopedDb(...)` calls below are
  // kept as documentation/grep anchors for the highest-traffic auth
  // endpoints (signup/signin/etc.) and remain a no-op overlay.
  const AUTH_LOCAL_PREFIXES = ["/api/auth/", "/api/webhooks/resend"] as const;
  app.use((req, res, next) => {
    if (
      !AUTH_LOCAL_PREFIXES.some(
        (p) => req.path === p || req.path.startsWith(p),
      )
    ) {
      return next();
    }
    void withUnscopedDb(
      "auth:local-routes",
      () =>
        new Promise<void>((resolve) => {
          res.on("finish", resolve);
          res.on("close", resolve);
          next();
        }),
    );
  });

  // ---------- email + password sign-up ----------
  app.post("/api/auth/signup", signupLimiter, async (req, res, next) => {
    // Pre-membership: there is no workspace to scope to yet — the whole
    // point is to create the user (and, on first signup, their first
    // workspace). Wrap in `withUnscopedDb` so the task #193 runtime guard
    // (server/db.ts) does not flag the `users` / `invitations` /
    // `memberships` lookups that happen here. The reason string doubles
    // as a grep marker for the audited unscoped paths.
    return withUnscopedDb("auth:signup", async () => {
      try {
        const input = signUpSchema.parse(req.body);
        const existing = await authBizStorage.getUserByEmail(input.email);
        if (existing) {
          return res.status(409).json({ message: "هذا البريد الإلكتروني مسجل بالفعل / Email already registered", field: "email" });
        }

        const passwordHash = await hashPassword(input.password);
        const user = await authBizStorage.createLocalUser({
          email: input.email,
          passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          preferredLocale: input.preferredLocale ?? "ar",
        });

        // If the signup carries an invitation token, accept it (creates membership for that company).
        let bootstrapped: "adopted" | "created" | "invited" = "created";
        if (input.invitationToken) {
          const inv = await authBizStorage.getInvitationByToken(input.invitationToken);
          if (
            inv &&
            inv.status === "pending" &&
            inv.expiresAt.getTime() > Date.now() &&
            inv.email.toLowerCase() === user.email!.toLowerCase()
          ) {
            await authBizStorage.createMembership({ userId: user.id, companyId: inv.companyId, role: inv.role as Role });
            await authBizStorage.acceptInvitation(inv.token, user.id);
            bootstrapped = "invited";
          }
        }
        if (bootstrapped === "created") {
          const display = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email!;
          await authBizStorage.bootstrapWorkspaceForUser(user.id, display, {
            currencyCode: input.currencyCode,
          });
        }

        const session = buildLocalSession(user);
        req.login(session, (err) => {
          if (err) return next(err);
          res.status(201).json({ user: sanitizeUser(user), bootstrapped });
        });
      } catch (err) {
        if (handleZod(err, res)) return;
        next(err);
      }
    });
  });

  // ---------- email + password sign-in ----------
  app.post("/api/auth/signin", signinLimiter, async (req, res, next) => {
    // Pre-membership: user identity is verified from the email/password
    // pair *before* any workspace can be selected. The lookups touch the
    // auth-tier `users` / `memberships` tables which are intentionally out
    // of `workspace_isolation` RLS scope; wrap in `withUnscopedDb` to
    // silence the task #193 runtime guard while keeping a grep-able
    // audit marker.
    return withUnscopedDb("auth:signin", async () => {
      try {
        const input = signInSchema.parse(req.body);
        const user = await authBizStorage.getUserByEmail(input.email);
        if (!user || !user.passwordHash) {
          return res.status(401).json({ message: "بيانات الدخول غير صحيحة / Invalid credentials" });
        }
        const ok = await verifyPassword(input.password, user.passwordHash);
        if (!ok) {
          return res.status(401).json({ message: "بيانات الدخول غير صحيحة / Invalid credentials" });
        }

        // Ensure the user has at least one workspace (legacy users created before bootstrap).
        const memberships = await authBizStorage.listMembershipsForUser(user.id);
        if (memberships.length === 0) {
          const display = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email!;
          await authBizStorage.bootstrapWorkspaceForUser(user.id, display);
        }

        const session = buildLocalSession(user);
        req.login(session, (err) => {
          if (err) return next(err);
          res.json({ user: sanitizeUser(user) });
        });
      } catch (err) {
        if (handleZod(err, res)) return;
        next(err);
      }
    });
  });

  // ---------- session sign-out (POST so SPA can call from JS) ----------
  app.post("/api/auth/signout", (req, res) => {
    req.logout(() => {
      req.session?.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ ok: true });
      });
    });
  });

  // ---------- request password reset ----------
  app.post("/api/auth/forgot-password", resetLimiter, async (req, res) => {
    // Pre-membership: callers know an email but no workspace id (and we
    // explicitly do not want to leak whether the email is registered, so
    // we cannot return a 401/404 to "force" the caller to authenticate).
    // Wrap in `withUnscopedDb` so the task #193 runtime guard does not
    // flag the legitimate `users` / `password_reset_tokens` writes here.
    return withUnscopedDb("auth:forgot-password", async () => {
    try {
      const { email } = requestResetSchema.parse(req.body);
      const user = await authBizStorage.getUserByEmail(email);
      // Always return ok to prevent email enumeration.
      const isProd = process.env.NODE_ENV === "production";
      if (user && user.provider === "local") {
        const { id: tokenId, token } = await authBizStorage.createPasswordResetToken(user.id);
        const link = `${appBaseUrl()}/reset-password/${token}`;

        // Try to send a real branded email when a transport is configured.
        const result = await sendPasswordResetEmail({
          to: user.email!,
          link,
          firstName: user.firstName ?? null,
          locale: normalizeLocale(user.preferredLocale),
        });

        // Mirror the invitation pattern: record one event per send attempt
        // and denormalize the latest status onto the token row so admins
        // can answer "did the reset email go out?" without scraping logs.
        if (result.ok) {
          await Promise.all([
            authBizStorage.recordPasswordResetEmailEvent({
              tokenId,
              userId: user.id,
              messageId: result.id,
              type: "sent",
            }),
            authBizStorage.updatePasswordResetEmailMeta(tokenId, {
              messageId: result.id,
              status: "sent",
              error: null,
            }),
          ]);
        } else {
          const status = result.reason === "not_configured" ? "not_configured" : "send_failed";
          await Promise.all([
            authBizStorage.recordPasswordResetEmailEvent({
              tokenId,
              userId: user.id,
              type: status,
              error: result.error ?? result.reason,
            }),
            authBizStorage.updatePasswordResetEmailMeta(tokenId, {
              messageId: null,
              status,
              error: result.error ?? result.reason,
            }),
          ]);
        }

        if (!result.ok) {
          // Never log the tokenized link in production — it grants account
          // takeover to anyone with log access. Only emit generic metadata.
          if (isProd) {
            if (result.reason === "not_configured") {
              console.error("[auth] password reset email not sent: transport not configured");
            } else {
              console.error(`[auth] password reset email send failed (${result.error ?? "unknown"})`);
            }
          } else {
            if (result.reason === "not_configured") {
              console.warn(
                `[auth] email transport not configured; password reset link for ${email}: ${link}`,
              );
            } else {
              console.error(`[auth] failed to send password reset email to ${email}: ${result.error}`);
            }
            return res.json({ ok: true, devResetLink: link });
          }
        }
      }
      res.json({ ok: true });
    } catch (err) {
      if (handleZod(err, res)) return;
      throw err;
    }
    });
  });

  // ---------- confirm reset ----------
  app.post("/api/auth/reset-password", resetConfirmLimiter, async (req, res) => {
    // Pre-membership: a password-reset token only identifies a user, not
    // a workspace. Wrap in `withUnscopedDb` so the runtime guard does
    // not flag the `password_reset_tokens` consume + `users` password
    // update + session-sweep that this handler legitimately performs.
    return withUnscopedDb("auth:reset-password", async () => {
      try {
        const { token, password } = confirmResetSchema.parse(req.body);
        const consumed = await authBizStorage.consumePasswordResetToken(token);
        if (!consumed) return res.status(400).json({ message: "رمز الاستعادة غير صالح أو منتهي / Invalid or expired token" });
        const passwordHash = await hashPassword(password);
        await authBizStorage.setPasswordHash(consumed.userId, passwordHash);
        // Invalidate all existing sessions for this user as a security best practice.
        await authBizStorage.deleteSessionsForUserExcept(consumed.userId);
        res.json({ ok: true });
      } catch (err) {
        if (handleZod(err, res)) return;
        throw err;
      }
    });
  });

  // ---------- bootstrap a workspace for OIDC sessions on first hit ----------
  // The blueprint's /api/auth/user returns the user row. We extend it: if the
  // signed-in OIDC user has no membership yet, create/adopt a workspace.
  app.use("/api/auth/user", async (req, _res, next) => {
    // Pre-membership: this hook fires before the user's first workspace
    // exists (and is the moment we create it for fresh OIDC accounts).
    // The `users` / `memberships` reads here are intentionally outside
    // workspace scope; wrap in `withUnscopedDb` so the runtime guard
    // does not flag this every-request bootstrap path.
    await withUnscopedDb("auth:user-bootstrap-on-first-hit", async () => {
      try {
        const user = req.user as any;
        if (req.isAuthenticated() && user?.id && user.provider !== "local") {
          const id = user.id as string;
          const u = await authBizStorage.getUserById(id);
          if (u) {
            const ms = await authBizStorage.listMembershipsForUser(id);
            if (ms.length === 0) {
              const display = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "User";
              await authBizStorage.bootstrapWorkspaceForUser(id, display);
            }
          }
        }
      } catch (err) {
        console.error("workspace bootstrap error:", err);
      }
    });
    next();
  });

  // ---------- current user (override the blueprint route to also accept local sessions) ----------
  app.get("/api/auth/user", requireAuth, async (req, res) => {
    // `/api/auth/user` is in PUBLIC_API_PREFIXES (server/routes.ts) so
    // the global gate does not attach a workspace scope before this
    // handler runs — even authenticated users hit it without scope.
    // The `users` table is auth-tier (intentionally out of workspace
    // RLS scope), so wrap in `withUnscopedDb` to keep the audit trail
    // explicit and avoid tripping the runtime guard.
    return withUnscopedDb("auth:get-current-user", async () => {
      try {
        const userId = getUserIdOrThrow(req);
        const user = await authBizStorage.getUserById(userId);
        res.json(sanitizeUser(user));
      } catch (err) {
        console.error("Error fetching user:", err);
        res.status(500).json({ message: "Failed to fetch user" });
      }
    });
  });

  // ---------- list my memberships (drives company switcher + permissions) ----------
  app.get("/api/auth/memberships", requireAuth, async (req, res) => {
    // The whole point of this endpoint is "what workspaces can this user
    // see?" — so it inherently spans every workspace the user holds a
    // membership in, not just the active scope. `memberships` is
    // intentionally out of `workspace_isolation` RLS scope; wrap in
    // `withUnscopedDb` so the runtime guard doesn't flag this even when
    // the global gate happened to attach a workspace scope first.
    return withUnscopedDb("auth:list-my-memberships", async () => {
      const userId = getUserIdOrThrow(req);
      const rows = await authBizStorage.listMembershipsForUser(userId);
      const active = await resolveActiveCompanyId(req, userId);
      res.json({ memberships: rows, activeCompanyId: active });
    });
  });

  // ---------- profile ----------
  app.patch("/api/auth/profile", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserIdOrThrow(req);
      const patch = updateProfileSchema.parse(req.body);
      const u = await authBizStorage.updateUser(userId, patch);
      res.json(sanitizeUser(u));
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  // ---------- avatar upload ----------
  // Avatar files are persisted by `saveAvatarFile` to private S3 when
  // configured (or the legacy local fallback) and served through the
  // authenticated /objects/avatars/* route. We use multer's memory storage because the
  // file is small (<= 2 MB) and the avatar-storage helper hashes the
  // buffer for dedupe before pushing it to the bucket.
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AVATAR_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
        return cb(new Error("Only image uploads are supported (PNG, JPEG, WEBP, GIF)."));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/auth/profile/avatar",
    requireAuth,
    avatarUpload.single("file"),
    async (req, res, next) => {
      try {
        const userId = getUserIdOrThrow(req);
        const file = req.file;
        if (!file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        const saved = await saveAvatarFile({
          userId,
          buffer: file.buffer,
          mimeType: file.mimetype,
        });
        const u = await authBizStorage.updateUser(userId, { profileImageUrl: saved.publicUrl });
        res.json(sanitizeUser(u));
      } catch (err) {
        if (err instanceof InvalidAvatarImageError) {
          return res.status(400).json({ message: err.message });
        }
        next(err);
      }
    },
  );

  // Multer / fileFilter errors → 400 instead of 500, matching the
  // /api/documents handler's behaviour so the client can surface them.
  app.use(
    "/api/auth/profile/avatar",
    (err: any, _req: Request, res: Response, next: NextFunction) => {
      if (err && err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            message: "Image is too large. Maximum size is 2 MB.",
          });
        }
        return res.status(400).json({ message: err.message });
      }
      if (err instanceof InvalidAvatarImageError) {
        return res.status(400).json({ message: err.message });
      }
      if (err && /Only image uploads/.test(err.message)) {
        return res.status(400).json({ message: err.message });
      }
      return next(err);
    },
  );

  // Avatar bytes are served by the authenticated /objects/avatars/:userId/:filename
  // route registered in server/routes.ts.

  app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserIdOrThrow(req);
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const u = await authBizStorage.getUserById(userId);
      if (!u || u.provider !== "local" || !u.passwordHash) {
        return res.status(400).json({ message: "Password change not available for this account" });
      }
      const ok = await verifyPassword(currentPassword, u.passwordHash);
      if (!ok) return res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة / Current password is incorrect", field: "currentPassword" });
      await authBizStorage.setPasswordHash(userId, await hashPassword(newPassword));
      // Keep the current session, sign out everywhere else.
      await authBizStorage.deleteSessionsForUserExcept(userId, (req as any).sessionID);
      res.json({ ok: true });
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  // ---------- active sessions (profile page security panel) ----------
  app.get("/api/auth/sessions", requireAuth, async (req, res) => {
    const userId = getUserIdOrThrow(req);
    const rows = await authBizStorage.listSessionsForUser(userId, (req as any).sessionID);
    res.json(rows);
  });

  app.post("/api/auth/sessions/sign-out-others", requireAuth, async (req, res) => {
    const userId = getUserIdOrThrow(req);
    await authBizStorage.deleteSessionsForUserExcept(userId, (req as any).sessionID);
    res.json({ ok: true });
  });

  // ---------- members management (owner only) ----------
  app.get("/api/auth/members", requireAuth, requireRole("owner"), async (req, res) => {
    const ctx = (req as any).membership!;
    const rows = await authBizStorage.listMembersForCompany(ctx.companyId);
    res.json(rows);
  });

  app.patch("/api/auth/members/:id", requireAuth, requireRole("owner"), async (req, res, next) => {
    try {
      const ctx = (req as any).membership!;
      const { role } = updateMemberRoleSchema.parse(req.body);
      const all = await authBizStorage.listMembersForCompany(ctx.companyId);
      const target = all.find((m) => m.id === String(req.params.id));
      if (!target) return res.status(404).json({ message: "Member not found" });
      // Don't allow demoting the last owner.
      if (target.role === "owner" && role !== "owner") {
        const owners = await authBizStorage.countOwnersForCompany(ctx.companyId);
        if (owners <= 1) return res.status(400).json({ message: "Cannot demote the only owner" });
      }
      const m = await authBizStorage.updateMembershipRole(String(req.params.id), role as Role);
      res.json(m);
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  app.get("/api/auth/members/:id/activity", requireAuth, requireRole("owner"), async (req, res) => {
    const ctx = (req as any).membership!;
    const all = await authBizStorage.listMembersForCompany(ctx.companyId);
    const target = all.find((m) => m.id === String(req.params.id));
    if (!target) return res.status(404).json({ message: "Member not found" });
    const [sessions, passwordResetTokens] = await Promise.all([
      authBizStorage.listSessionsForUser(target.userId),
      authBizStorage.listPasswordResetTokensForUser(target.userId),
    ]);
    res.json({
      member: { id: target.id, userId: target.userId, role: target.role, user: target.user },
      sessions,
      passwordResetTokens,
    });
  });

  // Per password-reset-token lifecycle log (admin-only). Mirrors the invitation
  // events route so the Members UI can render the same timeline drawer for
  // password-reset emails. Scoped to the admin's workspace.
  app.get(
    "/api/auth/password-reset-tokens/:id/events",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const token = await authBizStorage.getPasswordResetTokenById(String(req.params.id));
      if (!token) return res.status(404).json({ message: "Token not found" });
      const members = await authBizStorage.listMembersForCompany(ctx.companyId);
      if (!members.some((m) => m.userId === token.userId)) {
        return res.status(404).json({ message: "Token not found" });
      }
      const events = await authBizStorage.listPasswordResetEmailEventsForToken(token.id);
      res.json(events);
    },
  );

  app.delete("/api/auth/members/:id", requireAuth, requireRole("owner"), async (req, res) => {
    const ctx = (req as any).membership!;
    const all = await authBizStorage.listMembersForCompany(ctx.companyId);
    const target = all.find((m) => m.id === String(req.params.id));
    if (!target) return res.status(404).json({ message: "Member not found" });
    if (target.role === "owner") {
      const owners = await authBizStorage.countOwnersForCompany(ctx.companyId);
      if (owners <= 1) return res.status(400).json({ message: "Cannot remove the only owner" });
    }
    await authBizStorage.deleteMembership(String(req.params.id));
    res.status(204).send();
  });

  // ---------- invitations ----------
  app.get("/api/auth/invitations", requireAuth, requireRole("owner"), async (req, res) => {
    const ctx = (req as any).membership!;
    const rows = await authBizStorage.listInvitationsForCompany(ctx.companyId);
    res.json(rows);
  });

  app.post("/api/auth/invitations", requireAuth, requireRole("owner"), async (req, res, next) => {
    try {
      const ctx = (req as any).membership!;
      const input = inviteSchema.parse(req.body);
      const inv = await authBizStorage.createInvitation({
        companyId: ctx.companyId,
        invitedByUserId: ctx.userId,
        email: input.email,
        role: input.role as Role,
      });
      const link = `${appBaseUrl()}/accept-invitation/${inv.token}`;
      const emailResult = await sendInvitationOrLog(inv, link);
      res.status(201).json({ invitation: inv, link, emailSent: emailResult.ok });
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  app.post("/api/auth/invitations/:id/resend", requireAuth, requireRole("owner"), async (req, res) => {
    // SECURITY (scan finding, IDOR): requireRole("owner") only proves the
    // caller owns SOME workspace. Bind :id to the caller's active workspace so
    // an owner of workspace A can't resend/revoke/read invitations of
    // workspace B by guessing the id.
    const ctx = (req as any).membership!;
    const target = await authBizStorage.getInvitationById(String(req.params.id));
    if (!target || target.companyId !== ctx.companyId) {
      return res.status(404).json({ message: "Invitation not found" });
    }
    const inv = await authBizStorage.resendInvitation(String(req.params.id));
    const link = `${appBaseUrl()}/accept-invitation/${inv.token}`;
    const emailResult = await sendInvitationOrLog(inv, link);
    res.json({ invitation: inv, link, emailSent: emailResult.ok });
  });

  app.delete("/api/auth/invitations/:id", requireAuth, requireRole("owner"), async (req, res) => {
    const ctx = (req as any).membership!;
    const target = await authBizStorage.getInvitationById(String(req.params.id));
    if (!target || target.companyId !== ctx.companyId) {
      return res.status(404).json({ message: "Invitation not found" });
    }
    await authBizStorage.revokeInvitation(String(req.params.id));
    res.status(204).send();
  });

  // Public preview of an invitation by token (no auth required, used by sign-up form).
  app.get("/api/auth/invitations/by-token/:token", async (req, res) => {
    // Public route in PUBLIC_API_PREFIXES — runs without any workspace
    // scope. The lookup uses an opaque random token (32 bytes of
    // crypto.randomBytes hex) which is unguessable; revealing the
    // companyId for a known-pending invitation token to its bearer is
    // the whole point of the endpoint. Wrap in `withUnscopedDb` so the
    // runtime guard doesn't flag this audited cross-tenant lookup.
    return withUnscopedDb("auth:invitation-by-token", async () => {
      const inv = await authBizStorage.getInvitationByToken(req.params.token);
      if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) {
        return res.status(404).json({ message: "Invitation not found or expired" });
      }
      res.json({ email: inv.email, role: inv.role, companyId: inv.companyId });
    });
  });

  // Authenticated accept (for users who are already signed-in and click the link).
  app.post("/api/auth/invitations/accept", inviteAcceptLimiter, requireAuth, async (req, res) => {
    const userId = getUserIdOrThrow(req);
    const token = String(req.body?.token ?? "");
    const inv = await authBizStorage.getInvitationByToken(token);
    if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "Invitation is no longer valid" });
    }
    const u = await authBizStorage.getUserById(userId);
    if (!u?.email || u.email.toLowerCase() !== inv.email.toLowerCase()) {
      return res.status(403).json({ message: "Invitation email does not match your account" });
    }
    const existing = await authBizStorage.getMembership(userId, inv.companyId);
    if (!existing) {
      await authBizStorage.createMembership({ userId, companyId: inv.companyId, role: inv.role as Role });
    }
    await authBizStorage.acceptInvitation(token, userId);
    res.json({ companyId: inv.companyId, role: inv.role });
  });

  // Per-invitation lifecycle log (admin-only). Powers the "why did this fail?"
  // tooltip / drilldown in the Members UI.
  app.get("/api/auth/invitations/:id/events", requireAuth, requireRole("owner"), async (req, res) => {
    // SECURITY (scan finding, IDOR): bind :id to the caller's workspace before
    // revealing another workspace's invitation delivery history.
    const ctx = (req as any).membership!;
    const target = await authBizStorage.getInvitationById(String(req.params.id));
    if (!target || target.companyId !== ctx.companyId) {
      return res.status(404).json({ message: "Invitation not found" });
    }
    const events = await authBizStorage.listInvitationEmailEvents(String(req.params.id));
    res.json(events);
  });

  // Unified delivery-health feed across every transactional email transport
  // in this workspace. Backs the /settings/email-delivery admin page.
  // One row per send attempt (keyed by provider message id, or local
  // attempt id when the send failed pre-dispatch).
  app.get("/api/auth/email-deliveries", requireAuth, requireRole("owner"), async (req, res) => {
    const ctx = (req as any).membership!;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const email = typeof req.query.email === "string" ? req.query.email : null;
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    const wantsCsv = req.query.format === "csv";
    // CSV exports for compliance reviewers can legitimately span weeks or
    // months, so allow them to pull more rows than the on-screen list. The
    // hard ceiling is enforced in the storage layer.
    const defaultLimit = wantsCsv ? EMAIL_DELIVERY_EXPORT_CAP : 200;
    const maxLimit = wantsCsv ? EMAIL_DELIVERY_EXPORT_CAP : 500;
    const limit = Number.isFinite(Number(req.query.limit))
      ? Number(req.query.limit)
      : defaultLimit;
    const rows = await authBizStorage.listEmailDeliveriesForCompany(ctx.companyId, {
      status,
      email,
      from,
      to,
      limit,
      maxLimit,
    });
    if (wantsCsv) {
      const header = [
        "transport",
        "recipient",
        "status",
        "error",
        "last_event_at",
        "message_id",
        "created_at",
      ];
      const lines = [header.join(",")];
      for (const r of rows) {
        lines.push(
          [
            r.transport,
            r.recipient ?? "",
            r.latestStatus ?? "",
            r.latestError ?? "",
            r.latestAt ?? "",
            r.messageId ?? "",
            r.firstAt ?? "",
          ]
            .map(csvCell)
            .join(","),
        );
      }
      // Reflect the chosen window in the filename so reviewers can save
      // multiple pulls side-by-side without overwriting each other. Only
      // accept strict YYYY-MM-DD; anything else (ISO timestamps, bad
      // input) falls back to a today-stamped name and avoids smuggling
      // characters into the Content-Disposition header.
      const isoDate = (v: string | null) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      const fromStamp = isoDate(from);
      const toStamp = isoDate(to);
      let stamp: string;
      if (fromStamp && toStamp) {
        stamp = `${fromStamp}_to_${toStamp}`;
      } else if (fromStamp) {
        stamp = `from_${fromStamp}`;
      } else if (toStamp) {
        stamp = `to_${toStamp}`;
      } else {
        stamp = new Date().toISOString().slice(0, 10);
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="email-delivery-${stamp}.csv"`,
      );
      // Prepend a UTF-8 BOM so Excel auto-detects encoding for non-ASCII
      // recipients (Arabic names show up correctly).
      return res.send("\uFEFF" + lines.join("\r\n") + "\r\n");
    }
    res.json(rows);
  });

  // Companion count for the delivery-health export. Returns the row count
  // a CSV pull with the same filters would produce, plus the server's hard
  // export cap so the client can warn admins when the export will be
  // truncated. Cheap to compute relative to the list query (no LIMIT, no
  // joining first/last events).
  app.get(
    "/api/auth/email-deliveries/count",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const email = typeof req.query.email === "string" ? req.query.email : null;
      const from = typeof req.query.from === "string" ? req.query.from : null;
      const to = typeof req.query.to === "string" ? req.query.to : null;
      const count = await authBizStorage.countEmailDeliveriesForCompany(ctx.companyId, {
        status,
        email,
        from,
        to,
      });
      res.json({ count, cap: EMAIL_DELIVERY_EXPORT_CAP });
    },
  );

  // "Has this workspace ever produced any email-delivery event?" probe.
  // Lets the Recent sends card on /settings/email-delivery distinguish
  // "no rows because filters" from "no rows because nothing has ever
  // been sent" so brand-new workspaces get a tailored explanation
  // instead of the generic filter-empty line.
  app.get(
    "/api/auth/email-deliveries/has-any",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const hasAny = await authBizStorage.hasAnyEmailDeliveryForCompany(
        ctx.companyId,
      );
      res.json({ hasAny });
    },
  );

  // 7-day (or N-day) failure-class trend for the delivery-health header.
  // Returns densified daily counts for bounced / complained / send_failed
  // across both invitation and password-reset transports, scoped to the
  // calling workspace. Used by the trend chips and sparkline tooltips.
  app.get(
    "/api/auth/email-deliveries/trends",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const daysRaw = Number(req.query.days);
      const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 7;
      const trends = await authBizStorage.getEmailDeliveryFailureTrends(ctx.companyId, { days });
      res.json(trends);
    },
  );

  // ---------- delivery-health alerts ----------
  // Read/update the per-workspace alert configuration. Defaults are applied
  // server-side so a workspace that has never written a row still gets
  // sensible numbers.
  app.get(
    "/api/auth/email-delivery-alerts/settings",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const cfg = await authBizStorage.getEmailDeliveryAlertSettings(ctx.companyId);
      res.json({
        enabled: cfg.enabled,
        emailEnabled: cfg.emailEnabled,
        windowHours: cfg.windowHours,
        absoluteThreshold: cfg.absoluteThreshold,
        ratioThreshold: Number(cfg.ratioThreshold),
        minSamplesForRatio: cfg.minSamplesForRatio,
        cooldownMinutes: cfg.cooldownMinutes,
        // Null on legacy rows that pre-date the column — the client seeds
        // the form with the env-derived effective default in that case so
        // the displayed numbers match what the evaluator would actually
        // use right now. We also surface the platform-wide effective value
        // separately so the form can show an "inherited vs. custom" badge
        // instead of silently substituting a default that looks identical
        // to a saved override.
        dedupeHours: cfg.dedupeHours,
        retryMinutes: cfg.retryMinutes,
        effectiveDedupeHours: getDedupeHours(cfg.dedupeHours ?? null),
        effectiveRetryMinutes: getRetryMinutes(cfg.retryMinutes ?? null),
        updatedAt: cfg.updatedAt,
      });
    },
  );

  app.put(
    "/api/auth/email-delivery-alerts/settings",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const input = upsertEmailDeliveryAlertSettingsSchema.parse(req.body);
        const cfg = await authBizStorage.upsertEmailDeliveryAlertSettings(ctx.companyId, {
          ...input,
          updatedByUserId: ctx.userId,
        });
        res.json({
          enabled: cfg.enabled,
          emailEnabled: cfg.emailEnabled,
          windowHours: cfg.windowHours,
          absoluteThreshold: cfg.absoluteThreshold,
          ratioThreshold: Number(cfg.ratioThreshold),
          minSamplesForRatio: cfg.minSamplesForRatio,
          cooldownMinutes: cfg.cooldownMinutes,
          dedupeHours: cfg.dedupeHours,
          retryMinutes: cfg.retryMinutes,
          effectiveDedupeHours: getDedupeHours(cfg.dedupeHours ?? null),
          effectiveRetryMinutes: getRetryMinutes(cfg.retryMinutes ?? null),
          updatedAt: cfg.updatedAt,
        });
      } catch (err) {
        if (handleZod(err, res)) return;
        next(err);
      }
    },
  );

  // The current un-dismissed alert (if any), for the in-app banner. Polled
  // by the shell so a freshly-fired alert appears without a page reload.
  // Returns 200 with `null` when there's nothing to show — easier for the
  // client to handle than a 404.
  app.get(
    "/api/auth/email-delivery-alerts/active",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const alert = await authBizStorage.getActiveEmailDeliveryAlert(ctx.companyId);
      if (!alert) return res.json(null);
      res.json({
        id: alert.id,
        firedAt: alert.firedAt,
        windowHours: alert.windowHours,
        failureCount: alert.failureCount,
        sendCount: alert.sendCount,
        reason: alert.reason,
        snapshot: alert.snapshot,
        emailSent: alert.emailSent,
        emailRecipients: alert.emailRecipients,
      });
    },
  );

  app.post(
    "/api/auth/email-delivery-alerts/:id/dismiss",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const alert = await authBizStorage.dismissEmailDeliveryAlert(
        String(req.params.id),
        ctx.companyId,
        ctx.userId,
      );
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      res.json({ ok: true });
    },
  );

  // Audit log of recent firings, joined with the dismissing user's display
  // name. Drives the "Recent alerts" table on /app/settings/email-delivery
  // so owners can see *who* silenced *what* and *when*. Bounded server-side
  // (default 20, hard cap 100) so the response stays small.
  //
  // Pagination is keyset on `firedAt`: pass `?before=<ISO>` to fetch the
  // page older than that timestamp. The response carries a `nextCursor`
  // (oldest row's firedAt) when a full page came back, or `null` when the
  // caller has reached the end. Keyset (vs OFFSET) keeps each read cheap
  // even after the table grows.
  app.get(
    "/api/auth/email-delivery-alerts/history",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 100)
        : 20;
      let before: Date | null = null;
      if (typeof req.query.before === "string" && req.query.before.length > 0) {
        const parsed = new Date(req.query.before);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ message: "Invalid 'before' cursor" });
        }
        before = parsed;
      }
      const rows = await authBizStorage.listRecentEmailDeliveryAlerts(
        ctx.companyId,
        limit,
        before,
      );
      // A full page implies more rows may exist; surface the oldest row's
      // firedAt as the next cursor. A short page means we've reached the end.
      const nextCursor =
        rows.length === limit && rows.length > 0
          ? rows[rows.length - 1].firedAt
          : null;
      res.json({
        rows: rows.map((r) => ({
          id: r.id,
          firedAt: r.firedAt,
          windowHours: r.windowHours,
          failureCount: r.failureCount,
          sendCount: r.sendCount,
          reason: r.reason,
          snapshot: r.snapshot,
          emailSent: r.emailSent,
          emailRecipients: r.emailRecipients,
          dismissedAt: r.dismissedAt,
          dismissedByUserId: r.dismissedByUserId,
          dismissedByName: r.dismissedByName,
          dismissedByEmail: r.dismissedByEmail,
        })),
        nextCursor,
      });
    },
  );

  // Re-arm the alert evaluator for this workspace by clearing the cooldown
  // gate for the *next* pass. The action is intentionally workspace-level
  // (one cooldown per workspace) — see the per-id alias below for the
  // ergonomic "Re-arm this row" UI shape.
  //
  // Implementation is non-destructive: it sets a one-shot
  // `cooldownClearedAt` timestamp on the per-workspace settings row and
  // leaves every historical `firedAt` untouched, so the audit log keeps
  // showing real firing times. Returns `cleared:false` (with HTTP 200)
  // when there is no recent alert to re-arm — the UI surfaces that as a
  // distinct toast instead of a misleading "success".
  app.post(
    "/api/auth/email-delivery-alerts/rearm",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const cleared = await authBizStorage.clearEmailDeliveryAlertCooldown(
          ctx.companyId,
        );
        res.json({ ok: true, cleared });
      } catch (err) {
        next(err);
      }
    },
  );

  // Per-id alias used by the "Recent alerts" table's per-row Re-arm button.
  // It validates that `:id` belongs to the calling workspace (404 otherwise
  // — keeps the response from leaking the existence of foreign alert ids)
  // and then performs the same workspace-level re-arm as POST /rearm. The
  // id is used for scoping/traceability only; cooldown is a workspace
  // property, not a per-row property. The validation uses an indexed
  // (id, company_id) lookup so it stays correct even for older rows that
  // fall outside any bounded "recent" window.
  app.post(
    "/api/auth/email-delivery-alerts/:id/rearm",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const id = String(req.params.id);
        const target = await authBizStorage.getEmailDeliveryAlertById(
          id,
          ctx.companyId,
        );
        if (!target) {
          return res.status(404).json({ message: "Alert not found" });
        }
        const cleared = await authBizStorage.clearEmailDeliveryAlertCooldown(
          ctx.companyId,
        );
        res.json({ ok: true, cleared });
      } catch (err) {
        next(err);
      }
    },
  );

  // Run the evaluator on demand. Useful when an admin tightens a threshold
  // and wants to see whether the new value would already be tripping. Also
  // used by tests to drive the cron without waiting for the interval.
  //
  // Accepts an optional `?skipCooldown=1` query parameter (NODE_ENV-gated)
  // so the dedupe + retry e2e spec can re-fire the evaluator a second time
  // in the same case without having to age the previous alert's `firedAt`
  // out of the cooldown window via direct SQL. The bypass is silently
  // ignored in production so no real workspace can use it to spam owners.
  app.post(
    "/api/auth/email-delivery-alerts/evaluate",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const skipCooldown = readDevSkipCooldownFromQuery(req.query);
        const result = await evaluateEmailDeliveryAlertsForCompany(
          ctx.companyId,
          { skipCooldown },
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // Test-only stub installer for the email transport. Lets the dedupe +
  // retry spec drive `sendEmail` to a deterministic per-address outcome
  // (success or `send_failed`) without hitting Resend.
  //
  // Defense-in-depth: the route is NOT registered at all when
  // `NODE_ENV === "production"` (Express returns its default 404 from
  // its terminal middleware), AND the setter / getter live in a
  // dev-only module (`./email-dev-stub`) that is loaded lazily inside
  // this conditional. That means the production esbuild bundle
  // (`script/build.ts` defines `process.env.NODE_ENV` as
  // `"production"`) tree-shakes the entire branch — neither the route
  // handler closure nor any reference to `setEmailTestStub` ends up in
  // the running production process. A future refactor that re-orders
  // the gate, runs body parsing too early, or accidentally exposes the
  // setter to a production code path therefore cannot poison the live
  // transport.
  if (process.env.NODE_ENV !== "production") {
    // Use createRequire so esbuild's NODE_ENV define folds the entire
    // `if` branch (including this resolution) to a no-op in the
    // production bundle. A top-level `import` from "./email-dev-stub"
    // would survive bundling even though the conditional caller is
    // dead, defeating the goal of physically excluding the dev module
    // from production.
    const devRequire = createRequire(import.meta.url);
    const { registerEmailStubDevRoute } =
      devRequire("./email-dev-stub.ts") as typeof import("./email-dev-stub");
    registerEmailStubDevRoute(app);
  }

  // Per-recipient outcome log for one alert. Surfaces *which* owners
  // received the alert email and which didn't, so an owner who suspects
  // they missed a fire can confirm it (and tell whether the workspace's
  // address book needs cleaning). Validates that `:id` belongs to the
  // caller's workspace before reading the recipient table — without
  // that gate an owner could enumerate other workspaces' alert ids.
  // The latest-per-address roll-up is computed in SQL so a long retry
  // history doesn't bloat the response.
  app.get(
    "/api/auth/email-delivery-alerts/:id/recipients",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const id = String(req.params.id);
        const target = await authBizStorage.getEmailDeliveryAlertById(
          id,
          ctx.companyId,
        );
        if (!target) {
          return res.status(404).json({ message: "Alert not found" });
        }
        const recipients =
          await authBizStorage.listEmailDeliveryAlertRecipientsLatest(id);
        res.json({
          alertId: id,
          emailSent: target.emailSent,
          emailRecipients: target.emailRecipients,
          recipients,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // Per-recipient retry. Sends the alert email to one address right now
  // (mirroring the bookkeeping of the background retry pass) so an owner
  // can unstick a transient SMTP failure without waiting for the next
  // sweep. Returns the new outcome row so the UI can flip the badge in
  // place. Workspace-scoped via the same id check as the recipients GET.
  app.post(
    "/api/auth/email-delivery-alerts/:id/recipients/retry",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const id = String(req.params.id);
        const target = await authBizStorage.getEmailDeliveryAlertById(
          id,
          ctx.companyId,
        );
        if (!target) {
          return res.status(404).json({ message: "Alert not found" });
        }
        const email =
          typeof req.body?.email === "string" ? req.body.email.trim() : "";
        if (!email || !email.includes("@")) {
          return res.status(400).json({ message: "email is required" });
        }
        // Guardrail: only allow retrying an address that was actually
        // attempted on this alert AND whose latest attempt failed.
        // Without this an owner could call the route with any email,
        // sending out-of-band alert emails and inflating
        // `emailRecipients`. The list is workspace-scoped via the
        // `getEmailDeliveryAlertById` check above.
        const recipients =
          await authBizStorage.listEmailDeliveryAlertRecipientsLatest(id);
        const lower = email.toLowerCase();
        const match = recipients.find((r) => r.email.toLowerCase() === lower);
        if (!match) {
          return res
            .status(404)
            .json({ message: "Recipient not found on this alert" });
        }
        if (match.status !== "failed") {
          return res.status(409).json({
            message: "Recipient is not in a failed state",
            status: match.status,
          });
        }
        const outcome = await retryEmailDeliveryAlertRecipient({
          alertId: id,
          companyId: ctx.companyId,
          email,
        });
        if (outcome.ok) {
          res.json({ ok: true });
        } else {
          // 200 with `ok:false` (not 5xx) so the UI can surface the
          // provider error in a toast without React Query's retry kicking
          // in — a transient send failure is the *expected* failure mode
          // here, not a bug in our route.
          res.json({ ok: false, error: outcome.error });
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // Per-message lifecycle log used by the delivery-health drawer.
  // Scopes by workspace so admins can't enumerate other workspaces'
  // message ids. Accepts URL-encoded keys because some local attempt
  // ids contain a colon.
  app.get(
    "/api/auth/email-deliveries/:transport/:key/events",
    requireAuth,
    requireRole("owner"),
    async (req, res) => {
      const ctx = (req as any).membership!;
      const transport = String(req.params.transport);
      if (transport !== "invitation" && transport !== "password_reset") {
        return res.status(400).json({ message: "Unknown transport" });
      }
      // Express has already URL-decoded `:key` for us — including the
      // colon in `attempt:<eventId>` keys.
      const key = String(req.params.key);
      const events = await authBizStorage.listEmailDeliveryEvents(
        transport,
        ctx.companyId,
        key,
      );
      res.json(events);
    },
  );

  // ---------- Resend webhook ----------
  // Resend signs payloads with the Svix scheme:
  //   svix-id, svix-timestamp, svix-signature ("v1,<base64sig> v1,<base64sig>")
  // Signed string: `${svix_id}.${svix_timestamp}.${rawBody}` HMAC-SHA256
  // with the base64-decoded portion of `whsec_<base64>`.
  app.post("/api/webhooks/resend", resendWebhook);
}

function constantTimeEqualB64(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "base64");
    const bb = Buffer.from(b, "base64");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function verifyResendSignature(req: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Dev convenience: accept unsigned events but log loudly. In production
    // an unsigned secret means we never accept the payload.
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "RESEND_WEBHOOK_SECRET not configured" };
    }
    console.warn("[resend webhook] RESEND_WEBHOOK_SECRET missing — accepting unsigned event (dev only)");
    return { ok: true };
  }
  const id = String(req.header("svix-id") ?? "");
  const ts = String(req.header("svix-timestamp") ?? "");
  const sigHeader = String(req.header("svix-signature") ?? "");
  if (!id || !ts || !sigHeader) return { ok: false, reason: "missing svix headers" };

  // Reject events older than 5 minutes (replay defense).
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
    return { ok: false, reason: "stale timestamp" };
  }

  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return { ok: false, reason: "raw body unavailable" };

  // Strip the `whsec_` prefix and base64-decode.
  const secretB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBuf: Buffer;
  try {
    secretBuf = Buffer.from(secretB64, "base64");
  } catch {
    return { ok: false, reason: "invalid secret encoding" };
  }

  const signed = `${id}.${ts}.${raw.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secretBuf).update(signed).digest("base64");

  // Header may include multiple `vN,signature` pairs — any match is OK.
  const candidates = sigHeader.split(" ").map((p) => p.split(",")[1]).filter(Boolean) as string[];
  const match = candidates.some((c) => constantTimeEqualB64(c, expected));
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

// Map Resend event-type strings ("email.delivered", "email.bounced", …) onto
// the short status tokens we store and render.
function mapResendEventType(t: string): string | null {
  if (!t.startsWith("email.")) return null;
  const tail = t.slice("email.".length);
  // Known Resend events: sent, delivered, delivery_delayed, bounced, complained,
  // opened, clicked, failed.
  const allowed = new Set([
    "sent",
    "delivered",
    "delivery_delayed",
    "bounced",
    "complained",
    "opened",
    "clicked",
    "failed",
  ]);
  if (!allowed.has(tail)) return null;
  return tail === "failed" ? "send_failed" : tail;
}

async function resendWebhook(req: Request, res: Response) {
  const verified = verifyResendSignature(req);
  if (!verified.ok) {
    console.warn(`[resend webhook] rejected: ${verified.reason}`);
    return res.status(401).json({ message: "invalid signature" });
  }

  const body = req.body as { type?: string; created_at?: string; data?: any } | undefined;
  if (!body || typeof body !== "object" || !body.type) {
    return res.status(400).json({ message: "invalid payload" });
  }

  const status = mapResendEventType(body.type);
  if (!status) {
    // Unknown event type — ack with 200 so Resend doesn't retry forever.
    return res.status(200).json({ ok: true, ignored: body.type });
  }

  // Resend events surface the message id on `data.email_id` (modern) or
  // `data.id` (legacy). Bounce/complaint reasons live on `data.bounce` /
  // `data.reason`.
  const data = body.data ?? {};
  const messageId: string | null = data.email_id ?? data.id ?? null;
  if (!messageId) {
    return res.status(200).json({ ok: true, ignored: "no message id" });
  }

  const error: string | null =
    data?.bounce?.message ??
    data?.reason ??
    (status === "bounced" ? "Address rejected by recipient server" : null);

  const eventAt = body.created_at ? new Date(body.created_at) : new Date();

  // The same Resend account ferries both invitation and password-reset
  // mails. Try each lookup before giving up so a bounce on either path
  // updates the right record.
  const inv = await authBizStorage.getInvitationByMessageId(messageId);
  if (inv) {
    await Promise.all([
      authBizStorage.recordInvitationEmailEvent({
        invitationId: inv.id,
        messageId,
        type: status,
        error,
        payload: body,
      }),
      authBizStorage.updateInvitationEmailMeta(inv.id, {
        status,
        error,
        eventAt,
      }),
    ]);
    return res.status(200).json({ ok: true, kind: "invitation" });
  }

  const prt = await authBizStorage.getPasswordResetTokenByMessageId(messageId);
  if (prt) {
    await Promise.all([
      authBizStorage.recordPasswordResetEmailEvent({
        tokenId: prt.id,
        userId: prt.userId,
        messageId,
        type: status,
        error,
        payload: body,
      }),
      authBizStorage.updatePasswordResetEmailMeta(prt.id, {
        status,
        error,
        eventAt,
      }),
    ]);
    return res.status(200).json({ ok: true, kind: "password_reset" });
  }

  return res.status(200).json({ ok: true, ignored: "no matching record" });
}

// Quote a CSV cell per RFC 4180: wrap in double-quotes when the value
// contains a comma, quote, or newline; double up embedded quotes.
// Cells starting with `=`, `+`, `-`, or `@` are prefixed with a single
// quote to defuse spreadsheet formula injection (CWE-1236).
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
