import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  users,
  memberships,
  invitations,
  passwordResetTokens,
  companies,
  type User,
  type Membership,
  type Invitation,
  type Role,
} from "@shared/schema";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const authBizStorage = {
  // ---------- users ----------
  async getUserByEmail(email: string): Promise<User | undefined> {
    const e = email.trim().toLowerCase();
    const [u] = await db.select().from(users).where(eq(users.email, e));
    return u;
  },

  async createLocalUser(input: {
    email: string;
    passwordHash: string;
    firstName?: string | null;
    lastName?: string | null;
    preferredLocale?: "ar" | "en";
  }): Promise<User> {
    const [u] = await db
      .insert(users)
      .values({
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        provider: "local",
        preferredLocale: input.preferredLocale ?? "ar",
      })
      .returning();
    return u;
  },

  async updateUser(id: string, patch: Partial<typeof users.$inferInsert>): Promise<User> {
    const [u] = await db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return u;
  },

  async setPasswordHash(id: string, passwordHash: string) {
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
  },

  // ---------- session inspection (for "active sessions" UI + sign-out-others) ----------
  async listSessionsForUser(userId: string, currentSid?: string) {
    const rows = await db.execute(sql`
      SELECT sid, sess, expire
      FROM sessions
      WHERE sess->'passport'->'user'->'claims'->>'sub' = ${userId}
        AND expire > NOW()
      ORDER BY expire DESC
    `);
    const list = (rows as any).rows ?? (rows as any);
    return (list as Array<{ sid: string; sess: any; expire: Date }>).map((r) => ({
      sid: r.sid,
      expiresAt: r.expire,
      isCurrent: currentSid ? r.sid === currentSid : false,
      provider: r.sess?.passport?.user?._local ? "local" : "replit",
    }));
  },

  async deleteSessionsForUserExcept(userId: string, keepSid?: string) {
    if (keepSid) {
      await db.execute(sql`
        DELETE FROM sessions
        WHERE (sess->'passport'->'user'->>'_uid' = ${userId}
               OR sess->'passport'->'user'->'claims'->>'sub' = ${userId})
          AND sid <> ${keepSid}
      `);
    } else {
      await db.execute(sql`
        DELETE FROM sessions
        WHERE sess->'passport'->'user'->>'_uid' = ${userId}
           OR sess->'passport'->'user'->'claims'->>'sub' = ${userId}
      `);
    }
  },

  // ---------- memberships ----------
  async listMembershipsForUser(userId: string) {
    return db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        companyId: memberships.companyId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        company: companies,
      })
      .from(memberships)
      .leftJoin(companies, eq(companies.id, memberships.companyId))
      .where(eq(memberships.userId, userId))
      .orderBy(desc(memberships.createdAt));
  },

  async listMembersForCompany(companyId: number) {
    return db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        companyId: memberships.companyId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          provider: users.provider,
        },
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.companyId, companyId))
      .orderBy(memberships.createdAt);
  },

  async getMembership(userId: string, companyId: number): Promise<Membership | undefined> {
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)));
    return m;
  },

  async createMembership(input: { userId: string; companyId: number; role: Role }): Promise<Membership> {
    const [m] = await db.insert(memberships).values(input).returning();
    return m;
  },

  async updateMembershipRole(id: string, role: Role): Promise<Membership> {
    const [m] = await db.update(memberships).set({ role }).where(eq(memberships.id, id)).returning();
    return m;
  },

  async deleteMembership(id: string) {
    await db.delete(memberships).where(eq(memberships.id, id));
  },

  async countAdminsForCompany(companyId: number): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.role, "admin")));
    return rows[0]?.c ?? 0;
  },

  // ---------- invitations ----------
  async createInvitation(input: {
    companyId: number;
    invitedByUserId: string;
    email: string;
    role: Role;
    ttlHours?: number;
  }): Promise<Invitation> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + (input.ttlHours ?? 168) * 60 * 60 * 1000); // 7d
    const [inv] = await db
      .insert(invitations)
      .values({
        companyId: input.companyId,
        invitedByUserId: input.invitedByUserId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        token,
        expiresAt,
        status: "pending",
      })
      .returning();
    return inv;
  },

  async listInvitationsForCompany(companyId: number) {
    return db.select().from(invitations).where(eq(invitations.companyId, companyId)).orderBy(desc(invitations.createdAt));
  },

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [inv] = await db.select().from(invitations).where(eq(invitations.token, token));
    return inv;
  },

  async revokeInvitation(id: string): Promise<void> {
    await db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, id));
  },

  async resendInvitation(id: string): Promise<Invitation> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 168 * 60 * 60 * 1000);
    const [inv] = await db
      .update(invitations)
      .set({ token, expiresAt, status: "pending" })
      .where(eq(invitations.id, id))
      .returning();
    return inv;
  },

  async acceptInvitation(token: string, userId: string): Promise<Invitation> {
    const [inv] = await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: userId })
      .where(eq(invitations.token, token))
      .returning();
    return inv;
  },

  // ---------- password reset ----------
  async createPasswordResetToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await db.insert(passwordResetTokens).values({ userId, token, expiresAt });
    return { token, expiresAt };
  },

  async consumePasswordResetToken(token: string): Promise<{ userId: string } | null> {
    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token));
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    return { userId: row.userId };
  },

  // ---------- companies (workspace bootstrap) ----------
  async getCompanyById(id: number): Promise<typeof companies.$inferSelect | undefined> {
    const [c] = await db.select().from(companies).where(eq(companies.id, id));
    return c;
  },

  async createCompanyForOwner(ownerUserId: string, name: string): Promise<typeof companies.$inferSelect> {
    const [c] = await db
      .insert(companies)
      .values({
        name,
        functionalCurrency: "USD",
        currencySymbol: "$",
        isDefault: false,
        isActive: true,
        ownerUserId,
      })
      .returning();
    return c;
  },

  /** First-signup bootstrap: if the legacy seed companies have no owner,
   *  give the new user Admin membership on each so the seeded data is usable.
   *  Otherwise we provision them a fresh personal workspace. */
  async bootstrapWorkspaceForUser(userId: string, displayName: string): Promise<{ companyId: number; role: Role; bootstrapped: "adopted" | "created" }> {
    const orphan = await db
      .select()
      .from(companies)
      .where(sql`${companies.ownerUserId} IS NULL`);

    if (orphan.length > 0) {
      // First user adopts all orphan seed companies as owner + admin member.
      for (const c of orphan) {
        await db.update(companies).set({ ownerUserId: userId }).where(eq(companies.id, c.id));
        const existing = await this.getMembership(userId, c.id);
        if (!existing) {
          await this.createMembership({ userId, companyId: c.id, role: "admin" });
        }
      }
      const def = orphan.find((c) => c.isDefault) ?? orphan[0];
      return { companyId: def.id, role: "admin", bootstrapped: "adopted" };
    }

    // Otherwise create a fresh personal workspace.
    const c = await this.createCompanyForOwner(userId, `${displayName} — Workspace`);
    await this.createMembership({ userId, companyId: c.id, role: "admin" });
    return { companyId: c.id, role: "admin", bootstrapped: "created" };
  },
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
