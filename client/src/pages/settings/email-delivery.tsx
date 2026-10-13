import { Fragment, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocale, type Locale } from "@/contexts/locale-context";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useT, type StringKey } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
import { isString, useSessionStorageState } from "@/hooks/use-session-storage-state";
import {
  isRangePreset,
  isStatusFilterValue,
  isStoredDateString,
  isTrendWindow,
  STATUS_FILTERS,
  TREND_WINDOWS,
  type RangePreset,
  type TrendWindow,
} from "@/pages/settings/email-delivery-filters";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Mail,
  MailCheck,
  MailX,
  MailWarning,
  Clock,
  AlertTriangle,
  Send,
  Eye,
  MousePointerClick,
  Loader2,
  KeyRound,
  UserPlus,
  Search,
  RefreshCw,
  Download,
  ShieldOff,
  History,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { RecipientsPanel } from "@/components/layout/email-delivery-alert-banner";

type Transport = "invitation" | "password_reset";

type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "send_failed"
  | "not_configured"
  | null;

type DeliveryTone = "success" | "warning" | "info" | "destructive" | "muted";

interface DeliveryRow {
  transport: Transport;
  // Stable per-attempt key: provider message id, or `attempt:<eventId>`
  // when the send failed before the provider returned a message id.
  key: string;
  messageId: string | null;
  parentId: string;
  recipient: string;
  role: string | null;
  latestStatus: DeliveryStatus | string;
  latestError: string | null;
  latestAt: string | null;
  firstAt: string | null;
}

interface TrendPoint {
  date: string;
  count: number;
}

interface FailureTrends {
  days: number;
  start: string;
  end: string;
  series: {
    bounced: TrendPoint[];
    complained: TrendPoint[];
    send_failed: TrendPoint[];
  };
  totals: { bounced: number; complained: number; send_failed: number };
}

interface EventRow {
  id: string;
  messageId: string | null;
  type: string;
  error: string | null;
  createdAt: string | null;
}

// Session-storage keys for the filters that should survive a page reload.
// Kept side-by-side so the shared prefix and naming stay obvious. The
// per-filter validator predicates that gate hydration of these keys
// live in `./email-delivery-filters.ts` so they can be unit-tested
// branch-by-branch alongside the shared session-storage hook.
const TREND_WINDOW_STORAGE_KEY = "email-delivery:trend-window";
const STATUS_FILTER_STORAGE_KEY = "email-delivery:status-filter";
const RECIPIENT_FILTER_STORAGE_KEY = "email-delivery:recipient";
const RANGE_PRESET_STORAGE_KEY = "email-delivery:range";
const RANGE_FROM_STORAGE_KEY = "email-delivery:range-from";
const RANGE_TO_STORAGE_KEY = "email-delivery:range-to";

type TFn = (key: StringKey) => string;

function trendWindowLabel(window: TrendWindow, tr: TFn): string {
  switch (window) {
    case "1":
      return tr("edh_win_24h");
    case "7":
      return tr("edh_win_7d");
    case "30":
      return tr("edh_win_30d");
  }
}

function trendWindowShort(window: TrendWindow, tr: TFn): string {
  switch (window) {
    case "1":
      return tr("edh_win_24h_short");
    case "7":
      return tr("edh_win_7d_short");
    case "30":
      return tr("edh_win_30d_short");
  }
}

const RANGE_DAYS: Partial<Record<RangePreset, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

// Convert the chosen preset (or custom inputs) into the YYYY-MM-DD pair
// the server understands. The server treats the `to` bound as inclusive
// of the whole calendar day, so we don't need to bump it here.
function resolveRangeBounds(
  range: RangePreset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  if (range === "custom") {
    return { from: customFrom.trim(), to: customTo.trim() };
  }
  const days = RANGE_DAYS[range];
  if (!days) return { from: "", to: "" };
  const now = new Date();
  const today = toDateOnly(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - (days - 1));
  return { from: toDateOnly(fromDate), to: today };
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusDescriptor(
  status: DeliveryStatus | string,
  tr: TFn,
): { label: string; tone: DeliveryTone; Icon: typeof MailCheck } {
  switch (status) {
    case "sent":
      return { label: tr("edh_st_sent"), tone: "info", Icon: Send };
    case "delivered":
      return { label: tr("edh_st_delivered"), tone: "success", Icon: MailCheck };
    case "delivery_delayed":
      return { label: tr("edh_st_delayed"), tone: "warning", Icon: Clock };
    case "bounced":
      return { label: tr("edh_st_bounced"), tone: "destructive", Icon: MailX };
    case "complained":
      return { label: tr("edh_st_spam"), tone: "destructive", Icon: MailWarning };
    case "opened":
      return { label: tr("edh_st_opened"), tone: "info", Icon: Eye };
    case "clicked":
      return { label: tr("edh_st_clicked"), tone: "info", Icon: MousePointerClick };
    case "send_failed":
      return { label: tr("edh_st_failed"), tone: "destructive", Icon: AlertTriangle };
    case "not_configured":
      return { label: tr("edh_st_email_off"), tone: "muted", Icon: Mail };
    case "queued":
      return { label: tr("edh_st_queued"), tone: "muted", Icon: Mail };
    default:
      return { label: tr("edh_st_pending"), tone: "muted", Icon: Mail };
  }
}

const TONE_BADGE: Record<DeliveryTone, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  destructive:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  muted: "border-border bg-muted text-muted-foreground",
};

function transportDescriptor(
  transport: Transport,
  tr: TFn,
): { label: string; Icon: typeof Mail } {
  if (transport === "invitation") {
    return { label: tr("edh_tr_invitation"), Icon: UserPlus };
  }
  return { label: tr("edh_tr_password"), Icon: KeyRound };
}

function formatDate(value: string | null, locale: Locale): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

export default function EmailDeliveryPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const tr = useT();
  const { role } = useAuth();
  const isAdmin = role === "owner";

  // Recipient search, status drop-down, and trend-window toggle all
  // round-trip through sessionStorage via the same shared hook so an
  // admin's view of this page is preserved across reloads and back/forth
  // navigation within the tab.
  const [statusFilter, setStatusFilter] = useSessionStorageState<string>(
    STATUS_FILTER_STORAGE_KEY,
    "all",
    isStatusFilterValue,
  );
  const [emailInput, setEmailInput] = useSessionStorageState<string>(
    RECIPIENT_FILTER_STORAGE_KEY,
    "",
    isString,
  );
  // Debounce the recipient input so each keystroke doesn't slam the API.
  // Both the on-screen list query and the row-count chip near Download CSV
  // re-issue when this value changes — wiring them to the *debounced*
  // value caps the request volume to one probe per ~250ms idle window
  // (vs one per keystroke, which on busy workspaces hammers the in-memory
  // count cache and the underlying CTE for no user benefit).
  //
  // `useDebouncedValue` seeds its first returned value synchronously,
  // so the first fetch after a page reload is already scoped to the
  // restored recipient (otherwise the chip would briefly run unfiltered
  // until the 250ms timer fires).
  const emailFilter = useDebouncedValue(emailInput.trim(), 250);
  const [selected, setSelected] = useState<DeliveryRow | null>(null);
  const [trendWindow, setTrendWindow] = useSessionStorageState<TrendWindow>(
    TREND_WINDOW_STORAGE_KEY,
    "7",
    isTrendWindow,
  );

  // Date-range filter for the export window. `range` is a preset key that
  // shortcuts to a from/to in days; `customFrom`/`customTo` are the inputs
  // shown when the admin picks "custom". Stored as YYYY-MM-DD strings so
  // they round-trip cleanly through query params and `<input type="date">`.
  // All three round-trip through sessionStorage with the same shared hook
  // as the recipient/status/trend-window filters, so an admin's chosen
  // window survives reloads and back/forth navigation within the tab.
  const [range, setRange] = useSessionStorageState<RangePreset>(
    RANGE_PRESET_STORAGE_KEY,
    "all",
    isRangePreset,
  );
  const [customFrom, setCustomFrom] = useSessionStorageState<string>(
    RANGE_FROM_STORAGE_KEY,
    "",
    isStoredDateString,
  );
  const [customTo, setCustomTo] = useSessionStorageState<string>(
    RANGE_TO_STORAGE_KEY,
    "",
    isStoredDateString,
  );

  const dateBounds = useMemo(
    () => resolveRangeBounds(range, customFrom, customTo),
    [range, customFrom, customTo],
  );

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (emailFilter) queryParams.set("email", emailFilter);
  if (dateBounds.from) queryParams.set("from", dateBounds.from);
  if (dateBounds.to) queryParams.set("to", dateBounds.to);
  const qs = queryParams.toString();

  const {
    data: deliveries = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<DeliveryRow[]>({
    queryKey: [
      "/api/auth/email-deliveries",
      statusFilter,
      emailFilter,
      dateBounds.from,
      dateBounds.to,
    ],
    queryFn: async () => {
      const r = await fetch(`/api/auth/email-deliveries${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
      return r.json();
    },
    enabled: isAdmin,
  });

  // Server-truth row count for the *export*. The on-screen list is capped
  // at 200 rows, but the CSV pulls up to `cap` (currently 10,000). Showing
  // this number next to Download CSV lets admins gauge file size before
  // they pull, and the cap lets us warn when the export will be truncated.
  const {
    data: exportCount,
    isFetching: exportCountFetching,
  } = useQuery<{ count: number; cap: number }>({
    queryKey: [
      "/api/auth/email-deliveries/count",
      statusFilter,
      emailFilter,
      dateBounds.from,
      dateBounds.to,
    ],
    queryFn: async () => {
      const r = await fetch(`/api/auth/email-deliveries/count${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
      return r.json();
    },
    enabled: isAdmin,
  });
  const exportRowCount = exportCount?.count ?? 0;
  const exportCap = exportCount?.cap ?? 10000;
  const exportAtCap = exportRowCount >= exportCap;
  const exportRowsDisplayed = Math.min(exportRowCount, exportCap);

  // Workspace-scoped "has anything ever been sent?" probe. Drives the
  // tailored empty-state message on the Recent sends card so a brand-new
  // workspace sees a friendly explanation instead of the generic
  // "no rows match these filters" line. We block the empty-state render
  // until the probe resolves so brand-new workspaces don't briefly see
  // the wrong (filter-empty) message.
  const { data: hasAnyData, isLoading: hasAnyLoading } = useQuery<{
    hasAny: boolean;
  }>({
    queryKey: ["/api/auth/email-deliveries/has-any"],
    enabled: isAdmin,
  });
  const workspaceHasAnySends = hasAnyData?.hasAny ?? true;

  const summary = useMemo(() => {
    const totals = { all: deliveries.length, delivered: 0, failed: 0, pending: 0 };
    for (const d of deliveries) {
      const s = d.latestStatus;
      if (s === "delivered" || s === "opened" || s === "clicked") totals.delivered++;
      else if (s === "bounced" || s === "complained" || s === "send_failed") totals.failed++;
      else totals.pending++;
    }
    return totals;
  }, [deliveries]);

  const { data: trends } = useQuery<FailureTrends>({
    queryKey: ["/api/auth/email-deliveries/trends", trendWindow],
    queryFn: async () => {
      const r = await fetch(`/api/auth/email-deliveries/trends?days=${trendWindow}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
      return r.json();
    },
    enabled: isAdmin,
  });

  const { data: events = [], isLoading: loadingEvents, error: eventsError } = useQuery<EventRow[]>({
    queryKey: ["/api/auth/email-deliveries", "events", selected?.transport, selected?.key],
    queryFn: async () => {
      const r = await fetch(
        `/api/auth/email-deliveries/${selected!.transport}/${encodeURIComponent(selected!.key)}/events`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
      return r.json();
    },
    enabled: !!selected && isAdmin,
  });

  if (role && !isAdmin) {
    return (
      <div className="max-w-2xl py-12" data-testid="email-delivery-forbidden">
        <h1 className="font-serif text-2xl tracking-tight">{tr("edh_not_authorized")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("edh_forbidden_desc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl" data-testid="page-email-delivery">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">
          {tr("edh_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("edh_subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="grid-summary">
        <SummaryStat label={tr("edh_total")} value={summary.all} testid="stat-total" />
        <SummaryStat
          label={tr("edh_delivered")}
          value={summary.delivered}
          tone="success"
          testid="stat-delivered"
        />
        <SummaryStat
          label={tr("edh_failures")}
          value={summary.failed}
          tone="destructive"
          testid="stat-failed"
        />
        <SummaryStat
          label={tr("edh_pending")}
          value={summary.pending}
          tone="muted"
          testid="stat-pending"
        />
      </div>

      {role === "owner" && <AlertSettingsCard locale={locale} />}
      {role === "owner" && <RecentAlertsCard locale={locale} />}

      {trends && (() => {
        const isAllQuiet =
          trends.totals.bounced === 0 &&
          trends.totals.complained === 0 &&
          trends.totals.send_failed === 0;
        return (
        <TooltipProvider delayDuration={150}>
          <div
            className="rounded-md border bg-card p-4"
            data-testid="trends-failures"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground" data-testid="text-trends-window-label">
                  {trendWindowLabel(trendWindow, tr)}
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {tr("edh_reputation_alerts")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                  {tr("edh_hover_daily")}
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={trendWindow}
                  onValueChange={(value) => {
                    if (isTrendWindow(value)) setTrendWindow(value);
                  }}
                  aria-label={tr("edh_select_window")}
                  data-testid="toggle-trend-window"
                >
                  {TREND_WINDOWS.map((w) => (
                    <ToggleGroupItem
                      key={w}
                      value={w}
                      aria-label={trendWindowLabel(w, tr)}
                      data-testid={`toggle-trend-window-${w}`}
                    >
                      {trendWindowShort(w, tr)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {tr("edh_hover_daily")}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="grid-trends">
              <TrendChip
                label={tr("edh_bounced")}
                Icon={MailX}
                series={trends.series.bounced}
                total={trends.totals.bounced}
                locale={locale}
                windowLabel={trendWindowLabel(trendWindow, tr)}
                testid="chip-trend-bounced"
              />
              <TrendChip
                label={tr("edh_spam_reports")}
                Icon={MailWarning}
                series={trends.series.complained}
                total={trends.totals.complained}
                locale={locale}
                windowLabel={trendWindowLabel(trendWindow, tr)}
                testid="chip-trend-complained"
              />
              <TrendChip
                label={tr("edh_send_failures")}
                Icon={AlertTriangle}
                series={trends.series.send_failed}
                total={trends.totals.send_failed}
                locale={locale}
                windowLabel={trendWindowLabel(trendWindow, tr)}
                testid="chip-trend-send-failed"
              />
            </div>
            {isAllQuiet && (
              <p
                className="mt-3 text-xs text-muted-foreground"
                data-testid="text-trends-empty"
              >
                {tr("edh_no_rep_alerts").replace("{window}", trendWindowShort(trendWindow, tr))}
              </p>
            )}
          </div>
        </TooltipProvider>
        );
      })()}

      <Card>
        <CardHeader>
          <CardTitle>{tr("edh_recent_sends")}</CardTitle>
          <CardDescription>
            {tr("edh_recent_hint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3" data-testid="filters">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="filter-email">{tr("edh_recipient")}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="filter-email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={tr("edh_search_recipient")}
                    className="ps-8"
                    data-testid="input-filter-email"
                  />
                </div>
              </div>
              <div className="w-full sm:w-56 space-y-1.5">
                <Label>{tr("edh_status")}</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="option-status-all">
                      {tr("edh_all_statuses")}
                    </SelectItem>
                    {STATUS_FILTERS.map((s) => (
                      <SelectItem key={s as string} value={s as string} data-testid={`option-status-${s}`}>
                        {statusDescriptor(s, tr).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-56 space-y-1.5">
                <Label>{tr("edh_date_range")}</Label>
                <Select
                  value={range}
                  onValueChange={(v) => setRange(v as RangePreset)}
                >
                  <SelectTrigger data-testid="select-filter-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="option-range-all">
                      {tr("edh_all_time")}
                    </SelectItem>
                    <SelectItem value="7d" data-testid="option-range-7d">
                      {tr("edh_win_7d")}
                    </SelectItem>
                    <SelectItem value="30d" data-testid="option-range-30d">
                      {tr("edh_win_30d")}
                    </SelectItem>
                    <SelectItem value="90d" data-testid="option-range-90d">
                      {tr("edh_win_90d")}
                    </SelectItem>
                    <SelectItem value="custom" data-testid="option-range-custom">
                      {tr("edh_custom_range")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {range === "custom" && (
              <div
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                data-testid="custom-range"
              >
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="filter-from">{tr("edh_from")}</Label>
                  <Input
                    id="filter-from"
                    type="date"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    data-testid="input-filter-from"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="filter-to">{tr("edh_to")}</Label>
                  <Input
                    id="filter-to"
                    type="date"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                    data-testid="input-filter-to"
                  />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => refetch()}
                data-testid="button-refresh"
              >
                <RefreshCw className={`me-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                {tr("edh_refresh")}
              </Button>
              <Button
                type="button"
                variant="outline"
                asChild
                disabled={exportRowCount === 0}
                data-testid="button-download-csv"
              >
                <a
                  href={`/api/auth/email-deliveries${qs ? `?${qs}&` : "?"}format=csv`}
                  download
                >
                  <Download className="me-2 h-4 w-4" />
                  {tr("edh_download_csv")}
                </a>
              </Button>
              {/* Live row count for the current filters. Shown next to the
                  Download CSV button so admins can tell at a glance whether
                  the file will be huge before pulling it. While the count is
                  refreshing we keep the previous number visible to avoid
                  the chip flickering on every keystroke. When the matching
                  set is at the export cap the chip switches to a "cap+"
                  display and the warning banner below carries the action. */}
              {exportCount && (
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  data-testid="text-export-count"
                  aria-live="polite"
                >
                  {exportCountFetching && (
                    <Loader2 className="me-1 inline h-3 w-3 animate-spin align-[-2px]" />
                  )}
                  {exportAtCap
                    ? tr("edh_rows_cap").replace("{n}", exportCap.toLocaleString(locale))
                    : tr("edh_rows_export").replace("{n}", exportRowCount.toLocaleString(locale))}
                </span>
              )}
              {(dateBounds.from || dateBounds.to) && (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="text-active-range"
                >
                  {tr("edh_window_label")} {dateBounds.from || "—"}
                  {" → "}
                  {dateBounds.to || "—"}
                </span>
              )}
            </div>
            {/* Hard-cap hint. When the matching row count meets the server's
                export ceiling, the CSV will be truncated to the most recent
                N rows — admins should narrow the window to get the rest. */}
            {exportAtCap && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                data-testid="hint-export-cap"
                role="status"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {tr("edh_showing_latest").replace("{n}", exportRowsDisplayed.toLocaleString(locale))}
                </span>
              </div>
            )}
          </div>

          {isLoading || (deliveries.length === 0 && hasAnyLoading) ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground" data-testid="state-loading">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : deliveries.length === 0 ? (
            workspaceHasAnySends ? (
              <div
                className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground"
                data-testid="state-empty"
              >
                {tr("edh_no_match")}
              </div>
            ) : (
              <div
                className="rounded-md border border-dashed px-6 py-10 text-center"
                data-testid="state-empty-never-sent"
              >
                <Mail className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
                <div className="mt-3 text-sm font-medium">
                  {tr("edh_no_sends_yet")}
                </div>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  {tr("edh_no_sends_hint")}
                </p>
              </div>
            )
          ) : (
            <ul className="divide-y divide-border rounded-md border" data-testid="list-deliveries">
              {deliveries.map((d) => {
                const s = statusDescriptor(d.latestStatus, tr);
                const StatusIcon = s.Icon;
                const transportDesc = transportDescriptor(d.transport, tr);
                const TransportIcon = transportDesc.Icon;
                const rowKey = `${d.transport}-${d.key}`;
                return (
                  <li
                    key={rowKey}
                    className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(d)}
                      className="flex flex-1 flex-col gap-2 text-start sm:flex-row sm:items-center sm:gap-4"
                      data-testid={`row-delivery-${rowKey}`}
                    >
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground sm:w-44">
                        <TransportIcon className="h-3.5 w-3.5" />
                        <span data-testid={`text-transport-${rowKey}`}>{transportDesc.label}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" data-testid={`text-recipient-${rowKey}`}>
                          {d.recipient || "—"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {d.latestError ? (
                            <span data-testid={`text-error-${rowKey}`}>{d.latestError}</span>
                          ) : (
                            formatDate(d.latestAt ?? d.firstAt, locale)
                          )}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`gap-1 ${TONE_BADGE[s.tone]}`}
                        data-testid={`badge-status-${rowKey}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {s.label}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side={ar ? "left" : "right"} className="w-full max-w-md sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {transportDescriptor(selected.transport, tr).label} · {selected.recipient}
                </SheetTitle>
                <SheetDescription>
                  {tr("edh_lifecycle_hint")}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <div data-testid="text-message-id">
                    <span className="font-medium text-foreground">
                      {tr("edh_message_id")}:
                    </span>{" "}
                    {selected.messageId ?? tr("edh_no_provider_id")}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium text-foreground">
                      {tr("edh_last_update")}:
                    </span>{" "}
                    {formatDate(selected.latestAt ?? selected.firstAt, locale)}
                  </div>
                </div>

                <ScrollArea className="h-[60vh] pe-2">
                  {loadingEvents ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : eventsError ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="state-events-error">
                      {tr("edh_events_error")}
                    </div>
                  ) : events.length === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="state-events-empty">
                      {tr("edh_no_events")}
                    </div>
                  ) : (
                    <ol className="space-y-2" data-testid="list-events">
                      {events.map((ev) => {
                        const s = statusDescriptor(ev.type, tr);
                        const Icon = s.Icon;
                        return (
                          <li
                            key={ev.id}
                            className="flex items-start gap-3 rounded-md border bg-card p-3"
                            data-testid={`row-event-${ev.id}`}
                          >
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_BADGE[s.tone]}`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{s.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(ev.createdAt, locale)}
                                </span>
                              </div>
                              {ev.error && (
                                <div className="mt-1 text-xs text-destructive" data-testid={`text-event-error-${ev.id}`}>
                                  {ev.error}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </ScrollArea>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TrendChip({
  label,
  Icon,
  series,
  total,
  locale,
  windowLabel,
  testid,
}: {
  label: string;
  Icon: typeof Mail;
  series: TrendPoint[];
  total: number;
  locale: Locale;
  windowLabel: string;
  testid: string;
}) {
  const isQuiet = total === 0;
  const tone = isQuiet ? "muted" : "destructive";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-accent/40 ${TONE_BADGE[tone]}`}
          data-testid={testid}
          tabIndex={0}
        >
          <div className="flex items-center gap-2 text-xs font-medium">
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </div>
          <span className="tabular-nums text-base font-semibold" data-testid={`${testid}-total`}>
            {total}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="p-2">
        <div className="mb-1.5 text-xs font-medium" data-testid={`${testid}-tooltip-title`}>
          {label} · {windowLabel}
        </div>
        <div className="mb-2" data-testid={`${testid}-tooltip-sparkline`}>
          <Sparkline points={series} tone={tone} />
        </div>
        <ul className="space-y-0.5 text-xs" data-testid={`${testid}-tooltip-list`}>
          {series.map((p) => (
            <li
              key={p.date}
              className="flex items-center justify-between gap-4 tabular-nums"
              data-testid={`${testid}-day-${p.date}`}
            >
              <span className="text-muted-foreground">
                {new Date(`${p.date}T00:00:00Z`).toLocaleDateString(locale, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className={p.count > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
                {p.count}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function Sparkline({ points, tone }: { points: TrendPoint[]; tone: DeliveryTone }) {
  const w = 140;
  const h = 28;
  const n = points.length;
  if (n === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = n > 1 ? w / (n - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - (p.count / max) * (h - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={tone === "destructive" ? "text-rose-500 dark:text-rose-300" : "text-muted-foreground/60"}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => {
        const x = i * stepX;
        const y = h - (p.count / max) * (h - 2) - 1;
        return (
          <circle
            key={p.date}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={p.count > 0 ? 1.6 : 1}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

function SummaryStat({
  label,
  value,
  tone = "info",
  testid,
}: {
  label: string;
  value: number;
  tone?: DeliveryTone;
  testid: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4" data-testid={testid}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "destructive" ? "text-destructive" : tone === "success" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

interface AlertSettings {
  enabled: boolean;
  emailEnabled: boolean;
  windowHours: number;
  absoluteThreshold: number;
  ratioThreshold: number;
  minSamplesForRatio: number;
  cooldownMinutes: number;
  // Per-address dedupe / retry windows. Null when the workspace pre-dates
  // the columns and has never re-saved its alert settings; in that case
  // the evaluator falls back to the EMAIL_DELIVERY_ALERT_DEDUPE_HOURS /
  // EMAIL_DELIVERY_ALERT_RETRY_MINUTES env vars (12h / 60m by default),
  // so we seed the form with those numbers to mirror the live behavior.
  dedupeHours: number | null;
  retryMinutes: number | null;
  // Server-computed effective values that include the env-var fallback
  // when the column is null. Drives both the form's seeded value and the
  // "platform default" badge so the displayed numbers always match the
  // evaluator's actual behavior, even when ops has tuned the env vars
  // away from the historical 12h / 60m.
  effectiveDedupeHours: number;
  effectiveRetryMinutes: number;
  updatedAt: string | null;
}

// Hard-coded fallback used only for the *initial* form render before the
// settings query resolves. The server-supplied `effectiveDedupeHours` /
// `effectiveRetryMinutes` take over on the first response, which means
// the displayed numbers stay accurate even if the env vars have been
// tuned. Kept in sync with the env-var defaults shipped in
// server/auth/email-delivery-alerts.ts so an admin landing on the page
// doesn't see numbers flicker between the constant and the real value.
const DEFAULT_DEDUPE_HOURS = 12;
const DEFAULT_RETRY_MINUTES = 60;

/**
 * Inline label badge that tells an owner whether the dedupe / retry value
 * is the platform-wide env default (workspace column is null) or a saved
 * per-workspace override. Without this, the two states render the same
 * number, so an owner can't tell which value will follow the env if ops
 * tunes the platform defaults vs. which value will hold steady.
 */
function OverrideBadge({
  isOverride,
  tr,
  testid,
}: {
  isOverride: boolean;
  tr: TFn;
  testid: string;
}) {
  if (isOverride) {
    return (
      <Badge
        variant="secondary"
        className="shrink-0 text-[10px] uppercase tracking-wider"
        data-testid={testid}
        data-source="custom"
      >
        {tr("edh_custom")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground"
      data-testid={testid}
      data-source="platform-default"
    >
      {tr("edh_platform_default")}
    </Badge>
  );
}

/**
 * Owner-only configuration block for the failure-rate alert. Lives below the
 * top-level summary so admins can see the current numbers and dial the
 * threshold against them in the same view. The "evaluate now" button reuses
 * the same evaluator the cron uses, so it produces real banners.
 */
function AlertSettingsCard({ locale }: { locale: Locale }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tr = useT();

  const { data, isLoading } = useQuery<AlertSettings>({
    queryKey: ["/api/auth/email-delivery-alerts/settings"],
  });

  // Local form mirror — keeps inputs responsive and lets us defer the save
  // round-trip until the admin hits the button.
  const [enabled, setEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [windowHours, setWindowHours] = useState(24);
  const [absoluteThreshold, setAbsoluteThreshold] = useState(5);
  const [ratioPercent, setRatioPercent] = useState(2);
  const [minSamplesForRatio, setMinSamplesForRatio] = useState(20);
  const [cooldownMinutes, setCooldownMinutes] = useState(360);
  const [dedupeHours, setDedupeHours] = useState(DEFAULT_DEDUPE_HOURS);
  const [retryMinutes, setRetryMinutes] = useState(DEFAULT_RETRY_MINUTES);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setEmailEnabled(data.emailEnabled);
    setWindowHours(data.windowHours);
    setAbsoluteThreshold(data.absoluteThreshold);
    setRatioPercent(Number((data.ratioThreshold * 100).toFixed(2)));
    setMinSamplesForRatio(data.minSamplesForRatio);
    setCooldownMinutes(data.cooldownMinutes);
    // Null = "never overridden" — fall back to the server-reported
    // effective value (which already includes the env-var fallback) so
    // the displayed number matches the evaluator's behavior even when
    // ops has tuned the platform defaults away from 12h / 60m. The first
    // save turns the column into a concrete value.
    setDedupeHours(data.dedupeHours ?? data.effectiveDedupeHours);
    setRetryMinutes(data.retryMinutes ?? data.effectiveRetryMinutes);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", "/api/auth/email-delivery-alerts/settings", {
        enabled,
        emailEnabled,
        windowHours,
        absoluteThreshold,
        // Server stores as 0..1 ratio; UI is friendlier as a percent.
        ratioThreshold: Number((ratioPercent / 100).toFixed(4)),
        minSamplesForRatio,
        cooldownMinutes,
        dedupeHours,
        retryMinutes,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auth/email-delivery-alerts/settings"] });
      toast({
        title: tr("edh_saved"),
        description: tr("edh_settings_updated"),
      });
    },
    onError: (err: unknown) => {
      toast({
        variant: "destructive",
        title: tr("edh_save_failed"),
        description: tr(mapErrorKey(err)),
      });
    },
  });

  type EvaluateResult =
    | {
        fired: false;
        reason: "disabled" | "below_threshold" | "in_cooldown";
        failures: number;
        sends: number;
        windowHours: number;
      }
    | {
        fired: true;
        alertId: string;
        reason: "absolute" | "ratio";
        failures: number;
        sends: number;
        windowHours: number;
        emailSent: boolean;
        emailRecipients: number;
      };

  const evaluateNow = useMutation<EvaluateResult>({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/auth/email-delivery-alerts/evaluate",
      );
      return (await res.json()) as EvaluateResult;
    },
    onSuccess: (result) => {
      // Refresh the shell-level banner and the trends/log panels below so
      // the admin sees the outcome of the manual evaluation everywhere it
      // matters without a page reload.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/email-delivery-alerts/active"] });
      // The "Recent alerts" audit log gains a row whenever the evaluator
      // fires, so invalidate it alongside the active-alert banner query.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/email-delivery-alerts/history"] });
      // Use the array-prefix form so every (window-scoped) variant of the
      // trends query and every (transport+key-scoped) events query refetches.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/email-deliveries/trends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/email-deliveries"] });
      const fired = result.fired === true;
      toast({
        title: fired ? tr("edh_alert_fired") : tr("edh_no_alert"),
        description: fired
          ? tr("edh_failures_window")
              .replace("{failures}", String(result.failures))
              .replace("{hours}", String(result.windowHours))
          : tr("edh_within_limit"),
      });
    },
    onError: (err: unknown) => {
      toast({
        variant: "destructive",
        title: tr("edh_eval_failed"),
        description: tr(mapErrorKey(err)),
      });
    },
  });

  const dirty = useMemo(() => {
    if (!data) return false;
    // Treat null on the server (legacy row, never overridden) as equal to
    // the effective value the form was seeded with — otherwise the Save
    // button would always read as "dirty" on workspaces that pre-date
    // the dedupe / retry columns, even when the admin hasn't touched
    // them. The effective value already folds in the env-var fallback,
    // so this stays correct even when ops tunes the platform defaults.
    const serverDedupe = data.dedupeHours ?? data.effectiveDedupeHours;
    const serverRetry = data.retryMinutes ?? data.effectiveRetryMinutes;
    return (
      enabled !== data.enabled ||
      emailEnabled !== data.emailEnabled ||
      windowHours !== data.windowHours ||
      absoluteThreshold !== data.absoluteThreshold ||
      Number((ratioPercent / 100).toFixed(4)) !== Number(data.ratioThreshold.toFixed(4)) ||
      minSamplesForRatio !== data.minSamplesForRatio ||
      cooldownMinutes !== data.cooldownMinutes ||
      dedupeHours !== serverDedupe ||
      retryMinutes !== serverRetry
    );
  }, [data, enabled, emailEnabled, windowHours, absoluteThreshold, ratioPercent, minSamplesForRatio, cooldownMinutes, dedupeHours, retryMinutes]);

  return (
    <Card data-testid="card-email-delivery-alerts">
      <CardHeader>
        <CardTitle>{tr("edh_health_alerts")}</CardTitle>
        <CardDescription>
          {tr("edh_health_desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-medium">
                {tr("edh_enable_alerts")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tr("edh_eval_bg")}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-alerts-enabled"
              aria-label={tr("edh_enable_alerts")}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-medium">
                {tr("edh_email_owners")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tr("edh_in_addition")}
              </p>
            </div>
            <Switch
              checked={emailEnabled}
              onCheckedChange={setEmailEnabled}
              data-testid="switch-alerts-email-enabled"
              aria-label={tr("edh_email_owners")}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="alert-window">
              {tr("edh_window_hours")}
            </Label>
            <Input
              id="alert-window"
              type="number"
              min={1}
              max={168}
              value={windowHours}
              onChange={(e) => setWindowHours(Math.max(1, Math.min(168, Number(e.target.value) || 0)))}
              data-testid="input-alert-window-hours"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_window_range")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-absolute">
              {tr("edh_abs_threshold")}
            </Label>
            <Input
              id="alert-absolute"
              type="number"
              min={1}
              value={absoluteThreshold}
              onChange={(e) => setAbsoluteThreshold(Math.max(1, Number(e.target.value) || 0))}
              data-testid="input-alert-absolute"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_abs_hint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-ratio">
              {tr("edh_ratio_threshold")}
            </Label>
            <Input
              id="alert-ratio"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={ratioPercent}
              onChange={(e) => setRatioPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              data-testid="input-alert-ratio"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_ratio_disable")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-min-samples">
              {tr("edh_min_sends")}
            </Label>
            <Input
              id="alert-min-samples"
              type="number"
              min={1}
              value={minSamplesForRatio}
              onChange={(e) => setMinSamplesForRatio(Math.max(1, Number(e.target.value) || 0))}
              data-testid="input-alert-min-samples"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_min_sends_hint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-cooldown">
              {tr("edh_cooldown")}
            </Label>
            <Input
              id="alert-cooldown"
              type="number"
              min={5}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Math.max(5, Number(e.target.value) || 0))}
              data-testid="input-alert-cooldown"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_cooldown_hint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="alert-dedupe-hours">
                {tr("edh_dedupe_window")}
              </Label>
              <OverrideBadge
                isOverride={data?.dedupeHours != null}
                tr={tr}
                testid="badge-alert-dedupe-source"
              />
            </div>
            <Input
              id="alert-dedupe-hours"
              type="number"
              min={0}
              max={168}
              value={dedupeHours}
              onChange={(e) =>
                setDedupeHours(
                  Math.max(0, Math.min(168, Number(e.target.value) || 0)),
                )
              }
              data-testid="input-alert-dedupe-hours"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_dedupe_hint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="alert-retry-minutes">
                {tr("edh_retry_window")}
              </Label>
              <OverrideBadge
                isOverride={data?.retryMinutes != null}
                tr={tr}
                testid="badge-alert-retry-source"
              />
            </div>
            <Input
              id="alert-retry-minutes"
              type="number"
              min={0}
              max={60 * 24}
              value={retryMinutes}
              onChange={(e) =>
                setRetryMinutes(
                  Math.max(0, Math.min(60 * 24, Number(e.target.value) || 0)),
                )
              }
              data-testid="input-alert-retry-minutes"
            />
            <p className="text-xs text-muted-foreground">
              {tr("edh_retry_hint")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => evaluateNow.mutate()}
            disabled={evaluateNow.isPending || isLoading}
            data-testid="button-evaluate-alerts-now"
          >
            {evaluateNow.isPending ? tr("edh_evaluating") : tr("edh_evaluate_now")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || isLoading}
            data-testid="button-save-alert-settings"
          >
            {save.isPending ? tr("edh_saving") : tr("edh_save_settings")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface RecentAlertRow {
  id: string;
  firedAt: string | null;
  windowHours: number;
  failureCount: number;
  sendCount: number;
  reason: "absolute" | "ratio" | string;
  snapshot: { bounced: number; complained: number; send_failed: number } | null;
  emailSent: boolean;
  emailRecipients: number;
  dismissedAt: string | null;
  dismissedByUserId: string | null;
  dismissedByName: string | null;
  dismissedByEmail: string | null;
}

/**
 * Read-only audit log of recent alert firings, with attribution for who
 * silenced each one. The "Reset cooldown" action above the table re-arms
 * the evaluator so the next pass can fire even if we're still inside the
 * cooldown window — useful right after tightening a threshold or rotating
 * ownership. Only the most-recent row gates the cooldown so the per-row
 * "Re-arm" button is enabled only on that row; older rows show a tooltip
 * explaining why the action is disabled.
 */
interface RecentAlertsPage {
  rows: RecentAlertRow[];
  nextCursor: string | null;
}

const RECENT_ALERTS_PAGE_SIZE = 20;

function RecentAlertsCard({ locale }: { locale: Locale }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tr = useT();
  // Track which alert rows are expanded so the recipients sub-row only
  // pays its query cost (and the SQL DISTINCT-ON roll-up) the first time
  // an admin asks to see the address list for that alert.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Keyset-paginated audit log: each page fetches `RECENT_ALERTS_PAGE_SIZE`
  // older rows than the previous page's `nextCursor` (firedAt of the
  // oldest row on that page). When the server returns a `null` cursor we
  // know we've reached the end and can disable the "Load older" button.
  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<RecentAlertsPage>({
    queryKey: ["/api/auth/email-delivery-alerts/history"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(RECENT_ALERTS_PAGE_SIZE),
      });
      if (pageParam) params.set("before", String(pageParam));
      const res = await apiRequest(
        "GET",
        `/api/auth/email-delivery-alerts/history?${params.toString()}`,
      );
      return (await res.json()) as RecentAlertsPage;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const rearm = useMutation<{ ok: boolean; cleared: boolean }, Error, string>({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "POST",
        `/api/auth/email-delivery-alerts/${encodeURIComponent(id)}/rearm`,
      );
      return (await res.json()) as { ok: boolean; cleared: boolean };
    },
    onSuccess: (result) => {
      // Invalidate every view that reads alert state so the admin sees the
      // re-arm reflected immediately: history (for the future firedAt sort)
      // and the active-banner endpoint (in case the next sweep flips it).
      qc.invalidateQueries({
        queryKey: ["/api/auth/email-delivery-alerts/history"],
      });
      qc.invalidateQueries({
        queryKey: ["/api/auth/email-delivery-alerts/active"],
      });
      toast({
        title: result.cleared ? tr("edh_cooldown_reset") : tr("edh_nothing_rearm"),
        description: result.cleared ? tr("edh_rearm_next") : tr("edh_rearm_none"),
      });
    },
    onError: (err: unknown) => {
      toast({
        variant: "destructive",
        title: tr("edh_rearm_failed"),
        description: tr(mapErrorKey(err)),
      });
    },
  });

  // Flatten the per-page response into a single ordered list for rendering.
  // Pages are already sorted newest-first within themselves and the cursor
  // marches strictly older across pages, so a flat concat keeps the table
  // sorted descending by firedAt without an extra sort pass.
  const rows = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.rows),
    [data],
  );
  const mostRecentId = rows[0]?.id;
  const cooldownGated = !!rows[0] && !!rows[0].firedAt;
  const hasLoadedAny = !isLoading && rows.length > 0;

  return (
    <Card data-testid="card-recent-alerts">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              {tr("edh_recent_alerts")}
            </CardTitle>
            <CardDescription>
              {tr("edh_recent_alerts_hint")}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => mostRecentId && rearm.mutate(mostRecentId)}
            disabled={!cooldownGated || rearm.isPending || isLoading}
            data-testid="button-reset-cooldown"
          >
            <ShieldOff className="me-2 h-4 w-4" />
            {rearm.isPending ? tr("edh_working") : tr("edh_reset_cooldown")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tr("edh_loading")}
          </div>
        ) : rows.length === 0 ? (
          <div
            className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
            data-testid="empty-recent-alerts"
          >
            {tr("edh_no_past_alerts")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-recent-alerts">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b">
                  <th className="w-8 px-2 py-2" aria-hidden="true" />
                  <th className="px-2 py-2 text-start font-medium">
                    {tr("edh_col_fired")}
                  </th>
                  <th className="px-2 py-2 text-start font-medium">
                    {tr("edh_col_reason")}
                  </th>
                  <th className="px-2 py-2 text-start font-medium">
                    {tr("edh_col_fail_sends")}
                  </th>
                  <th className="px-2 py-2 text-start font-medium">
                    {tr("edh_col_email")}
                  </th>
                  <th className="px-2 py-2 text-start font-medium">
                    {tr("edh_col_dismissed_by")}
                  </th>
                  <th className="px-2 py-2 text-end font-medium">
                    {tr("edh_col_action")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isMostRecent = index === 0;
                  const dismissed = !!row.dismissedAt;
                  const dismissedDisplay = dismissed
                    ? row.dismissedByName ||
                      row.dismissedByEmail ||
                      tr("edh_removed_user")
                    : null;
                  const isExpanded = !!expanded[row.id];
                  return (
                    <Fragment key={row.id}>
                    <tr
                      className="border-b last:border-0"
                      data-testid={`row-recent-alert-${row.id}`}
                    >
                      <td className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({
                              ...prev,
                              [row.id]: !prev[row.id],
                            }))
                          }
                          aria-expanded={isExpanded}
                          aria-label={tr("edh_show_recipients")}
                          data-testid={`button-toggle-recipients-${row.id}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-2 py-2 align-top whitespace-nowrap" data-testid={`text-fired-at-${row.id}`}>
                        {formatDate(row.firedAt, locale)}
                        <div className="text-xs text-muted-foreground">
                          {tr("edh_window_n_hours").replace("{n}", String(row.windowHours))}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top" data-testid={`text-reason-${row.id}`}>
                        <Badge variant={row.reason === "ratio" ? "secondary" : "destructive"}>
                          {row.reason === "ratio" ? tr("edh_reason_ratio") : tr("edh_reason_absolute")}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 align-top" data-testid={`text-counts-${row.id}`}>
                        <div className="font-medium">
                          {row.failureCount} / {row.sendCount}
                        </div>
                        {row.snapshot && (
                          <div className="text-xs text-muted-foreground">
                            {tr("edh_snapshot")
                              .replace("{bounced}", String(row.snapshot.bounced))
                              .replace("{complained}", String(row.snapshot.complained))
                              .replace("{failed}", String(row.snapshot.send_failed))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top" data-testid={`text-email-${row.id}`}>
                        {row.emailSent ? (
                          <Badge variant="outline">
                            {tr("edh_sent_n").replace("{n}", String(row.emailRecipients))}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {tr("edh_none")}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top" data-testid={`text-dismissed-${row.id}`}>
                        {dismissed ? (
                          <div>
                            <div className="font-medium" data-testid={`text-dismissed-by-${row.id}`}>
                              {dismissedDisplay}
                            </div>
                            <div className="text-xs text-muted-foreground" data-testid={`text-dismissed-at-${row.id}`}>
                              {formatDate(row.dismissedAt, locale)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {tr("edh_active")}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top text-end">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="inline-block">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => rearm.mutate(row.id)}
                                  disabled={!isMostRecent || rearm.isPending}
                                  data-testid={`button-rearm-${row.id}`}
                                >
                                  {tr("edh_rearm")}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {isMostRecent ? tr("edh_rearm_cancel") : tr("edh_rearm_latest")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr
                        className="border-b last:border-0 bg-muted/30"
                        data-testid={`row-recipients-${row.id}`}
                      >
                        <td colSpan={7} className="px-2 pb-3 pt-0">
                          <RecipientsPanel
                            alertId={row.id}
                            locale={locale}
                            variant="card"
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasLoadedAny && (
          <div className="mt-4 flex items-center justify-center">
            {hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="button-load-older-alerts"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {tr("edh_loading")}
                  </>
                ) : (
                  tr("edh_load_older")
                )}
              </Button>
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-no-more-alerts"
              >
                {tr("edh_no_older")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
