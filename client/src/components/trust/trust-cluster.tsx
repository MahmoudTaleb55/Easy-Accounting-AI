import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, RefreshCw, Shield, Database, Plug, UserCheck, Landmark, QrCode } from "lucide-react";
import { useLocale } from "@/contexts/locale-context";
import { useT, type StringKey } from "@/i18n/dict";
import { formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { BankAccount, ZatcaConfig } from "@shared/schema";

type IntegrationHealth = "healthy" | "degraded" | "down" | "not_configured";

interface IntegrationStatus {
  id: string;
  labelKey: StringKey;
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

const HEALTH_LABEL: Record<IntegrationHealth, StringKey> = {
  healthy: "trust_health_healthy",
  degraded: "trust_health_degraded",
  down: "trust_health_down",
  not_configured: "trust_health_not_configured",
};

/**
 * Builds an integration list that reflects real-time data from the backend.
 * Bank and ZATCA health are derived from actual configuration data.
 */
function useIntegrationStatuses(lastFetchAt: Date | null): IntegrationStatus[] {
  const { locale } = useLocale();
  const t = useT();

  const { data: bankAccounts } = useQuery<BankAccount[]>({
    queryKey: ["/api/banking/accounts"],
    refetchOnWindowFocus: false,
  });

  const { data: zatcaConfig } = useQuery<ZatcaConfig | null>({
    queryKey: ["/api/zatca/config"],
    refetchOnWindowFocus: false,
  });

  const hasBankAccounts = bankAccounts && bankAccounts.length > 0;
  const isZatcaActive = zatcaConfig && zatcaConfig.isActive;

  return [
    {
      id: "database",
      labelKey: "trust_int_db",
      health: lastFetchAt ? "healthy" : "degraded",
      lastSyncAt: lastFetchAt,
      cadence: t("trust_int_db_cadence"),
      detail: t("trust_int_db_detail"),
    },
    {
      id: "ai",
      labelKey: "trust_int_ai",
      health: "healthy",
      lastSyncAt: lastFetchAt,
      cadence: t("trust_int_ai_cadence"),
      detail: t("trust_int_ai_detail"),
    },
    {
      id: "bank-feed",
      labelKey: "trust_int_bank",
      health: hasBankAccounts ? "healthy" : "not_configured",
      lastSyncAt: hasBankAccounts ? lastFetchAt : null,
      cadence: hasBankAccounts ? t("trust_int_bank_cadence_on") : t("trust_cadence_off"),
      detail: hasBankAccounts
        ? t("trust_int_bank_detail_on").replace("{n}", String(bankAccounts!.length))
        : t("trust_int_bank_detail_off"),
    },
    {
      id: "zatca",
      labelKey: "trust_int_zatca",
      health: isZatcaActive ? "healthy" : "not_configured",
      lastSyncAt: isZatcaActive ? lastFetchAt : null,
      cadence: isZatcaActive ? t("trust_int_zatca_cadence_on") : t("trust_cadence_off"),
      detail: isZatcaActive
        ? t("trust_int_zatca_detail_on")
            .replace("{vat}", zatcaConfig!.vatNumber)
            .replace("{env}", zatcaConfig!.environment === "sandbox" ? t("trust_env_sandbox") : t("trust_env_production"))
        : t("trust_int_zatca_detail_off"),
    },
  ];
}

interface MeRole {
  id: number;
  name: string;
  role: "owner" | "accountant" | "viewer";
}

const ROLE_LABEL: Record<MeRole["role"], StringKey> = {
  owner: "trust_role_owner",
  accountant: "trust_role_accountant",
  viewer: "trust_role_viewer",
};

export function TrustCluster() {
  const { locale } = useLocale();
  const t = useT();
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
    ? `${t("trust_updated")} ${formatDistanceToNow(lastFetchAt, {
        addSuffix: true,
        locale: dfLocale,
      })}`
    : t("trust_waiting");

  // A very short version of the freshness signal so the topbar can keep
  // showing "how recent" at tablet widths (768–1023px) without blowing the
  // horizontal budget. "2m", "5h", "3d" — or a localized "now" near zero.
  const compactFreshLabel = (() => {
    if (!lastFetchAt) return locale === "ar" ? "—" : "—";
    const diffSec = Math.max(0, Math.floor((Date.now() - lastFetchAt.getTime()) / 1000));
    if (diffSec < 45) return t("trust_now");
    const mins = Math.round(diffSec / 60);
    if (mins < 60) return `${mins}${t("trust_abbr_min")}`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}${t("trust_abbr_hour")}`;
    const days = Math.round(hours / 24);
    return `${days}${t("trust_abbr_day")}`;
  })();

  const roleLabel = me ? t(ROLE_LABEL[me.role]) : null;
  // Tablet-width abbreviation: keep role explicit without leaning on title/hover
  // (which is unreliable on touch). English: first 3 chars + dot when longer.
  // Arabic labels here are already short, so use them as-is.
  const roleLabelShort = me
    ? locale === "ar"
      ? t(ROLE_LABEL[me.role])
      : me.role === "accountant"
      ? "Acc."
      : t(ROLE_LABEL[me.role])
    : null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          data-testid="button-trust-cluster"
          aria-label={t("trust_aria_status")}
        >
          <span className="relative inline-flex items-center justify-center w-4 h-4">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                HEALTH_TONE[overall],
              )}
            />
          </span>
          <span className="hidden lg:inline tabular-nums" data-testid="text-data-freshness">
            {freshLabel}
          </span>
          <span
            className="hidden md:inline lg:hidden tabular-nums text-[11px]"
            data-testid="text-data-freshness-compact"
            title={freshLabel}
          >
            {compactFreshLabel}
          </span>
          {me && roleLabel && (
            <>
              <span
                className="hidden lg:inline-flex items-center gap-1 ms-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"
                data-testid="text-current-role"
              >
                <UserCheck className="w-3 h-3" />
                {roleLabel}
              </span>
              <span
                className="hidden md:inline-flex lg:hidden items-center gap-1 ms-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"
                data-testid="text-current-role-compact"
                aria-label={roleLabel}
              >
                <UserCheck className="w-3 h-3" />
                {roleLabelShort}
              </span>
            </>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border text-start space-y-1">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Shield className="w-4 h-4 text-primary" />
              {t("trust_title")}
            </SheetTitle>
            <button
              onClick={() => refetch()}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 motion-safe:transition-colors"
              data-testid="button-refresh-status"
            >
              <RefreshCw className={cn("w-3 h-3", isFetching && "motion-safe:animate-spin")} />
              {t("trust_refresh")}
            </button>
          </div>
          <SheetDescription className="text-[11px] text-muted-foreground">{freshLabel}</SheetDescription>
        </SheetHeader>
        <ul className="divide-y divide-border" data-testid="list-integration-status">
          {integrations.map((it) => {
            const Icon =
              it.id === "database" ? Database
              : it.id === "ai" ? Shield
              : it.id === "bank-feed" ? Landmark
              : it.id === "zatca" ? QrCode
              : Plug;
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
                      {t(it.labelKey)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                      <span className={cn("h-1.5 w-1.5 rounded-full", HEALTH_TONE[it.health])} />
                      {t(HEALTH_LABEL[it.health])}
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
                        {t("trust_last_sync")} ·{" "}
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
                        {t("trust_next")} · {it.cadence}
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
                {t("trust_all_ok")}
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-warning" />
                {t("trust_some_attention")}
              </>
            )}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
