import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db, withUnscopedDb } from "../db";
import { eq, and, asc } from "drizzle-orm";
import { memberships, type Role, ROLE_TIER, users, companies } from "@shared/schema";

/**
 * Unified auth + role middleware.
 *
 * Sessions can be created two ways:
 *   1) OAuth (Google / Microsoft) — oidcAuth verify callback stores
 *      { id, email, firstName, lastName, provider } in the passport session.
 *   2) Local email + password — local strategy stores the full users row
 *      (same shape: id, email, firstName, lastName).
 *
 * Both shapes expose `id` at the top level so downstream helpers never need
 * to dig into `claims.sub`.
 */

function unauthorized(res: Response, message = "Unauthorized") {
  res.status(401).json({ message });
}

/**
 * Wrap an async RequestHandler so a rejected promise is routed to Express's
 * error pipeline via next(err) instead of becoming an UNHANDLED rejection.
 *
 * SECURITY (scan finding, DENIAL_OF_SERVICE): these auth middlewares are
 * invoked manually from the global /api gate (not awaited by Express). An
 * async handler whose body rejects — e.g. loadMembership() hitting a DB error
 * on a request-driven path — would otherwise surface as an unhandled rejection
 * and can crash the whole process. Wrapping converts that into a clean 500 for
 * the single request.
 */
function asyncMw(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const user = req.user as any;
  if (!req.isAuthenticated() || !user) return unauthorized(res);
  return next();
};

/** Read the active workspace id from `X-Company-Id` header, `?companyId=`, or
 *  fall back to the user's first membership.
 *
 *  The fallback `db.select` runs *before* `withCompanyScope` is attached
 *  (we don't yet know which workspace this request is scoped to), and it
 *  only reads the auth-tier `memberships` table which is intentionally out
 *  of `workspace_isolation` RLS scope (see design doc 'Tables intentionally
 *  out of scope'). The whole body is wrapped in `withUnscopedDb` so the
 *  task #193 runtime guard does not flag this legitimate path on every
 *  request — while keeping a grep-able audit marker. */
export async function resolveActiveCompanyId(req: Request, userId: string): Promise<number | null> {
  return withUnscopedDb("auth:resolve-active-company-id", async () => {
    const headerId = req.header("x-company-id");
    const queryId = (req.query.companyId as string | undefined) ?? undefined;
    const candidate = Number(headerId ?? queryId);
    if (Number.isFinite(candidate) && candidate > 0) return candidate;

    // Fallback when no workspace was specified: the user's OLDEST membership
    // (their "home" workspace). SECURITY/correctness (scan finding): this is
    // deterministic — a previous `.limit(1)` with no ORDER BY returned an
    // arbitrary workspace, so a multi-workspace user who omitted the header
    // could non-deterministically operate on the wrong one of THEIR OWN
    // workspaces between requests. It can only ever resolve to a workspace the
    // caller already belongs to (the WHERE pins userId), and loadMembership
    // re-verifies membership for whatever id is chosen, so this never grants
    // cross-tenant access — the fix is about predictability, not isolation.
    const [m] = await db
      .select({ companyId: memberships.companyId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt), asc(memberships.companyId))
      .limit(1);
    return m?.companyId ?? null;
  });
}

export interface MembershipContext {
  userId: string;
  companyId: number;
  role: Role;
}

/**
 * Loads the active membership for the signed-in user and the resolved company.
 * On miss → 403.
 *
 * Runs *before* `withCompanyScope` is attached — the whole point is to
 * decide which workspace scope to attach. Only reads the auth-tier
 * `memberships` table (intentionally out of `workspace_isolation` RLS
 * scope). Wrapped in `withUnscopedDb` so the task #193 runtime guard does
 * not flag this legitimate path on every request.
 */
export async function loadMembership(req: Request): Promise<MembershipContext | null> {
  return withUnscopedDb("auth:load-membership", async () => {
    const user = req.user as any;
        const userId = user?.id as string | undefined;
    if (!userId) return null;
    const companyId = await resolveActiveCompanyId(req, userId);
    if (!companyId) return null;
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)));
    if (!m) return null;
    return { userId, companyId, role: m.role as Role };
  });
}

export const attachMembership: RequestHandler = asyncMw(async (req, _res, next) => {
  const ctx = await loadMembership(req);
  if (ctx) (req as any).membership = ctx;
  next();
});

export function requireRole(...minRoles: Role[]): RequestHandler {
  // Allow if the user holds ANY of the listed roles (or higher tier than the lowest of them).
  const minTier = Math.min(...minRoles.map((r) => ROLE_TIER[r]));
  return asyncMw(async (req, res, next) => {
    const ctx = (req as any).membership as MembershipContext | undefined;
    if (!ctx) {
      const loaded = await loadMembership(req);
      if (!loaded) return res.status(403).json({ message: "Forbidden" });
      (req as any).membership = loaded;
      if (ROLE_TIER[loaded.role] >= minTier) return next();
      return res.status(403).json({ message: "Insufficient role" });
    }
    if (ROLE_TIER[ctx.role] >= minTier) return next();
    return res.status(403).json({ message: "Insufficient role" });
  });
}

/** Permissive default for the /api/* surface area:
 *  - GET / HEAD → any authenticated member
 *  - mutations  → owner or accountant only (viewers are read-only)
 */
export const requireWriteRoleForMutations: RequestHandler = asyncMw(async (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  // Lazy-load membership.
  let ctx = (req as any).membership as MembershipContext | undefined;
  if (!ctx) {
    const loaded = await loadMembership(req);
    if (!loaded) return res.status(403).json({ message: "Forbidden" });
    (req as any).membership = loaded;
    ctx = loaded;
  }
  if (ctx.role === "owner" || ctx.role === "accountant") return next();
  return res.status(403).json({
    message: "Viewers have read-only access and cannot modify data",
  });
});

/** Convenience: extract the signed-in userId or send 401. */
export function getUserIdOrThrow(req: Request): string {
  const id = (req.user as any)?.id as string | undefined;
  if (!id) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return id;
}
