import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area } from "recharts";
import { usePeriod } from "@/contexts/period-context";
import { useT } from "@/i18n/dict";
import { useFormatMoney } from "@/lib/format";
import { useTransactions } from "@/hooks/use-transactions";
import { useLocale } from "@/contexts/locale-context";
import { startOfDay, format, eachDayOfInterval, isWithinInterval } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

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

interface KpiProps {
  label: string;
  value: number;
  fmt: (n: number) => string;
  delta?: number | null;
  series: SeriesPoint[];
  href: string;
  emphasis?: boolean;
  positiveDirection?: "up" | "down";
  testid: string;
  suffix?: string;
}

function deltaPct(curr: number, prev: number): number | null {
  if (!prev) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function Kpi({ label, value, fmt, delta, series, href, emphasis, positiveDirection = "up", testid, suffix }: KpiProps) {
  const t = useT();
  const goodUp = positiveDirection === "up";
  const isUp = (delta || 0) >= 0;
  const good = (isUp && goodUp) || (!isUp && !goodUp);
  const deltaTone = delta == null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const max = Math.max(...series.map((s) => s.value), 1);
  const min = Math.min(...series.map((s) => s.value), 0);
  const stroke = emphasis ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";

  return (
    <Link href={href} className="block group" data-testid={testid}>
      <div
        className={`h-full border ${
          emphasis ? "border-primary/30 bg-primary/[0.02]" : "border-border bg-card"
        } rounded-md p-4 transition-colors hover:bg-accent/30 hover:border-border`}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          {delta != null && (
            <div className={`text-[11px] tabular-nums font-medium inline-flex items-center gap-0.5 ${deltaTone}`}>
              {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(delta).toFixed(1)}%
            </div>
          )}
        </div>
        <div className={`tabular-nums font-semibold tracking-tight leading-none ${emphasis ? "text-3xl" : "text-2xl"} text-foreground`}>
          {fmt(value)}
          {suffix && <span className="text-sm text-muted-foreground font-normal ms-1">{suffix}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">{t("vs_previous")}</div>
        <div className="h-9 mt-3 -mx-1" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${testid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={1.5} fill={`url(#grad-${testid})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Link>
  );
}

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
    const cur = inRange(period.start, period.end);
    const prev = inRange(previousRange.start, previousRange.end);

    const incomeSeries = bucket(cur, period.start, period.end, "income");
    const expenseSeries = bucket(cur, period.start, period.end, "expense");
    const netSeries = bucket(cur, period.start, period.end, "net");

    const incomeTotal  = sum(incomeSeries);
    const expenseTotal = sum(expenseSeries);
    const netTotal     = incomeTotal - expenseTotal;

    const prevIncome  = sum(bucket(prev, previousRange.start, previousRange.end, "income"));
    const prevExpense = sum(bucket(prev, previousRange.start, previousRange.end, "expense"));
    const prevNet     = prevIncome - prevExpense;

    return {
      incomeSeries, expenseSeries, netSeries,
      incomeTotal, expenseTotal, netTotal,
      prevIncome, prevExpense, prevNet,
    };
  }, [txs, period, previousRange]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-md" />)}
      </div>
    );
  }

  const cash = Number(cashForecast?.currentCash ?? 0);
  const runway = cashForecast?.runwayDays ?? null;
  const cashSeries: SeriesPoint[] = (cashForecast?.series || []).slice(0, 30).map((p: any) => ({
    day: String(p.day), value: Number(p.balance || 0),
  }));

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="kpi-strip">
      <Kpi
        label={t("kpi_cash")}
        value={cash}
        fmt={fmtMoney}
        series={cashSeries.length ? cashSeries : data.netSeries}
        href="/app/reports"
        emphasis
        delta={null}
        testid="kpi-cash"
      />
      <Kpi
        label={t("kpi_revenue")}
        value={data.incomeTotal}
        fmt={fmtMoney}
        series={data.incomeSeries}
        href="/app/transactions?type=income"
        delta={compareToPrevious ? deltaPct(data.incomeTotal, data.prevIncome) : null}
        positiveDirection="up"
        testid="kpi-revenue"
      />
      <Kpi
        label={t("kpi_expenses")}
        value={data.expenseTotal}
        fmt={fmtMoney}
        series={data.expenseSeries}
        href="/app/transactions?type=expense"
        delta={compareToPrevious ? deltaPct(data.expenseTotal, data.prevExpense) : null}
        positiveDirection="down"
        testid="kpi-expenses"
      />
      <Kpi
        label={t("kpi_net")}
        value={data.netTotal}
        fmt={fmtMoney}
        series={data.netSeries}
        href="/app/reports"
        delta={compareToPrevious ? deltaPct(data.netTotal, data.prevNet) : null}
        positiveDirection="up"
        testid="kpi-net"
      />
      <Kpi
        label={t("kpi_runway")}
        value={runway != null ? runway : 0}
        fmt={(n) => (runway == null ? "∞" : String(Math.round(n)))}
        suffix={runway == null ? "" : t("days")}
        series={cashSeries.length ? cashSeries : data.netSeries}
        href="/app/insights"
        delta={null}
        testid="kpi-runway"
      />
    </div>
  );
}
