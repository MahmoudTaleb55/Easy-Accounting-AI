import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  users,
  memberships,
  invitations,
  invitationEmailEvents,
  passwordResetTokens,
  passwordResetEmailEvents,
  companies,
  settings,
  type User,
  type Membership,
  type Invitation,
  type InvitationEmailEvent,
  type PasswordResetToken,
  type PasswordResetEmailEvent,
  type Role,
} from "@shared/schema";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { resolveCurrency } from "@shared/currencies";

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
      .set({
        token,
        expiresAt,
        status: "pending",
        // Reset delivery snapshot — the new send is what we'll judge from now.
        lastMessageId: null,
        lastEmailStatus: null,
        lastEmailError: null,
        lastEmailEventAt: null,
      })
      .where(eq(invitations.id, id))
      .returning();
    return inv;
  },

  // ---------- email lifecycle ----------
  async recordInvitationEmailEvent(input: {
    invitationId: string;
    messageId?: string | null;
    type: string;
    error?: string | null;
    payload?: unknown;
  }): Promise<InvitationEmailEvent> {
    const [row] = await db
      .insert(invitationEmailEvents)
      .values({
        invitationId: input.invitationId,
        messageId: input.messageId ?? null,
        type: input.type,
        error: input.error ?? null,
        payload: (input.payload as any) ?? null,
      })
      .returning();
    return row;
  },

  async updateInvitationEmailMeta(
    id: string,
    meta: { messageId?: string | null; status: string; error?: string | null; eventAt?: Date },
  ): Promise<void> {
    const set: Record<string, unknown> = {
      lastEmailStatus: meta.status,
      lastEmailError: meta.error ?? null,
      lastEmailEventAt: meta.eventAt ?? new Date(),
    };
    if (meta.messageId !== undefined) set.lastMessageId = meta.messageId;
    await db.update(invitations).set(set).where(eq(invitations.id, id));
  },

  async getInvitationByMessageId(messageId: string): Promise<Invitation | undefined> {
    const [inv] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.lastMessageId, messageId));
    return inv;
  },

  async listInvitationEmailEvents(invitationId: string): Promise<InvitationEmailEvent[]> {
    return db
      .select()
      .from(invitationEmailEvents)
      .where(eq(invitationEmailEvents.invitationId, invitationId))
      .orderBy(desc(invitationEmailEvents.createdAt));
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
  async createPasswordResetToken(userId: string): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    const [row] = await db
      .insert(passwordResetTokens)
      .values({ userId, token, expiresAt })
      .returning();
    return { id: row.id, token, expiresAt };
  },

  async recordPasswordResetEmailEvent(input: {
    tokenId: string;
    userId: string;
    messageId?: string | null;
    type: string;
    error?: string | null;
    payload?: unknown;
  }): Promise<PasswordResetEmailEvent> {
    const [row] = await db
      .insert(passwordResetEmailEvents)
      .values({
        tokenId: input.tokenId,
        userId: input.userId,
        messageId: input.messageId ?? null,
        type: input.type,
        error: input.error ?? null,
        payload: (input.payload as any) ?? null,
      })
      .returning();
    return row;
  },

  async updatePasswordResetEmailMeta(
    tokenId: string,
    meta: { messageId?: string | null; status: string; error?: string | null; eventAt?: Date },
  ): Promise<void> {
    const set: Record<string, unknown> = {
      lastEmailStatus: meta.status,
      lastEmailError: meta.error ?? null,
      lastEmailEventAt: meta.eventAt ?? new Date(),
    };
    if (meta.messageId !== undefined) set.lastMessageId = meta.messageId;
    await db.update(passwordResetTokens).set(set).where(eq(passwordResetTokens.id, tokenId));
  },

  async getPasswordResetTokenByMessageId(messageId: string): Promise<PasswordResetToken | undefined> {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.lastMessageId, messageId));
    return row;
  },

  async listPasswordResetEmailEventsForUser(userId: string): Promise<PasswordResetEmailEvent[]> {
    return db
      .select()
      .from(passwordResetEmailEvents)
      .where(eq(passwordResetEmailEvents.userId, userId))
      .orderBy(desc(passwordResetEmailEvents.createdAt));
  },

  async listPasswordResetEmailEventsForToken(tokenId: string): Promise<PasswordResetEmailEvent[]> {
    return db
      .select()
      .from(passwordResetEmailEvents)
      .where(eq(passwordResetEmailEvents.tokenId, tokenId))
      .orderBy(desc(passwordResetEmailEvents.createdAt));
  },

  async getPasswordResetTokenById(id: string): Promise<PasswordResetToken | undefined> {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.id, id));
    return row;
  },

  /**
   * Unified delivery feed for the workspace's transactional email transports.
   *
   * Each row is one *send attempt* — keyed by the provider's `message_id`
   * when one was issued, or by the local event id (prefixed `attempt:`)
   * when the send failed before a `message_id` could be assigned. This
   * matches Resend's dashboard model where a resend creates a brand-new
   * row instead of overwriting the previous attempt.
   *
   * Source of truth is the per-event tables (`invitation_email_events`,
   * `password_reset_email_events`); the denormalized `last_*` columns
   * on parent rows are only used for the badge in the Members list.
   *
   * New transports plug in by adding another `SELECT` branch with the
   * same projected columns. Filters are applied in SQL so admins
   * searching a long history don't pay the round-trip cost.
   */
  async listEmailDeliveriesForCompany(
    companyId: number,
    opts: { status?: string | null; email?: string | null; limit?: number } = {},
  ): Promise<
    Array<{
      transport: "invitation" | "password_reset";
      key: string;
      messageId: string | null;
      parentId: string;
      recipient: string;
      role: string | null;
      latestStatus: string;
      latestError: string | null;
      latestAt: string | null;
      firstAt: string | null;
    }>
  > {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 500));
    const status = opts.status?.trim() || null;
    const emailLike = opts.email?.trim() ? `%${opts.email.trim().toLowerCase()}%` : null;

    // Inner query: every event projected to a uniform shape, with a
    // `dedup_key` so resends/retries become distinct rows. Outer query
    // collapses to the most recent event per (transport, key) using
    // DISTINCT ON, then applies user filters.
    const rows = await db.execute(sql`
      WITH all_events AS (
        SELECT
          'invitation'::text                                          AS transport,
          COALESCE(e.message_id, 'attempt:' || e.id)                  AS dedup_key,
          e.message_id                                                AS message_id,
          e.invitation_id                                             AS parent_id,
          i.email                                                     AS recipient,
          i.role                                                      AS role,
          e.type                                                      AS type,
          e.error                                                     AS error,
          e.created_at                                                AS created_at
        FROM invitation_email_events e
        INNER JOIN invitations i ON i.id = e.invitation_id
        WHERE i.company_id = ${companyId}

        UNION ALL

        SELECT
          'password_reset'::text                                      AS transport,
          COALESCE(e.message_id, 'attempt:' || e.id)                  AS dedup_key,
          e.message_id                                                AS message_id,
          e.token_id                                                  AS parent_id,
          COALESCE(u.email, '')                                       AS recipient,
          NULL::text                                                  AS role,
          e.type                                                      AS type,
          e.error                                                     AS error,
          e.created_at                                                AS created_at
        FROM password_reset_email_events e
        INNER JOIN memberships m ON m.user_id = e.user_id AND m.company_id = ${companyId}
        LEFT JOIN users u ON u.id = e.user_id
      ),
      latest_per_message AS (
        SELECT DISTINCT ON (transport, dedup_key)
          transport,
          dedup_key,
          message_id,
          parent_id,
          recipient,
          role,
          type        AS latest_status,
          error       AS latest_error,
          created_at  AS latest_at
        FROM all_events
        ORDER BY transport, dedup_key, created_at DESC
      ),
      first_per_message AS (
        SELECT transport, dedup_key, MIN(created_at) AS first_at
        FROM all_events
        GROUP BY transport, dedup_key
      )
      SELECT
        l.transport,
        l.dedup_key,
        l.message_id,
        l.parent_id,
        l.recipient,
        l.role,
        l.latest_status,
        l.latest_error,
        l.latest_at,
        f.first_at
      FROM latest_per_message l
      JOIN first_per_message f
        ON f.transport = l.transport AND f.dedup_key = l.dedup_key
      WHERE
        (${status}::text IS NULL OR l.latest_status = ${status}::text)
        AND (${emailLike}::text IS NULL OR LOWER(l.recipient) LIKE ${emailLike}::text)
      ORDER BY l.latest_at DESC NULLS LAST
      LIMIT ${limit}
    `);
    const list = (rows as any).rows ?? (rows as any);
    return (list as any[]).map((r) => ({
      transport: r.transport,
      key: r.dedup_key,
      messageId: r.message_id,
      parentId: r.parent_id,
      recipient: r.recipient ?? "",
      role: r.role,
      latestStatus: r.latest_status,
      latestError: r.latest_error,
      latestAt: r.latest_at,
      firstAt: r.first_at,
    }));
  },

  /**
   * Per-message lifecycle log for the unified delivery feed. Returns
   * every event for a single send attempt (one provider message id, or
   * one local attempt id when the send failed pre-dispatch), scoped to
   * the calling workspace so admins can't peek at another workspace's
   * deliveries.
   *
   * `key` is what `listEmailDeliveriesForCompany` returned: either a
   * raw provider message_id or `attempt:<eventId>` for a failed
   * pre-dispatch attempt.
   */
  async listEmailDeliveryEvents(
    transport: "invitation" | "password_reset",
    companyId: number,
    key: string,
  ): Promise<
    Array<{
      id: string;
      messageId: string | null;
      type: string;
      error: string | null;
      createdAt: string | null;
    }>
  > {
    const isAttempt = key.startsWith("attempt:");
    const attemptId = isAttempt ? key.slice("attempt:".length) : null;

    if (transport === "invitation") {
      const rows = await db.execute(sql`
        SELECT e.id, e.message_id, e.type, e.error, e.created_at
        FROM invitation_email_events e
        INNER JOIN invitations i ON i.id = e.invitation_id
        WHERE i.company_id = ${companyId}
          AND (
            (${attemptId}::text IS NOT NULL AND e.id = ${attemptId}::text)
            OR (${attemptId}::text IS NULL AND e.message_id = ${key}::text)
          )
        ORDER BY e.created_at DESC
      `);
      const list = (rows as any).rows ?? (rows as any);
      return (list as any[]).map((r) => ({
        id: r.id,
        messageId: r.message_id,
        type: r.type,
        error: r.error,
        createdAt: r.created_at,
      }));
    }

    const rows = await db.execute(sql`
      SELECT e.id, e.message_id, e.type, e.error, e.created_at
      FROM password_reset_email_events e
      INNER JOIN memberships m ON m.user_id = e.user_id AND m.company_id = ${companyId}
      WHERE
        (
          (${attemptId}::text IS NOT NULL AND e.id = ${attemptId}::text)
          OR (${attemptId}::text IS NULL AND e.message_id = ${key}::text)
        )
      ORDER BY e.created_at DESC
    `);
    const list = (rows as any).rows ?? (rows as any);
    return (list as any[]).map((r) => ({
      id: r.id,
      messageId: r.message_id,
      type: r.type,
      error: r.error,
      createdAt: r.created_at,
    }));
  },

  /**
   * Daily counts of failure-class email events over a rolling window
   * (default 7 days), aggregated across both invitation and
   * password-reset transports for a single workspace. Backs the
   * trend chips + sparklines on /settings/email-delivery.
   *
   * The result is densified server-side: every day in the window
   * appears in the series even when count = 0, so the frontend can
   * render a stable-length sparkline without gap-filling logic.
   *
   * Only the three failure-class types matter for sender-reputation
   * monitoring — bounced, complained (spam reports) and send_failed
   * — so other event types are filtered out in SQL to keep the
   * payload small.
   */
  async getEmailDeliveryFailureTrends(
    companyId: number,
    opts: { days?: number } = {},
  ): Promise<{
    days: number;
    start: string;
    end: string;
    series: {
      bounced: { date: string; count: number }[];
      complained: { date: string; count: number }[];
      send_failed: { date: string; count: number }[];
    };
    totals: { bounced: number; complained: number; send_failed: number };
  }> {
    const days = Math.max(1, Math.min(opts.days ?? 7, 90));
    const rows = await db.execute(sql`
      WITH window_days AS (
        SELECT generate_series(
          (CURRENT_DATE - (${days - 1}::int))::date,
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      ),
      failure_events AS (
        SELECT e.type, e.created_at
        FROM invitation_email_events e
        INNER JOIN invitations i ON i.id = e.invitation_id
        WHERE i.company_id = ${companyId}
          AND e.type IN ('bounced','complained','send_failed')
          AND e.created_at >= (CURRENT_DATE - (${days - 1}::int))::date

        UNION ALL

        SELECT e.type, e.created_at
        FROM password_reset_email_events e
        INNER JOIN memberships m ON m.user_id = e.user_id AND m.company_id = ${companyId}
        WHERE e.type IN ('bounced','complained','send_failed')
          AND e.created_at >= (CURRENT_DATE - (${days - 1}::int))::date
      ),
      event_types AS (
        SELECT unnest(ARRAY['bounced','complained','send_failed']) AS type
      ),
      grid AS (
        SELECT d.day, t.type
        FROM window_days d CROSS JOIN event_types t
      ),
      counted AS (
        SELECT
          (created_at AT TIME ZONE 'UTC')::date AS day,
          type,
          COUNT(*)::int AS count
        FROM failure_events
        GROUP BY 1, 2
      )
      SELECT
        to_char(g.day, 'YYYY-MM-DD') AS day,
        g.type                       AS type,
        COALESCE(c.count, 0)         AS count
      FROM grid g
      LEFT JOIN counted c ON c.day = g.day AND c.type = g.type
      ORDER BY g.day ASC, g.type ASC
    `);
    const list = (rows as any).rows ?? (rows as any);
    const series = {
      bounced: [] as { date: string; count: number }[],
      complained: [] as { date: string; count: number }[],
      send_failed: [] as { date: string; count: number }[],
    };
    const totals = { bounced: 0, complained: 0, send_failed: 0 };
    for (const r of list as any[]) {
      const t = r.type as keyof typeof series;
      if (!series[t]) continue;
      const count = Number(r.count) || 0;
      series[t].push({ date: r.day, count });
      totals[t] += count;
    }
    const start = series.bounced[0]?.date ?? "";
    const end = series.bounced[series.bounced.length - 1]?.date ?? "";
    return { days, start, end, series, totals };
  },

  async listPasswordResetTokensForUser(userId: string): Promise<PasswordResetToken[]> {
    return db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId))
      .orderBy(desc(passwordResetTokens.createdAt));
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

  async createCompanyForOwner(
    ownerUserId: string,
    name: string,
    opts?: { currencyCode?: string },
  ): Promise<typeof companies.$inferSelect> {
    // Symbol is derived server-side from the canonical catalogue — never
    // trusted from caller input — to keep accounting defaults consistent.
    const { code: currencyCode, symbol: currencySymbol } = resolveCurrency(opts?.currencyCode);

    // All-or-nothing: a company without its settings row would leave the
    // workspace bootstrap half-complete, so wrap both writes in a tx.
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(companies)
        .values({
          name,
          functionalCurrency: currencyCode,
          currencySymbol,
          isDefault: false,
          isActive: true,
          ownerUserId,
        })
        .returning();

      await tx.insert(settings).values({
        companyId: c.id,
        currencyCode,
        currencySymbol,
      });

      return c;
    });
  },

  /** First-signup bootstrap: if the legacy seed companies have no owner,
   *  give the new user Admin membership on each so the seeded data is usable.
   *  Otherwise we provision them a fresh personal workspace. */
  async bootstrapWorkspaceForUser(
    userId: string,
    displayName: string,
    opts?: { currencyCode?: string },
  ): Promise<{ companyId: number; role: Role; bootstrapped: "adopted" | "created" }> {
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
    const c = await this.createCompanyForOwner(userId, `${displayName} — Workspace`, opts);
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
