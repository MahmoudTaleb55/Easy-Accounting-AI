import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Bot, Cog, History } from "lucide-react";
import { useLocale } from "@/contexts/locale-context";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export type HistorySource = "user" | "ai" | "integration" | "system";
type SheetSide = "top" | "bottom" | "left" | "right";

export interface HistoryEvent {
  id: string | number;
  at: string | Date;
  source: HistorySource;
  actor?: string;
  action: string;
  changes?: Array<{ field: string; from?: string | number | null; to?: string | number | null }>;
  note?: string;
}

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  reference?: string;
  events: HistoryEvent[];
  loading?: boolean;
  /**
   * When true, an explicit notice is shown after the event list explaining
   * that ongoing edit/delete history is not yet recorded for this entity.
   * Use this when the only event in `events` is the original creation
   * snapshot and a dedicated audit log table is not yet wired.
   */
  partialAudit?: boolean;
}

const SOURCE_META: Record<
  HistorySource,
  { icon: React.ComponentType<{ className?: string }>; ar: string; en: string; tone: string }
> = {
  user:        { icon: User, ar: "مستخدم", en: "User", tone: "text-foreground" },
  ai:          { icon: Bot,  ar: "AI",     en: "AI",   tone: "text-primary" },
  integration: { icon: Cog,  ar: "تكامل",  en: "Integration", tone: "text-info" },
  system:      { icon: Cog,  ar: "النظام", en: "System", tone: "text-muted-foreground" },
};

export function HistoryDrawer({
  open,
  onOpenChange,
  title,
  reference,
  events,
  loading,
  partialAudit,
}: HistoryDrawerProps) {
  const { locale, dir } = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;
  const labels = {
    title: locale === "ar" ? "السجل والتغييرات" : "History & changes",
    none: locale === "ar" ? "لا يوجد سجل بعد لهذا العنصر." : "No history yet for this item.",
    from: locale === "ar" ? "من" : "from",
    to: locale === "ar" ? "إلى" : "to",
    loading: locale === "ar" ? "جارٍ التحميل…" : "Loading…",
    partial:
      locale === "ar"
        ? "يعرض هذا السجل لحظة الإنشاء فقط. تتبّع التعديلات اللاحقة سيتفعل عند تشغيل سجل المراجعة المخصّص."
        : "Only the original creation snapshot is recorded. Edit-level audit history will appear once the dedicated audit log is enabled.",
  };
  const side: SheetSide = dir === "rtl" ? "left" : "right";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className="w-full sm:max-w-md p-0 flex flex-col"
        data-testid="sheet-history"
      >
        <SheetHeader className="px-5 py-4 border-b border-border space-y-1.5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4 text-muted-foreground" />
            {labels.title}
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            <span className="font-medium text-foreground">{title}</span>
            {reference && (
              <>
                {" "}·{" "}
                <span className="font-numeric tabular-nums">{reference}</span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {labels.loading}
            </div>
          ) : events.length === 0 ? (
            <div className="px-6 py-16 text-center" data-testid="history-empty">
              <div className="mx-auto mb-3 inline-flex items-center justify-center w-10 h-10 rounded-md bg-muted/60 border border-border text-muted-foreground">
                <Clock className="w-4 h-4" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {labels.none}
              </p>
            </div>
          ) : (
            <ol className="relative px-5 py-5 space-y-5">
              {events.map((ev, i) => {
                const meta = SOURCE_META[ev.source];
                const Icon = meta.icon;
                const isLast = i === events.length - 1;
                return (
                  <li
                    key={ev.id}
                    className="relative ps-7"
                    data-testid={`history-event-${ev.id}`}
                  >
                    {!isLast && (
                      <span
                        aria-hidden
                        className="absolute start-2.5 top-5 bottom-[-1.25rem] w-px bg-border"
                      />
                    )}
                    <span
                      className={`absolute start-0 top-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-background border border-border ${meta.tone}`}
                    >
                      <Icon className="w-3 h-3" />
                    </span>
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <p className="text-sm font-medium text-foreground">
                        {ev.action}
                      </p>
                      <span className="text-[11px] font-numeric tabular-nums text-muted-foreground shrink-0">
                        {format(new Date(ev.at), "d MMM yyyy · HH:mm", { locale: dfLocale })}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-normal">
                        {locale === "ar" ? meta.ar : meta.en}
                      </Badge>
                      <span className="truncate" data-testid="text-history-actor">
                        {ev.actor || (locale === "ar" ? "المنفّذ غير متوفر" : "Actor unavailable")}
                      </span>
                    </div>
                    {ev.changes && ev.changes.length > 0 && (
                      <ul className="mt-2 space-y-1 border-s border-border ps-3 text-xs">
                        {ev.changes.map((c, idx) => (
                          <li key={idx} className="text-muted-foreground">
                            <span className="text-foreground/80 font-medium">{c.field}:</span>{" "}
                            {c.from !== undefined && c.from !== null && c.from !== "" && (
                              <span className="line-through opacity-70 font-numeric tabular-nums">
                                {String(c.from)}
                              </span>
                            )}
                            {c.from !== undefined && c.to !== undefined && " → "}
                            {c.to !== undefined && c.to !== null && (
                              <span className="text-foreground font-numeric tabular-nums">
                                {String(c.to)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {ev.note && (
                      <p className="mt-1.5 text-xs text-muted-foreground/90 leading-relaxed">
                        {ev.note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {!loading && events.length > 0 && partialAudit && (
            <div
              className="mx-5 mb-5 mt-1 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed"
              data-testid="history-partial-notice"
            >
              {labels.partial}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
