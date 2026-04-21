import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ArrowDownRight, Plus, Sparkles } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";
import { usePeriod } from "@/contexts/period-context";
import { useT } from "@/i18n/dict";
import { useFormatMoney, useSettings } from "@/lib/format";
import { useTransactions } from "@/hooks/use-transactions";
import { useLocale } from "@/contexts/locale-context";
import { startOfDay, eachDayOfInterval, isWithinInterval, format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SeriesPoint { day: string; value: number; }

function bucket(transactions: any[], start: Date, end: Date, kind: "income" | "expense" | "net") {
  const days = eachDayOfInterval({ start, end });
  return days.map((d) => {
    const day = format(d, "MM-dd");
    const dayStart = startOfDay(d);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);
    let v = 0;
    transactions.forEach((tx) => {
      const txd = new Date(tx.date || 0);
      if (!isWithinInterval(txd, { start: dayStart, end: dayEnd })) return;
      const amt = Number(tx.amount);
      if (kind === "income"  && tx.type === "income")  v += amt;
      if (kind === "expense" && tx.type === "expense") v += amt;
      if (kind === "net") v += tx.type === "income" ? amt : -amt;
    });
    return { day, value: v };
  });
}

function sum(arr: SeriesPoint[]) { return arr.reduce((s, p) => s + p.value, 0); }

function deltaPct(curr: number, prev: number): number | null {
  if (!prev) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ───────────────────────── Secondary KPI tile ─────────────────────────

interface TileProps {
  label: string;
  value: number;
  fmt: (n: number) => string;
  delta: number | null;
  series: SeriesPoint[];
  href: string;
  positiveDirection?: "up" | "down";
  testid: string;
  accentToken: string; // e.g. "var(--gain)"
  hasData: boolean;
}

function Tile({ label, value, fmt, delta, series, href, positiveDirection = "up", testid, accentToken, hasData }: TileProps) {
  const isUp = (delta || 0) >= 0;
  const goodUp = positiveDirection === "up";
  const good = (isUp && goodUp) || (!isUp && !goodUp);

  return (
    <Link href={href} className="block group" data-testid={testid}>
      <div className="h-full border border-border bg-card rounded-xl p-4 transition-all hover:border-foreground/20 hover:shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${accentToken})` }} />
            <span className="eyebrow">{label}</span>
          </div>
          {delta != null && hasData && (
            <span
              className={cn(
                "delta-chip",
                good ? "text-gain bg-gain-tint" : "text-loss bg-loss-tint",
              )}
            >
              {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="font-display text-2xl font-semibold tabular-nums tracking-tight leading-none text-foreground">
          {fmt(value)}
        </div>
        <div className="mt-auto h-8 -mx-1 pt-3" dir="ltr">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={`hsl(${accentToken})`}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full border-b border-dashed border-border" />
          )}
        </div>
      </div>
    </Link>
  );
}

// ───────────────────────── Hero cash card ─────────────────────────

interface HeroProps {
  cash: number;
  cashSeries: SeriesPoint[];
  runwayDays: number | null;
  netTotal: number;
  netDelta: number | null;
  fmt: (n: number) => string;
  hasData: boolean;
}

function HeroCash({ cash, cashSeries, runwayDays, netTotal, netDelta, fmt, hasData }: HeroProps) {
  const t = useT();
  const settings = useSettings();
  const { locale } = useLocale();
  const isUp = (netDelta || 0) >= 0;
  const cashPositive = cash >= 0;
  const heroAccent = cashPositive ? "var(--gain)" : "var(--loss)";

  // Format the number alone (no currency), then render currency separately.
  // Mercury / Stripe convention: hero number stands alone, currency is a small chip.
  const intlLocale = locale === "ar" ? "ar-SA" : "en-US";
  const numStr = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 })
    .format(Math.abs(cash));
  const sign = cash < 0 ? "−" : "";

  return (
    <Link href="/app/reports" className="block group lg:row-span-2" data-testid="kpi-cash">
      <div className="relative h-full overflow-hidden border border-border bg-card rounded-xl p-6 transition-all hover:border-foreground/20 hover:shadow-md flex flex-col">
        {/* subtle corner glow */}
        <div
          aria-hidden="true"
          className="absolute -top-24 -end-24 w-64 h-64 rounded-full opacity-[0.05] blur-3xl pointer-events-none"
          style={{ background: `hsl(${heroAccent})` }}
        />

        {/* header */}
        <div className="flex items-start justify-between gap-3 relative">
          <div className="space-y-1">
            <div className="eyebrow">{t("kpi_cash")}</div>
            <div className="text-xs text-muted-foreground">
              {hasData ? t("vs_previous") : t("start_first_tx_hint")}
            </div>
          </div>
          {runwayDays != null && hasData && (
            <div className="text-end">
              <div className="font-display text-lg font-semibold tabular-nums leading-none">
                {runwayDays === Infinity || !isFinite(runwayDays) ? "∞" : Math.round(runwayDays)}
              </div>
              <div className="eyebrow mt-1">{t("kpi_runway")}</div>
            </div>
          )}
        </div>

        {/* hero number — currency as separate chip, number stands alone */}
        <div className="mt-6 relative min-w-0">
          <div className="flex items-baseline gap-2 min-w-0" dir="ltr">
            <span
              className="eyebrow shrink-0"
              aria-hidden="true"
              title={settings.currencyCode}
            >
              {settings.currencyCode}
            </span>
            <div
              className={cn(
                "font-display font-semibold tabular-nums tracking-tighter leading-[1.02] min-w-0 truncate",
                "text-[clamp(1.875rem,3.2vw,2.75rem)]",
                cashPositive ? "text-foreground" : "text-loss",
              )}
              data-testid="text-hero-cash"
              title={fmt(cash)}
            >
              {sign}{numStr}
            </div>
          </div>
          {hasData && netDelta != null && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-sm">
              <span
                className={cn(
                  "delta-chip",
                  isUp ? "text-gain bg-gain-tint" : "text-loss bg-loss-tint",
                )}
              >
                {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                {Math.abs(netDelta).toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {fmt(netTotal)} {t("kpi_net")}
              </span>
            </div>
          )}
        </div>

        {/* big sparkline */}
        <div className="mt-auto pt-6 -mx-2" dir="ltr">
          <div className="h-24">
            {hasData && cashSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashSeries} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hero-cash-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={`hsl(${heroAccent})`} stopOpacity={0.20} />
                      <stop offset="100%" stopColor={`hsl(${heroAccent})`} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={`hsl(${heroAccent})`}
                    strokeWidth={2}
                    fill="url(#hero-cash-grad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex items-end">
                <div className="w-full border-b border-dashed border-border" />
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ───────────────────────── Empty state ─────────────────────────

function EmptyHero() {
  const t = useT();
  return (
    <Link href="/app/transactions?new=1" className="block lg:row-span-2 group" data-testid="kpi-empty-hero">
      <div className="h-full border border-dashed border-border bg-card/50 rounded-xl p-6 flex flex-col items-center justify-center text-center gap-4 transition-colors hover:border-foreground/30 hover:bg-card">
        <div className="h-12 w-12 rounded-xl border border-border bg-background inline-flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
        <div className="space-y-1.5 max-w-xs">
          <div className="font-display text-xl font-semibold leading-tight">{t("start_first_tx")}</div>
          <div className="text-sm text-muted-foreground leading-relaxed">{t("start_first_tx_hint")}</div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground border border-border rounded-md px-3 py-1.5 group-hover:bg-foreground group-hover:text-background transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {t("quick_create_tx")}
        </div>
      </div>
    </Link>
  );
}

// ───────────────────────── Main strip ─────────────────────────

export function KpiStrip() {
  const t = useT();
  const fmtMoney = useFormatMoney();
  const { period, previousRange, compareToPrevious } = usePeriod();
  const { data: txs, isLoading } = useTransactions();
  const { data: cashForecast } = useQuery<any>({
    queryKey: ["/api/insights/cash-forecast", 30],
    queryFn: () => fetch("/api/insights/cash-forecast?days=30").then((r) => r.json()),
  });

  const data = useMemo(() => {
    const list = (txs || []).filter((t) => t.date);
    const inRange = (start: Date, end: Date) =>
      list.filter((tx) => {
        const d = new Date(tx.date!);
        return d >= start && d <= end;
      });
    const cur  = inRange(period.start, period.end);
    const prev = inRange(previousRange.start, previousRange.end);

    const incomeSeries  = bucket(cur, period.start, period.end, "income");
    const expenseSeries = bucket(cur, period.start, period.end, "expense");
    const netSeries     = bucket(cur, period.start, period.end, "net");

    const incomeTotal  = sum(incomeSeries);
    const expenseTotal = sum(expenseSeries);
    const netTotal     = incomeTotal - expenseTotal;
    const txCount      = cur.length;

    const prevIncome  = sum(bucket(prev, previousRange.start, previousRange.end, "income"));
    const prevExpense = sum(bucket(prev, previousRange.start, previousRange.end, "expense"));
    const prevNet     = prevIncome - prevExpense;
    const prevTxCount = prev.length;

    return {
      incomeSeries, expenseSeries, netSeries,
      incomeTotal, expenseTotal, netTotal, txCount,
      prevIncome, prevExpense, prevNet, prevTxCount,
    };
  }, [txs, period, previousRange]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" data-testid="kpi-strip-loading">
        <Skeleton className="h-72 lg:row-span-2 rounded-xl" />
        <div className="grid grid-cols-2 lg:col-span-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const cash    = Number(cashForecast?.currentCash ?? 0);
  const runway  = cashForecast?.runwayDays ?? null;
  const cashSeries: SeriesPoint[] = (cashForecast?.series || []).slice(0, 30).map((p: any) => ({
    day: String(p.day), value: Number(p.balance || 0),
  }));

  const hasAnyData =
    (txs && txs.length > 0) ||
    Math.abs(cash) > 0 ||
    Math.abs(data.incomeTotal) > 0 ||
    Math.abs(data.expenseTotal) > 0;

  // Tx-count "fmt" — integers only, no currency
  const fmtCount = (n: number) => Math.round(n).toString();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" data-testid="kpi-strip">
      {hasAnyData ? (
        <HeroCash
          cash={cash}
          cashSeries={cashSeries.length ? cashSeries : data.netSeries}
          runwayDays={runway}
          netTotal={data.netTotal}
          netDelta={compareToPrevious ? deltaPct(data.netTotal, data.prevNet) : null}
          fmt={fmtMoney}
          hasData={hasAnyData}
        />
      ) : (
        <EmptyHero />
      )}

      <div className="grid grid-cols-2 lg:col-span-2 gap-3 auto-rows-fr">
        <Tile
          label={t("kpi_revenue")}
          value={data.incomeTotal}
          fmt={fmtMoney}
          delta={compareToPrevious ? deltaPct(data.incomeTotal, data.prevIncome) : null}
          series={data.incomeSeries}
          href="/app/transactions?type=income"
          positiveDirection="up"
          testid="kpi-revenue"
          accentToken="var(--chart-1)"
          hasData={hasAnyData}
        />
        <Tile
          label={t("kpi_expenses")}
          value={data.expenseTotal}
          fmt={fmtMoney}
          delta={compareToPrevious ? deltaPct(data.expenseTotal, data.prevExpense) : null}
          series={data.expenseSeries}
          href="/app/transactions?type=expense"
          positiveDirection="down"
          testid="kpi-expenses"
          accentToken="var(--muted-foreground)"
          hasData={hasAnyData}
        />
        <Tile
          label={t("kpi_net")}
          value={data.netTotal}
          fmt={fmtMoney}
          delta={compareToPrevious ? deltaPct(data.netTotal, data.prevNet) : null}
          series={data.netSeries}
          href="/app/reports"
          positiveDirection="up"
          testid="kpi-net"
          accentToken={data.netTotal >= 0 ? "var(--gain)" : "var(--loss)"}
          hasData={hasAnyData}
        />
        <Tile
          label={t("nav_transactions")}
          value={data.txCount}
          fmt={fmtCount}
          delta={compareToPrevious ? deltaPct(data.txCount, data.prevTxCount) : null}
          series={data.netSeries.map((p) => ({ day: p.day, value: Math.abs(p.value) > 0 ? 1 : 0 }))}
          href="/app/transactions"
          positiveDirection="up"
          testid="kpi-tx-count"
          accentToken="var(--chart-2)"
          hasData={hasAnyData}
        />
      </div>
    </div>
  );
}
