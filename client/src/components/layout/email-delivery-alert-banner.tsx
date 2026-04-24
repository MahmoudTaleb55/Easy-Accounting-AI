import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/contexts/locale-context";
import { apiRequest } from "@/lib/queryClient";

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
  const ar = locale === "ar";
  const qc = useQueryClient();

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
    if (ar) {
      const head =
        reason === "ratio" && sends > 0
          ? `ارتفعت نسبة إخفاقات بريد المعاملات إلى ${(
              (failures / sends) * 100
            ).toFixed(1)}% خلال آخر ${window} ساعة (${failures} من ${sends}).`
          : `سُجّلت ${failures} إخفاقات بريد خلال آخر ${window} ساعة.`;
      const detail = `الارتدادات: ${snap.bounced} · بلاغات السبام: ${snap.complained} · فشل الإرسال: ${snap.send_failed}`;
      return { head, detail };
    }
    const head =
      reason === "ratio" && sends > 0
        ? `Email failure rate hit ${((failures / sends) * 100).toFixed(
            1,
          )}% over the last ${window}h (${failures} of ${sends}).`
        : `${failures} email failures over the last ${window}h.`;
    const detail = `Bounced ${snap.bounced} · Spam reports ${snap.complained} · Send failures ${snap.send_failed}`;
    return { head, detail };
  }, [alert, ar]);

  if (!isAdmin || !alert || !summary) return null;

  return (
    <div
      role="alert"
      data-testid="banner-email-delivery-alert"
      className="border-b border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-start gap-3 px-4 py-2 md:px-8 lg:px-10">
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
        </div>
        <Link
          href="/app/settings/email-delivery"
          className="hidden shrink-0 self-center text-sm font-medium underline-offset-2 hover:underline sm:inline"
          data-testid="link-email-delivery-alert"
        >
          {ar ? "افتح صحة البريد" : "Open delivery health"}
        </Link>
        <button
          type="button"
          onClick={() => dismiss.mutate(alert.id)}
          disabled={dismiss.isPending}
          aria-label={ar ? "تجاهل التنبيه" : "Dismiss alert"}
          data-testid="button-dismiss-email-delivery-alert"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-900/80 transition-colors hover:bg-rose-100 hover:text-rose-900 disabled:opacity-50 dark:text-rose-100/80 dark:hover:bg-rose-900/40 dark:hover:text-rose-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
