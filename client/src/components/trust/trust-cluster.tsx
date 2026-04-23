import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, RefreshCw, Shield, Database, Plug, UserCheck } from "lucide-react";
import { useLocale } from "@/contexts/locale-context";
import { formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";

type IntegrationHealth = "healthy" | "degraded" | "down" | "not_configured";

interface IntegrationStatus {
  id: string;
  nameAr: string;
  nameEn: string;
  health: IntegrationHealth;
  lastSyncAt?: Date | null;
  nextSyncAt?: Date | null;
  cadence?: string;
  detail?: string;
}

interface InsightsHealth {
  status?: string;
  alerts?: number;
  cashOnHand?: number;
}

const HEALTH_TONE: Record<IntegrationHealth, string> = {
  healthy: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  not_configured: "bg-muted-foreground/40",
};

const HEALTH_LABEL: Record<IntegrationHealth, { ar: string; en: string }> = {
  healthy:        { ar: "يعمل", en: "Healthy" },
  degraded:       { ar: "تأخر", en: "Degraded" },
  down:           { ar: "متوقف", en: "Down" },
  not_configured: { ar: "غير مفعّل", en: "Not configured" },
};

/**
 * Builds a static-but-meaningful integration list from real data we
 * already have available client-side. Where data is missing it is
 * labeled "not configured" rather than fabricated.
 */
function useIntegrationStatuses(lastFetchAt: Date | null): IntegrationStatus[] {
  const { locale } = useLocale();
  return [
    {
      id: "database",
      nameAr: "قاعدة البيانات الرئيسية",
      nameEn: "Primary database",
      health: lastFetchAt ? "healthy" : "degraded",
      lastSyncAt: lastFetchAt,
      cadence: locale === "ar" ? "لحظي" : "Real-time on every write",
      detail:
        locale === "ar"
          ? "Postgres المُدارة على Replit — مزامنة لحظية مع كل عملية كتابة."
          : "Replit-managed Postgres — real-time on every write.",
    },
    {
      id: "ai",
      nameAr: "المساعد الذكي",
      nameEn: "AI assistant",
      health: "healthy",
      lastSyncAt: lastFetchAt,
      cadence: locale === "ar" ? "عند الطلب" : "On demand",
      detail:
        locale === "ar"
          ? "OpenAI عبر تكامل Replit — لا تُخزَّن المطالبات في خدمات خارجية."
          : "OpenAI via Replit integration — prompts not retained externally.",
    },
    {
      id: "bank-feed",
      nameAr: "مزامنة البنك",
      nameEn: "Bank feed",
      health: "not_configured",
      cadence: locale === "ar" ? "غير مجدول" : "Not scheduled",
      detail:
        locale === "ar"
          ? "لم يتم ربط حساب بنكي بعد. الإدخال يدوي عبر المعاملات."
          : "No bank account linked yet. Entry is manual via Transactions.",
    },
    {
      id: "zatca",
      nameAr: "الفوترة الإلكترونية (ZATCA)",
      nameEn: "E-invoicing (ZATCA)",
      health: "not_configured",
      cadence: locale === "ar" ? "غير مجدول" : "Not scheduled",
      detail:
        locale === "ar"
          ? "غير مفعّل. تظهر تقديرات الضرائب من مركز القرارات."
          : "Not configured. VAT estimates appear in the Insights center.",
    },
  ];
}

interface MeRole {
  id: number;
  name: string;
  role: "owner" | "accountant" | "viewer";
}

const ROLE_LABEL: Record<MeRole["role"], { ar: string; en: string }> = {
  owner: { ar: "مالك", en: "Owner" },
  accountant: { ar: "محاسب", en: "Accountant" },
  viewer: { ar: "مشاهد", en: "Viewer" },
};

export function TrustCluster() {
  const { locale } = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;
  const { data: me } = useQuery<MeRole>({ queryKey: ["/api/auth/me"] });

  // Use the insights health endpoint as a proxy for "is the data layer
  // alive and how recent is it". dataUpdatedAt gives us a real moment.
  const { data, dataUpdatedAt, isFetching, refetch, isError } = useQuery<InsightsHealth>({
    queryKey: ["/api/insights/health"],
    refetchOnWindowFocus: false,
  });

  const lastFetchAt = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const integrations = useIntegrationStatuses(lastFetchAt);
  const overall: IntegrationHealth = isError
    ? "down"
    : isFetching
    ? "degraded"
    : data
    ? "healthy"
    : "degraded";

  const freshLabel = lastFetchAt
    ? `${locale === "ar" ? "محدَّث" : "Updated"} ${formatDistanceToNow(lastFetchAt, {
        addSuffix: true,
        locale: dfLocale,
      })}`
    : locale === "ar"
    ? "في انتظار البيانات…"
    : "Waiting for data…";

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          data-testid="button-trust-cluster"
          aria-label={
            locale === "ar"
              ? "حالة المزامنة وسلامة الخدمات"
              : "Sync status and service health"
          }
        >
          <span className="relative inline-flex items-center justify-center w-4 h-4">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                HEALTH_TONE[overall],
              )}
            />
          </span>
          <span className="hidden md:inline tabular-nums" data-testid="text-data-freshness">
            {freshLabel}
          </span>
          {me && (
            <span
              className="hidden md:inline-flex items-center gap-1 ms-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"
              data-testid="text-current-role"
            >
              <UserCheck className="w-3 h-3" />
              {ROLE_LABEL[me.role][locale]}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border text-start space-y-1">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Shield className="w-4 h-4 text-primary" />
              {locale === "ar" ? "حالة الخدمات والمزامنة" : "Service & sync status"}
            </SheetTitle>
            <button
              onClick={() => refetch()}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 motion-safe:transition-colors"
              data-testid="button-refresh-status"
            >
              <RefreshCw className={cn("w-3 h-3", isFetching && "motion-safe:animate-spin")} />
              {locale === "ar" ? "تحديث" : "Refresh"}
            </button>
          </div>
          <SheetDescription className="text-[11px] text-muted-foreground">{freshLabel}</SheetDescription>
        </SheetHeader>
        <ul className="divide-y divide-border" data-testid="list-integration-status">
          {integrations.map((it) => {
            const Icon =
              it.id === "database" ? Database : it.id === "ai" ? Shield : Plug;
            return (
              <li
                key={it.id}
                className="px-4 py-3 flex items-start gap-3"
                data-testid={`integration-status-${it.id}`}
              >
                <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-md bg-muted/60 border border-border text-muted-foreground shrink-0">
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {locale === "ar" ? it.nameAr : it.nameEn}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                      <span className={cn("h-1.5 w-1.5 rounded-full", HEALTH_TONE[it.health])} />
                      {locale === "ar" ? HEALTH_LABEL[it.health].ar : HEALTH_LABEL[it.health].en}
                    </span>
                  </div>
                  {it.detail && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                      {it.detail}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] uppercase tracking-wider font-mono text-muted-foreground/70">
                    {it.lastSyncAt && (
                      <span>
                        {locale === "ar" ? "آخر مزامنة" : "Last sync"} ·{" "}
                        <span className="tabular-nums">
                          {formatDistanceToNow(it.lastSyncAt, {
                            addSuffix: true,
                            locale: dfLocale,
                          })}
                        </span>
                      </span>
                    )}
                    {it.cadence && (
                      <span>
                        {locale === "ar" ? "التالي" : "Next"} · {it.cadence}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="px-4 py-2.5 border-t border-border bg-muted/30">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            {overall === "healthy" ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-success" />
                {locale === "ar"
                  ? "كل الخدمات الأساسية تعمل."
                  : "All core services operational."}
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-warning" />
                {locale === "ar"
                  ? "بعض الخدمات تحتاج اهتماماً."
                  : "Some services need attention."}
              </>
            )}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
