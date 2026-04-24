/**
 * Background evaluator that turns the failure-class trends shown on
 * /app/settings/email-delivery into a *push* notification when the rate
 * crosses each workspace's configured threshold.
 *
 * Runs on a simple in-process interval — one row, one workspace, one
 * roll-up query. Keeps state in two tables:
 *   - email_delivery_alert_settings — per-workspace knobs (window, thresholds,
 *     cooldown, whether to also email owners). Defaults applied when missing.
 *   - email_delivery_alerts — append-only history of fired alerts. The most
 *     recent un-dismissed row is what the in-app banner reads. The most
 *     recent row of any kind is what the cooldown gate consults.
 *
 * Idempotent: if no threshold is crossed, or if we're inside the cooldown
 * window, no row is written and no email is sent. Safe to invoke manually
 * (the dev/test "evaluate now" route does exactly that).
 */

import { authBizStorage } from "./storage";
import { sendEmailDeliveryAlertEmail, normalizeLocale } from "./email";
import { authStorage } from "../replit_integrations/auth/storage";

export type EvaluationOutcome =
  | { fired: false; reason: "disabled" | "below_threshold" | "in_cooldown"; failures: number; sends: number; windowHours: number }
  | {
      fired: true;
      alertId: string;
      reason: "absolute" | "ratio";
      failures: number;
      sends: number;
      windowHours: number;
      emailSent: boolean;
      emailRecipients: number;
    };

/**
 * Evaluate the alert rules for a single workspace. Returns whether an alert
 * was raised and (when so) how it was delivered. Owner emails are only
 * fetched when emailEnabled is true to keep the no-op path cheap.
 */
export async function evaluateEmailDeliveryAlertsForCompany(
  companyId: number,
  opts: { now?: Date; alertLink?: string } = {},
): Promise<EvaluationOutcome> {
  const cfg = await authBizStorage.getEmailDeliveryAlertSettings(companyId);
  if (!cfg.enabled) {
    return { fired: false, reason: "disabled", failures: 0, sends: 0, windowHours: cfg.windowHours };
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
    };
  }

  // Cooldown gate. We use the most recent alert (regardless of dismissal)
  // so dismissing the banner doesn't immediately re-fire on the next sweep.
  const last = await authBizStorage.getMostRecentEmailDeliveryAlert(companyId);
  const now = opts.now ?? new Date();
  if (last && last.firedAt) {
    const ageMs = now.getTime() - new Date(last.firedAt).getTime();
    if (ageMs < cfg.cooldownMinutes * 60 * 1000) {
      return {
        fired: false,
        reason: "in_cooldown",
        failures: window.failures,
        sends: window.sends,
        windowHours: window.windowHours,
      };
    }
  }

  // Time to fire. Try the email side-channel first (when configured) so we
  // can persist its outcome on the alert row itself.
  let emailSent = false;
  let emailRecipients = 0;
  if (cfg.emailEnabled) {
    try {
      const owners = await authBizStorage.listOwnerEmailsForCompany(companyId);
      if (owners.length > 0) {
        const company = await authBizStorage.getCompanyById(companyId).catch(() => undefined);
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
        const link = baseUrl
          ? `${baseUrl}/app/settings/email-delivery`
          : "/app/settings/email-delivery";
        // Use the first owner's locale as a heuristic for the message language.
        let locale: "ar" | "en" = "ar";
        try {
          const firstOwnerId = (
            await authBizStorage.listMembersForCompany(companyId)
          ).find((m) => m.role === "owner")?.userId;
          if (firstOwnerId) {
            const u = await authStorage.getUser(firstOwnerId);
            locale = normalizeLocale(u?.preferredLocale);
          }
        } catch {
          /* fall back to default locale */
        }
        const results = await sendEmailDeliveryAlertEmail({
          to: owners,
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
        emailRecipients = results.filter((r) => r.ok).length;
        emailSent = emailRecipients > 0;
      }
    } catch (err) {
      console.error(
        `[email-delivery-alert] email side-channel failed for company ${companyId}:`,
        err,
      );
    }
  }

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
    emailSent,
    emailRecipients,
  });

  return {
    fired: true,
    alertId: alert.id,
    reason,
    failures: window.failures,
    sends: window.sends,
    windowHours: window.windowHours,
    emailSent,
    emailRecipients,
  };
}

/** Sweep every workspace that has at least one membership. */
export async function runEmailDeliveryAlertSweep(): Promise<{
  evaluated: number;
  fired: number;
}> {
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
