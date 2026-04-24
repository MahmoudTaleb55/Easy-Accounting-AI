import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/contexts/locale-context";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  // Debounce the email input so each keystroke doesn't slam the API.
  useEffect(() => {
    const t = window.setTimeout(() => setEmailFilter(emailInput.trim()), 250);
    return () => window.clearTimeout(t);
  }, [emailInput]);

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (emailFilter) queryParams.set("email", emailFilter);
  const qs = queryParams.toString();

  const {
    data: deliveries = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<DeliveryRow[]>({
    queryKey: ["/api/auth/email-deliveries", statusFilter, emailFilter],
    queryFn: async () => {
      const r = await fetch(`/api/auth/email-deliveries${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
      return r.json();
    },
    enabled: isAdmin,
  });

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="filters">
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
              disabled={deliveries.length === 0}
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
