import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { workspaceMembers, workspaceInvites, type WorkspaceMember, type WorkspaceRole, ROLES } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import crypto from "crypto";
import { authStorage } from "./replit_integrations/auth/storage";
import { authBizStorage } from "./auth/storage";
import { resolveActiveCompanyId } from "./auth/middleware";

declare global {
  namespace Express {
    interface Request {
      member?: WorkspaceMember;
    }
  }
}

/**
 * Coerce a stored role value into the canonical WorkspaceRole enum
 * (owner|accountant|viewer) used by the legacy /api/team layer. Membership
 * rows are now stored using the canonical strings directly, so this is
 * effectively the identity function — but it stays in place to defensively
 * normalise any stale row that slipped past the data migration, and so the
 * legacy /api/team mirror still derives its role from the authoritative
 * memberships table rather than the retired wm_id cookie.
 */
function mapRole(role: string | undefined | null): WorkspaceRole {
  if (role && (ROLES as readonly string[]).includes(role)) {
    return role as WorkspaceRole;
  }
  return "viewer";
}

/**
 * Shape of the passport session payload. Both auth providers (Replit OIDC
 * and the local email+password provider) populate `claims.sub` with the
 * stable user id.
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
 * Resolve the workspace_members mirror row for the current passport session.
 *
 * The mirror exists purely so the legacy /api/team UI (which lists / edits
 * `workspace_members` by id) stays consistent with the new memberships
 * system. It is never used to authorize writes — every /api endpoint is
 * gated by `requireAuth` + `requireWriteRoleForMutations` in `server/routes.ts`,
 * which read the authoritative role straight from the `memberships` table.
 *
 * Returns `null` when the request has no authenticated session — there is no
 * "anonymous viewer" identity anymore. Callers that need a member must check
 * for null and respond with 401/403 themselves.
 */
async function resolveCurrentMember(req: Request): Promise<WorkspaceMember | null> {
  const userId = getSessionUserId(req);
  if (!userId) return null;
  const u = await authStorage.getUser(userId);
  if (!u || !u.email) return null;

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

/**
 * Thin attachment middleware that populates `req.member` for the legacy
 * /api/team routes from the real authenticated session. It does NOT gate
 * writes — that is done globally in `server/routes.ts` against the
 * `memberships` table. Unauthenticated requests simply pass through with
 * `req.member` left undefined; downstream handlers decide whether they care.
 */
export function rbacMiddleware() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    try {
      const member = await resolveCurrentMember(req);
      if (member) req.member = member;
      next();
    } catch (err) {
      console.error("legacy member resolve error", err);
      next(err);
    }
  };
}

function newToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/me", async (req, res) => {
    const member = req.member;
    if (!member) {
      // Unauthenticated — return the legacy anonymous shape so existing
      // frontend code that branches on `role === "viewer"` still works.
      return res.json({ id: 0, name: "Anonymous", email: "", role: "viewer", status: "active" });
    }
    res.json({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
    });
  });

  app.get("/api/team/members", async (req, res) => {
    // Only authenticated workspace members can see the team roster.
    if (!req.member) {
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

  function requireOwner(req: Request, res: Response): boolean {
    if (req.member?.role !== "owner") {
      res.status(403).json({ message: "Owners only." });
      return false;
    }
    return true;
  }

  app.post("/api/team/invites", async (req, res) => {
    if (!requireOwner(req, res)) return;
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
    if (!requireOwner(req, res)) return;
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
    if (!requireOwner(req, res)) return;
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
    if (!requireOwner(req, res)) return;
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
