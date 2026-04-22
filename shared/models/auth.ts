import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, text, integer, boolean } from "drizzle-orm/pg-core";
import { z } from "zod";

// Session storage table — required by Replit Auth.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table — extended to support both Replit Auth (provider="replit")
// and email + password (provider="local").
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // "replit" | "local". A user with provider="local" uses passwordHash.
  provider: varchar("provider").notNull().default("local"),
  passwordHash: varchar("password_hash"),
  // Display preferences
  preferredLocale: varchar("preferred_locale").notNull().default("ar"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Roles (highest to lowest). Numeric tier used for role comparisons.
export const ROLES = ["admin", "accountant", "reviewer", "readonly"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_TIER: Record<Role, number> = { admin: 4, accountant: 3, reviewer: 2, readonly: 1 };

// Workspace memberships: user × company × role.
export const memberships = pgTable(
  "memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    companyId: integer("company_id").notNull(),
    role: text("role").notNull(), // admin | accountant | reviewer | readonly
    createdAt: timestamp("created_at").defaultNow(),
    lastActiveAt: timestamp("last_active_at"),
  },
  (t) => [
    index("memberships_user_idx").on(t.userId),
    index("memberships_company_idx").on(t.companyId),
  ]
);
export type Membership = typeof memberships.$inferSelect;
export type InsertMembership = typeof memberships.$inferInsert;

// Pending invitations.
export const invitations = pgTable(
  "invitations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: integer("company_id").notNull(),
    invitedByUserId: varchar("invited_by_user_id").notNull(),
    email: varchar("email").notNull(),
    role: text("role").notNull(),
    token: varchar("token").notNull().unique(),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked | expired
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedByUserId: varchar("accepted_by_user_id"),
    createdAt: timestamp("created_at").defaultNow(),
    // Latest delivery-status snapshot (denormalized from invitation_email_events
    // so the invitations list query stays a single read). Updated whenever a
    // send is attempted or a Resend webhook fires.
    lastMessageId: varchar("last_message_id"),
    lastEmailStatus: text("last_email_status"), // queued | sent | delivered | bounced | complained | delivery_delayed | opened | clicked | send_failed | not_configured
    lastEmailError: text("last_email_error"),
    lastEmailEventAt: timestamp("last_email_event_at"),
  },
  (t) => [
    index("invitations_company_idx").on(t.companyId),
    index("invitations_email_idx").on(t.email),
    index("invitations_last_message_idx").on(t.lastMessageId),
  ]
);
export type Invitation = typeof invitations.$inferSelect;

// Raw email lifecycle log: one row per send attempt and per webhook event
// from Resend. The newest row drives the badge in the admin UI; older rows
// power forensic drill-downs (why did it bounce, when, what was the address).
export const invitationEmailEvents = pgTable(
  "invitation_email_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    invitationId: varchar("invitation_id").notNull(),
    messageId: varchar("message_id"),
    // sent | delivered | bounced | complained | delivery_delayed | opened |
    // clicked | send_failed | not_configured
    type: text("type").notNull(),
    error: text("error"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("invitation_email_events_inv_idx").on(t.invitationId),
    index("invitation_email_events_msg_idx").on(t.messageId),
  ]
);
export type InvitationEmailEvent = typeof invitationEmailEvents.$inferSelect;

// Password reset tokens (one-shot, time-limited).
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    token: varchar("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("prt_user_idx").on(t.userId)]
);
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Zod schemas for client/server input validation.
export const signUpSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(128),
  firstName: z.string().min(1).max(80).optional().nullable(),
  lastName: z.string().min(1).max(80).optional().nullable(),
  invitationToken: z.string().optional().nullable(),
  preferredLocale: z.enum(["ar", "en"]).optional().default("ar"),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const requestResetSchema = z.object({ email: z.string().email() });
export const confirmResetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(128),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
});
export const updateMemberRoleSchema = z.object({ role: z.enum(ROLES) });

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(80).optional().nullable(),
  lastName: z.string().min(1).max(80).optional().nullable(),
  profileImageUrl: z.string().url().max(500).optional().nullable(),
  preferredLocale: z.enum(["ar", "en"]).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
