import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db, withUnscopedDb } from "../db";
import { eq, and } from "drizzle-orm";
import { memberships, type Role, ROLE_TIER, users, companies } from "@shared/schema";
import * as client from "openid-client";
import memoize from "memoizee";

/**
 * Unified auth + role middleware.
 *
 * Sessions can be created two ways:
 *   1) Replit Auth (OIDC) — passport stores { claims, access_token, refresh_token, expires_at }
 *   2) Local email + password — we store { claims: { sub, email, first_name, last_name }, _local: true }
 *
 * `requireAuth` accepts both shapes. For OIDC sessions we transparently refresh
 * the access token when expired (re-using the same logic the blueprint provides).
 */

const getOidcConfig = memoize(
  async () =>
    client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!,
    ),
  { maxAge: 3600 * 1000 },
);

function unauthorized(res: Response, message = "Unauthorized") {
  res.status(401).json({ message });
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  if (!req.isAuthenticated() || !user) return unauthorized(res);

  // Local sessions never expire mid-flight; cookie maxAge handles lifetime.
  if (user._local) return next();

  // OIDC session — refresh if needed.
  if (!user.expires_at) return unauthorized(res);
  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) return next();

  const refreshToken = user.refresh_token;
  if (!refreshToken) return unauthorized(res);

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    user.claims = tokenResponse.claims();
    user.access_token = tokenResponse.access_token;
    user.refresh_token = tokenResponse.refresh_token;
    user.expires_at = user.claims?.exp;
    return next();
  } catch {
    return unauthorized(res);
  }
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

    // Fallback: any membership the user holds.
    const [m] = await db
      .select({ companyId: memberships.companyId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
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
    const userId = user?.claims?.sub as string | undefined;
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

export const attachMembership: RequestHandler = async (req, _res, next) => {
  const ctx = await loadMembership(req);
  if (ctx) (req as any).membership = ctx;
  next();
};

export function requireRole(...minRoles: Role[]): RequestHandler {
  // Allow if the user holds ANY of the listed roles (or higher tier than the lowest of them).
  const minTier = Math.min(...minRoles.map((r) => ROLE_TIER[r]));
  return async (req, res, next) => {
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
  };
}

/** Permissive default for the /api/* surface area:
 *  - GET / HEAD → any authenticated member
 *  - mutations  → owner or accountant only (viewers are read-only)
 */
export const requireWriteRoleForMutations: RequestHandler = async (req, res, next) => {
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
};

/** Convenience: extract the signed-in userId or send 401. */
export function getUserIdOrThrow(req: Request): string {
  const id = (req.user as any)?.claims?.sub as string | undefined;
  if (!id) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return id;
}
