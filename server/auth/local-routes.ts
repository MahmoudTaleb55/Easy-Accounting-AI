import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
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
import { authStorage } from "../replit_integrations/auth/storage";
import { sendInvitationEmail, sendPasswordResetEmail, normalizeLocale } from "./email";
import { evaluateEmailDeliveryAlertsForCompany } from "./email-delivery-alerts";
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
    _local: true,
    claims: {
      sub: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      profile_image_url: user.profileImageUrl,
    },
  };
}

// Hard ceiling on a single CSV export of the email-delivery feed. Surfaced
// to the client via /count so the UI can warn when the export will be
// truncated.
const EMAIL_DELIVERY_EXPORT_CAP = 10000;

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
      authStorage.getUser(inv.invitedByUserId).catch(() => undefined),
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
  // ---------- email + password sign-up ----------
  app.post("/api/auth/signup", signupLimiter, async (req, res, next) => {
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
        res.status(201).json({ user, bootstrapped });
      });
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  // ---------- email + password sign-in ----------
  app.post("/api/auth/signin", signinLimiter, async (req, res, next) => {
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
        res.json({ user });
      });
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
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
    try {
      const { email } = requestResetSchema.parse(req.body);
      const user = await authBizStorage.getUserByEmail(email);
      // Always return ok to prevent email enumeration.
      const isProd = process.env.NODE_ENV === "production";
      if (user && user.provider === "local") {
        const { id: tokenId, token } = await authBizStorage.createPasswordResetToken(user.id);
        const link = `${req.protocol}://${req.get("host")}/reset-password/${token}`;

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

  // ---------- confirm reset ----------
  app.post("/api/auth/reset-password", resetConfirmLimiter, async (req, res) => {
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

  // ---------- bootstrap a workspace for OIDC sessions on first hit ----------
  // The blueprint's /api/auth/user returns the user row. We extend it: if the
  // signed-in OIDC user has no membership yet, create/adopt a workspace.
  app.use("/api/auth/user", async (req, _res, next) => {
    try {
      const user = req.user as any;
      if (req.isAuthenticated() && user?.claims?.sub && !user._local) {
        const id = user.claims.sub as string;
        const u = await authStorage.getUser(id);
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
    next();
  });

  // ---------- current user (override the blueprint route to also accept local sessions) ----------
  app.get("/api/auth/user", requireAuth, async (req, res) => {
    try {
      const userId = getUserIdOrThrow(req);
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (err) {
      console.error("Error fetching user:", err);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ---------- list my memberships (drives company switcher + permissions) ----------
  app.get("/api/auth/memberships", requireAuth, async (req, res) => {
    const userId = getUserIdOrThrow(req);
    const rows = await authBizStorage.listMembershipsForUser(userId);
    const active = await resolveActiveCompanyId(req, userId);
    res.json({ memberships: rows, activeCompanyId: active });
  });

  // ---------- profile ----------
  app.patch("/api/auth/profile", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserIdOrThrow(req);
      const patch = updateProfileSchema.parse(req.body);
      const u = await authBizStorage.updateUser(userId, patch);
      res.json(u);
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserIdOrThrow(req);
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const u = await authStorage.getUser(userId);
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
      const link = `${req.protocol}://${req.get("host")}/accept-invitation/${inv.token}`;
      const emailResult = await sendInvitationOrLog(inv, link);
      res.status(201).json({ invitation: inv, link, emailSent: emailResult.ok });
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  app.post("/api/auth/invitations/:id/resend", requireAuth, requireRole("owner"), async (req, res) => {
    const inv = await authBizStorage.resendInvitation(String(req.params.id));
    const link = `${req.protocol}://${req.get("host")}/accept-invitation/${inv.token}`;
    const emailResult = await sendInvitationOrLog(inv, link);
    res.json({ invitation: inv, link, emailSent: emailResult.ok });
  });

  app.delete("/api/auth/invitations/:id", requireAuth, requireRole("owner"), async (req, res) => {
    await authBizStorage.revokeInvitation(String(req.params.id));
    res.status(204).send();
  });

  // Public preview of an invitation by token (no auth required, used by sign-up form).
  app.get("/api/auth/invitations/by-token/:token", async (req, res) => {
    const inv = await authBizStorage.getInvitationByToken(req.params.token);
    if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) {
      return res.status(404).json({ message: "Invitation not found or expired" });
    }
    res.json({ email: inv.email, role: inv.role, companyId: inv.companyId });
  });

  // Authenticated accept (for users who are already signed-in and click the link).
  app.post("/api/auth/invitations/accept", inviteAcceptLimiter, requireAuth, async (req, res) => {
    const userId = getUserIdOrThrow(req);
    const token = String(req.body?.token ?? "");
    const inv = await authBizStorage.getInvitationByToken(token);
    if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "Invitation is no longer valid" });
    }
    const u = await authStorage.getUser(userId);
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
      const stamp = new Date().toISOString().slice(0, 10);
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

  // Run the evaluator on demand. Useful when an admin tightens a threshold
  // and wants to see whether the new value would already be tripping. Also
  // used by tests to drive the cron without waiting for the interval.
  app.post(
    "/api/auth/email-delivery-alerts/evaluate",
    requireAuth,
    requireRole("owner"),
    async (req, res, next) => {
      try {
        const ctx = (req as any).membership!;
        const result = await evaluateEmailDeliveryAlertsForCompany(ctx.companyId);
        res.json(result);
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
