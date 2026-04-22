import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
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
  ROLES,
  type Role,
} from "@shared/schema";
import { authBizStorage, hashPassword, verifyPassword } from "./storage";
import { authStorage } from "../replit_integrations/auth/storage";
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
        await authBizStorage.bootstrapWorkspaceForUser(user.id, display);
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
      if (user && user.provider === "local") {
        const { token } = await authBizStorage.createPasswordResetToken(user.id);
        // No email transport configured. Surface the reset URL in dev so the user can copy it.
        const link = `${req.protocol}://${req.get("host")}/reset-password/${token}`;
        if (process.env.NODE_ENV !== "production") {
          console.log(`[auth] password reset link for ${email}: ${link}`);
          return res.json({ ok: true, devResetLink: link });
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

  // ---------- members management (admin only) ----------
  app.get("/api/auth/members", requireAuth, requireRole("admin"), async (req, res) => {
    const ctx = (req as any).membership!;
    const rows = await authBizStorage.listMembersForCompany(ctx.companyId);
    res.json(rows);
  });

  app.patch("/api/auth/members/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      const ctx = (req as any).membership!;
      const { role } = updateMemberRoleSchema.parse(req.body);
      const all = await authBizStorage.listMembersForCompany(ctx.companyId);
      const target = all.find((m) => m.id === String(req.params.id));
      if (!target) return res.status(404).json({ message: "Member not found" });
      // Don't allow demoting the last admin.
      if (target.role === "admin" && role !== "admin") {
        const admins = await authBizStorage.countAdminsForCompany(ctx.companyId);
        if (admins <= 1) return res.status(400).json({ message: "Cannot demote the only admin" });
      }
      const m = await authBizStorage.updateMembershipRole(String(req.params.id), role as Role);
      res.json(m);
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  app.get("/api/auth/members/:id/activity", requireAuth, requireRole("admin"), async (req, res) => {
    const ctx = (req as any).membership!;
    const all = await authBizStorage.listMembersForCompany(ctx.companyId);
    const target = all.find((m) => m.id === String(req.params.id));
    if (!target) return res.status(404).json({ message: "Member not found" });
    const sessions = await authBizStorage.listSessionsForUser(target.userId);
    res.json({
      member: { id: target.id, userId: target.userId, role: target.role, user: target.user },
      sessions,
    });
  });

  app.delete("/api/auth/members/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const ctx = (req as any).membership!;
    const all = await authBizStorage.listMembersForCompany(ctx.companyId);
    const target = all.find((m) => m.id === String(req.params.id));
    if (!target) return res.status(404).json({ message: "Member not found" });
    if (target.role === "admin") {
      const admins = await authBizStorage.countAdminsForCompany(ctx.companyId);
      if (admins <= 1) return res.status(400).json({ message: "Cannot remove the only admin" });
    }
    await authBizStorage.deleteMembership(String(req.params.id));
    res.status(204).send();
  });

  // ---------- invitations ----------
  app.get("/api/auth/invitations", requireAuth, requireRole("admin"), async (req, res) => {
    const ctx = (req as any).membership!;
    const rows = await authBizStorage.listInvitationsForCompany(ctx.companyId);
    res.json(rows);
  });

  app.post("/api/auth/invitations", requireAuth, requireRole("admin"), async (req, res, next) => {
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
      if (process.env.NODE_ENV !== "production") {
        console.log(`[auth] invitation link for ${input.email}: ${link}`);
      }
      res.status(201).json({ invitation: inv, link });
    } catch (err) {
      if (handleZod(err, res)) return;
      next(err);
    }
  });

  app.post("/api/auth/invitations/:id/resend", requireAuth, requireRole("admin"), async (req, res) => {
    const inv = await authBizStorage.resendInvitation(String(req.params.id));
    const link = `${req.protocol}://${req.get("host")}/accept-invitation/${inv.token}`;
    if (process.env.NODE_ENV !== "production") {
      console.log(`[auth] invitation resent for ${inv.email}: ${link}`);
    }
    res.json({ invitation: inv, link });
  });

  app.delete("/api/auth/invitations/:id", requireAuth, requireRole("admin"), async (req, res) => {
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
}
