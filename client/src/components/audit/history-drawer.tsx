import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Bot, Cog, History, Filter, RotateCcw, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// Source kinds that can trigger a `reverseAutoPostedJournalEntry` cascade.
// Mirrors `JournalEntrySourceKind` in `server/storage.ts`. Kept inline here
// instead of importing from `@shared/schema` because the public `JournalEntrySourceKind`
// in shared/schema.ts is the user-facing variant (no `_event` suffixes, no
// `document` kind) — the audit row stamps the internal kind.
type ReversalSourceKind =
  | "payroll_run"
  | "depreciation_run"
  | "impairment_event"
  | "revaluation_event"
  | "disposal"
  | "document";

interface ReversalSource {
  kind: ReversalSourceKind;
  id: number;
}

function parseReversedBy(value: unknown): ReversalSource | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^([a-z_]+)#(\d+)$/);
  if (!m) return null;
  const kind = m[1] as ReversalSourceKind;
  const id = Number(m[2]);
  if (!Number.isFinite(id) || id <= 0) return null;
  // Defensive: only accept the documented kinds. Unknown kinds render as a
  // tombstone rather than as a clickable mystery link.
  if (
    kind !== "payroll_run" &&
    kind !== "depreciation_run" &&
    kind !== "impairment_event" &&
    kind !== "revaluation_event" &&
    kind !== "disposal" &&
    kind !== "document"
  ) {
    return null;
  }
  return { kind, id };
}

// Where to deep-link when the user clicks the source reference. The hash
// anchors mirror the patterns used by `buildJournalSourceLinkMap` in
// `server/storage.ts` so a still-living source row will scroll into view; a
// deleted source row simply leaves the user on the parent page (the
// "tombstone" fallback called out in the task spec).
function reversalSourceHref(source: ReversalSource): string {
  switch (source.kind) {
    case "payroll_run":
      return `/app/hr#pr-${source.id}`;
    case "depreciation_run":
      return `/app/fixed-assets#dr-${source.id}`;
    case "impairment_event":
      return `/app/fixed-assets#imp-${source.id}`;
    case "revaluation_event":
      return `/app/fixed-assets#rev-${source.id}`;
    case "disposal":
      return `/app/fixed-assets#disp-${source.id}`;
    case "document":
      return `/app/inbox#doc-${source.id}`;
  }
}

function reversalSourceLabel(
  source: ReversalSource,
  locale: "ar" | "en",
): string {
  const ar = locale === "ar";
  switch (source.kind) {
    case "payroll_run":
      return ar ? `كشف رواتب #${source.id}` : `Payroll run #${source.id}`;
    case "depreciation_run":
      return ar ? `دورة إهلاك #${source.id}` : `Depreciation run #${source.id}`;
    case "impairment_event":
      return ar ? `انخفاض قيمة #${source.id}` : `Impairment #${source.id}`;
    case "revaluation_event":
      return ar ? `إعادة تقييم #${source.id}` : `Revaluation #${source.id}`;
    case "disposal":
      return ar ? `استبعاد #${source.id}` : `Disposal #${source.id}`;
    case "document":
      return ar ? `مستند مرفوع #${source.id}` : `Document #${source.id}`;
  }
}

export interface HistoryEvent {
  id: string | number;
  at: string | Date;
  source: HistorySource;
  actor?: string;
  action: string;
  actionKey?: HistoryAction;
  changes?: Array<{ field: string; from?: unknown; to?: unknown }>;
  note?: string;
  reversedBy?: ReversalSource;
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
  /**
   * For `entityType="journal_entry"` only: when true, fetch the audit log via
   * the reversal-aware endpoint so the drawer surfaces the trail even if the
   * JE was cascade-deleted by a `reverseAutoPostedJournalEntry` call.
   */
  includeReversal?: boolean;
}

// Internal-use audit-row metadata that the timeline strips out before
// rendering the per-event change list. `reversedBy` becomes the dedicated
// "Reversed by …" link and `companyId` is purely an ownership stamp.
const HIDDEN_CHANGE_FIELDS = new Set(["reversedBy", "companyId"]);

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

export interface HistoryEntityPeriod {
  start?: string | Date | null;
  end?: string | Date | null;
}

interface HistoryTimelineProps {
  entityType?: HistoryEntityType;
  entityId?: number;
  enabled?: boolean;
  className?: string;
  /**
   * Journal entries can be cascade-deleted by `reverseAutoPostedJournalEntry`
   * (payroll-run delete, depreciation-run delete, fixed-asset event delete,
   * document delete). When this drawer is rendered for a JE that may already
   * be gone, set this flag so the timeline reads from the reversal-aware
   * endpoint and surfaces the "Reversed by …" trail.
   */
  includeReversal?: boolean;
  /**
   * Override the empty-state text. Useful when the timeline is mounted
   * inside a tombstone dialog and we want a more specific message
   * (e.g. "We couldn't find this entry or any related reversal trail.")
   * instead of the generic "No history yet for this item.".
   */
  emptyLabel?: string;
  /**
   * If provided, enables a "this entity's period" preset in the period filter
   * dropdown. Both start and end are inclusive. Either bound may be omitted
   * for open-ended ranges.
   */
  entityPeriod?: HistoryEntityPeriod;
}

type PeriodPreset = "all" | "entity" | "7d" | "30d" | "90d";

const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "all",
  "entity",
  "7d",
  "30d",
  "90d",
];

// Per-entity-type localStorage key. Keeping the choice scoped to the entity
// type (attendance vs leave vs payroll_run vs journal_entry, …) lets a user
// who lives in "Last 30 days" on attendance keep that, while the JE drawer
// remembers its own preference independently.
function periodStorageKey(entityType: HistoryEntityType | undefined): string | null {
  return entityType ? `history.periodFilter.${entityType}` : null;
}

function readPersistedPeriod(
  entityType: HistoryEntityType | undefined,
  hasEntityPeriod: boolean,
): PeriodPreset {
  const key = periodStorageKey(entityType);
  if (!key || typeof window === "undefined") return "all";
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return "all";
    if (!(PERIOD_PRESETS as readonly string[]).includes(raw)) return "all";
    const preset = raw as PeriodPreset;
    // The "entity period" preset only makes sense when the caller passed an
    // entityPeriod range. Fall back to "all" so an attendance row with no
    // dates doesn't get stuck filtered to an empty window.
    if (preset === "entity" && !hasEntityPeriod) return "all";
    return preset;
  } catch {
    return "all";
  }
}

function writePersistedPeriod(
  entityType: HistoryEntityType | undefined,
  preset: PeriodPreset,
): void {
  const key = periodStorageKey(entityType);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, preset);
  } catch {
    // Quota / disabled storage — silently ignore, the in-memory state still works.
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function HistoryTimeline({
  entityType,
  entityId,
  enabled: enabledProp = true,
  className,
  includeReversal = false,
  emptyLabel,
  entityPeriod,
}: HistoryTimelineProps) {
  const { locale } = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;
  const labels = {
    none: emptyLabel ?? (locale === "ar" ? "لا يوجد سجل بعد لهذا العنصر." : "No history yet for this item."),
    loading: locale === "ar" ? "جارٍ التحميل…" : "Loading…",
    error:
      locale === "ar"
        ? "تعذّر جلب السجل. حاول لاحقاً."
        : "Could not load history. Try again shortly.",
    create: locale === "ar" ? "تم الإنشاء" : "Created",
    update: locale === "ar" ? "تم التعديل" : "Updated",
    delete: locale === "ar" ? "تم الحذف" : "Deleted",
    post: locale === "ar" ? "تم الترحيل" : "Posted",
    reversed: locale === "ar" ? "تم العكس" : "Reversed",
    reversedBy: locale === "ar" ? "بواسطة" : "by",
    actorUnavailable: locale === "ar" ? "المنفّذ غير متوفر" : "Actor unavailable",
    filterSource: locale === "ar" ? "المصدر" : "Source",
    filterAction: locale === "ar" ? "الإجراء" : "Action",
    filterPeriod: locale === "ar" ? "الفترة" : "Period",
    filterReset: locale === "ar" ? "مسح" : "Reset",
    noMatch:
      locale === "ar" ? "لا توجد أحداث مطابقة للفلاتر." : "No events match your filters.",
    periodAll: locale === "ar" ? "كل الأوقات" : "All time",
    periodEntity: locale === "ar" ? "ضمن فترة العنصر" : "Within this period",
    period7d: locale === "ar" ? "آخر 7 أيام" : "Last 7 days",
    period30d: locale === "ar" ? "آخر 30 يوماً" : "Last 30 days",
    period90d: locale === "ar" ? "آخر 90 يوماً" : "Last 90 days",
  };
  const actionLabels: Record<HistoryAction, string> = {
    create: labels.create,
    update: labels.update,
    delete: labels.delete,
    post: labels.post,
  };

  const useReversalEndpoint =
    includeReversal && entityType === "journal_entry";
  const enabled = enabledProp && !!entityType && !!entityId && entityId > 0;

  // Period filter state has to be declared before the query because we want
  // changing presets to refetch with a narrower window — the bounds become
  // part of the query key and a `from` / `to` query string on the request.
  const [sourceFilter, setSourceFilter] = React.useState<Set<HistorySource>>(
    () => new Set(SOURCE_KEYS),
  );
  const [actionFilter, setActionFilter] = React.useState<Set<HistoryAction>>(
    () => new Set(ACTION_KEYS),
  );
  const hasEntityPeriod = !!entityPeriod && (
    entityPeriod.start !== undefined && entityPeriod.start !== null && entityPeriod.start !== "" ||
    entityPeriod.end !== undefined && entityPeriod.end !== null && entityPeriod.end !== ""
  );
  // Lazily seeded from localStorage so reopening the drawer (or returning in a
  // later session) restores the user's last picked preset for this entity type.
  // First-time users still land on "All time".
  const [periodFilter, setPeriodFilterState] = React.useState<PeriodPreset>(
    () => readPersistedPeriod(entityType, hasEntityPeriod),
  );

  const setPeriodFilter = React.useCallback(
    (next: PeriodPreset) => {
      setPeriodFilterState(next);
      writePersistedPeriod(entityType, next);
    },
    [entityType],
  );

  const periodWindow = React.useMemo<{ from: Date | null; to: Date | null }>(() => {
    if (periodFilter === "all") return { from: null, to: null };
    if (periodFilter === "entity") {
      const start = toDate(entityPeriod?.start);
      const end = toDate(entityPeriod?.end);
      return {
        from: start ? startOfDay(start) : null,
        to: end ? endOfDay(end) : null,
      };
    }
    const days = periodFilter === "7d" ? 7 : periodFilter === "30d" ? 30 : 90;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from: startOfDay(from), to: endOfDay(now) };
  }, [periodFilter, entityPeriod?.start, entityPeriod?.end]);

  // Push the period window down to the audit endpoint via `?from=&to=` so
  // very large per-entity histories don't force the browser to download
  // (and discard) thousands of rows that fall outside the active preset.
  // The reversal-aware endpoint always returns the full trail because the
  // whole point of that view is to surface deletions and their cause.
  const fromIso = periodWindow.from?.toISOString();
  const toIso = periodWindow.to?.toISOString();
  const auditUrl = React.useMemo(() => {
    if (!entityType || !entityId) return null;
    if (useReversalEndpoint) {
      return `/api/audit/journal_entry/${entityId}/with-reversal`;
    }
    const base = `/api/audit/${entityType}/${entityId}`;
    const qs = new URLSearchParams();
    if (fromIso) qs.set("from", fromIso);
    if (toIso) qs.set("to", toIso);
    const qsStr = qs.toString();
    return qsStr ? `${base}?${qsStr}` : base;
  }, [useReversalEndpoint, entityType, entityId, fromIso, toIso]);

  const { data, isLoading, isError } = useQuery<AuditRow[]>({
    // Two distinct cache keys so a normal lookup and the reversal-aware
    // lookup do not stomp on each other when both surfaces are visited.
    // The period bounds are part of the standard-lookup key so flipping
    // the preset triggers a refetch with the narrower window.
    queryKey: useReversalEndpoint
      ? ["/api/audit/journal_entry", entityId, "with-reversal"]
      : ["/api/audit", entityType, entityId, fromIso ?? null, toIso ?? null],
    queryFn: async () => {
      const res = await apiRequest("GET", auditUrl!);
      return (await res.json()) as AuditRow[];
    },
    enabled: enabled && !!auditUrl,
  });

  const events: HistoryEvent[] = React.useMemo(() => {
    if (!data) return [];
    const actionLabel = (a: string, isReversal: boolean) =>
      isReversal
        ? labels.reversed
        : a === "create"
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
      const rawChanges = row.changes || [];
      const reversedByChange = rawChanges.find((c) => c.field === "reversedBy");
      const reversedBy = reversedByChange
        ? parseReversedBy(reversedByChange.to)
        : null;
      return {
        id: row.id,
        at: row.occurredAt,
        source: src,
        actor: row.actor || undefined,
        action: actionLabel(row.action, !!reversedBy),
        actionKey: actKey,
        // Strip the reversal marker + ownership stamp from the per-event
        // change list so the UI renders the dedicated "Reversed by" link
        // once and doesn't surface internal bookkeeping fields.
        changes: rawChanges
          .filter((c) => !HIDDEN_CHANGE_FIELDS.has(c.field))
          .map((c) => ({
            field: c.field,
            from: c.from === undefined ? undefined : formatPrimitive(c.from),
            to: c.to === undefined ? undefined : formatPrimitive(c.to),
          })),
        reversedBy: reversedBy ?? undefined,
      } satisfies HistoryEvent;
    });
  }, [
    data,
    labels.create,
    labels.update,
    labels.delete,
    labels.post,
    labels.reversed,
  ]);

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
      if (periodWindow.from || periodWindow.to) {
        const at = new Date(ev.at);
        if (Number.isNaN(at.getTime())) return false;
        if (periodWindow.from && at < periodWindow.from) return false;
        if (periodWindow.to && at > periodWindow.to) return false;
      }
      return true;
    });
  }, [events, sourceFilter, actionFilter, periodWindow]);

  const toggle = <T,>(set: Set<T>, key: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const filtersDirty =
    sourceFilter.size !== SOURCE_KEYS.length ||
    actionFilter.size !== ACTION_KEYS.length ||
    periodFilter !== "all";

  const resetFilters = React.useCallback(() => {
    setSourceFilter(new Set(SOURCE_KEYS));
    setActionFilter(new Set(ACTION_KEYS));
    // Persist "all" so the Reset button is also a way to forget the
    // remembered preset, not just a local-this-render-only override.
    setPeriodFilter("all");
  }, [setPeriodFilter]);

  // When we move to a different entity (or different entity type), throw away
  // the per-mount source/action chip selections so the next entity starts
  // from a clean "all on" state. We deliberately do NOT include
  // `hasEntityPeriod` here — if the parent later re-resolves an `entityPeriod`
  // for the same entity, that should not silently reset the user's chip
  // toggles mid-view.
  React.useEffect(() => {
    setSourceFilter(new Set(SOURCE_KEYS));
    setActionFilter(new Set(ACTION_KEYS));
  }, [entityType, entityId]);

  // Rehydrate the period preset from storage whenever the entity type
  // changes (so each surface honours its own remembered choice) and also
  // when `hasEntityPeriod` becomes available — that lets a previously-saved
  // "entity" preset re-engage once the parent finishes resolving the range,
  // and keeps an "entity" preset from sticking when the new entity has no
  // dates (the helper falls back to "all" in that case).
  React.useEffect(() => {
    setPeriodFilterState(readPersistedPeriod(entityType, hasEntityPeriod));
  }, [entityType, entityId, hasEntityPeriod]);

  return (
    <div className={`flex flex-col ${className ?? ""}`} data-testid="history-timeline">
      {!isLoading && !isError && events.length > 0 && (
        <div
          className="px-5 py-3 border-b border-border space-y-2 bg-muted/20"
          data-testid="history-filters"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              <CalendarRange className="w-3 h-3" />
              {labels.filterPeriod}
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
          <Select
            value={periodFilter}
            onValueChange={(v) => setPeriodFilter(v as PeriodPreset)}
          >
            <SelectTrigger
              className="h-7 text-xs w-full"
              data-testid="select-history-filter-period"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="option-history-period-all">
                {labels.periodAll}
              </SelectItem>
              {hasEntityPeriod && (
                <SelectItem value="entity" data-testid="option-history-period-entity">
                  {labels.periodEntity}
                </SelectItem>
              )}
              <SelectItem value="7d" data-testid="option-history-period-7d">
                {labels.period7d}
              </SelectItem>
              <SelectItem value="30d" data-testid="option-history-period-30d">
                {labels.period30d}
              </SelectItem>
              <SelectItem value="90d" data-testid="option-history-period-90d">
                {labels.period90d}
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-1">
            <Filter className="w-3 h-3" />
            {labels.filterSource}
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
              const reversal = ev.reversedBy;
              return (
                <li
                  key={ev.id}
                  className="relative ps-7"
                  data-testid={`history-event-${ev.id}`}
                  data-reversal={reversal ? "true" : undefined}
                >
                  {!isLast && (
                    <span
                      aria-hidden
                      className="absolute start-2.5 top-5 bottom-[-1.25rem] w-px bg-border"
                    />
                  )}
                  <span
                    className={`absolute start-0 top-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-background border border-border ${
                      reversal ? "text-warning" : meta.tone
                    }`}
                  >
                    {reversal ? <RotateCcw className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
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
                  {reversal && (
                    <div
                      className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      data-testid={`history-reversal-${ev.id}`}
                    >
                      <span>{labels.reversedBy}</span>
                      <Link
                        href={reversalSourceHref(reversal)}
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted hover:border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid={`link-history-reversal-source-${reversal.kind}-${reversal.id}`}
                      >
                        {reversalSourceLabel(reversal, locale === "ar" ? "ar" : "en")}
                      </Link>
                    </div>
                  )}
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
  includeReversal = false,
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
          includeReversal={includeReversal}
          className="flex-1 min-h-0"
        />
      </SheetContent>
    </Sheet>
  );
}

