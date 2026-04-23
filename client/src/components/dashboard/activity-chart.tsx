import { useMemo } from "react";
import { useTransactions } from "@/hooks/use-transactions";
import { usePeriod } from "@/contexts/period-context";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { useFormatMoney } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { eachDayOfInterval, format, isWithinInterval, startOfDay } from "date-fns";
import { ActivityChartSkeleton } from "./skeletons";
import { useLocation } from "wouter";

function bucketNet(transactions: any[], start: Date, end: Date) {
  return eachDayOfInterval({ start, end }).map((d) => {
    const ds = startOfDay(d);
    const de = new Date(ds.getTime() + 86_400_000 - 1);
    let income = 0, expense = 0;
    transactions.forEach((tx) => {
      const txd = new Date(tx.date || 0);
      if (!isWithinInterval(txd, { start: ds, end: de })) return;
      const amt = Number(tx.amount);
      if (tx.type === "income") income += amt;
      else expense += amt;
    });
    return { day: format(d, "MM-dd"), income, expense, net: income - expense };
  });
}

export function ActivityChart() {
  const t = useT();
  const { dir, locale } = useLocale();
  const fmt = useFormatMoney();
  const { period, previousRange, compareToPrevious } = usePeriod();
  const { data: txs, isLoading } = useTransactions();
  const [, setLocation] = useLocation();

  const data = useMemo(() => {
    const list = (txs || []).filter((tx) => tx.date);
    const cur = bucketNet(
      list.filter((tx) => { const d = new Date(tx.date!); return d >= period.start && d <= period.end; }),
      period.start, period.end
    );
    if (!compareToPrevious) return cur.map((p, i) => ({ ...p, prev: 0, idx: i + 1 }));
    const prev = bucketNet(
      list.filter((tx) => { const d = new Date(tx.date!); return d >= previousRange.start && d <= previousRange.end; }),
      previousRange.start, previousRange.end
    );
    return cur.map((p, i) => ({ ...p, prev: prev[i]?.net ?? 0, idx: i + 1 }));
  }, [txs, period, previousRange, compareToPrevious]);

  if (isLoading) return <ActivityChartSkeleton />;

  const intl = locale === "ar" ? "ar-SA" : "en-US";

  return (
    <section className="border border-border bg-card rounded-md motion-safe:animate-fade-in" data-testid="activity-chart">
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t("activity_title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("activity_caption")}</p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-success" /> {t("income")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-destructive" /> {t("expense")}</span>
          {compareToPrevious && (
            <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-3 bg-muted-foreground/60" /> {t("prev_period")}</span>
          )}
        </div>
      </div>
      <div className="px-2 py-3 h-72" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
            onClick={(e: any) => {
              if (e?.activePayload?.[0]?.payload) setLocation("/app/transactions");
            }}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              orientation={dir === "rtl" ? "right" : "left"}
              tickFormatter={(v) => new Intl.NumberFormat(intl, { notation: "compact" }).format(Number(v))}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "var(--font-arabic)",
              }}
              formatter={(value: any, name) => [fmt(Number(value)), name]}
              cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
            />
            <defs>
              <linearGradient id="actIncome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.45} />
                <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="actExpense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="income"  name={t("income")} stroke="hsl(var(--success))"     strokeWidth={1.5} fill="url(#actIncome)" />
            <Area type="monotone" dataKey="expense" name={t("expense")} stroke="hsl(var(--destructive))" strokeWidth={1.5} fill="url(#actExpense)" />
            {compareToPrevious && (
              <Line type="monotone" dataKey="prev" name={t("prev_period")} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
