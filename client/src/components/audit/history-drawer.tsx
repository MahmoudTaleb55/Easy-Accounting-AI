import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Bot, Cog, History } from "lucide-react";
import { useLocale } from "@/contexts/locale-context";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export type HistorySource = "user" | "ai" | "integration" | "system";
type SheetSide = "top" | "bottom" | "left" | "right";
type HistoryAction = "create" | "update" | "delete" | "post";

export type HistoryEntityType =
  | "transaction"
  | "journal_entry"
  | "account"
  | "fixed_asset"
  | "employee"
  | "attendance"
  | "leave";

export interface HistoryEvent {
  id: string | number;
  at: string | Date;
  source: HistorySource;
  actor?: string;
  action: string;
  changes?: Array<{ field: string; from?: unknown; to?: unknown }>;
  note?: string;
}

interface AuditRow {
  id: number;
  entityType: string;
  entityId: number;
  action: HistoryAction | string;
  actor: string | null;
  source: HistorySource | string;
  changes: Array<{ field: string; from?: unknown; to?: unknown }> | null;
  occurredAt: string;
}

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  reference?: string;
  entityType?: HistoryEntityType;
  entityId?: number;
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

function formatPrimitive(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function HistoryDrawer({
  open,
  onOpenChange,
  title,
  reference,
  entityType,
  entityId,
}: HistoryDrawerProps) {
  const { locale, dir } = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;
  const labels = {
    title: locale === "ar" ? "السجل والتغييرات" : "History & changes",
    none: locale === "ar" ? "لا يوجد سجل بعد لهذا العنصر." : "No history yet for this item.",
    loading: locale === "ar" ? "جارٍ التحميل…" : "Loading…",
    error:
      locale === "ar"
        ? "تعذّر جلب السجل. حاول لاحقاً."
        : "Could not load history. Try again shortly.",
    create: locale === "ar" ? "تم الإنشاء" : "Created",
    update: locale === "ar" ? "تم التعديل" : "Updated",
    delete: locale === "ar" ? "تم الحذف" : "Deleted",
    post: locale === "ar" ? "تم الترحيل" : "Posted",
    actorUnavailable: locale === "ar" ? "المنفّذ غير متوفر" : "Actor unavailable",
  };
  const side: SheetSide = dir === "rtl" ? "left" : "right";

  const enabled = open && !!entityType && !!entityId && entityId > 0;
  const { data, isLoading, isError } = useQuery<AuditRow[]>({
    queryKey: ["/api/audit", entityType, entityId],
    enabled,
  });

  const events: HistoryEvent[] = React.useMemo(() => {
    if (!data) return [];
    const actionLabel = (a: string) =>
      a === "create"
        ? labels.create
        : a === "update"
        ? labels.update
        : a === "delete"
        ? labels.delete
        : a === "post"
        ? labels.post
        : a;
    return data.map((row) => {
      const src = (["user", "ai", "integration", "system"].includes(row.source)
        ? row.source
        : "system") as HistorySource;
      return {
        id: row.id,
        at: row.occurredAt,
        source: src,
        actor: row.actor || undefined,
        action: actionLabel(row.action),
        changes: (row.changes || []).map((c) => ({
          field: c.field,
          from: c.from === undefined ? undefined : formatPrimitive(c.from),
          to: c.to === undefined ? undefined : formatPrimitive(c.to),
        })),
      } satisfies HistoryEvent;
    });
  }, [data, labels.create, labels.update, labels.delete, labels.post]);

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
          {isLoading ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground" data-testid="history-loading">
              {labels.loading}
            </div>
          ) : isError ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground" data-testid="history-error">
              {labels.error}
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
                        {ev.actor || labels.actorUnavailable}
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
                            {c.from !== undefined && c.from !== null && c.from !== "" && c.to !== undefined && c.to !== null && c.to !== "" && " → "}
                            {c.to !== undefined && c.to !== null && c.to !== "" && (
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
