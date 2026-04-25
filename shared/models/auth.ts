import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgTable, timestamp, varchar, text, integer, boolean } from "drizzle-orm/pg-core";
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
//
// This is the single canonical role enum used end-to-end across the client,
// the server, and the database. Both `/api/auth/me` (in-memory projection
// of the active membership) and `/api/auth/memberships` (memberships
// table) speak this enum, and the membership rows are stored using
// exactly these strings.
//
// The legacy enum (admin/accountant/reviewer/readonly) was migrated to
// owner/accountant/viewer in 2026-04 — see migrations/0003_unify_role_enum.sql
// and the bootstrap step in `server/index.ts` that re-runs the data fix-up
// idempotently on each boot.
export const ROLES = ["owner", "accountant", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_TIER: Record<Role, number> = { owner: 3, accountant: 2, viewer: 1 };

// Workspace memberships: user × company × role.
export const memberships = pgTable(
  "memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    companyId: integer("company_id").notNull(),
    role: text("role").notNull(), // owner | accountant | viewer (see ROLES)
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
    // Companion to the unified email-delivery feed's DISTINCT ON
    // (transport, dedup_key) collapse. The count endpoint scans both
    // event tables on every (debounced) keystroke in the recipient
    // filter, and on workspaces with months of history this can do
    // tens of thousands of row reads. A composite (message_id,
    // created_at) index lets the planner satisfy the inner ORDER BY
    // in the DISTINCT ON without resorting the whole UNION.
    index("invitation_email_events_msg_created_idx").on(t.messageId, t.createdAt),
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
    // Latest delivery snapshot, mirroring the invitation pattern so the admin
    // UI can render a Sent/Delivered/Bounced badge for password reset emails.
    lastMessageId: varchar("last_message_id"),
    lastEmailStatus: text("last_email_status"),
    lastEmailError: text("last_email_error"),
    lastEmailEventAt: timestamp("last_email_event_at"),
  },
  (t) => [
    index("prt_user_idx").on(t.userId),
    index("prt_last_message_idx").on(t.lastMessageId),
  ]
);
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Lifecycle log for password-reset emails — same shape as invitation_email_events
// so the webhook + admin surfaces can treat both transports uniformly.
export const passwordResetEmailEvents = pgTable(
  "password_reset_email_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tokenId: varchar("token_id").notNull(),
    userId: varchar("user_id").notNull(),
    messageId: varchar("message_id"),
    type: text("type").notNull(),
    error: text("error"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("prt_email_events_token_idx").on(t.tokenId),
    index("prt_email_events_user_idx").on(t.userId),
    index("prt_email_events_msg_idx").on(t.messageId),
    // See `invitation_email_events_msg_created_idx` — same speed-up
    // for the password-reset transport's branch of the unified
    // email-delivery feed's DISTINCT ON (transport, dedup_key) collapse.
    index("prt_email_events_msg_created_idx").on(t.messageId, t.createdAt),
  ]
);
export type PasswordResetEmailEvent = typeof passwordResetEmailEvents.$inferSelect;

// Per-workspace configuration for the failure-rate alert evaluator. One row
// per workspace; the evaluator falls back to defaults when no row exists, so
// admins only need to write a row when they want to override.
export const emailDeliveryAlertSettings = pgTable(
  "email_delivery_alert_settings",
  {
    companyId: integer("company_id").primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    // Rolling window the evaluator looks back over.
    windowHours: integer("window_hours").notNull().default(24),
    // Fire if absolute failure count over the window meets/exceeds this.
    absoluteThreshold: integer("absolute_threshold").notNull().default(5),
    // Or if failure ratio meets/exceeds this fraction (0..1) AND there are
    // enough samples to make the ratio meaningful.
    ratioThreshold: numeric("ratio_threshold", { precision: 5, scale: 4 })
      .notNull()
      .default("0.0200"),
    minSamplesForRatio: integer("min_samples_for_ratio").notNull().default(20),
    // Suppress repeat alerts for this many minutes after the last fire.
    cooldownMinutes: integer("cooldown_minutes").notNull().default(360),
    // Per-address dedupe window: skip emailing an address that already
    // received a successful alert email for the same reason within this
    // many hours. 0 disables the gate. Nullable on purpose — the
    // evaluator falls back to EMAIL_DELIVERY_ALERT_DEDUPE_HOURS (12h
    // default) when null so workspaces that pre-date this column keep
    // working without an explicit save.
    dedupeHours: integer("dedupe_hours"),
    // Per-address retry window: re-attempt an address whose previous
    // attempt failed within this many minutes. 0 disables the retry pass.
    // Nullable for the same reason as `dedupeHours` — falls back to
    // EMAIL_DELIVERY_ALERT_RETRY_MINUTES (60m default) when null.
    retryMinutes: integer("retry_minutes"),
    // Timestamp at which an owner explicitly re-armed the alert evaluator.
    // The cooldown gate is bypassed on the next pass when this is newer than
    // the most recent alert's firedAt. Stored as a one-shot timestamp (not a
    // boolean) so we can audit when the bypass was requested without keeping
    // a separate audit table.
    cooldownClearedAt: timestamp("cooldown_cleared_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
    updatedByUserId: varchar("updated_by_user_id"),
  }
);
export type EmailDeliveryAlertSettings = typeof emailDeliveryAlertSettings.$inferSelect;

// History of fired alerts. The most recent un-dismissed row drives the
// in-app banner; older rows let admins audit the alert history.
export const emailDeliveryAlerts = pgTable(
  "email_delivery_alerts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: integer("company_id").notNull(),
    firedAt: timestamp("fired_at").notNull().defaultNow(),
    windowHours: integer("window_hours").notNull(),
    failureCount: integer("failure_count").notNull(),
    sendCount: integer("send_count").notNull(),
    // 'absolute' | 'ratio' — which threshold fired the alert.
    reason: text("reason").notNull(),
    snapshot: jsonb("snapshot").$type<{
      bounced: number;
      complained: number;
      send_failed: number;
    } | null>(),
    emailSent: boolean("email_sent").notNull().default(false),
    emailRecipients: integer("email_recipients").notNull().default(0),
    dismissedAt: timestamp("dismissed_at"),
    dismissedByUserId: varchar("dismissed_by_user_id"),
  },
  (t) => [
    index("email_delivery_alerts_company_idx").on(t.companyId),
    index("email_delivery_alerts_company_fired_idx").on(t.companyId, t.firedAt),
  ]
);
export type EmailDeliveryAlert = typeof emailDeliveryAlerts.$inferSelect;

// Per-address outcome rows for a fired alert. Each row is one *attempt* to
// deliver an alert email to a single recipient. The evaluator writes one
// row per address per attempt — including failures — so that:
//   - the dedupe gate can ask "has this address received the same reason
//     successfully within the last N hours?" without reading the email
//     transport's lifecycle log,
//   - the retry pass can ask "did any address fail the most recent attempt
//     for this alert and have we never since landed a 'sent' to them?".
//
// `companyId` and `reason` are denormalized off the parent alert row so the
// dedupe lookup is a single index hit on (company_id, reason, email,
// attempted_at) without a join.
export const emailDeliveryAlertRecipients = pgTable(
  "email_delivery_alert_recipients",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    alertId: varchar("alert_id")
      .notNull()
      .references(() => emailDeliveryAlerts.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull(),
    email: varchar("email").notNull(),
    // Mirrors emailDeliveryAlerts.reason ('absolute' | 'ratio') so we can
    // dedupe per-reason without joining back to the parent alert row.
    reason: text("reason").notNull(),
    // 'sent' | 'failed'
    status: text("status").notNull(),
    error: text("error"),
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_delivery_alert_recipients_alert_idx").on(t.alertId),
    // Dedupe lookup: "did <email> in <company> receive a successful <reason>
    // within the dedupe window?" — a single covering index hit.
    index("email_delivery_alert_recipients_dedupe_idx").on(
      t.companyId,
      t.reason,
      t.email,
      t.attemptedAt,
    ),
  ],
);
export type EmailDeliveryAlertRecipient =
  typeof emailDeliveryAlertRecipients.$inferSelect;

export const upsertEmailDeliveryAlertSettingsSchema = z.object({
  enabled: z.boolean(),
  emailEnabled: z.boolean(),
  windowHours: z.coerce.number().int().min(1).max(168), // 1h..7d
  absoluteThreshold: z.coerce.number().int().min(1).max(10000),
  ratioThreshold: z.coerce.number().min(0).max(1),
  minSamplesForRatio: z.coerce.number().int().min(1).max(10000),
  cooldownMinutes: z.coerce.number().int().min(5).max(60 * 24 * 7),
  // Per-address dedupe and retry windows. Both bounded the same way the
  // evaluator already clamps the env-var fallback (dedupe at one week,
  // retry at one day) so a misconfigured value can't permanently mute
  // alerts or hammer the SMTP provider with retries.
  // 0 explicitly disables each gate.
  // Optional + nullable: omitting them (or sending null) preserves the
  // existing column value / leaves the env fallback in effect.
  dedupeHours: z.coerce.number().int().min(0).max(168).nullable().optional(),
  retryMinutes: z.coerce.number().int().min(0).max(60 * 24).nullable().optional(),
});
export type UpsertEmailDeliveryAlertSettings = z.infer<
  typeof upsertEmailDeliveryAlertSettingsSchema
>;

// Zod schemas for client/server input validation.
export const signUpSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(128),
  firstName: z.string().min(1).max(80).optional().nullable(),
  lastName: z.string().min(1).max(80).optional().nullable(),
  invitationToken: z.string().optional().nullable(),
  preferredLocale: z.enum(["ar", "en", "de", "fr"]).optional().default("ar"),
  // Workspace currency. Server validates against the shared allowlist and
  // derives the symbol — clients cannot inject arbitrary symbols.
  currencyCode: z.string().min(2).max(8).optional(),
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

// Profile updates come from a form where blank inputs round-trip as empty
// strings. We preprocess each text field so:
//   - leading/trailing whitespace is stripped
//   - an empty/whitespace-only value clears the field (null) instead of
//     failing min(1) validation
//   - a non-empty value is still capped at a reasonable length and (for the
//     image) must look like a URL
const trimmedNameField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() || null : v),
  z.string().min(1).max(80).nullable().optional(),
);
const optionalUrlField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() || null : v),
  z.string().url().max(500).nullable().optional(),
);

export const updateProfileSchema = z.object({
  firstName: trimmedNameField,
  lastName: trimmedNameField,
  profileImageUrl: optionalUrlField,
  preferredLocale: z.enum(["ar", "en", "de", "fr"]).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
