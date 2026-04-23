import { useQuery } from "@tanstack/react-query";
import { Bot, X, AlertTriangle, AlertCircle, Info, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { usePeriod } from "@/contexts/period-context";
import { useLocation } from "wouter";

interface Props { open: boolean; onClose: () => void; }

interface Alert {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  description: string;
  metric?: string;
}

const sevIcon = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
} as const;

const sevColor = {
  critical: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
} as const;

export function AiRail({ open, onClose }: Props) {
  const t = useT();
  const { dir } = useLocale();
  const { period } = usePeriod();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<{ alerts: Alert[] }>({
    queryKey: ["/api/insights/alerts"],
    enabled: open,
  });

  if (!open) return null;

  const alerts = data?.alerts || [];

  return (
    <aside
      className={`fixed top-0 ${dir === "rtl" ? "left-0 border-r" : "right-0 border-l"} bottom-0 z-40 w-80 lg:w-96 bg-card border-border shadow-lg flex flex-col animate-in ${dir === "rtl" ? "slide-in-from-left" : "slide-in-from-right"} duration-200`}
      data-testid="ai-rail"
    >
      <div className="flex items-center justify-between border-b border-border px-4 h-14 shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 p-1.5 rounded-md">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">{t("ai_title")}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              {period.start.toLocaleDateString(dir === "rtl" ? "ar" : "en", { month: "short", day: "numeric" })}
              {" – "}
              {period.end.toLocaleDateString(dir === "rtl" ? "ar" : "en", { month: "short", day: "numeric" })}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-ai-rail">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="px-4 py-3 border-b border-border">
        <div className="text-xs text-muted-foreground">{t("ai_subtitle")}</div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {isLoading && (
          <div className="text-xs text-muted-foreground text-center py-8">…</div>
        )}
        {!isLoading && alerts.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-12">{t("ai_no_signals")}</div>
        )}
        {alerts.map((a) => {
          const Icon = sevIcon[a.severity];
          return (
            <div
              key={a.id}
              className="rounded-md border border-border bg-background/40 p-3"
              data-testid={`ai-suggestion-${a.id}`}
            >
              <div className="flex items-start gap-2">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${sevColor[a.severity]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground leading-snug">{a.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{a.description}</div>
                  {a.metric && (
                    <div className="mt-1.5 inline-block font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      {a.metric}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setLocation("/app/insights")}
                  data-testid={`ai-accept-${a.id}`}
                >
                  {t("ai_accept")} <ArrowRight className={`w-3 h-3 ${dir === "rtl" ? "me-1 rotate-180" : "ms-1"}`} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
