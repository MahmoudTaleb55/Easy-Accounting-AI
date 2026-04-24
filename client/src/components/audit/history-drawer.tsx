import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Bot, Cog, History, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/locale-context";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export type HistorySource = "user" | "ai" | "integration" | "system";
type SheetSide = "top" | "bottom" | "left" | "right";
type HistoryAction = "create" | "update" | "delete" | "post";
const SOURCE_KEYS: HistorySource[] = ["user", "ai", "system", "integration"];
const ACTION_KEYS: HistoryAction[] = ["create", "update", "delete", "post"];

export type HistoryEntityType =
  | "transaction"
  | "journal_entry"
  | "account"
  | "fixed_asset"
  | "employee"
  | "attendance"
  | "leave"
  | "payroll_run";

export interface HistoryEvent {
  id: string | number;
  at: string | Date;
  source: HistorySource;
  actor?: string;
  action: string;
  actionKey?: HistoryAction;
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

interface HistoryTimelineProps {
  entityType?: HistoryEntityType;
  entityId?: number;
  enabled?: boolean;
  className?: string;
}

export function HistoryTimeline({
  entityType,
  entityId,
  enabled: enabledProp = true,
  className,
}: HistoryTimelineProps) {
  const { locale } = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;
  const labels = {
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
    filterSource: locale === "ar" ? "المصدر" : "Source",
    filterAction: locale === "ar" ? "الإجراء" : "Action",
    filterReset: locale === "ar" ? "مسح" : "Reset",
    noMatch:
      locale === "ar" ? "لا توجد أحداث مطابقة للفلاتر." : "No events match your filters.",
  };
  const actionLabels: Record<HistoryAction, string> = {
    create: labels.create,
    update: labels.update,
    delete: labels.delete,
    post: labels.post,
  };

  const enabled = enabledProp && !!entityType && !!entityId && entityId > 0;
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
      const actKey = (ACTION_KEYS as string[]).includes(row.action)
        ? (row.action as HistoryAction)
        : undefined;
      return {
        id: row.id,
        at: row.occurredAt,
        source: src,
        actor: row.actor || undefined,
        action: actionLabel(row.action),
        actionKey: actKey,
        changes: (row.changes || []).map((c) => ({
          field: c.field,
          from: c.from === undefined ? undefined : formatPrimitive(c.from),
          to: c.to === undefined ? undefined : formatPrimitive(c.to),
        })),
      } satisfies HistoryEvent;
    });
  }, [data, labels.create, labels.update, labels.delete, labels.post]);

  const [sourceFilter, setSourceFilter] = React.useState<Set<HistorySource>>(
    () => new Set(SOURCE_KEYS),
  );
  const [actionFilter, setActionFilter] = React.useState<Set<HistoryAction>>(
    () => new Set(ACTION_KEYS),
  );

  const sourceCounts = React.useMemo(() => {
    const m: Record<HistorySource, number> = { user: 0, ai: 0, system: 0, integration: 0 };
    for (const ev of events) m[ev.source] = (m[ev.source] ?? 0) + 1;
    return m;
  }, [events]);

  const actionCounts = React.useMemo(() => {
    const m: Record<HistoryAction, number> = { create: 0, update: 0, delete: 0, post: 0 };
    for (const ev of events) if (ev.actionKey) m[ev.actionKey] = (m[ev.actionKey] ?? 0) + 1;
    return m;
  }, [events]);

  const filteredEvents = React.useMemo(() => {
    return events.filter((ev) => {
      if (!sourceFilter.has(ev.source)) return false;
      if (ev.actionKey && !actionFilter.has(ev.actionKey)) return false;
      return true;
    });
  }, [events, sourceFilter, actionFilter]);

  const toggle = <T,>(set: Set<T>, key: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const filtersDirty =
    sourceFilter.size !== SOURCE_KEYS.length || actionFilter.size !== ACTION_KEYS.length;

  const resetFilters = React.useCallback(() => {
    setSourceFilter(new Set(SOURCE_KEYS));
    setActionFilter(new Set(ACTION_KEYS));
  }, []);

  React.useEffect(() => {
    resetFilters();
  }, [entityType, entityId, resetFilters]);

  return (
    <div className={`flex flex-col ${className ?? ""}`} data-testid="history-timeline">
      {!isLoading && !isError && events.length > 0 && (
        <div
          className="px-5 py-3 border-b border-border space-y-2 bg-muted/20"
          data-testid="history-filters"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              <Filter className="w-3 h-3" />
              {labels.filterSource}
            </div>
            {filtersDirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground"
                onClick={resetFilters}
                data-testid="button-history-filter-reset"
              >
                {labels.filterReset}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_KEYS.map((key) => {
              const meta = SOURCE_META[key];
              const Icon = meta.icon;
              const active = sourceFilter.has(key);
              const count = sourceCounts[key] ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(sourceFilter, key, setSourceFilter)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 h-6 text-[11px] transition-colors ${
                    active
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  }`}
                  data-testid={`button-history-filter-source-${key}`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{locale === "ar" ? meta.ar : meta.en}</span>
                  <span className="font-numeric tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-1">
            {labels.filterAction}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ACTION_KEYS.map((key) => {
              const active = actionFilter.has(key);
              const count = actionCounts[key] ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(actionFilter, key, setActionFilter)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 h-6 text-[11px] transition-colors ${
                    active
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  }`}
                  data-testid={`button-history-filter-action-${key}`}
                >
                  <span>{actionLabels[key]}</span>
                  <span className="font-numeric tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">{labels.none}</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="px-6 py-16 text-center" data-testid="history-empty-filtered">
            <div className="mx-auto mb-3 inline-flex items-center justify-center w-10 h-10 rounded-md bg-muted/60 border border-border text-muted-foreground">
              <Filter className="w-4 h-4" />
            </div>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">{labels.noMatch}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 h-7 text-xs"
              onClick={resetFilters}
              data-testid="button-history-filter-reset-empty"
            >
              {labels.filterReset}
            </Button>
          </div>
        ) : (
          <ol className="relative px-5 py-5 space-y-5">
            {filteredEvents.map((ev, i) => {
              const meta = SOURCE_META[ev.source];
              const Icon = meta.icon;
              const isLast = i === filteredEvents.length - 1;
              const isAi = ev.source === "ai";
              const isAiFallback = isAi && (!ev.actor || ev.actor === "AI assistant");
              const isAiViaHuman = isAi && !!ev.actor && ev.actor !== "AI assistant";
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
                    <p className="text-sm font-medium text-foreground">{ev.action}</p>
                    <span className="text-[11px] font-numeric tabular-nums text-muted-foreground shrink-0">
                      {format(new Date(ev.at), "d MMM yyyy · HH:mm", { locale: dfLocale })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {!isAiViaHuman && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-normal">
                        {locale === "ar" ? meta.ar : meta.en}
                      </Badge>
                    )}
                    {!isAiFallback && (
                      <span className="truncate" data-testid="text-history-actor">
                        {isAiViaHuman ? (
                          <>
                            {ev.actor}
                            <span className="text-muted-foreground/80">
                              {" "}
                              {locale === "ar" ? "عبر AI" : "via AI"}
                            </span>
                          </>
                        ) : (
                          ev.actor || labels.actorUnavailable
                        )}
                      </span>
                    )}
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
    </div>
  );
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
  const labels = {
    title: locale === "ar" ? "السجل والتغييرات" : "History & changes",
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
        <HistoryTimeline
          entityType={entityType}
          entityId={entityId}
          enabled={open}
          className="flex-1 min-h-0"
        />
      </SheetContent>
    </Sheet>
  );
}

