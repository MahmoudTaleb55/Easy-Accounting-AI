import { useMemo } from "react";
import { useTransactions, useTransactionSummary } from "@/hooks/use-transactions";
import { format, subDays, startOfDay, isAfter } from "date-fns";
import { ar } from "date-fns/locale";
import {
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  Activity,
  ReceiptText,
  TrendingUp,
  PieChart as PieChartIcon,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
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
} from "recharts";

const CATEGORY_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useTransactionSummary();
  const { data: transactions, isLoading: isTxLoading } = useTransactions();

  const sortedTx = useMemo(() => {
    if (!transactions) return [];
    return [...transactions].sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    );
  }, [transactions]);

  const recentTransactions = sortedTx.slice(0, 5);

  // Spending by category (expenses only)
  const categoryData = useMemo(() => {
    if (!transactions) return [];
    const map = new Map<string, number>();
    transactions
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        const amt = Number(t.amount);
        map.set(t.category, (map.get(t.category) || 0) + amt);
      });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [transactions]);

  // Last 7 days income vs expense
  const weeklyData = useMemo(() => {
    if (!transactions) return [];
    const days: { day: string; إيراد: number; مصروف: number }[] = [];
    const today = startOfDay(new Date());
    for (let i = 6; i >= 0; i--) {
      const d = subDays(today, i);
      days.push({ day: format(d, "EEE", { locale: ar }), إيراد: 0, مصروف: 0 });
    }
    const sevenDaysAgo = subDays(today, 6);
    transactions.forEach((t) => {
      const txDate = startOfDay(new Date(t.date || new Date()));
      if (isAfter(txDate, subDays(sevenDaysAgo, 1))) {
        const diff = Math.floor(
          (today.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const idx = 6 - diff;
        if (idx >= 0 && idx < 7) {
          const amt = Number(t.amount);
          if (t.type === "income") days[idx]["إيراد"] += amt;
          else days[idx]["مصروف"] += amt;
        }
      }
    });
    return days;
  }, [transactions]);

  // Quick insight: top expense category
  const topCategory = categoryData[0];

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground" data-testid="text-page-title">
            نظرة عامة
          </h1>
          <p className="text-muted-foreground mt-2 font-medium">
            مرحباً بك! إليك ملخص لأموالك اليوم.
          </p>
        </div>
        {topCategory && (
          <div className="bg-gradient-to-l from-primary/10 to-emerald-500/10 border border-primary/20 rounded-2xl px-5 py-3 flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-primary shrink-0" />
            <div className="text-sm">
              <span className="font-bold text-foreground">أكثر فئة إنفاقاً:</span>{" "}
              <span className="font-extrabold text-primary" data-testid="text-top-category">
                {topCategory.name}
              </span>{" "}
              <span className="text-muted-foreground">
                ({topCategory.value.toLocaleString("ar-SA")} ر.س)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isSummaryLoading ? (
          <>
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </>
        ) : (
          <>
            <Card
              className="rounded-2xl border-none shadow-lg shadow-black/5 bg-gradient-to-br from-primary to-blue-600 text-primary-foreground hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group"
              data-testid="card-balance"
            >
              <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-colors" />
              <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
              <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
                <CardTitle className="text-sm font-bold opacity-90">الرصيد الإجمالي</CardTitle>
                <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-sm">
                  <Wallet className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="z-10 relative">
                <div className="text-4xl font-black" data-testid="text-balance">
                  {summary?.balance.toLocaleString("ar-SA")}{" "}
                  <span className="text-lg opacity-80 font-medium">ر.س</span>
                </div>
                <p className="text-xs mt-2 flex items-center gap-1 font-medium opacity-90">
                  <Activity className="w-3 h-3" /> متاح حالياً
                </p>
              </CardContent>
            </Card>

            <Card
              className="rounded-2xl border-none shadow-lg shadow-emerald-500/5 hover:shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group"
              data-testid="card-income"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-colors" />
              <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
                <CardTitle className="text-sm font-bold text-emerald-600/80">إجمالي الإيرادات</CardTitle>
                <div className="p-3 bg-emerald-100 text-emerald-600 rounded-2xl">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="z-10 relative">
                <div className="text-3xl font-black text-emerald-600" data-testid="text-income">
                  {summary?.totalIncome.toLocaleString("ar-SA")}{" "}
                  <span className="text-lg font-medium opacity-80">ر.س</span>
                </div>
              </CardContent>
            </Card>

            <Card
              className="rounded-2xl border-none shadow-lg shadow-rose-500/5 hover:shadow-xl hover:shadow-rose-500/10 hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group"
              data-testid="card-expense"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-colors" />
              <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
                <CardTitle className="text-sm font-bold text-rose-600/80">إجمالي المصروفات</CardTitle>
                <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl">
                  <ArrowDownRight className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="z-10 relative">
                <div className="text-3xl font-black text-rose-600" data-testid="text-expense">
                  {summary?.totalExpense.toLocaleString("ar-SA")}{" "}
                  <span className="text-lg font-medium opacity-80">ر.س</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly bar chart */}
        <Card className="lg:col-span-2 rounded-2xl border-none shadow-lg shadow-black/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl font-bold">
              <div className="p-2 bg-primary/10 rounded-xl">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              نشاط آخر 7 أيام
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isTxLoading ? (
              <Skeleton className="h-64 w-full rounded-xl" />
            ) : (
              <div className="h-64 w-full" data-testid="chart-weekly" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="day"
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
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                      formatter={(v: number) => `${v.toLocaleString("ar-SA")} ر.س`}
                    />
                    <Legend
                      wrapperStyle={{ fontFamily: "Cairo", fontWeight: 600, paddingTop: "8px" }}
                      iconType="circle"
                    />
                    <Bar dataKey="إيراد" fill="#10b981" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="مصروف" fill="#f43f5e" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category pie chart */}
        <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl font-bold">
              <div className="p-2 bg-primary/10 rounded-xl">
                <PieChartIcon className="w-5 h-5 text-primary" />
              </div>
              توزيع المصروفات
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isTxLoading ? (
              <Skeleton className="h-64 w-full rounded-xl" />
            ) : categoryData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <PieChartIcon className="w-12 h-12 opacity-20 mb-3" />
                <p className="font-medium text-sm">لا توجد مصروفات بعد</p>
              </div>
            ) : (
              <div className="h-64 w-full" data-testid="chart-categories" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {categoryData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
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
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {categoryData.length > 0 && (
              <div className="mt-4 space-y-2">
                {categoryData.slice(0, 4).map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                      />
                      <span className="font-semibold text-foreground">{c.name}</span>
                    </div>
                    <span className="font-bold text-muted-foreground">
                      {c.value.toLocaleString("ar-SA")} ر.س
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-secondary rounded-lg">
              <ReceiptText className="w-5 h-5 text-foreground" />
            </div>
            <h2 className="text-2xl font-bold">أحدث المعاملات</h2>
          </div>
          <Link
            href="/app/transactions"
            className="text-sm font-bold text-primary hover:text-primary/80 transition-colors"
            data-testid="link-view-all"
          >
            عرض الكل ←
          </Link>
        </div>

        <Card className="rounded-2xl border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="divide-y divide-border/50">
            {isTxLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-6 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Skeleton className="w-12 h-12 rounded-2xl" />
                    <div className="space-y-2">
                      <Skeleton className="w-32 h-4" />
                      <Skeleton className="w-20 h-3" />
                    </div>
                  </div>
                  <Skeleton className="w-24 h-6" />
                </div>
              ))
            ) : recentTransactions.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <ReceiptText className="w-12 h-12 opacity-20 mb-4" />
                <p className="font-medium text-lg">لا توجد معاملات حتى الآن</p>
                <p className="text-sm opacity-70">اذهب إلى صفحة المعاملات أو المساعد الذكي لإضافة أول معاملة لك.</p>
              </div>
            ) : (
              recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  data-testid={`row-transaction-${tx.id}`}
                  className="p-6 flex items-center justify-between hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-3 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                        tx.type === "income"
                          ? "bg-emerald-100 text-emerald-600"
                          : "bg-rose-100 text-rose-600"
                      }`}
                    >
                      {tx.type === "income" ? (
                        <ArrowUpRight className="w-6 h-6" />
                      ) : (
                        <ArrowDownRight className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-lg">{tx.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-semibold px-2 py-1 bg-secondary text-secondary-foreground rounded-md">
                          {tx.category}
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">
                          {format(new Date(tx.date || new Date()), "d MMMM yyyy", { locale: ar })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    className={`font-black text-xl flex items-center gap-1 ${
                      tx.type === "income" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {tx.type === "income" ? "+" : "-"}
                    {Number(tx.amount).toLocaleString("ar-SA")}
                    <span className="text-sm font-medium opacity-70">ر.س</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
