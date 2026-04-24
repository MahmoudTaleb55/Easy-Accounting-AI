import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { workspaceMembers, type WorkspaceMember, type WorkspaceRole, ROLES } from "@shared/schema";
import { eq } from "drizzle-orm";
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
 * (owner|accountant|viewer). Membership rows are stored using the canonical
 * strings directly, so this is effectively the identity function — but it
 * stays in place to defensively normalise any stale row that slipped past
 * the data migration, and so the workspace_members mirror still derives its
 * role from the authoritative `memberships` table rather than the retired
 * wm_id cookie.
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
 * `workspace_members` is now a *read-only mirror* of the canonical
 * `memberships` table. The real invite + member-management flow lives on
 * `/api/auth/members` and `/api/auth/invitations` (server/auth/local-routes.ts).
 * The mirror is refreshed here, on demand, so existing call sites that read
 * `req.member` (most importantly `/api/auth/me` below) keep working without
 * a second lookup. It is never used to authorize writes — every /api endpoint
 * is gated by `requireAuth` + `requireWriteRoleForMutations` in
 * `server/routes.ts`, which read the authoritative role straight from the
 * `memberships` table.
 *
 * Returns `null` when the request has no authenticated session. `/api/auth/me`
 * still projects an "anonymous viewer" identity to the client for that case
 * so role-aware UI components keep rendering.
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
 * Thin attachment middleware that populates `req.member` from the real
 * authenticated session. It does NOT gate writes — that is done globally in
 * `server/routes.ts` against the `memberships` table. Unauthenticated
 * requests simply pass through with `req.member` left undefined; downstream
 * handlers decide whether they care.
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

export function registerAuthRoutes(app: Express) {
  // Identity probe used by trust + role-aware UI components. Sources `req.member`
  // from the workspace_members mirror (see `resolveCurrentMember` above), which
  // is itself derived from the canonical memberships table.
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

  // The legacy `/api/team/*` endpoints (members CRUD + invite create/accept)
  // were retired here in 2026-04. The real flow now lives on
  // `/api/auth/members` and `/api/auth/invitations` in
  // `server/auth/local-routes.ts`. Old `/invite/:token` URLs are redirected
  // to `/accept-invitation/:token` by the SPA router (see `client/src/App.tsx`).
}
