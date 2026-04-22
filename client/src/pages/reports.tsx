import { useMemo, useState } from "react"
import { useTransactions } from "@/hooks/use-transactions"
import { format, startOfMonth, endOfMonth, isWithinInterval, subMonths, startOfYear } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import {
  Printer,
  Download,
  Sparkles,
  FileText,
  LayoutDashboard,
  Scale,
  Building2,
  TrendingUp,
  TrendingDown,
  Inbox,
} from "lucide-react"
import { IfrsIncomeStatement } from "@/components/reports/ifrs-statement"
import { FinancialAnalysis } from "@/components/reports/financial-analysis"
import { TrialBalance } from "@/components/reports/trial-balance"
import { BalanceSheet } from "@/components/reports/balance-sheet"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CardGridSkeleton } from "@/components/feedback/list-skeleton"
import { Button } from "@/components/ui/button"
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
  Area,
  AreaChart,
} from "recharts"
import { useLocale } from "@/contexts/locale-context"
import { useFormatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"

const CHART_TOKENS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

type Period = "month" | "3months" | "year" | "all"
type ViewMode = "analytics" | "ifrs" | "trial-balance" | "balance-sheet" | "analysis"

export default function Reports() {
  const { locale } = useLocale()
  const fmt = useFormatMoney()
  const dfLocale = locale === "ar" ? ar : enUS
  const { data: transactions, isLoading } = useTransactions()
  const [period, setPeriod] = useState<Period>("3months")
  const [viewMode, setViewMode] = useState<ViewMode>("analytics")

  const t = useMemo(
    () => ({
      eyebrow: locale === "ar" ? "التقارير" : "Reports",
      title:
        locale === "ar"
          ? "صورة واضحة لأداء أعمالك."
          : "A clear view of your business performance.",
      subtitle:
        locale === "ar"
          ? "قوائم متوافقة مع IFRS، تحليلات لحظية، وقابلة للطباعة والتصدير."
          : "IFRS-aligned statements with live analytics, ready to print or export.",
      print: locale === "ar" ? "طباعة" : "Print",
      exportCsv: locale === "ar" ? "تصدير CSV" : "Export CSV",
      analytics: locale === "ar" ? "نظرة تحليلية" : "Analytics",
      ifrs: locale === "ar" ? "قائمة الدخل" : "Income statement",
      trial: locale === "ar" ? "ميزان المراجعة" : "Trial balance",
      balance: locale === "ar" ? "المركز المالي" : "Balance sheet",
      analysis: locale === "ar" ? "تحليل ذكي" : "AI analysis",
      period: locale === "ar" ? "الفترة" : "Period",
      pMonth: locale === "ar" ? "هذا الشهر" : "This month",
      p3: locale === "ar" ? "آخر 3 أشهر" : "Last 3 months",
      pYear: locale === "ar" ? "هذه السنة" : "This year",
      pAll: locale === "ar" ? "الكل" : "All time",
      kpiIncome: locale === "ar" ? "الإيرادات" : "Revenue",
      kpiExpense: locale === "ar" ? "المصروفات" : "Expenses",
      kpiNet: locale === "ar" ? "صافي الربح" : "Net profit",
      kpiSavings: locale === "ar" ? "هامش الربح" : "Profit margin",
      insightsTitle: locale === "ar" ? "ملخص ذكي" : "Smart summary",
      monthlyTrend:
        locale === "ar" ? "الاتجاه الشهري — آخر 6 أشهر" : "Monthly trend — last 6 months",
      expensesByCat:
        locale === "ar" ? "المصروفات حسب الفئة" : "Expenses by category",
      incomeByCat:
        locale === "ar" ? "الإيرادات حسب الفئة" : "Revenue by category",
      txDetails: locale === "ar" ? "تفاصيل المعاملات" : "Transaction details",
      noExpense:
        locale === "ar" ? "لا توجد مصروفات في هذه الفترة." : "No expenses in this period.",
      noIncome:
        locale === "ar" ? "لا توجد إيرادات في هذه الفترة." : "No revenue in this period.",
      noTx: locale === "ar" ? "لا توجد معاملات في هذه الفترة." : "No transactions in this period.",
      colDate: locale === "ar" ? "التاريخ" : "Date",
      colType: locale === "ar" ? "النوع" : "Type",
      colCat: locale === "ar" ? "الفئة" : "Category",
      colDesc: locale === "ar" ? "البيان" : "Description",
      colAmount: locale === "ar" ? "المبلغ" : "Amount",
      typeIncome: locale === "ar" ? "إيراد" : "Revenue",
      typeExpense: locale === "ar" ? "مصروف" : "Expense",
      insPositive: (n: number) =>
        locale === "ar" ? `وضعك المالي إيجابي. فائض قدره ${fmt(n)}.` : `Net positive. Surplus of ${fmt(n)}.`,
      insNegative: (n: number) =>
        locale === "ar"
          ? `المصروفات تتجاوز الإيرادات بـ ${fmt(n)}. راجع أكبر بنود الإنفاق.`
          : `Expenses exceed revenue by ${fmt(n)}. Review your largest spending lines.`,
      insTopCat: (name: string, pct: number) =>
        locale === "ar"
          ? `أكبر فئة إنفاق: ${name} (${pct}% من إجمالي المصروفات).`
          : `Top spending category: ${name} (${pct}% of total expenses).`,
      insCount: (n: number) =>
        locale === "ar" ? `سُجّلت ${n} معاملة خلال هذه الفترة.` : `${n} transactions recorded in this period.`,
      insMargin: (n: number) =>
        locale === "ar"
          ? `هامش الربح ${n}% — فوق المتوسط الموصى به.`
          : `Profit margin at ${n}% — above the recommended threshold.`,
      reportTitle: locale === "ar" ? "تقرير مالي — محاسب ذكي" : "Financial report — Smart Books",
      reportDate: locale === "ar" ? "تاريخ التقرير" : "Report date",
    }),
    [locale, fmt],
  )

  const PERIOD_OPTIONS: { key: Period; label: string }[] = [
    { key: "month", label: t.pMonth },
    { key: "3months", label: t.p3 },
    { key: "year", label: t.pYear },
    { key: "all", label: t.pAll },
  ]

  const VIEW_MODES: { key: ViewMode; label: string; icon: typeof LayoutDashboard }[] = [
    { key: "analytics", label: t.analytics, icon: LayoutDashboard },
    { key: "ifrs", label: t.ifrs, icon: FileText },
    { key: "trial-balance", label: t.trial, icon: Scale },
    { key: "balance-sheet", label: t.balance, icon: Building2 },
    { key: "analysis", label: t.analysis, icon: Sparkles },
  ]

  const range = useMemo(() => {
    const now = new Date()
    if (period === "month") return { start: startOfMonth(now), end: endOfMonth(now) }
    if (period === "3months") return { start: startOfMonth(subMonths(now, 2)), end: endOfMonth(now) }
    if (period === "year") return { start: startOfYear(now), end: endOfMonth(now) }
    return null
  }, [period])

  const filteredTx = useMemo(() => {
    if (!transactions) return []
    if (!range) return transactions
    return transactions.filter((tx) => {
      const d = new Date(tx.date || new Date())
      return isWithinInterval(d, range)
    })
  }, [transactions, range])

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    filteredTx.forEach((tx) => {
      const amt = Number(tx.amount)
      if (tx.type === "income") income += amt
      else expense += amt
    })
    return {
      income,
      expense,
      net: income - expense,
      savingsRate: income > 0 ? ((income - expense) / income) * 100 : 0,
      txCount: filteredTx.length,
    }
  }, [filteredTx])

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    filteredTx
      .filter((tx) => tx.type === "expense")
      .forEach((tx) => {
        const amt = Number(tx.amount)
        map.set(tx.category, (map.get(tx.category) || 0) + amt)
      })
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, percent: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value)
  }, [filteredTx])

  const incomeBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    filteredTx
      .filter((tx) => tx.type === "income")
      .forEach((tx) => {
        const amt = Number(tx.amount)
        map.set(tx.category, (map.get(tx.category) || 0) + amt)
      })
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, percent: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value)
  }, [filteredTx])

  const monthlyTrend = useMemo(() => {
    const incomeKey = locale === "ar" ? "إيراد" : "Income"
    const expenseKey = locale === "ar" ? "مصروف" : "Expense"
    if (!transactions) return { data: [], incomeKey, expenseKey }
    const now = new Date()
    const months: Array<Record<string, string | number>> = []
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(now, i)
      const start = startOfMonth(monthDate)
      const end = endOfMonth(monthDate)
      let income = 0
      let expense = 0
      transactions.forEach((tx) => {
        const d = new Date(tx.date || new Date())
        if (isWithinInterval(d, { start, end })) {
          const amt = Number(tx.amount)
          if (tx.type === "income") income += amt
          else expense += amt
        }
      })
      months.push({
        month: format(monthDate, "MMM", { locale: dfLocale }),
        [incomeKey]: income,
        [expenseKey]: expense,
      })
    }
    return { data: months, incomeKey, expenseKey }
  }, [transactions, dfLocale, locale])

  const handlePrint = () => window.print()

  const handleExportCSV = () => {
    const rows = [
      [t.colDate, t.colType, t.colCat, t.colDesc, t.colAmount],
      ...filteredTx.map((tx) => [
        format(new Date(tx.date || new Date()), "yyyy-MM-dd"),
        tx.type === "income" ? t.typeIncome : t.typeExpense,
        tx.category,
        tx.description,
        String(tx.amount),
      ]),
    ]
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${locale === "ar" ? "تقرير-مالي" : "report"}-${format(new Date(), "yyyy-MM-dd")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <CardGridSkeleton count={4} cols={4} height="h-28" />
        <CardGridSkeleton count={1} cols={1} height="h-80" />
      </div>
    )
  }

  return (
    <div
      className="space-y-8 animate-in fade-in-50 duration-300"
      id="report-content"
      data-testid="page-reports"
    >
      {/* Header */}
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between print:hidden">
        <div className="space-y-2">
          <div className="eyebrow text-muted-foreground/80">{t.eyebrow}</div>
          <h1
            className="font-display text-3xl md:text-4xl tracking-tight text-foreground"
            data-testid="text-page-title"
          >
            {t.title}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleExportCSV}
            className="gap-2"
            data-testid="button-export-csv"
          >
            <Download className="w-4 h-4" />
            {t.exportCsv}
          </Button>
          <Button onClick={handlePrint} className="gap-2" data-testid="button-print">
            <Printer className="w-4 h-4" />
            {t.print}
          </Button>
        </div>
      </header>

      {/* View mode + period — quiet segmented controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between print:hidden">
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <SegmentedControl
            options={VIEW_MODES}
            value={viewMode}
            onChange={setViewMode}
            testIdPrefix="button-view"
          />
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs uppercase tracking-wider text-muted-foreground/80 shrink-0">
            {t.period}
          </span>
          <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0 min-w-0">
            <SegmentedControl
              options={PERIOD_OPTIONS.map((p) => ({ key: p.key, label: p.label }))}
              value={period}
              onChange={setPeriod}
              testIdPrefix="button-period"
              compact
            />
          </div>
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
        <AnalyticsView
          totals={totals}
          categoryBreakdown={categoryBreakdown}
          incomeBreakdown={incomeBreakdown}
          monthlyTrend={monthlyTrend}
          filteredTx={filteredTx}
          fmt={fmt}
          dfLocale={dfLocale}
          t={t}
        />
      )}
    </div>
  )
}

// ---------- Segmented control ----------

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testIdPrefix,
  compact = false,
}: {
  options: Array<{ key: T; label: string; icon?: typeof LayoutDashboard }>
  value: T
  onChange: (v: T) => void
  testIdPrefix: string
  compact?: boolean
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card p-1"
    >
      {options.map((opt) => {
        const Icon = opt.icon
        const active = value === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            data-testid={`${testIdPrefix}-${opt.key}`}
            className={cn(
              "inline-flex items-center gap-2 rounded-md font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              compact ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- Analytics view ----------

function AnalyticsView({
  totals,
  categoryBreakdown,
  incomeBreakdown,
  monthlyTrend,
  filteredTx,
  fmt,
  dfLocale,
  t,
}: {
  totals: { income: number; expense: number; net: number; savingsRate: number; txCount: number }
  categoryBreakdown: { name: string; value: number; percent: number }[]
  incomeBreakdown: { name: string; value: number; percent: number }[]
  monthlyTrend: { data: Array<Record<string, string | number>>; incomeKey: string; expenseKey: string }
  filteredTx: any[]
  fmt: (n: number | string) => string
  dfLocale: typeof ar | typeof enUS
  t: any
}) {
  const showInsights = filteredTx.length > 0

  return (
    <div className="space-y-8">
      {/* Print-only header */}
      <div className="hidden print:block border-b pb-4">
        <h2 className="text-2xl font-bold">{t.reportTitle}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t.reportDate}: {format(new Date(), "d MMMM yyyy", { locale: dfLocale })}
        </p>
      </div>

      {/* KPI strip — Mercury style: only revenue gets color, expense neutral */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label={t.kpiIncome}
          value={fmt(totals.income)}
          accent="hsl(var(--chart-1))"
          testId="kpi-income"
        />
        <Stat
          label={t.kpiExpense}
          value={fmt(totals.expense)}
          accent="hsl(var(--muted-foreground))"
          testId="kpi-expense"
        />
        <Stat
          label={t.kpiNet}
          value={fmt(totals.net)}
          accent={totals.net >= 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-4))"}
          testId="kpi-net"
        />
        <Stat
          label={t.kpiSavings}
          value={`${totals.savingsRate.toFixed(1)}%`}
          accent={totals.savingsRate >= 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-4))"}
          testId="kpi-savings"
        />
      </div>

      {/* Smart summary */}
      {showInsights && (
        <Card className="rounded-xl">
          <div className="p-6 flex items-start gap-4">
            <div className="p-2 rounded-lg bg-muted/60 shrink-0">
              <Sparkles className="w-4 h-4 text-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                {t.insightsTitle}
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                    style={{
                      background:
                        totals.net >= 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-4))",
                    }}
                  />
                  <span className="text-foreground">
                    {totals.net >= 0
                      ? t.insPositive(totals.net)
                      : t.insNegative(Math.abs(totals.net))}
                  </span>
                </li>
                {categoryBreakdown[0] && (
                  <li className="flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: "hsl(var(--chart-3))" }}
                    />
                    <span>
                      {t.insTopCat(
                        categoryBreakdown[0].name,
                        Math.round(categoryBreakdown[0].percent),
                      )}
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ background: "hsl(var(--chart-5))" }}
                  />
                  <span>{t.insCount(totals.txCount)}</span>
                </li>
                {totals.savingsRate >= 20 && (
                  <li className="flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: "hsl(var(--chart-1))" }}
                    />
                    <span className="text-foreground">
                      {t.insMargin(Math.round(totals.savingsRate))}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Monthly trend */}
      <Card className="rounded-xl">
        <div className="p-6 pb-2">
          <h3 className="text-sm font-semibold text-foreground">{t.monthlyTrend}</h3>
        </div>
        <div className="px-2 pb-4 h-72 w-full" data-testid="chart-monthly-trend" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={monthlyTrend.data}
              margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-5))" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={(v) =>
                  Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(v))
                }
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                formatter={(v: number) => fmt(v)}
              />
              <Area
                type="monotone"
                dataKey={monthlyTrend.incomeKey}
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                fill="url(#incomeGrad)"
              />
              <Area
                type="monotone"
                dataKey={monthlyTrend.expenseKey}
                stroke="hsl(var(--chart-5))"
                strokeWidth={2}
                fill="url(#expenseGrad)"
                strokeDasharray="4 4"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-xl">
          <div className="p-6 pb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t.expensesByCat}</h3>
            <TrendingDown className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-2">
            {categoryBreakdown.length === 0 ? (
              <EmptyChart label={t.noExpense} />
            ) : (
              <>
                <div className="h-52 w-full" data-testid="chart-expense-categories" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={82}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                      >
                        {categoryBreakdown.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CHART_TOKENS[index % CHART_TOKENS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                        formatter={(v: number) => fmt(v)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <BreakdownList items={categoryBreakdown} fmt={fmt} testIdPrefix="row-expense-cat" />
              </>
            )}
          </div>
        </Card>

        <Card className="rounded-xl">
          <div className="p-6 pb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t.incomeByCat}</h3>
            <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--chart-1))" }} />
          </div>
          <div className="p-6 pt-2">
            {incomeBreakdown.length === 0 ? (
              <EmptyChart label={t.noIncome} />
            ) : (
              <>
                <div className="h-52 w-full" data-testid="chart-income-categories" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={incomeBreakdown}
                      layout="vertical"
                      margin={{ top: 5, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="2 4"
                        stroke="hsl(var(--border))"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) =>
                          Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(v))
                        }
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: "hsl(var(--foreground))", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        width={88}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                        formatter={(v: number) => fmt(v)}
                      />
                      <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <BreakdownList
                  items={incomeBreakdown}
                  fmt={fmt}
                  singleAccent="hsl(var(--chart-1))"
                  testIdPrefix="row-income-cat"
                />
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Detailed transactions table — ledger style */}
      <Card className="rounded-xl overflow-hidden">
        <div className="p-6 pb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {t.txDetails}{" "}
            <span className="text-muted-foreground font-normal">({filteredTx.length})</span>
          </h3>
        </div>
        {filteredTx.length === 0 ? (
          <div className="px-6 pb-12 text-center text-muted-foreground text-sm">
            <Inbox className="w-10 h-10 mx-auto mb-2 opacity-30" />
            {t.noTx}
          </div>
        ) : (
          <div className="overflow-x-auto table-sticky-first border-t border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground/80 bg-muted/30">
                  <th className="px-6 py-3 text-start font-medium">{t.colDate}</th>
                  <th className="px-6 py-3 text-start font-medium">{t.colType}</th>
                  <th className="px-6 py-3 text-start font-medium">{t.colCat}</th>
                  <th className="px-6 py-3 text-start font-medium">{t.colDesc}</th>
                  <th className="px-6 py-3 text-end font-medium">{t.colAmount}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredTx
                  .slice()
                  .sort(
                    (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
                  )
                  .map((tx) => (
                    <tr
                      key={tx.id}
                      data-testid={`row-report-tx-${tx.id}`}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-6 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {format(new Date(tx.date || new Date()), "d MMM yyyy", { locale: dfLocale })}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs",
                            tx.type === "income" ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background:
                                tx.type === "income"
                                  ? "hsl(var(--chart-1))"
                                  : "hsl(var(--chart-5))",
                            }}
                          />
                          {tx.type === "income" ? t.typeIncome : t.typeExpense}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-foreground/80">{tx.category}</td>
                      <td className="px-6 py-3 text-foreground">{tx.description}</td>
                      <td
                        className={cn(
                          "px-6 py-3 text-end tabular-nums font-display",
                          tx.type === "income" ? "" : "text-foreground",
                        )}
                        style={
                          tx.type === "income"
                            ? { color: "hsl(var(--chart-1))" }
                            : undefined
                        }
                      >
                        {tx.type === "income" ? "+" : "−"}
                        {fmt(Number(tx.amount))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- Stat ----------

function Stat({
  label,
  value,
  accent,
  testId,
}: {
  label: string
  value: string
  accent: string
  testId: string
}) {
  return (
    <Card
      className="rounded-xl p-5 hover:border-border transition-colors"
      data-testid={`card-${testId}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        <span className="text-xs uppercase tracking-wider text-muted-foreground/80">{label}</span>
      </div>
      <div
        className="font-display text-2xl lg:text-3xl tracking-tight tabular-nums text-foreground"
        data-testid={`text-${testId}`}
      >
        {value}
      </div>
    </Card>
  )
}

function BreakdownList({
  items,
  fmt,
  singleAccent,
  testIdPrefix,
}: {
  items: { name: string; value: number; percent: number }[]
  fmt: (n: number) => string
  singleAccent?: string
  testIdPrefix: string
}) {
  return (
    <div className="mt-5 space-y-3">
      {items.slice(0, 5).map((c, i) => {
        const color = singleAccent ?? CHART_TOKENS[i % CHART_TOKENS.length]
        return (
          <div key={c.name} className="space-y-1.5" data-testid={`${testIdPrefix}-${c.name}`}>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="font-medium text-foreground">{c.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {c.percent.toFixed(0)}%
                </span>
                <span className="font-display text-foreground tabular-nums">{fmt(c.value)}</span>
              </div>
            </div>
            <div className="h-1 bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, c.percent)}%`, background: color }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-52 flex flex-col items-center justify-center text-muted-foreground">
      <Inbox className="w-10 h-10 opacity-25 mb-2" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
