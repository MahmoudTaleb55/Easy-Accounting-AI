import { useMemo } from "react"
import { Link } from "wouter"
import { useTransactions, useTransactionSummary } from "@/hooks/use-transactions"
import { format, subDays, startOfDay, isAfter } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import {
  ArrowDownRight,
  ArrowUpRight,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Plus,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useLocale } from "@/contexts/locale-context"
import { useFormatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts"

/* ------------------------------------------------------------------ */
/* Tiny shared primitives — kept local to keep the page self-contained */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow text-muted-foreground/80">{children}</div>
}

function DeltaPill({ value }: { value: number }) {
  const positive = value >= 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium font-numeric tabular-nums px-1.5 py-0.5 rounded",
        positive
          ? "text-success bg-success/10"
          : "text-expense bg-expense/10"
      )}
    >
      {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const { locale, dir } = useLocale()
  const fmt = useFormatMoney()
  const dfLocale = locale === "ar" ? ar : enUS

  const { data: summary, isLoading: isSummaryLoading } = useTransactionSummary()
  const { data: transactions, isLoading: isTxLoading } = useTransactions()

  const t = useMemo(
    () => ({
      eyebrow: locale === "ar" ? "الكوكبت · الربع الحالي" : "Cockpit · current quarter",
      title: locale === "ar" ? "صباح الخير. هذه حالة عملك الآن." : "Good morning. Here is your business right now.",
      subtitle:
        locale === "ar"
          ? "أرقام محدّثة لحظياً عبر كل الحسابات والقيود."
          : "Live numbers across every account and journal entry.",
      newEntry: locale === "ar" ? "قيد جديد" : "New entry",
      viewLedger: locale === "ar" ? "افتح اليومية" : "Open ledger",
      kpiBalance: locale === "ar" ? "صافي الرصيد" : "Net balance",
      kpiBalanceHint: locale === "ar" ? "متاح حالياً عبر كل الحسابات" : "Available across all accounts",
      kpiIncome: locale === "ar" ? "الإيرادات" : "Revenue",
      kpiExpense: locale === "ar" ? "المصروفات" : "Expenses",
      kpiMargin: locale === "ar" ? "هامش الربح" : "Profit margin",
      cashflowTitle: locale === "ar" ? "التدفق النقدي" : "Cash flow",
      cashflowSubtitle: locale === "ar" ? "آخر ٣٠ يوماً" : "Last 30 days",
      categoriesTitle: locale === "ar" ? "أكبر فئات الإنفاق" : "Top spending categories",
      categoriesEmpty: locale === "ar" ? "لا توجد مصروفات بعد." : "No expenses yet.",
      insightTitle: locale === "ar" ? "رؤية المساعد الذكي" : "AI insight",
      recentTitle: locale === "ar" ? "أحدث المعاملات" : "Recent activity",
      recentEmpty:
        locale === "ar"
          ? "لا توجد معاملات بعد. أضف أوّل قيد من المساعد الذكي أو من صفحة المعاملات."
          : "No activity yet. Add your first entry from the AI assistant or the transactions page.",
      viewAll: locale === "ar" ? "عرض الكل" : "View all",
      income: locale === "ar" ? "إيراد" : "Income",
      expense: locale === "ar" ? "مصروف" : "Expense",
    }),
    [locale]
  )

  const sortedTx = useMemo(() => {
    if (!transactions) return []
    return [...transactions].sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    )
  }, [transactions])

  const recentTransactions = sortedTx.slice(0, 6)

  /* Top expense categories (with shares) */
  const categoryData = useMemo(() => {
    if (!transactions) return [] as { name: string; value: number; share: number }[]
    const map = new Map<string, number>()
    transactions
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        const amt = Number(t.amount)
        map.set(t.category, (map.get(t.category) || 0) + amt)
      })
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0) || 1
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, share: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [transactions])

  /* 30-day cash flow series */
  const cashflowData = useMemo(() => {
    if (!transactions) return []
    const days: { day: string; net: number; date: Date }[] = []
    const today = startOfDay(new Date())
    for (let i = 29; i >= 0; i--) {
      const d = subDays(today, i)
      days.push({ day: format(d, "d MMM", { locale: dfLocale }), date: d, net: 0 })
    }
    const cutoff = subDays(today, 29)
    let running = 0
    transactions.forEach((tx) => {
      const txDate = startOfDay(new Date(tx.date || new Date()))
      if (isAfter(txDate, subDays(cutoff, 1))) {
        const idx = 29 - Math.floor((today.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24))
        if (idx >= 0 && idx < 30) {
          const amt = Number(tx.amount)
          days[idx].net += tx.type === "income" ? amt : -amt
        }
      }
    })
    // Convert per-day deltas into running balance
    return days.map((d) => {
      running += d.net
      return { ...d, net: running }
    })
  }, [transactions, dfLocale])

  const margin =
    summary && summary.totalIncome > 0
      ? ((summary.totalIncome - summary.totalExpense) / summary.totalIncome) * 100
      : 0

  const topCategory = categoryData[0]

  return (
    <div className="space-y-8" data-testid="dashboard">
      {/* Header */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <Eyebrow>{t.eyebrow}</Eyebrow>
          <h1
            className="text-2xl md:text-3xl lg:text-[34px] font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t.title}
          </h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="default" data-testid="button-open-ledger">
            <Link href="/app/journal">
              {t.viewLedger}
              <ArrowRight className={cn("w-4 h-4", dir === "rtl" && "rotate-180")} />
            </Link>
          </Button>
          <Button asChild size="default" data-testid="button-new-entry">
            <Link href="/app/transactions">
              <Plus className="w-4 h-4" />
              {t.newEntry}
            </Link>
          </Button>
        </div>
      </header>

      {/* KPI band */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="kpi-band">
        {isSummaryLoading ? (
          <>
            <Skeleton className="h-[120px] rounded-md" />
            <Skeleton className="h-[120px] rounded-md" />
            <Skeleton className="h-[120px] rounded-md" />
            <Skeleton className="h-[120px] rounded-md" />
          </>
        ) : (
          <>
            <KpiCard
              label={t.kpiBalance}
              value={fmt(summary?.balance ?? 0)}
              hint={t.kpiBalanceHint}
              tone="dark"
              delta={12.4}
              data-testid="card-balance"
            />
            <KpiCard
              label={t.kpiIncome}
              value={fmt(summary?.totalIncome ?? 0)}
              delta={8.2}
              accent="income"
              data-testid="card-income"
            />
            <KpiCard
              label={t.kpiExpense}
              value={fmt(summary?.totalExpense ?? 0)}
              delta={-2.1}
              accent="expense"
              data-testid="card-expense"
            />
            <KpiCard
              label={t.kpiMargin}
              value={`${margin.toFixed(1)}%`}
              delta={margin >= 30 ? 4.5 : -3.2}
              data-testid="card-margin"
            />
          </>
        )}
      </section>

      {/* Cashflow + categories */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Cashflow */}
        <Card
          variant="default"
          className="lg:col-span-2 p-0 overflow-hidden"
          data-testid="card-cashflow"
        >
          <div className="px-6 pt-5 pb-3 flex items-start justify-between gap-4">
            <div>
              <Eyebrow>{t.cashflowSubtitle}</Eyebrow>
              <h3 className="text-base font-semibold text-foreground mt-1">{t.cashflowTitle}</h3>
            </div>
            <Badge variant="muted" size="sm" className="font-numeric">
              <TrendingUp className="w-3 h-3 me-1" />
              {fmt(summary?.balance ?? 0)}
            </Badge>
          </div>
          <div className="h-[260px] w-full px-2 pb-2" dir="ltr">
            {isTxLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashflowData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <defs>
                    <linearGradient id="cashflow-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={32}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                      boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,.06))",
                    }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: "11px" }}
                    formatter={(v: number) => [fmt(v), t.kpiBalance]}
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    fill="url(#cashflow-fill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(var(--chart-1))" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Categories */}
        <Card variant="default" className="p-6" data-testid="card-categories">
          <Eyebrow>{locale === "ar" ? "هذا الشهر" : "This month"}</Eyebrow>
          <h3 className="text-base font-semibold text-foreground mt-1 mb-5">{t.categoriesTitle}</h3>
          {isTxLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : categoryData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{t.categoriesEmpty}</p>
          ) : (
            <ul className="space-y-3.5">
              {categoryData.map((c, i) => (
                <li key={c.name} data-testid={`row-category-${i}`}>
                  <div className="flex items-center justify-between text-[13px] mb-1.5">
                    <span className="font-medium text-foreground truncate">{c.name}</span>
                    <span className="font-numeric tabular-nums text-muted-foreground">{fmt(c.value)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(4, c.share)}%`,
                        background: `hsl(var(--chart-${(i % 5) + 1}))`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* AI insight banner */}
      {topCategory && (
        <section
          className="relative overflow-hidden rounded-md border border-border bg-card px-6 py-5 flex items-start gap-4"
          data-testid="banner-ai-insight"
        >
          <div className="shrink-0 mt-0.5">
            <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Eyebrow>{t.insightTitle}</Eyebrow>
            <p className="text-[15px] leading-relaxed text-foreground mt-1">
              {locale === "ar" ? (
                <>
                  أكبر فئة إنفاقاً هذا الشهر هي{" "}
                  <span className="font-semibold text-primary" data-testid="text-top-category">
                    {topCategory.name}
                  </span>{" "}
                  بنسبة{" "}
                  <span className="font-numeric tabular-nums font-semibold">
                    {topCategory.share.toFixed(0)}%
                  </span>{" "}
                  من إجمالي المصروفات. لو خفّضتها 10٪ ستحرّر{" "}
                  <span className="font-numeric tabular-nums font-semibold">
                    {fmt(topCategory.value * 0.1)}
                  </span>{" "}
                  شهرياً.
                </>
              ) : (
                <>
                  Your largest expense this month is{" "}
                  <span className="font-semibold text-primary" data-testid="text-top-category">
                    {topCategory.name}
                  </span>{" "}
                  at{" "}
                  <span className="font-numeric tabular-nums font-semibold">
                    {topCategory.share.toFixed(0)}%
                  </span>{" "}
                  of total spend. Reducing it by 10% would free{" "}
                  <span className="font-numeric tabular-nums font-semibold">
                    {fmt(topCategory.value * 0.1)}
                  </span>{" "}
                  every month.
                </>
              )}
            </p>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-y-8 end-0 w-48 bg-gradient-to-l rtl:bg-gradient-to-r from-primary/5 to-transparent blur-2xl"
          />
        </section>
      )}

      {/* Recent activity */}
      <section data-testid="section-recent">
        <div className="flex items-center justify-between mb-3">
          <div>
            <Eyebrow>{locale === "ar" ? "النشاط" : "Activity"}</Eyebrow>
            <h2 className="text-base font-semibold text-foreground mt-1">{t.recentTitle}</h2>
          </div>
          <Button asChild variant="link" size="sm" data-testid="link-view-all">
            <Link href="/app/transactions">
              {t.viewAll}
              <ArrowRight className={cn("w-3.5 h-3.5", dir === "rtl" && "rotate-180")} />
            </Link>
          </Button>
        </div>

        <Card variant="default" className="p-0 overflow-hidden">
          {isTxLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-6 py-4 flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : recentTransactions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{t.recentEmpty}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentTransactions.map((tx) => {
                const isIncome = tx.type === "income"
                return (
                  <li
                    key={tx.id}
                    className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors"
                    data-testid={`row-transaction-${tx.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-7 h-7 rounded-md border",
                          isIncome
                            ? "bg-success/10 border-success/20 text-success"
                            : "bg-expense/10 border-expense/20 text-expense"
                        )}
                        aria-hidden
                      >
                        {isIncome ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {tx.description}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium">
                            {tx.category}
                          </span>
                          <span className="text-[11px] text-muted-foreground/60">·</span>
                          <span className="text-[11px] text-muted-foreground/80 font-numeric">
                            {format(new Date(tx.date || new Date()), "d MMM yyyy", { locale: dfLocale })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "text-sm font-semibold font-numeric tabular-nums shrink-0",
                        isIncome ? "text-success" : "text-foreground"
                      )}
                    >
                      {isIncome ? "+" : "−"} {fmt(Number(tx.amount))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* KpiCard                                                              */
/* ------------------------------------------------------------------ */

type KpiCardProps = {
  label: string
  value: string
  hint?: string
  delta?: number
  tone?: "default" | "dark"
  accent?: "income" | "expense"
  "data-testid"?: string
}

function KpiCard({ label, value, hint, delta, tone = "default", accent, ...rest }: KpiCardProps) {
  const isDark = tone === "dark"
  return (
    <Card
      variant={isDark ? "default" : "default"}
      className={cn(
        "p-5 flex flex-col gap-3 transition-colors relative overflow-hidden",
        isDark
          ? "bg-foreground text-background border-foreground"
          : "bg-card hover:border-border/80"
      )}
      data-testid={rest["data-testid"]}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "eyebrow",
            isDark ? "text-background/60" : "text-muted-foreground/80"
          )}
        >
          {label}
        </span>
        {accent === "income" && (
          <ArrowUpRight className="w-3.5 h-3.5 text-success" aria-hidden />
        )}
        {accent === "expense" && (
          <ArrowDownRight className="w-3.5 h-3.5 text-expense" aria-hidden />
        )}
      </div>
      <div
        className={cn(
          "text-2xl md:text-[28px] font-semibold tracking-tight font-numeric tabular-nums leading-none",
          isDark ? "text-background" : "text-foreground"
        )}
      >
        {value}
      </div>
      <div className="flex items-center justify-between gap-2 mt-auto">
        {hint ? (
          <span
            className={cn(
              "text-[11px]",
              isDark ? "text-background/60" : "text-muted-foreground"
            )}
          >
            {hint}
          </span>
        ) : (
          <span />
        )}
        {typeof delta === "number" && <DeltaPill value={delta} />}
      </div>
    </Card>
  )
}
