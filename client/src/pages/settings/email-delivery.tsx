import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@/contexts/locale-context";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";

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

type TrendWindow = "1" | "7" | "30";

const TREND_WINDOWS: TrendWindow[] = ["1", "7", "30"];
const TREND_WINDOW_STORAGE_KEY = "email-delivery:trend-window";

function isTrendWindow(value: string | null): value is TrendWindow {
  return value === "1" || value === "7" || value === "30";
}

function trendWindowLabel(window: TrendWindow, ar: boolean): string {
  switch (window) {
    case "1":
      return ar ? "آخر 24 ساعة" : "Last 24 hours";
    case "7":
      return ar ? "آخر 7 أيام" : "Last 7 days";
    case "30":
      return ar ? "آخر 30 يومًا" : "Last 30 days";
  }
}

function trendWindowShort(window: TrendWindow, ar: boolean): string {
  switch (window) {
    case "1":
      return ar ? "٢٤س" : "24h";
    case "7":
      return ar ? "٧ أيام" : "7d";
    case "30":
      return ar ? "٣٠ يومًا" : "30d";
  }
}

type RangePreset = "all" | "7d" | "30d" | "90d" | "custom";

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

const STATUS_FILTERS: DeliveryStatus[] = [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "send_failed",
  "not_configured",
];

function statusDescriptor(
  status: DeliveryStatus | string,
  ar: boolean,
): { label: string; tone: DeliveryTone; Icon: typeof MailCheck } {
  switch (status) {
    case "sent":
      return { label: ar ? "أُرسلت" : "Sent", tone: "info", Icon: Send };
    case "delivered":
      return { label: ar ? "وصلت" : "Delivered", tone: "success", Icon: MailCheck };
    case "delivery_delayed":
      return { label: ar ? "تأخّر التسليم" : "Delayed", tone: "warning", Icon: Clock };
    case "bounced":
      return { label: ar ? "ارتدّت" : "Bounced", tone: "destructive", Icon: MailX };
    case "complained":
      return { label: ar ? "بلاغ سبام" : "Spam report", tone: "destructive", Icon: MailWarning };
    case "opened":
      return { label: ar ? "فُتحت" : "Opened", tone: "info", Icon: Eye };
    case "clicked":
      return { label: ar ? "نُقر عليها" : "Clicked", tone: "info", Icon: MousePointerClick };
    case "send_failed":
      return { label: ar ? "فشل الإرسال" : "Failed", tone: "destructive", Icon: AlertTriangle };
    case "not_configured":
      return { label: ar ? "البريد غير مفعّل" : "Email off", tone: "muted", Icon: Mail };
    case "queued":
      return { label: ar ? "بانتظار" : "Queued", tone: "muted", Icon: Mail };
    default:
      return { label: ar ? "بانتظار" : "Pending", tone: "muted", Icon: Mail };
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
  ar: boolean,
): { label: string; Icon: typeof Mail } {
  if (transport === "invitation") {
    return { label: ar ? "دعوة فريق" : "Invitation", Icon: UserPlus };
  }
  return { label: ar ? "استعادة كلمة المرور" : "Password reset", Icon: KeyRound };
}

function formatDate(value: string | null, ar: boolean): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(ar ? "ar" : "en", {
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
  const { role } = useAuth();
  const isAdmin = role === "owner";

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [emailInput, setEmailInput] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [selected, setSelected] = useState<DeliveryRow | null>(null);
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(() => {
    if (typeof window === "undefined") return "7";
    const stored = window.sessionStorage.getItem(TREND_WINDOW_STORAGE_KEY);
    return isTrendWindow(stored) ? stored : "7";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(TREND_WINDOW_STORAGE_KEY, trendWindow);
  }, [trendWindow]);

  // Date-range filter for the export window. `range` is a preset key that
  // shortcuts to a from/to in days; `customFrom`/`customTo` are the inputs
  // shown when the admin picks "custom". Stored as YYYY-MM-DD strings so
  // they round-trip cleanly through query params and `<input type="date">`.
  const [range, setRange] = useState<RangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Debounce the email input so each keystroke doesn't slam the API.
  useEffect(() => {
    const t = window.setTimeout(() => setEmailFilter(emailInput.trim()), 250);
    return () => window.clearTimeout(t);
  }, [emailInput]);

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
        <h1 className="font-serif text-2xl tracking-tight">{ar ? "غير مصرح" : "Not authorized"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ar
            ? "صحة بريد المعاملات متاحة لمالك مساحة العمل فقط."
            : "Email delivery health is restricted to workspace admins."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl" data-testid="page-email-delivery">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">
          {ar ? "صحة بريد المعاملات" : "Email delivery health"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "كل عمليات الإرسال الأخيرة عبر دعوات الفريق ورسائل استعادة كلمة المرور — مع حالة التسليم وأي إخفاقات."
            : "Every recent send across team invitations and password-reset emails — with delivery status and any failures."}
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="grid-summary">
        <SummaryStat label={ar ? "إجمالي" : "Total"} value={summary.all} testid="stat-total" />
        <SummaryStat
          label={ar ? "وصلت" : "Delivered"}
          value={summary.delivered}
          tone="success"
          testid="stat-delivered"
        />
        <SummaryStat
          label={ar ? "إخفاقات" : "Failures"}
          value={summary.failed}
          tone="destructive"
          testid="stat-failed"
        />
        <SummaryStat
          label={ar ? "بالانتظار" : "Pending"}
          value={summary.pending}
          tone="muted"
          testid="stat-pending"
        />
      </div>

      {role === "owner" && <AlertSettingsCard ar={ar} />}

      {trends && (
        <TooltipProvider delayDuration={150}>
          <div
            className="rounded-md border bg-card p-4"
            data-testid="trends-failures"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground" data-testid="text-trends-window-label">
                  {trendWindowLabel(trendWindow, ar)}
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {ar
                    ? "تنبيهات سمعة المُرسِل"
                    : "Sender-reputation signals"}
                </div>
                <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                  {ar
                    ? "مرّر فوق رقم لرؤية التوزيع اليومي."
                    : "Hover a chip to see the daily breakdown."}
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
                  aria-label={ar ? "اختيار نافذة الاتجاه" : "Select trend window"}
                  data-testid="toggle-trend-window"
                >
                  {TREND_WINDOWS.map((w) => (
                    <ToggleGroupItem
                      key={w}
                      value={w}
                      aria-label={trendWindowLabel(w, ar)}
                      data-testid={`toggle-trend-window-${w}`}
                    >
                      {trendWindowShort(w, ar)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {ar
                    ? "مرّر فوق رقم لرؤية التوزيع اليومي."
                    : "Hover a chip to see the daily breakdown."}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="grid-trends">
              <TrendChip
                label={ar ? "ارتدّت" : "Bounced"}
                Icon={MailX}
                series={trends.series.bounced}
                total={trends.totals.bounced}
                ar={ar}
                windowLabel={trendWindowLabel(trendWindow, ar)}
                testid="chip-trend-bounced"
              />
              <TrendChip
                label={ar ? "بلاغات سبام" : "Spam reports"}
                Icon={MailWarning}
                series={trends.series.complained}
                total={trends.totals.complained}
                ar={ar}
                windowLabel={trendWindowLabel(trendWindow, ar)}
                testid="chip-trend-complained"
              />
              <TrendChip
                label={ar ? "فشل الإرسال" : "Send failures"}
                Icon={AlertTriangle}
                series={trends.series.send_failed}
                total={trends.totals.send_failed}
                ar={ar}
                windowLabel={trendWindowLabel(trendWindow, ar)}
                testid="chip-trend-send-failed"
              />
            </div>
          </div>
        </TooltipProvider>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{ar ? "عمليات الإرسال الأخيرة" : "Recent sends"}</CardTitle>
          <CardDescription>
            {ar
              ? "اضغط أي صف لرؤية كل أحداث دورة حياة الرسالة."
              : "Click any row to see the full lifecycle of that message."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3" data-testid="filters">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="filter-email">{ar ? "البريد الإلكتروني" : "Recipient"}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="filter-email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={ar ? "ابحث ببريد المستلم…" : "Search by recipient…"}
                    className="ps-8"
                    data-testid="input-filter-email"
                  />
                </div>
              </div>
              <div className="w-full sm:w-56 space-y-1.5">
                <Label>{ar ? "الحالة" : "Status"}</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="option-status-all">
                      {ar ? "كل الحالات" : "All statuses"}
                    </SelectItem>
                    {STATUS_FILTERS.map((s) => (
                      <SelectItem key={s as string} value={s as string} data-testid={`option-status-${s}`}>
                        {statusDescriptor(s, ar).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-56 space-y-1.5">
                <Label>{ar ? "الفترة الزمنية" : "Date range"}</Label>
                <Select
                  value={range}
                  onValueChange={(v) => setRange(v as RangePreset)}
                >
                  <SelectTrigger data-testid="select-filter-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="option-range-all">
                      {ar ? "كل الوقت" : "All time"}
                    </SelectItem>
                    <SelectItem value="7d" data-testid="option-range-7d">
                      {ar ? "آخر 7 أيام" : "Last 7 days"}
                    </SelectItem>
                    <SelectItem value="30d" data-testid="option-range-30d">
                      {ar ? "آخر 30 يومًا" : "Last 30 days"}
                    </SelectItem>
                    <SelectItem value="90d" data-testid="option-range-90d">
                      {ar ? "آخر 90 يومًا" : "Last 90 days"}
                    </SelectItem>
                    <SelectItem value="custom" data-testid="option-range-custom">
                      {ar ? "نطاق مخصّص" : "Custom range"}
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
                  <Label htmlFor="filter-from">{ar ? "من" : "From"}</Label>
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
                  <Label htmlFor="filter-to">{ar ? "إلى" : "To"}</Label>
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
                {ar ? "تحديث" : "Refresh"}
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
                  {ar ? "تنزيل CSV" : "Download CSV"}
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
                    ? ar
                      ? `+${exportCap.toLocaleString("ar")} صفًا`
                      : `${exportCap.toLocaleString("en")}+ rows`
                    : ar
                      ? `${exportRowCount.toLocaleString("ar")} صفًا للتصدير`
                      : `${exportRowCount.toLocaleString("en")} ${exportRowCount === 1 ? "row" : "rows"} to export`}
                </span>
              )}
              {(dateBounds.from || dateBounds.to) && (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="text-active-range"
                >
                  {ar ? "النطاق:" : "Window:"} {dateBounds.from || (ar ? "—" : "—")}
                  {" → "}
                  {dateBounds.to || (ar ? "—" : "—")}
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
                  {ar
                    ? `يعرض أحدث ${exportRowsDisplayed.toLocaleString("ar")} فقط — ضيّق النطاق للحصول على تصدير كامل.`
                    : `Showing the most recent ${exportRowsDisplayed.toLocaleString("en")} — narrow the window for a full export.`}
                </span>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground" data-testid="state-loading">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : deliveries.length === 0 ? (
            <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground" data-testid="state-empty">
              {ar
                ? "لا توجد رسائل تطابق هذه المرشحات."
                : "No messages match these filters yet."}
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-md border" data-testid="list-deliveries">
              {deliveries.map((d) => {
                const s = statusDescriptor(d.latestStatus, ar);
                const StatusIcon = s.Icon;
                const t = transportDescriptor(d.transport, ar);
                const TransportIcon = t.Icon;
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
                        <span data-testid={`text-transport-${rowKey}`}>{t.label}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" data-testid={`text-recipient-${rowKey}`}>
                          {d.recipient || "—"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {d.latestError ? (
                            <span data-testid={`text-error-${rowKey}`}>{d.latestError}</span>
                          ) : (
                            formatDate(d.latestAt ?? d.firstAt, ar)
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
                  {transportDescriptor(selected.transport, ar).label} · {selected.recipient}
                </SheetTitle>
                <SheetDescription>
                  {ar
                    ? "كل أحداث دورة حياة الرسالة، الأحدث أولاً."
                    : "Every lifecycle event for this message, newest first."}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <div data-testid="text-message-id">
                    <span className="font-medium text-foreground">
                      {ar ? "معرف الرسالة" : "Message ID"}:
                    </span>{" "}
                    {selected.messageId ?? (ar ? "(لم يصل معرف من المزود)" : "(no provider id yet)")}
                  </div>
                  <div className="mt-1">
                    <span className="font-medium text-foreground">
                      {ar ? "آخر تحديث" : "Last update"}:
                    </span>{" "}
                    {formatDate(selected.latestAt ?? selected.firstAt, ar)}
                  </div>
                </div>

                <ScrollArea className="h-[60vh] pe-2">
                  {loadingEvents ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : eventsError ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="state-events-error">
                      {ar ? "تعذّر تحميل الأحداث." : "Could not load events."}
                    </div>
                  ) : events.length === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="state-events-empty">
                      {ar ? "لا توجد أحداث بعد." : "No events recorded yet."}
                    </div>
                  ) : (
                    <ol className="space-y-2" data-testid="list-events">
                      {events.map((ev) => {
                        const s = statusDescriptor(ev.type, ar);
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
                                  {formatDate(ev.createdAt, ar)}
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
  ar,
  windowLabel,
  testid,
}: {
  label: string;
  Icon: typeof Mail;
  series: TrendPoint[];
  total: number;
  ar: boolean;
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
                {new Date(`${p.date}T00:00:00Z`).toLocaleDateString(ar ? "ar" : "en", {
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
  updatedAt: string | null;
}

/**
 * Owner-only configuration block for the failure-rate alert. Lives below the
 * top-level summary so admins can see the current numbers and dial the
 * threshold against them in the same view. The "evaluate now" button reuses
 * the same evaluator the cron uses, so it produces real banners.
 */
function AlertSettingsCard({ ar }: { ar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

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

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setEmailEnabled(data.emailEnabled);
    setWindowHours(data.windowHours);
    setAbsoluteThreshold(data.absoluteThreshold);
    setRatioPercent(Number((data.ratioThreshold * 100).toFixed(2)));
    setMinSamplesForRatio(data.minSamplesForRatio);
    setCooldownMinutes(data.cooldownMinutes);
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
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auth/email-delivery-alerts/settings"] });
      toast({
        title: ar ? "تم الحفظ" : "Saved",
        description: ar
          ? "تم تحديث إعدادات التنبيهات."
          : "Alert thresholds updated.",
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: ar ? "تعذّر الحفظ" : "Save failed",
        description: err.message ?? "",
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
      // Use the array-prefix form so every (window-scoped) variant of the
      // trends query and every (transport+key-scoped) events query refetches.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/email-deliveries/trends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/email-deliveries"] });
      const fired = result.fired === true;
      toast({
        title: fired
          ? ar
            ? "تم إطلاق التنبيه"
            : "Alert fired"
          : ar
          ? "لا يوجد تنبيه"
          : "No alert",
        description: fired
          ? ar
            ? `تم تسجيل ${result.failures} إخفاقات خلال ${result.windowHours} ساعة.`
            : `${result.failures} failures recorded in the last ${result.windowHours}h.`
          : ar
          ? "الإخفاقات الحالية ضمن الحد المسموح."
          : "Current failures are within the configured thresholds.",
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: ar ? "تعذّر التشغيل" : "Evaluation failed",
        description: err.message ?? "",
      });
    },
  });

  const dirty = useMemo(() => {
    if (!data) return false;
    return (
      enabled !== data.enabled ||
      emailEnabled !== data.emailEnabled ||
      windowHours !== data.windowHours ||
      absoluteThreshold !== data.absoluteThreshold ||
      Number((ratioPercent / 100).toFixed(4)) !== Number(data.ratioThreshold.toFixed(4)) ||
      minSamplesForRatio !== data.minSamplesForRatio ||
      cooldownMinutes !== data.cooldownMinutes
    );
  }, [data, enabled, emailEnabled, windowHours, absoluteThreshold, ratioPercent, minSamplesForRatio, cooldownMinutes]);

  return (
    <Card data-testid="card-email-delivery-alerts">
      <CardHeader>
        <CardTitle>{ar ? "تنبيهات صحة البريد" : "Delivery health alerts"}</CardTitle>
        <CardDescription>
          {ar
            ? "نبّه المالكين عند ارتفاع نسبة إخفاقات بريد المعاملات فوق الحد المحدّد."
            : "Notify workspace owners when transactional email failures spike past the configured threshold."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-medium">
                {ar ? "تفعيل التنبيهات" : "Enable alerts"}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ar
                  ? "يعمل التقييم في الخلفية كل 10 دقائق."
                  : "Evaluator runs in the background every 10 minutes."}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-alerts-enabled"
              aria-label={ar ? "تفعيل التنبيهات" : "Enable alerts"}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-medium">
                {ar ? "إرسال بريد للمالكين" : "Email owners on alert"}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ar
                  ? "بالإضافة إلى الشريط داخل التطبيق."
                  : "In addition to the in-app banner."}
              </p>
            </div>
            <Switch
              checked={emailEnabled}
              onCheckedChange={setEmailEnabled}
              data-testid="switch-alerts-email-enabled"
              aria-label={ar ? "إرسال بريد للمالكين" : "Email owners on alert"}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="alert-window">
              {ar ? "نافذة المراقبة (ساعات)" : "Window (hours)"}
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
              {ar ? "1 إلى 168 ساعة." : "Between 1 and 168."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-absolute">
              {ar ? "الحد المطلق للإخفاقات" : "Absolute failure threshold"}
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
              {ar
                ? "يطلق عند بلوغ هذا العدد بصرف النظر عن الحجم."
                : "Fires when failures hit this count regardless of volume."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-ratio">
              {ar ? "حد النسبة (%)" : "Ratio threshold (%)"}
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
              {ar ? "اضبط 0 للتعطيل." : "Set to 0 to disable the ratio rule."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-min-samples">
              {ar ? "أقل عدد رسائل لاحتساب النسبة" : "Minimum sends for ratio"}
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
              {ar
                ? "يمنع إطلاق التنبيه على أحجام صغيرة."
                : "Avoids ratio alerts on tiny sample sizes."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-cooldown">
              {ar ? "فترة التهدئة (دقائق)" : "Cooldown (minutes)"}
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
              {ar
                ? "أقل فاصل بين تنبيهين متتاليين."
                : "Minimum gap between consecutive alerts."}
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
            {evaluateNow.isPending
              ? ar
                ? "جارٍ التقييم..."
                : "Evaluating..."
              : ar
              ? "تقييم الآن"
              : "Evaluate now"}
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || isLoading}
            data-testid="button-save-alert-settings"
          >
            {save.isPending
              ? ar
                ? "جارٍ الحفظ..."
                : "Saving..."
              : ar
              ? "حفظ الإعدادات"
              : "Save settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
