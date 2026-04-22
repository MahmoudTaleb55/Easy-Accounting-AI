import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { workspaceMembers, workspaceInvites, type WorkspaceMember, type WorkspaceRole } from "@shared/schema";
import { eq, and, asc, count } from "drizzle-orm";
import crypto from "crypto";

const COOKIE_NAME = "wm_id";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year (seconds)

// Anonymous identity used for any request without a valid cookie *after* a
// workspace owner already exists. It carries the viewer role so the same
// write-gating logic blocks every mutation. It is never persisted.
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

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

// HMAC secret used to sign the identity cookie so a caller cannot impersonate
// another member by setting `wm_id=<their id>`. Falls back to a random secret
// generated once per process when no env value is configured (cookies do not
// need to survive a restart in dev).
const COOKIE_SECRET =
  process.env.SESSION_SECRET ||
  process.env.WM_COOKIE_SECRET ||
  crypto.randomBytes(32).toString("hex");

function signMemberId(id: number): string {
  const sig = crypto.createHmac("sha256", COOKIE_SECRET).update(String(id)).digest("hex").slice(0, 32);
  return `${id}.${sig}`;
}

function verifyMemberCookie(raw: string | undefined): number | null {
  if (!raw) return null;
  const [idStr, sig] = raw.split(".");
  if (!idStr || !sig) return null;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) return null;
  const expected = crypto.createHmac("sha256", COOKIE_SECRET).update(String(id)).digest("hex").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function setMemberCookie(res: Response, id: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = `${COOKIE_NAME}=${signMemberId(id)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax; HttpOnly${secure}`;
  res.setHeader("Set-Cookie", value);
}

async function workspaceMemberCount(): Promise<number> {
  const [row] = await db.select({ c: count() }).from(workspaceMembers);
  return Number(row?.c || 0);
}

/**
 * Resolves the workspace member behind the current request.
 *
 * The app does not yet have a real auth provider (tracked as a follow-up).
 * To keep that limitation from turning into a privilege-escalation, identity
 * is resolved as follows:
 *
 *   1. If the cookie points to a real, active member -> use them.
 *   2. Otherwise, if NO members exist in the workspace yet, this is the very
 *      first visitor: bootstrap them as the owner and pin the cookie.
 *   3. Otherwise (cookie missing/invalid AND a workspace already exists) the
 *      caller is anonymous. They get the read-only ANONYMOUS_MEMBER, so the
 *      same write-gating that protects viewers blocks every mutation.
 */
async function resolveCurrentMember(
  req: Request,
  res: Response,
): Promise<WorkspaceMember> {
  const cookies = parseCookies(req.headers.cookie);
  const id = verifyMemberCookie(cookies[COOKIE_NAME]);
  if (id !== null) {
    const found = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1);
    if (found.length > 0 && found[0].status === "active") return found[0];
  }

  if ((await workspaceMemberCount()) === 0) {
    const [created] = await db
      .insert(workspaceMembers)
      .values({
        name: "Workspace Owner",
        email: "owner@workspace.local",
        role: "owner",
        status: "active",
      })
      .returning();
    setMemberCookie(res, created.id);
    return created;
  }

  return ANONYMOUS_MEMBER;
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

  // Development-only helper to switch the active member while a real auth
  // provider is not yet wired up. Disabled outside development to prevent
  // privilege escalation, and additionally requires the current caller to
  // already be an owner so it cannot be used as a foothold.
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/auth/switch", async (req, res) => {
      if (req.member?.role !== "owner") {
        return res.status(403).json({ message: "owner only" });
      }
      const id = Number(req.body?.memberId);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ message: "memberId مطلوب" });
      }
      const found = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1);
      if (found.length === 0) return res.status(404).json({ message: "العضو غير موجود" });
      setMemberCookie(res, found[0].id);
      res.json({ id: found[0].id, name: found[0].name, role: found[0].role });
    });
  }

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

    setMemberCookie(res, memberId);
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

