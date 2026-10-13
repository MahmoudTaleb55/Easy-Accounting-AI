import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  MailCheck,
  MailX,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocale, type Locale } from "@/contexts/locale-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useT } from "@/i18n/dict";

interface ActiveAlert {
  id: string;
  firedAt: string | null;
  windowHours: number;
  failureCount: number;
  sendCount: number;
  reason: "absolute" | "ratio";
  snapshot: { bounced: number; complained: number; send_failed: number } | null;
  emailSent: boolean;
  emailRecipients: number;
}

interface RecipientRow {
  email: string;
  status: "sent" | "failed" | string;
  error: string | null;
  attemptedAt: string | null;
  attempts: number;
}

interface RecipientsResponse {
  alertId: string;
  emailSent: boolean;
  emailRecipients: number;
  recipients: RecipientRow[];
}

/**
 * Top-of-app banner that appears for workspace owners whenever the failure-rate
 * evaluator has fired an alert that hasn't been dismissed. Polls every minute
 * so a freshly-tripped alert appears without a page reload, and dismissal is
 * a one-click action that records who dismissed it server-side.
 */
export function EmailDeliveryAlertBanner() {
  const { role } = useAuth();
  const isAdmin = role === "owner";
  const { locale } = useLocale();
  const t = useT();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: alert } = useQuery<ActiveAlert | null>({
    queryKey: ["/api/auth/email-delivery-alerts/active"],
    enabled: isAdmin,
    // Poll once a minute. The evaluator runs every ~10m server-side, but
    // an admin who tightens a threshold and triggers an evaluate-now wants
    // immediate feedback in the shell.
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 30 * 1000,
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/auth/email-delivery-alerts/${id}/dismiss`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auth/email-delivery-alerts/active"] });
      // Keep the audit log on /app/settings/email-delivery in sync so the
      // dismissal attribution shows up immediately after the banner is
      // closed from the shell, without waiting for a manual refetch.
      qc.invalidateQueries({ queryKey: ["/api/auth/email-delivery-alerts/history"] });
    },
  });

  const summary = useMemo(() => {
    if (!alert) return null;
    const snap = alert.snapshot ?? { bounced: 0, complained: 0, send_failed: 0 };
    const reason = alert.reason;
    const window = alert.windowHours;
    const failures = alert.failureCount;
    const sends = alert.sendCount;
    const head =
      reason === "ratio" && sends > 0
        ? t("edab_head_ratio")
            .replace("{rate}", ((failures / sends) * 100).toFixed(1))
            .replace("{window}", String(window))
            .replace("{failures}", String(failures))
            .replace("{sends}", String(sends))
        : t("edab_head_absolute")
            .replace("{failures}", String(failures))
            .replace("{window}", String(window));
    const detail = t("edab_detail")
      .replace("{bounced}", String(snap.bounced))
      .replace("{complained}", String(snap.complained))
      .replace("{failed}", String(snap.send_failed));
    return { head, detail };
  }, [alert, t]);

  if (!isAdmin || !alert || !summary) return null;

  return (
    <div
      role="alert"
      data-testid="banner-email-delivery-alert"
      className="border-b border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
    >
      <div className="mx-auto w-full max-w-[1600px] px-4 py-2 md:px-8 lg:px-10">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1 text-sm leading-snug">
            <div className="font-medium" data-testid="text-email-delivery-alert-headline">
              {summary.head}
            </div>
            <div
              className="mt-0.5 text-xs text-rose-900/80 dark:text-rose-100/80"
              data-testid="text-email-delivery-alert-detail"
            >
              {summary.detail}
            </div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              data-testid="button-toggle-recipients"
              aria-expanded={expanded}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-rose-900 underline-offset-2 hover:underline dark:text-rose-100"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {alert.emailSent
                ? t("edab_delivered_to").replace("{n}", String(alert.emailRecipients))
                : t("edab_show_status")}
            </button>
          </div>
          <Link
            href="/app/settings/email-delivery"
            className="hidden shrink-0 self-center text-sm font-medium underline-offset-2 hover:underline sm:inline"
            data-testid="link-email-delivery-alert"
          >
            {t("edab_open_health")}
          </Link>
          <button
            type="button"
            onClick={() => dismiss.mutate(alert.id)}
            disabled={dismiss.isPending}
            aria-label={t("edab_dismiss")}
            data-testid="button-dismiss-email-delivery-alert"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-900/80 transition-colors hover:bg-rose-100 hover:text-rose-900 disabled:opacity-50 dark:text-rose-100/80 dark:hover:bg-rose-900/40 dark:hover:text-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {expanded && (
          <RecipientsPanel alertId={alert.id} locale={locale} variant="banner" />
        )}
      </div>
    </div>
  );
}

interface RecipientsPanelProps {
  alertId: string;
  locale: Locale;
  /**
   * `banner` styles for the rose-tinted shell banner; `card` styles for
   * the neutral surface inside the settings page so the recipient list
   * doesn't fight with the surrounding card.
   */
  variant: "banner" | "card";
}

/**
 * Per-recipient delivery status for a single alert. Fetched lazily on first
 * expand so a long history row doesn't cost a round-trip when the table
 * is collapsed. Used by both the in-app banner (active alert) and the
 * Recent alerts table (historical rows).
 */
export function RecipientsPanel({ alertId, locale, variant }: RecipientsPanelProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const { data, isLoading, isFetching, error } = useQuery<RecipientsResponse>({
    queryKey: ["/api/auth/email-delivery-alerts", alertId, "recipients"],
  });

  const retry = useMutation<
    { ok: boolean; error?: string },
    Error,
    string
  >({
    mutationFn: async (email: string) => {
      const res = await apiRequest(
        "POST",
        `/api/auth/email-delivery-alerts/${encodeURIComponent(alertId)}/recipients/retry`,
        { email },
      );
      return (await res.json()) as { ok: boolean; error?: string };
    },
    onSuccess: (result, email) => {
      qc.invalidateQueries({
        queryKey: ["/api/auth/email-delivery-alerts", alertId, "recipients"],
      });
      // The active-alert and history endpoints both denormalize the
      // delivered count, so they need to refetch when a retry lands.
      qc.invalidateQueries({
        queryKey: ["/api/auth/email-delivery-alerts/active"],
      });
      qc.invalidateQueries({
        queryKey: ["/api/auth/email-delivery-alerts/history"],
      });
      if (result.ok) {
        toast({
          title: t("edab_retry_sent"),
          description: t("edab_retry_sent_desc").replace("{email}", email),
        });
      } else {
        toast({
          variant: "destructive",
          title: t("edab_retry_failed"),
          description: result.error ?? t("edab_unknown_error"),
        });
      }
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: t("edab_retry_unable"),
        description: t("err_generic"),
      });
    },
  });

  const surface =
    variant === "banner"
      ? "mt-3 rounded-md border border-rose-200/60 bg-white/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/40"
      : "mt-3 rounded-md border bg-muted/40 p-3";

  if (isLoading) {
    return (
      <div className={surface} data-testid={`recipients-loading-${alertId}`}>
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("edab_loading")}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={surface} data-testid={`recipients-error-${alertId}`}>
        <p className="text-xs">
          {t("edab_load_error")}
        </p>
      </div>
    );
  }

  const recipients = data?.recipients ?? [];

  if (recipients.length === 0) {
    return (
      <div className={surface} data-testid={`recipients-empty-${alertId}`}>
        <p className="text-xs">
          {t("edab_none_sent")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={surface}
      data-testid={`recipients-panel-${alertId}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider">
        <span>{t("edab_recipients")}</span>
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      <ul className="divide-y divide-rose-200/40 text-xs dark:divide-rose-900/40">
        {recipients.map((r) => {
          const sent = r.status === "sent";
          const StatusIcon = sent ? MailCheck : MailX;
          const statusLabel = sent ? t("edab_sent") : t("edab_failed");
          const tone = sent
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-rose-700 dark:text-rose-300";
          return (
            <li
              key={r.email}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
              data-testid={`row-recipient-${r.email}`}
            >
              <span className={`inline-flex items-center gap-1 font-medium ${tone}`}>
                <StatusIcon className="h-3 w-3" />
                <span data-testid={`text-recipient-status-${r.email}`}>
                  {statusLabel}
                </span>
              </span>
              <span
                className="font-mono text-[11px] text-foreground/90"
                data-testid={`text-recipient-email-${r.email}`}
              >
                {r.email}
              </span>
              <span
                className="text-muted-foreground"
                data-testid={`text-recipient-attempted-${r.email}`}
              >
                {formatTimestamp(r.attemptedAt, locale)}
              </span>
              {r.attempts > 1 && (
                <span className="text-muted-foreground">
                  {t("edab_attempts").replace("{n}", String(r.attempts))}
                </span>
              )}
              {!sent && r.error && (
                <span
                  className="basis-full text-[11px] text-rose-700 dark:text-rose-300"
                  data-testid={`text-recipient-error-${r.email}`}
                >
                  {r.error}
                </span>
              )}
              {!sent && (
                <button
                  type="button"
                  onClick={() => retry.mutate(r.email)}
                  disabled={retry.isPending}
                  data-testid={`button-retry-recipient-${r.email}`}
                  className="ms-auto inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-0.5 text-[11px] font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/40"
                >
                  <RefreshCw className="h-3 w-3" />
                  {retry.isPending && retry.variables === r.email
                    ? t("edab_retrying")
                    : t("edab_retry_now")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTimestamp(value: string | null, locale: Locale): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(locale, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}
