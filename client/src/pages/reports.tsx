import { useMemo, useState } from "react";
import { useTransactions } from "@/hooks/use-transactions";
import { format, startOfMonth, endOfMonth, isWithinInterval, subMonths, startOfYear } from "date-fns";
import { ar } from "date-fns/locale";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Wallet,
  Printer,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  CalendarRange,
  PieChart as PieChartIcon,
  Sparkles,
  FileText,
  LayoutDashboard,
} from "lucide-react";
import { IfrsIncomeStatement } from "@/components/reports/ifrs-statement";
import { FinancialAnalysis } from "@/components/reports/financial-analysis";
import { TrialBalance } from "@/components/reports/trial-balance";
import { BalanceSheet } from "@/components/reports/balance-sheet";
import { Scale, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Area,
  AreaChart,
} from "recharts";

const CATEGORY_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

type Period = "month" | "3months" | "year" | "all";

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "month", label: "هذا الشهر" },
  { key: "3months", label: "آخر 3 أشهر" },
  { key: "year", label: "هذه السنة" },
  { key: "all", label: "كل الفترات" },
];

type ViewMode = "analytics" | "ifrs" | "trial-balance" | "balance-sheet" | "analysis";

export default function Reports() {
  const { data: transactions, isLoading } = useTransactions();
  const [period, setPeriod] = useState<Period>("3months");
  const [viewMode, setViewMode] = useState<ViewMode>("analytics");

  const range = useMemo(() => {
    const now = new Date();
    if (period === "month") return { start: startOfMonth(now), end: endOfMonth(now) };
    if (period === "3months") return { start: startOfMonth(subMonths(now, 2)), end: endOfMonth(now) };
    if (period === "year") return { start: startOfYear(now), end: endOfMonth(now) };
    return null;
  }, [period]);

  const filteredTx = useMemo(() => {
    if (!transactions) return [];
    if (!range) return transactions;
    return transactions.filter((t) => {
      const d = new Date(t.date || new Date());
      return isWithinInterval(d, range);
    });
  }, [transactions, range]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    filteredTx.forEach((t) => {
      const amt = Number(t.amount);
      if (t.type === "income") income += amt;
      else expense += amt;
    });
    return {
      income,
      expense,
      net: income - expense,
      savingsRate: income > 0 ? ((income - expense) / income) * 100 : 0,
      txCount: filteredTx.length,
    };
  }, [filteredTx]);

  // Spending breakdown by category
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredTx
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        const amt = Number(t.amount);
        map.set(t.category, (map.get(t.category) || 0) + amt);
      });
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, percent: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTx]);

  const incomeBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredTx
      .filter((t) => t.type === "income")
      .forEach((t) => {
        const amt = Number(t.amount);
        map.set(t.category, (map.get(t.category) || 0) + amt);
      });
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, percent: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTx]);

  // Monthly trend (last 6 months always for trend chart)
  const monthlyTrend = useMemo(() => {
    if (!transactions) return [];
    const now = new Date();
    const months: { month: string; إيراد: number; مصروف: number; صافي: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(now, i);
      const start = startOfMonth(monthDate);
      const end = endOfMonth(monthDate);
      let income = 0;
      let expense = 0;
      transactions.forEach((t) => {
        const d = new Date(t.date || new Date());
        if (isWithinInterval(d, { start, end })) {
          const amt = Number(t.amount);
          if (t.type === "income") income += amt;
          else expense += amt;
        }
      });
      months.push({
        month: format(monthDate, "MMM", { locale: ar }),
        إيراد: income,
        مصروف: expense,
        صافي: income - expense,
      });
    }
    return months;
  }, [transactions]);

  const handlePrint = () => window.print();

  const handleExportCSV = () => {
    const rows = [
      ["التاريخ", "النوع", "الفئة", "الوصف", "المبلغ"],
      ...filteredTx.map((t) => [
        format(new Date(t.date || new Date()), "yyyy-MM-dd"),
        t.type === "income" ? "إيراد" : "مصروف",
        t.category,
        t.description,
        String(t.amount),
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `تقرير-مالي-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500" id="report-content">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3"
            data-testid="text-page-title"
          >
            <div className="p-2 bg-primary/10 rounded-2xl">
              <BarChart3 className="w-7 h-7 text-primary" />
            </div>
            التقرير المالي
          </h1>
          <p className="text-muted-foreground mt-2 font-medium">
            تحليل شامل لأدائك المالي مع رؤى ذكية وقابل للطباعة والتصدير.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            variant="outline"
            onClick={handleExportCSV}
            className="rounded-xl h-11 font-bold gap-2"
            data-testid="button-export-csv"
          >
            <Download className="w-4 h-4" />
            تصدير CSV
          </Button>
          <Button
            onClick={handlePrint}
            className="rounded-xl h-11 font-bold gap-2 bg-primary hover:bg-primary/90"
            data-testid="button-print"
          >
            <Printer className="w-4 h-4" />
            طباعة
          </Button>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex flex-wrap gap-2 bg-card rounded-2xl p-1.5 border border-border/50 w-fit print:hidden">
        <button
          onClick={() => setViewMode("analytics")}
          data-testid="button-view-analytics"
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            viewMode === "analytics"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          عرض تحليلي
        </button>
        <button
          onClick={() => setViewMode("ifrs")}
          data-testid="button-view-ifrs"
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            viewMode === "ifrs"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="w-4 h-4" />
          قائمة الدخل (IFRS)
        </button>
        <button
          onClick={() => setViewMode("trial-balance")}
          data-testid="button-view-trial-balance"
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            viewMode === "trial-balance"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Scale className="w-4 h-4" />
          ميزان المراجعة
        </button>
        <button
          onClick={() => setViewMode("balance-sheet")}
          data-testid="button-view-balance-sheet"
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            viewMode === "balance-sheet"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building2 className="w-4 h-4" />
          المركز المالي
        </button>
        <button
          onClick={() => setViewMode("analysis")}
          data-testid="button-view-analysis"
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            viewMode === "analysis"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          تحليل ذكي
        </button>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <CalendarRange className="w-5 h-5 text-muted-foreground" />
        <span className="text-sm font-bold text-muted-foreground">الفترة:</span>
        <div className="flex flex-wrap gap-2 bg-card rounded-2xl p-1.5 border border-border/50">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              data-testid={`button-period-${opt.key}`}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                period === opt.key
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "ifrs" && (
        <IfrsIncomeStatement
          transactions={filteredTx}
          periodStart={range?.start ?? null}
          periodEnd={range?.end ?? null}
        />
      )}

      {viewMode === "trial-balance" && <TrialBalance />}

      {viewMode === "balance-sheet" && <BalanceSheet />}

      {viewMode === "analysis" && (
        <FinancialAnalysis
          transactions={filteredTx}
          periodLabel={PERIOD_OPTIONS.find((p) => p.key === period)?.label || ""}
        />
      )}

      {viewMode === "analytics" && (
        <>
          <AnalyticsView
            totals={totals}
            categoryBreakdown={categoryBreakdown}
            incomeBreakdown={incomeBreakdown}
            monthlyTrend={monthlyTrend}
            filteredTx={filteredTx}
          />
        </>
      )}
    </div>
  );
}

function AnalyticsView({
  totals,
  categoryBreakdown,
  incomeBreakdown,
  monthlyTrend,
  filteredTx,
}: {
  totals: { income: number; expense: number; net: number; savingsRate: number; txCount: number };
  categoryBreakdown: { name: string; value: number; percent: number }[];
  incomeBreakdown: { name: string; value: number; percent: number }[];
  monthlyTrend: { month: string; إيراد: number; مصروف: number; صافي: number }[];
  filteredTx: any[];
}) {
  return (
    <div className="space-y-8">


      {/* Print-only header */}
      <div className="hidden print:block border-b pb-4">
        <h2 className="text-2xl font-bold">تقرير مالي - محاسب ذكي</h2>
        <p className="text-sm text-muted-foreground mt-1">
          تاريخ التقرير: {format(new Date(), "d MMMM yyyy", { locale: ar })}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="إجمالي الإيرادات"
          value={totals.income}
          icon={<ArrowUpRight className="w-5 h-5" />}
          color="emerald"
          testId="kpi-income"
        />
        <KpiCard
          title="إجمالي المصروفات"
          value={totals.expense}
          icon={<ArrowDownRight className="w-5 h-5" />}
          color="rose"
          testId="kpi-expense"
        />
        <KpiCard
          title="صافي الربح"
          value={totals.net}
          icon={<Wallet className="w-5 h-5" />}
          color={totals.net >= 0 ? "blue" : "rose"}
          testId="kpi-net"
        />
        <KpiCard
          title="معدل الادخار"
          value={totals.savingsRate}
          icon={<Sparkles className="w-5 h-5" />}
          color={totals.savingsRate >= 20 ? "emerald" : totals.savingsRate >= 0 ? "amber" : "rose"}
          testId="kpi-savings"
          isPercent
        />
      </div>

      {/* AI Insights */}
      {filteredTx.length > 0 && (
        <Card className="rounded-2xl border-none shadow-lg shadow-black/5 bg-gradient-to-l from-primary/5 via-card to-emerald-500/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary/10 rounded-2xl shrink-0">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <h3 className="text-lg font-bold text-foreground">رؤى ذكية</h3>
                <ul className="space-y-1.5 text-sm font-medium text-foreground/80">
                  {totals.net >= 0 ? (
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600">✓</span>
                      وضعك المالي إيجابي. فائض قدره{" "}
                      <strong>{totals.net.toLocaleString("ar-SA")} ر.س</strong>.
                    </li>
                  ) : (
                    <li className="flex items-center gap-2">
                      <span className="text-rose-600">⚠</span>
                      مصروفاتك تتجاوز إيراداتك بـ{" "}
                      <strong>{Math.abs(totals.net).toLocaleString("ar-SA")} ر.س</strong>.
                    </li>
                  )}
                  {categoryBreakdown[0] && (
                    <li className="flex items-center gap-2">
                      <span className="text-primary">●</span>
                      أكبر فئة مصروفات: <strong>{categoryBreakdown[0].name}</strong> (
                      {categoryBreakdown[0].percent.toFixed(0)}% من إجمالي المصروفات)
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    <span className="text-primary">●</span>
                    سجلت <strong>{totals.txCount}</strong> معاملة خلال هذه الفترة.
                  </li>
                  {totals.savingsRate >= 20 && (
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600">★</span>
                      ممتاز! معدل ادخارك <strong>{totals.savingsRate.toFixed(0)}%</strong> فوق
                      المتوسط الموصى به.
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly trend */}
      <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl font-bold">
            <div className="p-2 bg-primary/10 rounded-xl">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            الاتجاه الشهري (آخر 6 أشهر)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full" data-testid="chart-monthly-trend" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, fontFamily: "Cairo" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "Cairo" }}
                  axisLine={false}
                  tickLine={false}
                  orientation="right"
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                    fontFamily: "Cairo",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                  }}
                  formatter={(v: number) => `${v.toLocaleString("ar-SA")} ر.س`}
                />
                <Legend
                  wrapperStyle={{ fontFamily: "Cairo", fontWeight: 600, paddingTop: "8px" }}
                  iconType="circle"
                />
                <Area
                  type="monotone"
                  dataKey="إيراد"
                  stroke="#10b981"
                  strokeWidth={3}
                  fill="url(#incomeGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="مصروف"
                  stroke="#f43f5e"
                  strokeWidth={3}
                  fill="url(#expenseGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Income vs Expense Bar comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl font-bold">
              <div className="p-2 bg-rose-100 text-rose-600 rounded-xl">
                <TrendingDown className="w-5 h-5" />
              </div>
              المصروفات حسب الفئة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categoryBreakdown.length === 0 ? (
              <EmptyChart label="لا توجد مصروفات في هذه الفترة" />
            ) : (
              <>
                <div className="h-56 w-full" data-testid="chart-expense-categories" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {categoryBreakdown.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          fontFamily: "Cairo",
                        }}
                        formatter={(v: number) => `${v.toLocaleString("ar-SA")} ر.س`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <BreakdownList items={categoryBreakdown} colors={CATEGORY_COLORS} testIdPrefix="row-expense-cat" />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl font-bold">
              <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                <TrendingUp className="w-5 h-5" />
              </div>
              الإيرادات حسب الفئة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {incomeBreakdown.length === 0 ? (
              <EmptyChart label="لا توجد إيرادات في هذه الفترة" />
            ) : (
              <>
                <div className="h-56 w-full" data-testid="chart-income-categories" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={incomeBreakdown}
                      layout="vertical"
                      margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "Cairo" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: "hsl(var(--foreground))", fontSize: 12, fontFamily: "Cairo" }}
                        axisLine={false}
                        tickLine={false}
                        width={80}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          fontFamily: "Cairo",
                        }}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                        formatter={(v: number) => `${v.toLocaleString("ar-SA")} ر.س`}
                      />
                      <Bar dataKey="value" fill="#10b981" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <BreakdownList items={incomeBreakdown} colors={["#10b981"]} testIdPrefix="row-income-cat" />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed transactions table */}
      <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl font-bold">
            <div className="p-2 bg-secondary rounded-xl">
              <PieChartIcon className="w-5 h-5" />
            </div>
            تفاصيل المعاملات ({filteredTx.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredTx.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p className="font-medium">لا توجد معاملات في هذه الفترة.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-foreground/80 text-right">
                    <th className="p-4 font-bold">التاريخ</th>
                    <th className="p-4 font-bold">النوع</th>
                    <th className="p-4 font-bold">الفئة</th>
                    <th className="p-4 font-bold">الوصف</th>
                    <th className="p-4 font-bold text-left">المبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredTx
                    .slice()
                    .sort(
                      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
                    )
                    .map((tx) => (
                      <tr
                        key={tx.id}
                        data-testid={`row-report-tx-${tx.id}`}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-4 text-muted-foreground font-medium whitespace-nowrap">
                          {format(new Date(tx.date || new Date()), "d MMM yyyy", { locale: ar })}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                              tx.type === "income"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-rose-100 text-rose-700"
                            }`}
                          >
                            {tx.type === "income" ? "إيراد" : "مصروف"}
                          </span>
                        </td>
                        <td className="p-4 font-semibold">{tx.category}</td>
                        <td className="p-4 text-foreground/80">{tx.description}</td>
                        <td
                          className={`p-4 text-left font-black tabular-nums ${
                            tx.type === "income" ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {tx.type === "income" ? "+" : "-"}
                          {Number(tx.amount).toLocaleString("ar-SA")} ر.س
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon,
  color,
  testId,
  isPercent = false,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "emerald" | "rose" | "amber";
  testId: string;
  isPercent?: boolean;
}) {
  const colorMap = {
    blue: { bg: "bg-blue-100", text: "text-blue-600", value: "text-blue-700" },
    emerald: { bg: "bg-emerald-100", text: "text-emerald-600", value: "text-emerald-700" },
    rose: { bg: "bg-rose-100", text: "text-rose-600", value: "text-rose-700" },
    amber: { bg: "bg-amber-100", text: "text-amber-600", value: "text-amber-700" },
  } as const;
  const c = colorMap[color];

  return (
    <Card
      className="rounded-2xl border-none shadow-md shadow-black/5 hover:shadow-lg hover:-translate-y-0.5 transition-all"
      data-testid={`card-${testId}`}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-muted-foreground">{title}</span>
          <div className={`p-2 ${c.bg} ${c.text} rounded-xl`}>{icon}</div>
        </div>
        <div className={`text-2xl lg:text-3xl font-black tabular-nums ${c.value}`} data-testid={`text-${testId}`}>
          {isPercent ? (
            <>
              {value.toFixed(1)}
              <span className="text-base font-bold opacity-80">%</span>
            </>
          ) : (
            <>
              {value.toLocaleString("ar-SA")}
              <span className="text-sm font-medium opacity-70 mr-1">ر.س</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownList({
  items,
  colors,
  testIdPrefix,
}: {
  items: { name: string; value: number; percent: number }[];
  colors: string[];
  testIdPrefix: string;
}) {
  return (
    <div className="mt-4 space-y-3">
      {items.slice(0, 5).map((c, i) => (
        <div key={c.name} className="space-y-1" data-testid={`${testIdPrefix}-${c.name}`}>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: colors[i % colors.length] }}
              />
              <span className="font-bold text-foreground">{c.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">
                {c.percent.toFixed(0)}%
              </span>
              <span className="font-extrabold text-foreground tabular-nums">
                {c.value.toLocaleString("ar-SA")} ر.س
              </span>
            </div>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, c.percent)}%`,
                background: colors[i % colors.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-56 flex flex-col items-center justify-center text-muted-foreground">
      <PieChartIcon className="w-12 h-12 opacity-20 mb-3" />
      <p className="font-medium text-sm">{label}</p>
    </div>
  );
}
