import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  users,
  memberships,
  invitations,
  invitationEmailEvents,
  passwordResetTokens,
  passwordResetEmailEvents,
  companies,
  settings,
  emailDeliveryAlertSettings,
  emailDeliveryAlerts,
  emailDeliveryAlertRecipients,
  type User,
  type Membership,
  type Invitation,
  type InvitationEmailEvent,
  type PasswordResetToken,
  type PasswordResetEmailEvent,
  type EmailDeliveryAlertSettings,
  type EmailDeliveryAlert,
  type EmailDeliveryAlertRecipient,
  type Role,
} from "@shared/schema";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { resolveCurrency } from "@shared/currencies";

// Coerce a date-window query param into a Postgres-friendly ISO timestamp,
// or null if the caller didn't supply one / it can't be parsed.
//
// `from`: lower bound is inclusive — `YYYY-MM-DD` becomes that day at 00:00.
// `to`: upper bound is exclusive in SQL but inclusive of the calendar day
// when only a date was supplied, so bump bare dates by one day. Full ISO
// timestamps with a time component are passed through unchanged.
function normalizeFromBound(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const d = parseDateOnly(v);
  if (d) return d.toISOString();
  const ts = new Date(v);
  return Number.isFinite(ts.getTime()) ? ts.toISOString() : null;
}

function normalizeToBound(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const d = parseDateOnly(v);
  if (d) {
    // Bump bare YYYY-MM-DD by 24h so the upper bound covers the whole day.
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  const ts = new Date(v);
  return Number.isFinite(ts.getTime()) ? ts.toISOString() : null;
}

function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

// In-memory TTL cache for the email-delivery count endpoint.
//
// /settings/email-delivery refetches the count on every (debounced)
// keystroke in the recipient filter, plus on tab focus and from
// sibling browser tabs. The underlying CTE — UNION across both
// transports' event tables, DISTINCT ON to collapse to one row per
// send attempt — does tens of thousands of row reads on workspaces
// with months of history. A short TTL keyed by company + the
// normalized filter signature collapses repeated probes for the same
// filter combo into one query while keeping the chip within a few
// seconds of fresh.
//
// 5s is short enough that we don't need explicit invalidation when a
// new event is appended; the cap on entries keeps memory bounded
// when admins page through many filter combos.
const EMAIL_DELIVERY_COUNT_TTL_MS = 5_000;
const EMAIL_DELIVERY_COUNT_CACHE_MAX = 256;
type EmailDeliveryCountEntry = { value: number; expiresAt: number };
const emailDeliveryCountCache = new Map<string, EmailDeliveryCountEntry>();

function emailDeliveryCountCacheKey(
  companyId: number,
  status: string | null,
  emailLike: string | null,
  from: string | null,
  to: string | null,
): string {
  return JSON.stringify([companyId, status, emailLike, from, to]);
}

/**
 * Test-only escape hatch: drop every entry from the count cache.
 * Real call sites shouldn't need this — the TTL is short enough that
 * any staleness is bounded — but tests that assert "the count
 * reflects the row I just inserted" need to bypass the cache.
 */
export function clearEmailDeliveryCountCache(): void {
  emailDeliveryCountCache.clear();
}

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

  async countOwnersForCompany(companyId: number): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.role, "owner")));
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
    opts: {
      status?: string | null;
      email?: string | null;
      limit?: number;
      // ISO timestamps (or YYYY-MM-DD). Filter the union by event
      // `created_at`. `from` is inclusive; `to` is inclusive of the
      // whole calendar day when only a date is supplied.
      from?: string | null;
      to?: string | null;
      // CSV exports for a date window can legitimately be much larger
      // than the on-screen list, so callers can opt in to a higher cap.
      maxLimit?: number;
    } = {},
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
    const hardCap = Math.max(1, Math.min(opts.maxLimit ?? 500, 10000));
    const limit = Math.max(1, Math.min(opts.limit ?? 200, hardCap));
    const status = opts.status?.trim() || null;
    const emailLike = opts.email?.trim() ? `%${opts.email.trim().toLowerCase()}%` : null;
    // Normalize date bounds. A bare `YYYY-MM-DD` for `to` should cover
    // the entire day, so bump it to the next midnight and use a `<`
    // comparison in SQL.
    const from = normalizeFromBound(opts.from);
    const to = normalizeToBound(opts.to);

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
          AND (${from}::timestamptz IS NULL OR e.created_at >= ${from}::timestamptz)
          AND (${to}::timestamptz   IS NULL OR e.created_at <  ${to}::timestamptz)

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
        WHERE
          (${from}::timestamptz IS NULL OR e.created_at >= ${from}::timestamptz)
          AND (${to}::timestamptz IS NULL OR e.created_at <  ${to}::timestamptz)
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
   * Companion count for `listEmailDeliveriesForCompany` — returns how many
   * rows a CSV export with the same filters would produce. Used by the
   * delivery-health UI to show the row count next to the Download CSV
   * button so admins can tell at a glance whether they need to narrow
   * the window before pulling the file.
   *
   * The shape of the underlying query mirrors the list query (same CTEs,
   * same filters) — the only difference is the outer projection counts
   * collapsed (transport, dedup_key) groups instead of returning rows.
   * No `LIMIT` is applied so the caller can compare the true count to
   * the export cap and warn when the export will be truncated.
   */
  async countEmailDeliveriesForCompany(
    companyId: number,
    opts: {
      status?: string | null;
      email?: string | null;
      from?: string | null;
      to?: string | null;
    } = {},
  ): Promise<number> {
    const status = opts.status?.trim() || null;
    const emailLike = opts.email?.trim() ? `%${opts.email.trim().toLowerCase()}%` : null;
    const from = normalizeFromBound(opts.from);
    const to = normalizeToBound(opts.to);

    // Short TTL cache: collapse the keystroke-rate of probes for the
    // same filter combo into a single query, but stay fresh enough
    // that a newly arrived event shows up within a few seconds.
    const cacheKey = emailDeliveryCountCacheKey(
      companyId,
      status,
      emailLike,
      from,
      to,
    );
    const now = Date.now();
    const cached = emailDeliveryCountCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const rows = await db.execute(sql`
      WITH all_events AS (
        SELECT
          'invitation'::text                                          AS transport,
          COALESCE(e.message_id, 'attempt:' || e.id)                  AS dedup_key,
          i.email                                                     AS recipient,
          e.type                                                      AS type,
          e.created_at                                                AS created_at
        FROM invitation_email_events e
        INNER JOIN invitations i ON i.id = e.invitation_id
        WHERE i.company_id = ${companyId}
          AND (${from}::timestamptz IS NULL OR e.created_at >= ${from}::timestamptz)
          AND (${to}::timestamptz   IS NULL OR e.created_at <  ${to}::timestamptz)

        UNION ALL

        SELECT
          'password_reset'::text                                      AS transport,
          COALESCE(e.message_id, 'attempt:' || e.id)                  AS dedup_key,
          COALESCE(u.email, '')                                       AS recipient,
          e.type                                                      AS type,
          e.created_at                                                AS created_at
        FROM password_reset_email_events e
        INNER JOIN memberships m ON m.user_id = e.user_id AND m.company_id = ${companyId}
        LEFT JOIN users u ON u.id = e.user_id
        WHERE
          (${from}::timestamptz IS NULL OR e.created_at >= ${from}::timestamptz)
          AND (${to}::timestamptz IS NULL OR e.created_at <  ${to}::timestamptz)
      ),
      latest_per_message AS (
        SELECT DISTINCT ON (transport, dedup_key)
          transport,
          dedup_key,
          recipient,
          type AS latest_status
        FROM all_events
        ORDER BY transport, dedup_key, created_at DESC
      )
      SELECT COUNT(*)::bigint AS n
      FROM latest_per_message l
      WHERE
        (${status}::text IS NULL OR l.latest_status = ${status}::text)
        AND (${emailLike}::text IS NULL OR LOWER(l.recipient) LIKE ${emailLike}::text)
    `);
    const list = (rows as any).rows ?? (rows as any);
    const n = list?.[0]?.n;
    const count = typeof n === "bigint" ? Number(n) : Number(n ?? 0);

    // Bound memory: when the cap is reached, drop the oldest entry.
    // Map preserves insertion order so this is effectively FIFO,
    // which is fine — entries expire on a short TTL anyway.
    if (emailDeliveryCountCache.size >= EMAIL_DELIVERY_COUNT_CACHE_MAX) {
      const oldest = emailDeliveryCountCache.keys().next().value;
      if (oldest !== undefined) emailDeliveryCountCache.delete(oldest);
    }
    emailDeliveryCountCache.set(cacheKey, {
      value: count,
      expiresAt: now + EMAIL_DELIVERY_COUNT_TTL_MS,
    });
    return count;
  },

  /**
   * Cheap "has the workspace ever produced any email-delivery event?"
   * probe used by the Recent sends card to distinguish "empty because
   * filters" from "empty because nothing has ever been sent". Avoids
   * the full count CTE — a pair of `EXISTS` subselects across the two
   * event tables is enough to answer truthy/falsy and lets the planner
   * stop at the first matching row.
   */
  async hasAnyEmailDeliveryForCompany(companyId: number): Promise<boolean> {
    const rows = await db.execute(sql`
      SELECT (
        EXISTS (
          SELECT 1
          FROM invitation_email_events e
          INNER JOIN invitations i ON i.id = e.invitation_id
          WHERE i.company_id = ${companyId}
        )
        OR EXISTS (
          SELECT 1
          FROM password_reset_email_events e
          INNER JOIN memberships m
            ON m.user_id = e.user_id AND m.company_id = ${companyId}
        )
      ) AS has_any
    `);
    const list = (rows as any).rows ?? (rows as any);
    return list?.[0]?.has_any === true;
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
    const created = await db.transaction(async (tx) => {
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
    // Seed the default chart of accounts for the new workspace so the first
    // quick transaction (auto-posted JE) and payroll run can immediately
    // resolve cash/revenue/expense accounts by code. Done outside the tx
    // because the seed touches a separate code path and is idempotent if
    // re-run, while a failure here should not roll back the company itself.
    const { seedDefaultCoaForCompany } = await import("../init-coa");
    await seedDefaultCoaForCompany(created.id);
    return created;
  },

  // ---------- email delivery alerting ----------

  /**
   * Default alert configuration applied when a workspace has not yet written
   * its own row. Mirrors the column defaults in the schema so the evaluator
   * can run identically whether or not a row exists.
   */
  defaultEmailDeliveryAlertSettings(companyId: number): EmailDeliveryAlertSettings {
    return {
      companyId,
      enabled: true,
      emailEnabled: false,
      windowHours: 24,
      absoluteThreshold: 5,
      ratioThreshold: "0.0200",
      minSamplesForRatio: 20,
      cooldownMinutes: 360,
      cooldownClearedAt: null,
      updatedAt: null,
      updatedByUserId: null,
    };
  },

  async getEmailDeliveryAlertSettings(companyId: number): Promise<EmailDeliveryAlertSettings> {
    const [row] = await db
      .select()
      .from(emailDeliveryAlertSettings)
      .where(eq(emailDeliveryAlertSettings.companyId, companyId));
    if (row) return row;
    return this.defaultEmailDeliveryAlertSettings(companyId);
  },

  async upsertEmailDeliveryAlertSettings(
    companyId: number,
    patch: {
      enabled: boolean;
      emailEnabled: boolean;
      windowHours: number;
      absoluteThreshold: number;
      ratioThreshold: number;
      minSamplesForRatio: number;
      cooldownMinutes: number;
      updatedByUserId?: string | null;
    },
  ): Promise<EmailDeliveryAlertSettings> {
    // Ratio is stored as a decimal string to keep numeric column precision.
    const ratioStr = patch.ratioThreshold.toFixed(4);
    const values = {
      companyId,
      enabled: patch.enabled,
      emailEnabled: patch.emailEnabled,
      windowHours: patch.windowHours,
      absoluteThreshold: patch.absoluteThreshold,
      ratioThreshold: ratioStr,
      minSamplesForRatio: patch.minSamplesForRatio,
      cooldownMinutes: patch.cooldownMinutes,
      updatedAt: new Date(),
      updatedByUserId: patch.updatedByUserId ?? null,
    };
    const [row] = await db
      .insert(emailDeliveryAlertSettings)
      .values(values)
      .onConflictDoUpdate({
        target: emailDeliveryAlertSettings.companyId,
        set: {
          enabled: values.enabled,
          emailEnabled: values.emailEnabled,
          windowHours: values.windowHours,
          absoluteThreshold: values.absoluteThreshold,
          ratioThreshold: values.ratioThreshold,
          minSamplesForRatio: values.minSamplesForRatio,
          cooldownMinutes: values.cooldownMinutes,
          updatedAt: values.updatedAt,
          updatedByUserId: values.updatedByUserId,
        },
      })
      .returning();
    return row;
  },

  /**
   * Roll-up of failure-class events vs all send attempts in a rolling
   * window for a single workspace. The ratio numerator counts only
   * failure-class events; the denominator counts every recorded send
   * attempt (sent / send_failed / not_configured) so the ratio reflects
   * "what fraction of recent outbound mail blew up".
   *
   * Rolling cutoff is `now - windowHours` (not midnight-aligned) because
   * the evaluator runs throughout the day and admins want a true rolling
   * read, not a calendar-day snapshot.
   */
  async getEmailDeliveryFailureWindow(
    companyId: number,
    windowHours: number,
  ): Promise<{
    bounced: number;
    complained: number;
    sendFailed: number;
    failures: number;
    sends: number;
    windowHours: number;
  }> {
    const hours = Math.max(1, Math.min(windowHours, 168));
    type Row = {
      bounced: number | string | null;
      complained: number | string | null;
      send_failed: number | string | null;
      sends: number | string | null;
    };
    const result = await db.execute<Row>(sql`
      WITH all_events AS (
        SELECT e.type
        FROM invitation_email_events e
        INNER JOIN invitations i ON i.id = e.invitation_id
        WHERE i.company_id = ${companyId}
          AND e.created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')

        UNION ALL

        SELECT e.type
        FROM password_reset_email_events e
        INNER JOIN memberships m
          ON m.user_id = e.user_id AND m.company_id = ${companyId}
        WHERE e.created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
      )
      SELECT
        COUNT(*) FILTER (WHERE type = 'bounced')::int        AS bounced,
        COUNT(*) FILTER (WHERE type = 'complained')::int     AS complained,
        COUNT(*) FILTER (WHERE type = 'send_failed')::int    AS send_failed,
        COUNT(*) FILTER (WHERE type IN ('sent','send_failed','not_configured'))::int AS sends
      FROM all_events
    `);
    const r: Partial<Row> = result.rows[0] ?? {};
    const bounced = Number(r.bounced) || 0;
    const complained = Number(r.complained) || 0;
    const sendFailed = Number(r.send_failed) || 0;
    return {
      bounced,
      complained,
      sendFailed,
      failures: bounced + complained + sendFailed,
      sends: Number(r.sends) || 0,
      windowHours: hours,
    };
  },

  async getActiveEmailDeliveryAlert(
    companyId: number,
  ): Promise<EmailDeliveryAlert | undefined> {
    const [row] = await db
      .select()
      .from(emailDeliveryAlerts)
      .where(
        and(
          eq(emailDeliveryAlerts.companyId, companyId),
          isNull(emailDeliveryAlerts.dismissedAt),
        ),
      )
      .orderBy(desc(emailDeliveryAlerts.firedAt))
      .limit(1);
    return row;
  },

  async getMostRecentEmailDeliveryAlert(
    companyId: number,
  ): Promise<EmailDeliveryAlert | undefined> {
    const [row] = await db
      .select()
      .from(emailDeliveryAlerts)
      .where(eq(emailDeliveryAlerts.companyId, companyId))
      .orderBy(desc(emailDeliveryAlerts.firedAt))
      .limit(1);
    return row;
  },

  async createEmailDeliveryAlert(input: {
    companyId: number;
    windowHours: number;
    failureCount: number;
    sendCount: number;
    reason: "absolute" | "ratio";
    snapshot: { bounced: number; complained: number; send_failed: number };
    emailSent: boolean;
    emailRecipients: number;
  }): Promise<EmailDeliveryAlert> {
    const [row] = await db
      .insert(emailDeliveryAlerts)
      .values({
        companyId: input.companyId,
        windowHours: input.windowHours,
        failureCount: input.failureCount,
        sendCount: input.sendCount,
        reason: input.reason,
        snapshot: input.snapshot,
        emailSent: input.emailSent,
        emailRecipients: input.emailRecipients,
      })
      .returning();
    return row;
  },

  /**
   * Append per-recipient outcome rows for a fired alert. Each call writes
   * one row per address, including failures, so the dedupe and retry
   * passes have a complete attempt log to read from.
   */
  async recordEmailDeliveryAlertRecipientOutcomes(input: {
    alertId: string;
    companyId: number;
    reason: "absolute" | "ratio";
    outcomes: Array<{
      email: string;
      status: "sent" | "failed";
      error?: string | null;
    }>;
  }): Promise<void> {
    if (input.outcomes.length === 0) return;
    await db.insert(emailDeliveryAlertRecipients).values(
      input.outcomes.map((o) => ({
        alertId: input.alertId,
        companyId: input.companyId,
        email: o.email.trim().toLowerCase(),
        reason: input.reason,
        status: o.status,
        error: o.error ?? null,
      })),
    );
  },

  /**
   * Set of addresses that successfully received an alert email for the
   * given workspace + reason within the last `dedupeHours`. The evaluator
   * skips these addresses on the *next* fire so a flapping provider can't
   * spam the same owner with near-identical alerts.
   *
   * Stored emails are lowercased on insert (see
   * `recordEmailDeliveryAlertRecipientOutcomes`) so this comparison is
   * case-stable; callers should normalise their candidate list the same
   * way before doing membership checks.
   */
  async listRecentlyAlertedRecipients(
    companyId: number,
    reason: "absolute" | "ratio",
    dedupeHours: number,
  ): Promise<Set<string>> {
    const hours = Math.max(0, dedupeHours);
    if (hours === 0) return new Set();
    const result = await db.execute<{ email: string }>(sql`
      SELECT DISTINCT lower(email) AS email
      FROM email_delivery_alert_recipients
      WHERE company_id = ${companyId}
        AND reason = ${reason}
        AND status = 'sent'
        AND attempted_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
    `);
    return new Set(result.rows.map((r) => r.email));
  },

  /**
   * Alerts that have at least one recipient whose most recent attempt
   * within `retryMinutes` ended in 'failed' (and we never landed a 'sent'
   * to that address since). Each returned alert carries the list of
   * addresses to retry. The evaluator re-attempts these addresses on the
   * next sweep without waiting for the cooldown to expire — that's the
   * whole point: a transient SMTP error shouldn't make an owner miss the
   * alert until the next firing.
   */
  async listEmailDeliveryAlertRetries(
    companyId: number,
    retryMinutes: number,
  ): Promise<Array<{ alert: EmailDeliveryAlert; emails: string[] }>> {
    const minutes = Math.max(0, retryMinutes);
    if (minutes === 0) return [];
    type Row = {
      alert_id: string;
      email: string;
    };
    const result = await db.execute<Row>(sql`
      SELECT DISTINCT r.alert_id, lower(r.email) AS email
      FROM email_delivery_alert_recipients r
      WHERE r.company_id = ${companyId}
        AND r.status = 'failed'
        AND r.attempted_at >= NOW() - (${minutes}::int * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM email_delivery_alert_recipients s
          WHERE s.alert_id = r.alert_id
            AND lower(s.email) = lower(r.email)
            AND s.status = 'sent'
        )
    `);
    const rows = result.rows;
    if (rows.length === 0) return [];
    const grouped = new Map<string, Set<string>>();
    for (const r of rows) {
      let set = grouped.get(r.alert_id);
      if (!set) {
        set = new Set();
        grouped.set(r.alert_id, set);
      }
      set.add(r.email);
    }
    const alerts = await db
      .select()
      .from(emailDeliveryAlerts)
      .where(eq(emailDeliveryAlerts.companyId, companyId));
    const byId = new Map(alerts.map((a) => [a.id, a]));
    const out: Array<{ alert: EmailDeliveryAlert; emails: string[] }> = [];
    grouped.forEach((emails, alertId) => {
      const alert = byId.get(alertId);
      if (!alert) return;
      out.push({ alert, emails: Array.from(emails) });
    });
    return out;
  },

  /**
   * Bump an alert's denormalized success counter when a retry lands. We
   * keep the counter on the alert row (not just in the recipient log) so
   * the in-app banner's "delivered to N owners" line reflects retries
   * without a join.
   */
  async incrementEmailDeliveryAlertRecipientCount(
    alertId: string,
    delta: number,
  ): Promise<void> {
    if (delta <= 0) return;
    await db
      .update(emailDeliveryAlerts)
      .set({
        emailRecipients: sql`${emailDeliveryAlerts.emailRecipients} + ${delta}`,
        emailSent: true,
      })
      .where(eq(emailDeliveryAlerts.id, alertId));
  },

  async listEmailDeliveryAlertRecipients(
    alertId: string,
  ): Promise<EmailDeliveryAlertRecipient[]> {
    return db
      .select()
      .from(emailDeliveryAlertRecipients)
      .where(eq(emailDeliveryAlertRecipients.alertId, alertId))
      .orderBy(desc(emailDeliveryAlertRecipients.attemptedAt));
  },

  /**
   * Workspace-scoped existence check by id. Used by the per-row Re-arm
   * route to validate a UUID belongs to the caller's workspace without
   * scanning a bounded `listRecent` window (which would false-404 older
   * rows once a workspace has > N firings).
   */
  async getEmailDeliveryAlertById(
    id: string,
    companyId: number,
  ): Promise<EmailDeliveryAlert | undefined> {
    const [row] = await db
      .select()
      .from(emailDeliveryAlerts)
      .where(
        and(
          eq(emailDeliveryAlerts.id, id),
          eq(emailDeliveryAlerts.companyId, companyId),
        ),
      )
      .limit(1);
    return row;
  },

  async dismissEmailDeliveryAlert(
    id: string,
    companyId: number,
    userId: string,
  ): Promise<EmailDeliveryAlert | undefined> {
    const [row] = await db
      .update(emailDeliveryAlerts)
      .set({ dismissedAt: new Date(), dismissedByUserId: userId })
      .where(
        and(
          eq(emailDeliveryAlerts.id, id),
          eq(emailDeliveryAlerts.companyId, companyId),
        ),
      )
      .returning();
    return row;
  },

  /**
   * Recent alert firings for a workspace, joined with the dismissing user's
   * display name so the audit log on /app/settings/email-delivery can show
   * "dismissed by Alice 5m ago" without a second round-trip. Bounded by
   * `limit` so the response stays small even after years of evaluator runs.
   */
  async listRecentEmailDeliveryAlerts(
    companyId: number,
    limit = 20,
  ): Promise<
    Array<
      EmailDeliveryAlert & {
        dismissedByName: string | null;
        dismissedByEmail: string | null;
      }
    >
  > {
    const cap = Math.max(1, Math.min(limit, 100));
    const rows = await db
      .select({
        alert: emailDeliveryAlerts,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(emailDeliveryAlerts)
      .leftJoin(users, eq(users.id, emailDeliveryAlerts.dismissedByUserId))
      .where(eq(emailDeliveryAlerts.companyId, companyId))
      .orderBy(desc(emailDeliveryAlerts.firedAt))
      .limit(cap);
    return rows.map((r) => {
      const name =
        [r.firstName, r.lastName].filter((p) => p && p.trim().length > 0).join(" ").trim() ||
        null;
      return {
        ...r.alert,
        dismissedByName: name,
        dismissedByEmail: r.email ?? null,
      };
    });
  },

  /**
   * Force the next evaluator pass for this workspace to ignore the cooldown
   * window. Non-destructive — sets a one-shot `cooldownClearedAt` timestamp
   * on the per-workspace settings row instead of mutating any historical
   * `firedAt` (which would corrupt the audit log). The evaluator consults
   * this timestamp in addition to the firedAt-vs-cooldown comparison; once
   * the next alert fires (newer firedAt), the bypass naturally becomes
   * inert until set again. Returns `false` when there's nothing to re-arm
   * (no recent alert, so the evaluator wasn't gated to begin with).
   */
  async clearEmailDeliveryAlertCooldown(companyId: number): Promise<boolean> {
    const last = await this.getMostRecentEmailDeliveryAlert(companyId);
    if (!last) return false;
    const now = new Date();
    // Upsert: workspaces that haven't customised settings yet still need
    // a row created so the cooldownClearedAt timestamp survives.
    await db
      .insert(emailDeliveryAlertSettings)
      .values({
        companyId,
        cooldownClearedAt: now,
      })
      .onConflictDoUpdate({
        target: emailDeliveryAlertSettings.companyId,
        set: { cooldownClearedAt: now },
      });
    return true;
  },

  /** Owner emails for a workspace. Used as the email-alert recipient list. */
  async listOwnerEmailsForCompany(companyId: number): Promise<string[]> {
    const rows = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.companyId, companyId),
          eq(memberships.role, "owner"),
        ),
      );
    return (rows as { email: string | null }[])
      .map((r) => r.email)
      .filter((e): e is string => !!e && e.includes("@"));
  },

  /** Every company that has at least one membership — the cron sweeps these. */
  async listCompanyIdsWithMemberships(): Promise<number[]> {
    const rows = await db
      .selectDistinct({ companyId: memberships.companyId })
      .from(memberships);
    return rows.map((r) => r.companyId);
  },

  /** First-signup bootstrap: if the legacy seed companies have no owner,
   *  give the new user Owner membership on each so the seeded data is usable.
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
      // First user adopts all orphan seed companies as owner + owner member.
      for (const c of orphan) {
        await db.update(companies).set({ ownerUserId: userId }).where(eq(companies.id, c.id));
        const existing = await this.getMembership(userId, c.id);
        if (!existing) {
          await this.createMembership({ userId, companyId: c.id, role: "owner" });
        }
      }
      const def = orphan.find((c) => c.isDefault) ?? orphan[0];
      return { companyId: def.id, role: "owner", bootstrapped: "adopted" };
    }

    // Otherwise create a fresh personal workspace.
    const c = await this.createCompanyForOwner(userId, `${displayName} — Workspace`, opts);
    await this.createMembership({ userId, companyId: c.id, role: "owner" });
    return { companyId: c.id, role: "owner", bootstrapped: "created" };
  },
};

/**
 * Idempotent data fix-up that re-applies migrations/0003_unify_role_enum.sql
 * on every boot. Workspaces restored from older backups (or rows written by
 * an older deploy mid-rollout) get normalised back onto the canonical
 * owner|accountant|viewer enum without operator action.
 */
export async function unifyRoleEnumOnStartup(): Promise<void> {
  await db.execute(sql`UPDATE memberships SET role = 'owner'  WHERE role = 'admin'`);
  await db.execute(sql`UPDATE memberships SET role = 'viewer' WHERE role IN ('reviewer','readonly')`);
  await db.execute(sql`UPDATE invitations SET role = 'owner'  WHERE role = 'admin'`);
  await db.execute(sql`UPDATE invitations SET role = 'viewer' WHERE role IN ('reviewer','readonly')`);
}

/**
 * Idempotent re-apply of migrations/0006_drop_workspace_members.sql so dev
 * databases and any deploy that boots ahead of the migration runner end up
 * in the same shape as the canonical schema. The table has had no readers
 * since `req.member` started being projected in memory from `users` +
 * `memberships`, so dropping it on boot is safe.
 */
export async function dropWorkspaceMembersMirrorOnStartup(): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS workspace_members`);
}

/**
 * Idempotent re-apply of the email-delivery-alert tables — both the parent
 * `email_delivery_alerts` / `email_delivery_alert_settings` from migration
 * 0005 and the per-recipient outcome table from migration 0008.
 *
 * Same pattern as the other 000X bootstrappers in this file: every statement
 * is guarded with IF NOT EXISTS so re-runs are a no-op. We re-stage both
 * migrations together so dev databases and any deploy that boots ahead of
 * the migration runner end up with the full set of tables the evaluator
 * (and its dedupe / retry passes) need to read and write.
 */
export async function applyEmailDeliveryAlertRecipientsOnStartup(): Promise<void> {
  // Migration 0005 — parent settings + history tables. Required by the FK
  // on email_delivery_alert_recipients(alert_id), so we create these first.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_delivery_alert_settings (
      company_id integer PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      email_enabled boolean NOT NULL DEFAULT false,
      window_hours integer NOT NULL DEFAULT 24,
      absolute_threshold integer NOT NULL DEFAULT 5,
      ratio_threshold numeric(5,4) NOT NULL DEFAULT 0.0200,
      min_samples_for_ratio integer NOT NULL DEFAULT 20,
      cooldown_minutes integer NOT NULL DEFAULT 360,
      updated_at timestamp DEFAULT now(),
      updated_by_user_id varchar
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_delivery_alerts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id integer NOT NULL,
      fired_at timestamp NOT NULL DEFAULT now(),
      window_hours integer NOT NULL,
      failure_count integer NOT NULL,
      send_count integer NOT NULL,
      reason text NOT NULL,
      snapshot jsonb,
      email_sent boolean NOT NULL DEFAULT false,
      email_recipients integer NOT NULL DEFAULT 0,
      dismissed_at timestamp,
      dismissed_by_user_id varchar
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS email_delivery_alerts_company_idx
      ON email_delivery_alerts (company_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS email_delivery_alerts_company_fired_idx
      ON email_delivery_alerts (company_id, fired_at)
  `);

  // Migration 0008 — per-recipient outcome rows.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_delivery_alert_recipients (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_id varchar NOT NULL REFERENCES email_delivery_alerts(id) ON DELETE CASCADE,
      company_id integer NOT NULL,
      email varchar NOT NULL,
      reason text NOT NULL,
      status text NOT NULL,
      error text,
      attempted_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS email_delivery_alert_recipients_alert_idx
      ON email_delivery_alert_recipients (alert_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS email_delivery_alert_recipients_dedupe_idx
      ON email_delivery_alert_recipients (company_id, reason, email, attempted_at)
  `);
}

/**
 * Idempotent re-apply of migrations/0010_email_delivery_event_count_indexes.sql.
 *
 * Same pattern as the other 000X bootstrappers: dev databases and
 * any deploy that boots ahead of the migration runner end up with
 * the composite (message_id, created_at) indexes the email-delivery
 * count endpoint relies on. Without these the count query falls back
 * to a full UNION + sort and blows past the ~50ms target on
 * workspaces with months of history.
 */
export async function applyEmailDeliveryEventCountIndexesOnStartup(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS invitation_email_events_msg_created_idx
      ON invitation_email_events (message_id, created_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS prt_email_events_msg_created_idx
      ON password_reset_email_events (message_id, created_at)
  `);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
