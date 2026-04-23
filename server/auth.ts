import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { workspaceMembers, workspaceInvites, type WorkspaceMember, type WorkspaceRole } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import crypto from "crypto";
import { authStorage } from "./replit_integrations/auth/storage";
import { authBizStorage } from "./auth/storage";
import { resolveActiveCompanyId } from "./auth/middleware";

// Anonymous identity used for any request without a real authenticated session.
// It carries the viewer role so the same write-gating logic blocks every
// mutation. It is never persisted.
const ANONYMOUS_MEMBER: WorkspaceMember = {
  id: 0,
  name: "Anonymous",
  email: "",
  role: "viewer",
  status: "active",
  createdAt: null,
};

declare global {
  namespace Express {
    interface Request {
      member?: WorkspaceMember;
    }
  }
}

/**
 * Map a new-system role (admin|accountant|reviewer|readonly) to the legacy
 * WorkspaceRole (owner|accountant|viewer) used by the team/RBAC layer.
 */
function mapRole(role: string | undefined | null): WorkspaceRole {
  if (role === "admin") return "owner";
  if (role === "accountant") return "accountant";
  return "viewer";
}

/**
 * Shape of the passport session payload. Both auth providers (Replit OIDC
 * and the local email+password provider) populate `claims.sub` with the
 * stable user id; that's all the legacy RBAC layer needs.
 */
interface SessionUser {
  claims?: { sub?: string } & Record<string, unknown>;
}

function getSessionUserId(req: Request): string | null {
  if (!req.isAuthenticated?.()) return null;
  const user = req.user as SessionUser | undefined;
  const sub = user?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/**
 * Resolves the workspace member behind the current request from the real
 * authenticated session (passport).
 *
 *   1. If there is no authenticated session → anonymous (read-only).
 *   2. Otherwise the signed-in user is mirrored into a `workspace_members`
 *      row keyed by their email, with the role derived from their active
 *      workspace membership. The mirror is created or refreshed in place so
 *      role changes in the new system propagate to the legacy team layer.
 */
async function resolveCurrentMember(req: Request, _res: Response): Promise<WorkspaceMember> {
  const userId = getSessionUserId(req);
  if (!userId) return ANONYMOUS_MEMBER;
  const u = await authStorage.getUser(userId);
  if (!u || !u.email) return ANONYMOUS_MEMBER;

  const companyId = await resolveActiveCompanyId(req, userId);
  let mappedRole: WorkspaceRole = "viewer";
  if (companyId) {
    const m = await authBizStorage.getMembership(userId, companyId);
    if (m) mappedRole = mapRole(m.role);
  }

  const email = u.email.trim().toLowerCase();
  const display = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || email;

  const existing = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.email, email))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    if (row.role !== mappedRole || row.name !== display || row.status !== "active") {
      const [updated] = await db
        .update(workspaceMembers)
        .set({ role: mappedRole, name: display, status: "active" })
        .where(eq(workspaceMembers.id, row.id))
        .returning();
      return updated;
    }
    return row;
  }

  const [created] = await db
    .insert(workspaceMembers)
    .values({ name: display, email, role: mappedRole, status: "active" })
    .returning();
  return created;
}

// Endpoints that must remain available regardless of role
// (current-user lookup and accepting an invite). Matches against req.path.
const ROLE_BYPASS_PATHS = new Set<string>([
  "/api/auth/me",
  "/api/team/invites/accept",
]);

// Routes that only owners may write to (workspace-level configuration).
const OWNER_ONLY_PREFIXES = ["/api/team", "/api/settings", "/api/companies", "/api/fx-rates"];

// Explicit allowlist of write prefixes accountants are permitted to use.
// Anything outside this list (and outside owner-only prefixes) is denied for
// accountants — deny-by-default for any future write surface.
const ACCOUNTANT_WRITE_PREFIXES = [
  "/api/transactions",
  "/api/journal-entries",
  "/api/accounts",
  "/api/budgets",
  "/api/hr",
  "/api/insights",
  "/api/analysis",
  "/api/chat",
  "/api/asset-categories",
  "/api/fixed-assets",
  "/api/depreciation-runs",
];

function pathMatchesPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

export function rbacMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    try {
      const member = await resolveCurrentMember(req, res);
      req.member = member;

      const isWrite = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
      if (!isWrite) return next();
      if (ROLE_BYPASS_PATHS.has(req.path)) return next();

      if (member.role === "viewer") {
        return res.status(403).json({
          message: "صلاحيات القراءة فقط — لا يمكن إجراء تعديلات.",
          messageEn: "Viewers have read-only access.",
          role: member.role,
        });
      }
      if (member.role === "accountant") {
        if (pathMatchesPrefix(req.path, OWNER_ONLY_PREFIXES)) {
          return res.status(403).json({
            message: "هذه الإعدادات يحررها المالك فقط.",
            messageEn: "Workspace owners only.",
            role: member.role,
          });
        }
        if (!pathMatchesPrefix(req.path, ACCOUNTANT_WRITE_PREFIXES)) {
          return res.status(403).json({
            message: "هذا الإجراء غير مسموح للمحاسب.",
            messageEn: "This action is not permitted for accountants.",
            role: member.role,
          });
        }
      }
      next();
    } catch (err) {
      console.error("rbac middleware error", err);
      next(err);
    }
  };
}

function newToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/me", async (req, res) => {
    const member = req.member!;
    res.json({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
    });
  });

  app.get("/api/team/members", async (req, res) => {
    // Only real (active) workspace members can see the team roster — anonymous
    // visitors get a 403 here so we don't leak the member list publicly.
    if (!req.member || req.member.id === 0) {
      return res.status(403).json({ message: "Workspace members only." });
    }
    const list = await db.select().from(workspaceMembers).orderBy(asc(workspaceMembers.id));
    res.json(list);
  });

  app.get("/api/team/invites", async (req, res) => {
    // Pending invite tokens are owner-only secrets — anyone holding one can
    // join the workspace. Restrict both visibility and contents to owners.
    if (req.member?.role !== "owner") {
      return res.status(403).json({ message: "Owners only." });
    }
    const list = await db.select().from(workspaceInvites).orderBy(asc(workspaceInvites.id));
    res.json(list);
  });

  app.post("/api/team/invites", async (req, res) => {
    const { inviteMemberSchema } = await import("@shared/schema");
    const parsed = inviteMemberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

    const email = parsed.data.email.trim().toLowerCase();

    // Block invite if email already a member.
    const existingMember = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.email, email))
      .limit(1);
    if (existingMember.length > 0) {
      return res.status(409).json({ message: "هذا البريد ينتمي بالفعل لعضو في فريق العمل." });
    }

    // Revoke any previous pending invite for the same email so links don't pile up.
    await db
      .update(workspaceInvites)
      .set({ status: "revoked" })
      .where(and(eq(workspaceInvites.email, email), eq(workspaceInvites.status, "pending")));

    const token = newToken();
    const [created] = await db
      .insert(workspaceInvites)
      .values({
        email,
        name: parsed.data.name,
        role: parsed.data.role,
        token,
        invitedByMemberId: req.member?.id,
      })
      .returning();
    res.status(201).json(created);
  });

  app.delete("/api/team/invites/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    await db.update(workspaceInvites).set({ status: "revoked" }).where(eq(workspaceInvites.id, id));
    res.status(204).send();
  });

  app.post("/api/team/invites/accept", async (req, res) => {
    const { acceptInviteSchema } = await import("@shared/schema");
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

    const found = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.token, parsed.data.token))
      .limit(1);
    if (found.length === 0) return res.status(404).json({ message: "دعوة غير موجودة" });
    const invite = found[0];
    if (invite.status !== "pending") {
      return res.status(410).json({ message: "هذه الدعوة لم تعد صالحة." });
    }

    // Reuse existing member with the same email if present, otherwise create one.
    const existing = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.email, invite.email))
      .limit(1);

    let memberId: number;
    if (existing.length > 0) {
      memberId = existing[0].id;
      await db
        .update(workspaceMembers)
        .set({ role: invite.role as WorkspaceRole, status: "active" })
        .where(eq(workspaceMembers.id, memberId));
    } else {
      const [created] = await db
        .insert(workspaceMembers)
        .values({
          name: parsed.data.name?.trim() || invite.name,
          email: invite.email,
          role: invite.role,
          status: "active",
        })
        .returning();
      memberId = created.id;
    }

    await db
      .update(workspaceInvites)
      .set({ status: "accepted", acceptedMemberId: memberId, acceptedAt: new Date() })
      .where(eq(workspaceInvites.id, invite.id));

    // Identity is no longer cookie-pinned here; the invitee must sign in
    // through the real auth flow (/signin or /accept-invitation/:token) to
    // be tied to this membership.
    res.json({ memberId, role: invite.role });
  });

  app.patch("/api/team/members/:id", async (req, res) => {
    const { updateMemberRoleSchema } = await import("@shared/schema");
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = updateMemberRoleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

    const target = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1);
    if (target.length === 0) return res.status(404).json({ message: "العضو غير موجود" });

    // Prevent removing the last owner.
    if (target[0].role === "owner" && parsed.data.role !== "owner") {
      const owners = await db.select().from(workspaceMembers).where(eq(workspaceMembers.role, "owner"));
      if (owners.length <= 1) {
        return res.status(409).json({ message: "لا يمكن تخفيض رتبة المالك الأخير. عيّن مالكاً آخر أولاً." });
      }
    }

    const [updated] = await db
      .update(workspaceMembers)
      .set({ role: parsed.data.role })
      .where(eq(workspaceMembers.id, id))
      .returning();
    res.json(updated);
  });

  app.delete("/api/team/members/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const target = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1);
    if (target.length === 0) return res.status(204).send();
    if (target[0].id === req.member?.id) {
      return res.status(409).json({ message: "لا يمكنك حذف نفسك." });
    }
    if (target[0].role === "owner") {
      const owners = await db.select().from(workspaceMembers).where(eq(workspaceMembers.role, "owner"));
      if (owners.length <= 1) {
        return res.status(409).json({ message: "لا يمكن حذف المالك الأخير." });
      }
    }
    await db.delete(workspaceMembers).where(eq(workspaceMembers.id, id));
    res.status(204).send();
  });
}
