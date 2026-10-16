import type { Express, Request, Response, NextFunction } from "express";
import { type WorkspaceRole, ROLES } from "@shared/schema";
import { authBizStorage } from "./auth/storage";
import { resolveActiveCompanyId } from "./auth/middleware";
import { withUnscopedDb } from "./db";

/**
 * Projected identity for the signed-in user, attached to `req.member` for
 * the `/api/auth/me` handler. This is *not* a database row — the legacy
 * `workspace_members` mirror table was retired in 2026-04 and identity
 * now lives in a single place: the canonical `users` + `memberships`
 * tables. The shape here is shaped specifically to keep the
 * `/api/auth/me` JSON response stable for existing frontend consumers.
 */
export interface CurrentMember {
  name: string;
  email: string;
  role: WorkspaceRole;
  status: "active";
}

declare global {
  namespace Express {
    interface Request {
      member?: CurrentMember;
    }
  }
}

/**
 * Coerce a stored role value into the canonical WorkspaceRole enum
 * (owner|accountant|viewer). Membership rows are stored using the canonical
 * strings directly, so this is effectively the identity function — it
 * stays in place to defensively normalise any stale row that slipped past
 * the data migration.
 */
function mapRole(role: string | undefined | null): WorkspaceRole {
  if (role && (ROLES as readonly string[]).includes(role)) {
    return role as WorkspaceRole;
  }
  return "viewer";
}

/**
 * Shape of the passport session payload. Both auth providers (OIDC
 * and the local email+password provider) populate `id` with the
 * stable user id.
 */
interface SessionUser {
  // Canonical shape written by both auth providers today: the user id lives
  // at `id` (see buildLocalSession + the OIDC verify callbacks). `claims.sub`
  // is the old session shape that no longer exists in live sessions.
  id?: string;
  claims?: { sub?: string } & Record<string, unknown>;
}

function getSessionUserId(req: Request): string | null {
  if (!req.isAuthenticated?.()) return null;
  const user = req.user as SessionUser | undefined;
  // BUG FIX: this used to read ONLY `user.claims.sub` — the legacy
  // session shape that no live session carries (sessions store the id at
  // `user.id`, same as server/auth/middleware.ts's loadMembership). So this
  // always returned null → resolveCurrentMember returned null → /api/auth/me
  // fell back to the anonymous `role: "viewer"` default, making the topbar
  // trust-cluster chip show "Viewer" for every user including owners. Prefer
  // the real `id`, keep `claims.sub` only as a legacy fallback.
  const id = user?.id;
  if (typeof id === "string" && id.length > 0) return id;
  const sub = user?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/**
 * Build the projected `CurrentMember` for the active passport session by
 * reading directly from the canonical `users` row + active-workspace
 * `memberships` row. Returns `null` for unauthenticated requests; the
 * `/api/auth/me` handler then falls back to the historical "anonymous
 * viewer" shape so role-aware UI components keep rendering.
 *
 * No writes happen on the request path — there is no longer a mirror
 * table to keep in sync. Member management (invite, role change, removal)
 * lives on `/api/auth/members` and `/api/auth/invitations`
 * (server/auth/local-routes.ts).
 */
async function resolveCurrentMember(req: Request): Promise<CurrentMember | null> {
  // `rbacMiddleware` runs *before* the global /api gate that attaches
  // `withCompanyScope` (see server/index.ts mount order), so every db
  // call here is pre-scope by construction. The reads only touch
  // auth-tier `users` / `memberships` — both intentionally out of
  // `workspace_isolation` RLS scope — so wrap in `withUnscopedDb` to
  // silence the task #193 runtime guard while keeping a grep-able
  // audit marker.
  return withUnscopedDb("auth:resolve-current-member", async () => {
    const userId = getSessionUserId(req);
    if (!userId) return null;
    const u = await authBizStorage.getUserById(userId);
    if (!u || !u.email) return null;

    const companyId = await resolveActiveCompanyId(req, userId);
    let mappedRole: WorkspaceRole = "viewer";
    if (companyId) {
      const m = await authBizStorage.getMembership(userId, companyId);
      if (m) mappedRole = mapRole(m.role);
    }

    const email = u.email.trim().toLowerCase();
    const display = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || email;

    return { name: display, email, role: mappedRole, status: "active" };
  });
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
      console.error("current member resolve error", err);
      next(err);
    }
  };
}

export function registerAuthRoutes(app: Express) {
  // Identity probe used by trust + role-aware UI components. Sources
  // `req.member` directly from the canonical users + memberships tables
  // (see `resolveCurrentMember` above). The numeric `id` field is a
  // historical artefact: it used to be the row id of the now-removed
  // `workspace_members` mirror table. Frontend code only branches on
  // `id === 0` to detect the anonymous shape, so we keep `1` for
  // authenticated users and `0` for anonymous to preserve that contract.
  app.get("/api/auth/me", async (req, res) => {
    const member = req.member;
    if (!member) {
      // Unauthenticated — return the legacy anonymous shape so existing
      // frontend code that branches on `role === "viewer"` still works.
      return res.json({ id: 0, name: "Anonymous", email: "", role: "viewer", status: "active" });
    }
    res.json({
      id: 1,
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
