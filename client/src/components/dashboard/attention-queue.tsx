import { useMemo } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, ArrowRight, BookText, Activity, FileQuestion,
} from "lucide-react";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import {
  useDashboardAlerts,
  useDashboardJournalEntries,
  useTransactions,
} from "@/hooks/use-dashboard-data";
import { AttentionQueueSkeleton } from "./skeletons";

interface AttentionItem {
  id: string;
  kind: "anomaly" | "pending_je" | "inactivity" | "alert";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  href: string;
  metric?: string;
}

const sevConfig: Record<AttentionItem["severity"], { icon: any; color: string; ring: string }> = {
  critical: { icon: AlertCircle,    color: "text-destructive", ring: "border-destructive/30" },
  warning:  { icon: AlertTriangle,  color: "text-warning",     ring: "border-warning/30" },
  info:     { icon: Info,           color: "text-info",        ring: "border-info/30" },
};

const kindIcon = {
  anomaly:    Activity,
  pending_je: BookText,
  inactivity: FileQuestion,
  alert:      Info,
};

export function AttentionQueue() {
  const t = useT();
  const { dir } = useLocale();
  const { data: alerts, isLoading: alertsLoading } = useDashboardAlerts();
  const { data: txs } = useTransactions();
  const { data: jes } = useDashboardJournalEntries();

  const items: AttentionItem[] = useMemo(() => {
    const out: AttentionItem[] = [];
    (alerts?.alerts || []).forEach((a) => {
      if (a.severity === "success") return;
      out.push({
        id: `alert-${a.id}`,
        kind: a.severity === "critical" ? "anomaly" : "alert",
        severity: a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info",
        title: a.title,
        description: a.description,
        href: "/app/insights",
        metric: a.metric,
      });
    });
    (jes || []).forEach((je: any) => {
      if (je.source === "ai" || (je.lines || []).length === 0) {
        out.push({
          id: `je-${je.id}`,
          kind: "pending_je",
          severity: "warning",
          title: t("attention_pending_je"),
          description: `${je.reference || ""} — ${je.description || ""}`,
          href: "/app/journal",
        });
      }
    });
    if (txs && txs.length > 0) {
      const week = Date.now() - 7 * 86_400_000;
      const recent = txs.filter((tx) => tx.date && new Date(tx.date).getTime() >= week).length;
      if (recent === 0 && txs.length > 0) {
        out.push({
          id: "inactive-week",
          kind: "inactivity",
          severity: "info",
          title: t("attention_inactive"),
          description: t("attention_inactive_desc"),
          href: "/app/transactions?new=1",
        });
      }
    }
    return out
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      })
      .slice(0, 6);
  }, [alerts, jes, txs, t, dir]);

  if (alertsLoading) {
    return <AttentionQueueSkeleton />;
  }

  if (items.length === 0) {
    const txCount = txs?.length || 0;
    const now = new Date();
    const ts = now.toLocaleTimeString(dir === "rtl" ? "ar" : "en", { hour: "2-digit", minute: "2-digit" });
    return (
      <section
        className="border border-border bg-card rounded-md p-6 flex items-center gap-4 motion-safe:animate-fade-in"
        data-testid="attention-empty"
      >
        <div className="rounded-full bg-success/10 p-3 shrink-0">
          <CheckCircle2 className="w-6 h-6 text-success" />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold tracking-tight text-foreground">{t("attention_caught_up_a")}</div>
          <div className="text-sm text-muted-foreground mt-0.5 tabular-nums">
            {txCount > 0
              ? t("attention_caught_up_count")
                  .replace("{n}", txCount.toLocaleString(dir === "rtl" ? "ar-SA" : "en-US"))
                  .replace("{ts}", ts)
              : t("attention_caught_up_b")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="motion-safe:animate-fade-in" data-testid="attention-queue">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold tracking-tight">{t("attention_title")}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map((it) => {
          const cfg = sevConfig[it.severity];
          const KindIcon = kindIcon[it.kind];
          return (
            <Link
              key={it.id}
              href={it.href}
              data-testid={`attention-item-${it.id}`}
              className={`group flex items-start gap-3 rounded-md border ${cfg.ring} bg-card p-3 transition-colors hover:bg-accent/30`}
            >
              <div className="mt-0.5 shrink-0">
                <KindIcon className={`w-4 h-4 ${cfg.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground leading-snug">{it.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">{it.description}</div>
                {it.metric && (
                  <div className="mt-1 inline-block font-mono text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground tabular-nums">
                    {it.metric}
                  </div>
                )}
              </div>
              <ArrowRight
                className={`w-4 h-4 mt-1 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors ${
                  dir === "rtl" ? "rotate-180" : ""
                }`}
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
