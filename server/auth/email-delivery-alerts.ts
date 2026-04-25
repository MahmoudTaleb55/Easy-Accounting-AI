/**
 * Background evaluator that turns the failure-class trends shown on
 * /app/settings/email-delivery into a *push* notification when the rate
 * crosses each workspace's configured threshold.
 *
 * Runs on a simple in-process interval — one row, one workspace, one
 * roll-up query. Keeps state in three tables:
 *   - email_delivery_alert_settings — per-workspace knobs (window, thresholds,
 *     cooldown, whether to also email owners). Defaults applied when missing.
 *   - email_delivery_alerts — append-only history of fired alerts. The most
 *     recent un-dismissed row is what the in-app banner reads. The most
 *     recent row of any kind is what the cooldown gate consults.
 *   - email_delivery_alert_recipients — append-only per-address attempt log
 *     for the alert email side-channel. Drives two protections that sit
 *     *outside* the cooldown gate:
 *       (a) Dedupe: don't email the same address about the same reason
 *           more than once per `EMAIL_DELIVERY_ALERT_DEDUPE_HOURS` (12h
 *           default), so a flapping provider can't spam the same owner.
 *       (b) Retry: re-attempt addresses whose previous attempt failed
 *           within `EMAIL_DELIVERY_ALERT_RETRY_MINUTES` (60 default), so a
 *           transient SMTP error doesn't make an owner miss the alert
 *           until the next cooldown window expires.
 *
 * Idempotent: if no threshold is crossed, or if we're inside the cooldown
 * window, no row is written and no email is sent. Safe to invoke manually
 * (the dev/test "evaluate now" route does exactly that).
 */

import { authBizStorage } from "./storage";
import {
  sendEmailDeliveryAlertEmail,
  normalizeLocale,
  type EmailLocale,
} from "./email";
import { authStorage } from "../replit_integrations/auth/storage";
import { withRlsBypass } from "../db";

export type EvaluationOutcome =
  | { fired: false; reason: "disabled" | "below_threshold" | "in_cooldown"; failures: number; sends: number; windowHours: number; retried?: number }
  | {
      fired: true;
      alertId: string;
      reason: "absolute" | "ratio";
      failures: number;
      sends: number;
      windowHours: number;
      emailSent: boolean;
      emailRecipients: number;
      // How many addresses were skipped by the dedupe gate on this fire.
      emailDeduped: number;
      // How many *previously failed* addresses got a successful retry on
      // this sweep (across all alerts, not just this one).
      retried: number;
    };

/**
 * Dedupe window: skip an address that already received a successful alert
 * email for the same reason within this many hours. The per-workspace
 * column is the source of truth; the env var is the fallback for
 * workspaces that pre-date the column (`override === null`) so existing
 * environments keep working without a re-save.
 */
export function getDedupeHours(override?: number | null): number {
  const value =
    typeof override === "number" && Number.isFinite(override) && override >= 0
      ? override
      : Number(process.env.EMAIL_DELIVERY_ALERT_DEDUPE_HOURS);
  if (!Number.isFinite(value) || value < 0) return 12;
  // Clamp at one week so a misconfigured value can't permanently mute alerts.
  return Math.min(value, 168);
}

/**
 * Retry window: re-attempt an address whose previous attempt failed within
 * this many minutes. Kept short (default 60min) because beyond that the
 * next cooldown is likely to fire anyway and the original alert context
 * starts going stale. Per-workspace override wins; env var is the fallback.
 */
export function getRetryMinutes(override?: number | null): number {
  const value =
    typeof override === "number" && Number.isFinite(override) && override >= 0
      ? override
      : Number(process.env.EMAIL_DELIVERY_ALERT_RETRY_MINUTES);
  if (!Number.isFinite(value) || value < 0) return 60;
  return Math.min(value, 24 * 60);
}

/** First owner's locale, used as a heuristic for the email language. */
async function pickWorkspaceLocale(companyId: number): Promise<EmailLocale> {
  try {
    const firstOwnerId = (
      await authBizStorage.listMembersForCompany(companyId)
    ).find((m) => m.role === "owner")?.userId;
    if (firstOwnerId) {
      const u = await authStorage.getUser(firstOwnerId);
      return normalizeLocale(u?.preferredLocale);
    }
  } catch {
    /* fall back to default locale */
  }
  return "ar";
}

function buildAlertLink(opts: { alertLink?: string }): string {
  const baseUrl =
    opts.alertLink ?? (process.env.PUBLIC_APP_URL?.replace(/\/$/, "") || "");
  if (!baseUrl) {
    // A relative link is unusable inside an email client; we still send
    // the email (the body is informative on its own) but warn so an
    // operator notices the missing config.
    console.warn(
      "[email-delivery-alert] PUBLIC_APP_URL is not set; alert email will contain a relative link.",
    );
  }
  return baseUrl
    ? `${baseUrl}/app/settings/email-delivery`
    : "/app/settings/email-delivery";
}

/**
 * Re-attempt addresses whose previous attempt failed within the retry
 * window. Independent of the cooldown gate — the whole point is to recover
 * from a transient outage without waiting for the next firing.
 *
 * Returns the number of addresses that succeeded on retry (used by the
 * caller to surface activity in the evaluation outcome).
 */
async function runRetryPass(
  companyId: number,
  opts: { alertLink?: string; retryMinutes?: number | null },
): Promise<number> {
  const retryMinutes = getRetryMinutes(opts.retryMinutes);
  if (retryMinutes === 0) return 0;
  const candidates = await authBizStorage.listEmailDeliveryAlertRetries(
    companyId,
    retryMinutes,
  );
  if (candidates.length === 0) return 0;

  // Cache per-workspace context — locale and company name don't change
  // between retries within a single sweep.
  const company = await authBizStorage
    .getCompanyById(companyId)
    .catch(() => undefined);
  const locale = await pickWorkspaceLocale(companyId);
  const link = buildAlertLink(opts);

  let succeeded = 0;
  for (const { alert, emails } of candidates) {
    if (emails.length === 0) continue;
    const snapshot = (alert.snapshot ?? {
      bounced: 0,
      complained: 0,
      send_failed: 0,
    }) as { bounced: number; complained: number; send_failed: number };

    let results: Awaited<ReturnType<typeof sendEmailDeliveryAlertEmail>> = [];
    try {
      results = await sendEmailDeliveryAlertEmail({
        to: emails,
        workspace: company?.name ?? "Workspace",
        reason: alert.reason as "absolute" | "ratio",
        failures: alert.failureCount,
        sends: alert.sendCount,
        windowHours: alert.windowHours,
        bounced: snapshot.bounced,
        complained: snapshot.complained,
        sendFailed: snapshot.send_failed,
        link,
        locale,
      });
    } catch (err) {
      console.error(
        `[email-delivery-alert] retry send failed for company ${companyId}, alert ${alert.id}:`,
        err,
      );
      // Mark every retried address as failed so we'll try again next sweep.
      results = emails.map(() => ({
        ok: false as const,
        reason: "send_failed" as const,
        error: (err as Error).message,
      }));
    }

    const outcomes = emails.map((email, i) => {
      const r = results[i];
      if (r && r.ok) {
        return { email, status: "sent" as const };
      }
      const error =
        r && !r.ok
          ? r.reason === "send_failed"
            ? r.error ?? "send_failed"
            : r.reason
          : "send_failed";
      return { email, status: "failed" as const, error };
    });

    await authBizStorage.recordEmailDeliveryAlertRecipientOutcomes({
      alertId: alert.id,
      companyId,
      reason: alert.reason as "absolute" | "ratio",
      outcomes,
    });

    const ok = outcomes.filter((o) => o.status === "sent").length;
    if (ok > 0) {
      await authBizStorage.incrementEmailDeliveryAlertRecipientCount(
        alert.id,
        ok,
      );
      succeeded += ok;
    }
  }
  return succeeded;
}

/**
 * Re-attempt a single recipient address for a single alert on demand.
 *
 * Powers the per-row "Retry now" button on the owner-facing recipient list.
 * Mirrors the bookkeeping of `runRetryPass` (one address sent, one outcome
 * row appended, denormalized counter bumped on success) so the in-app
 * banner's "delivered to N owners" line stays accurate when an admin
 * unsticks a transient SMTP failure manually instead of waiting for the
 * next sweep.
 *
 * Returns `{ ok: true }` on a successful send, or `{ ok: false, error }`
 * when the provider rejected the message — the caller surfaces the error
 * in a toast. Throws when the alert doesn't belong to the workspace
 * (caller is expected to have already validated that, but we double-check
 * for defense in depth).
 */
export async function retryEmailDeliveryAlertRecipient(opts: {
  alertId: string;
  companyId: number;
  email: string;
  alertLink?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = opts.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "invalid_email" };
  }
  const alert = await authBizStorage.getEmailDeliveryAlertById(
    opts.alertId,
    opts.companyId,
  );
  if (!alert) {
    throw new Error("alert_not_found");
  }
  const company = await authBizStorage
    .getCompanyById(opts.companyId)
    .catch(() => undefined);
  const locale = await pickWorkspaceLocale(opts.companyId);
  const link = buildAlertLink(opts);
  const snapshot = (alert.snapshot ?? {
    bounced: 0,
    complained: 0,
    send_failed: 0,
  }) as { bounced: number; complained: number; send_failed: number };

  let result: Awaited<ReturnType<typeof sendEmailDeliveryAlertEmail>>[number];
  try {
    const results = await sendEmailDeliveryAlertEmail({
      to: [email],
      workspace: company?.name ?? "Workspace",
      reason: alert.reason as "absolute" | "ratio",
      failures: alert.failureCount,
      sends: alert.sendCount,
      windowHours: alert.windowHours,
      bounced: snapshot.bounced,
      complained: snapshot.complained,
      sendFailed: snapshot.send_failed,
      link,
      locale,
    });
    result = results[0] ?? {
      ok: false,
      reason: "send_failed",
      error: "no_result",
    };
  } catch (err) {
    result = {
      ok: false,
      reason: "send_failed",
      error: (err as Error).message,
    };
  }

  if (result.ok) {
    await authBizStorage.recordEmailDeliveryAlertRecipientOutcomes({
      alertId: alert.id,
      companyId: opts.companyId,
      reason: alert.reason as "absolute" | "ratio",
      outcomes: [{ email, status: "sent" }],
    });
    await authBizStorage.incrementEmailDeliveryAlertRecipientCount(
      alert.id,
      1,
    );
    return { ok: true };
  }

  const error =
    result.reason === "send_failed"
      ? result.error ?? "send_failed"
      : result.reason;
  await authBizStorage.recordEmailDeliveryAlertRecipientOutcomes({
    alertId: alert.id,
    companyId: opts.companyId,
    reason: alert.reason as "absolute" | "ratio",
    outcomes: [{ email, status: "failed", error }],
  });
  return { ok: false, error };
}

/**
 * Evaluate the alert rules for a single workspace. Returns whether an alert
 * was raised and (when so) how it was delivered. Owner emails are only
 * fetched when emailEnabled is true to keep the no-op path cheap.
 */
export async function evaluateEmailDeliveryAlertsForCompany(
  companyId: number,
  opts: { now?: Date; alertLink?: string; skipCooldown?: boolean } = {},
): Promise<EvaluationOutcome> {
  const cfg = await authBizStorage.getEmailDeliveryAlertSettings(companyId);
  if (!cfg.enabled) {
    // Workspace turned alerting off entirely — don't retry either, since
    // a retry would re-email an owner about an alert from a config they
    // have since disabled.
    return {
      fired: false,
      reason: "disabled",
      failures: 0,
      sends: 0,
      windowHours: cfg.windowHours,
      retried: 0,
    };
  }

  // Retry pass is independent of the cooldown gate so a transient SMTP
  // outage doesn't lock an owner out of the alert until the next firing,
  // but it must still respect the workspace's email-side-channel toggle:
  // if the operator has disabled alert emails, we shouldn't deliver them
  // through the back door of a retry. Best-effort — failures are logged
  // but don't abort the sweep, since the threshold check below is the
  // more important signal.
  let retried = 0;
  if (cfg.emailEnabled) {
    try {
      retried = await runRetryPass(companyId, {
        alertLink: opts.alertLink,
        retryMinutes: cfg.retryMinutes,
      });
    } catch (err) {
      console.error(
        `[email-delivery-alert] retry pass failed for company ${companyId}:`,
        err,
      );
    }
  }

  const window = await authBizStorage.getEmailDeliveryFailureWindow(
    companyId,
    cfg.windowHours,
  );

  // Threshold logic. Either rule may fire independently:
  //   - absolute: failures >= absoluteThreshold (raw count, useful at low volumes)
  //   - ratio:    failures / sends >= ratioThreshold AND sends >= minSamples
  let reason: "absolute" | "ratio" | null = null;
  if (window.failures >= cfg.absoluteThreshold) {
    reason = "absolute";
  } else {
    const ratioFloor = Number(cfg.ratioThreshold);
    if (
      window.sends >= cfg.minSamplesForRatio &&
      ratioFloor > 0 &&
      window.failures / Math.max(1, window.sends) >= ratioFloor
    ) {
      reason = "ratio";
    }
  }

  if (!reason) {
    return {
      fired: false,
      reason: "below_threshold",
      failures: window.failures,
      sends: window.sends,
      windowHours: window.windowHours,
      retried,
    };
  }

  // Cooldown gate. We use the most recent alert (regardless of dismissal)
  // so dismissing the banner doesn't immediately re-fire on the next sweep.
  //
  // Two non-destructive bypasses:
  //   - `opts.skipCooldown` — in-memory bypass for tests / one-shot
  //     evaluator calls.
  //   - `cfg.cooldownClearedAt` — persisted "Re-arm" timestamp set by the
  //     owner-facing /rearm route. Considered active only while it is
  //     newer than the most-recent firedAt; once a fresh alert fires,
  //     the bypass naturally becomes inert again.
  const last = await authBizStorage.getMostRecentEmailDeliveryAlert(companyId);
  const now = opts.now ?? new Date();
  const persistentBypass =
    !!cfg.cooldownClearedAt &&
    !!last?.firedAt &&
    new Date(cfg.cooldownClearedAt).getTime() >
      new Date(last.firedAt).getTime();
  if (!opts.skipCooldown && !persistentBypass && last && last.firedAt) {
    const ageMs = now.getTime() - new Date(last.firedAt).getTime();
    if (ageMs < cfg.cooldownMinutes * 60 * 1000) {
      return {
        fired: false,
        reason: "in_cooldown",
        failures: window.failures,
        sends: window.sends,
        windowHours: window.windowHours,
        retried,
      };
    }
  }

  // Time to fire. We persist the alert row first (with zero recipients) so
  // every per-recipient outcome we record below has a valid parent row to
  // hang off — and so that even if the email side-channel throws, the
  // alert itself is still visible in the in-app banner.
  const alert = await authBizStorage.createEmailDeliveryAlert({
    companyId,
    windowHours: window.windowHours,
    failureCount: window.failures,
    sendCount: window.sends,
    reason,
    snapshot: {
      bounced: window.bounced,
      complained: window.complained,
      send_failed: window.sendFailed,
    },
    emailSent: false,
    emailRecipients: 0,
  });

  let emailSent = false;
  let emailRecipients = 0;
  let emailDeduped = 0;
  if (cfg.emailEnabled) {
    try {
      const owners = await authBizStorage.listOwnerEmailsForCompany(companyId);
      // Normalise to lowercase so dedupe (which lowercases on insert) and
      // membership tests line up regardless of how the address was typed.
      const normalizedOwners = Array.from(
        new Set(owners.map((e) => e.trim().toLowerCase())),
      );

      // Dedupe gate — sits *outside* the cooldown so a flapping provider
      // can't spam the same owner with multiple near-identical alerts in
      // a single day. The cooldown gates the *alert*; this gates the
      // *email* per address.
      const dedupeHours = getDedupeHours(cfg.dedupeHours);
      const recentlyAlerted =
        dedupeHours > 0
          ? await authBizStorage.listRecentlyAlertedRecipients(
              companyId,
              reason,
              dedupeHours,
            )
          : new Set<string>();
      const targets = normalizedOwners.filter(
        (e) => !recentlyAlerted.has(e),
      );
      emailDeduped = normalizedOwners.length - targets.length;

      if (targets.length > 0) {
        const company = await authBizStorage
          .getCompanyById(companyId)
          .catch(() => undefined);
        const link = buildAlertLink(opts);
        const locale = await pickWorkspaceLocale(companyId);

        let results: Awaited<ReturnType<typeof sendEmailDeliveryAlertEmail>> =
          [];
        try {
          results = await sendEmailDeliveryAlertEmail({
            to: targets,
            workspace: company?.name ?? "Workspace",
            reason,
            failures: window.failures,
            sends: window.sends,
            windowHours: window.windowHours,
            bounced: window.bounced,
            complained: window.complained,
            sendFailed: window.sendFailed,
            link,
            locale,
          });
        } catch (err) {
          console.error(
            `[email-delivery-alert] initial send failed for company ${companyId}:`,
            err,
          );
          // Mark every targeted address as failed so the retry pass on the
          // next sweep picks them up.
          results = targets.map(() => ({
            ok: false as const,
            reason: "send_failed" as const,
            error: (err as Error).message,
          }));
        }

        const outcomes = targets.map((email, i) => {
          const r = results[i];
          if (r && r.ok) {
            return { email, status: "sent" as const };
          }
          const error =
            r && !r.ok
              ? r.reason === "send_failed"
                ? r.error ?? "send_failed"
                : r.reason
              : "send_failed";
          return { email, status: "failed" as const, error };
        });

        await authBizStorage.recordEmailDeliveryAlertRecipientOutcomes({
          alertId: alert.id,
          companyId,
          reason,
          outcomes,
        });

        emailRecipients = outcomes.filter((o) => o.status === "sent").length;
        emailSent = emailRecipients > 0;
        if (emailRecipients > 0) {
          await authBizStorage.incrementEmailDeliveryAlertRecipientCount(
            alert.id,
            emailRecipients,
          );
        }
      }
    } catch (err) {
      console.error(
        `[email-delivery-alert] email side-channel failed for company ${companyId}:`,
        err,
      );
    }
  }

  return {
    fired: true,
    alertId: alert.id,
    reason,
    failures: window.failures,
    sends: window.sends,
    windowHours: window.windowHours,
    emailSent,
    emailRecipients,
    emailDeduped,
    retried,
  };
}

/** Sweep every workspace that has at least one membership.
 *
 * Runs under `withRlsBypass` because it intentionally iterates every
 * workspace and `evaluateEmailDeliveryAlertsForCompany` may need to read
 * cross-workspace audit / membership data without a single
 * `app.current_company_id` GUC pinned to the connection. See
 * docs/design/workspace-isolation-defense-in-depth.md ("Bypass paths").
 */
export async function runEmailDeliveryAlertSweep(): Promise<{
  evaluated: number;
  fired: number;
}> {
  return withRlsBypass("cron:email-delivery-alert-sweep", async () => {
    const ids = await authBizStorage.listCompanyIdsWithMemberships();
    let fired = 0;
    for (const id of ids) {
      try {
        const out = await evaluateEmailDeliveryAlertsForCompany(id);
        if (out.fired) fired++;
      } catch (err) {
        console.error(
          `[email-delivery-alert] evaluation failed for company ${id}:`,
          err,
        );
      }
    }
    return { evaluated: ids.length, fired };
  });
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic sweep. Defaults to every 10 minutes; override via
 * `EMAIL_DELIVERY_ALERT_SWEEP_MINUTES`. The first run is delayed briefly
 * so app boot isn't blocked by a slow query.
 */
export function startEmailDeliveryAlertJob(): void {
  if (timer) return;
  const minutes = Math.max(
    1,
    Number(process.env.EMAIL_DELIVERY_ALERT_SWEEP_MINUTES) || 10,
  );
  const intervalMs = minutes * 60 * 1000;
  // Defer the first sweep so it doesn't race with bootstrap migrations.
  setTimeout(() => {
    runEmailDeliveryAlertSweep().catch((err) =>
      console.error("[email-delivery-alert] initial sweep failed:", err),
    );
    timer = setInterval(() => {
      runEmailDeliveryAlertSweep().catch((err) =>
        console.error("[email-delivery-alert] sweep failed:", err),
      );
    }, intervalMs);
  }, 30 * 1000);
}

export function stopEmailDeliveryAlertJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
