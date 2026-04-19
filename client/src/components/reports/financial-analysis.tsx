import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { buildIfrsStatement } from "@/lib/ifrs-classifier";
import type { Transaction } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Target,
  Loader2,
  Activity,
  Percent,
  Zap,
  Lightbulb,
} from "lucide-react";

interface AnalysisResult {
  healthScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: { title: string; detail: string; priority: "high" | "medium" | "low" }[];
  topAction: string;
}

interface Props {
  transactions: Transaction[];
  periodLabel: string;
}

export function FinancialAnalysis({ transactions, periodLabel }: Props) {
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const ratios = useMemo(() => {
    const stmt = buildIfrsStatement(transactions);
    const safeDiv = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

    // Top expense category
    let topCat = "—";
    let topAmt = 0;
    const opMap = new Map<string, number>();
    stmt.operatingExpenseItems.forEach((it) => opMap.set(it.category, it.amount));
    stmt.cogsItems.forEach((it) =>
      opMap.set(it.category, (opMap.get(it.category) || 0) + it.amount)
    );
    opMap.forEach((amt, cat) => {
      if (amt > topAmt) {
        topAmt = amt;
        topCat = cat;
      }
    });
    const totalOutflow = stmt.totalCogs + stmt.totalOperatingExpenses;

    return {
      stmt,
      grossMargin: safeDiv(stmt.grossProfit, stmt.totalRevenue),
      operatingMargin: safeDiv(
        stmt.totalRevenue - stmt.totalCogs - stmt.totalOperatingExpenses,
        stmt.totalRevenue
      ),
      netMargin: safeDiv(stmt.netProfit, stmt.totalRevenue),
      expenseRatio: safeDiv(totalOutflow, stmt.totalRevenue),
      topExpenseCategory: topCat,
      topExpenseShare: safeDiv(topAmt, totalOutflow),
      topExpenses: Array.from(opMap.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    };
  }, [transactions]);

  const mutation = useMutation<AnalysisResult, Error, void>({
    mutationFn: async () => {
      const payload = {
        period: periodLabel,
        totals: {
          revenue: ratios.stmt.totalRevenue,
          cogs: ratios.stmt.totalCogs,
          grossProfit: ratios.stmt.grossProfit,
          operatingExpenses: ratios.stmt.totalOperatingExpenses,
          netProfit: ratios.stmt.netProfit,
          txCount: transactions.length,
        },
        ratios: {
          grossMargin: Number(ratios.grossMargin.toFixed(2)),
          operatingMargin: Number(ratios.operatingMargin.toFixed(2)),
          netMargin: Number(ratios.netMargin.toFixed(2)),
          expenseRatio: Number(ratios.expenseRatio.toFixed(2)),
          topExpenseShare: Number(ratios.topExpenseShare.toFixed(2)),
          topExpenseCategory: ratios.topExpenseCategory,
        },
        topExpenses: ratios.topExpenses.map((e) => ({
          category: e.category,
          amount: Number(e.amount.toFixed(2)),
        })),
      };
      const res = await apiRequest("POST", "/api/analysis", payload);
      return (await res.json()) as AnalysisResult;
    },
    onSuccess: (data) => setResult(data),
  });

  const noData = transactions.length === 0;

  return (
    <div className="space-y-6">
      {/* Ratios grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <RatioCard
          icon={<Percent className="w-5 h-5" />}
          label="هامش الربح الإجمالي"
          value={ratios.grossMargin}
          benchmark={30}
          testId="ratio-gross-margin"
        />
        <RatioCard
          icon={<Activity className="w-5 h-5" />}
          label="هامش الربح التشغيلي"
          value={ratios.operatingMargin}
          benchmark={15}
          testId="ratio-operating-margin"
        />
        <RatioCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="هامش صافي الربح"
          value={ratios.netMargin}
          benchmark={10}
          testId="ratio-net-margin"
        />
        <RatioCard
          icon={<TrendingDown className="w-5 h-5" />}
          label="نسبة المصروفات"
          value={ratios.expenseRatio}
          benchmark={70}
          inverse
          testId="ratio-expense"
        />
      </div>

      {/* Trigger card */}
      <Card className="rounded-2xl border-none shadow-lg shadow-black/5 bg-gradient-to-l from-primary/10 via-card to-emerald-500/10 overflow-hidden">
        <CardContent className="p-6 lg:p-8">
          <div className="flex flex-col lg:flex-row items-start gap-6 justify-between">
            <div className="flex items-start gap-4 flex-1">
              <div className="p-3 bg-primary/15 rounded-2xl shrink-0">
                <Sparkles className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-foreground">
                  تحليل ذكي لأدائك المالي
                </h3>
                <p className="text-sm text-muted-foreground mt-2 font-medium leading-relaxed max-w-xl">
                  دع الذكاء الاصطناعي يحلل بياناتك ويخبرك بنقاط القوة والضعف ويقترح
                  قرارات عملية لتحسين أرباحك بناءً على المعايير المحاسبية الدولية.
                </p>
              </div>
            </div>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || noData}
              className="rounded-xl h-12 px-6 font-bold gap-2 bg-primary hover:bg-primary/90 text-base shrink-0"
              data-testid="button-generate-analysis"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري التحليل...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  {result ? "تحليل جديد" : "ابدأ التحليل"}
                </>
              )}
            </Button>
          </div>
          {noData && (
            <p
              className="text-sm text-muted-foreground mt-4 text-center font-medium"
              data-testid="text-no-data"
            >
              لا توجد معاملات في هذه الفترة لتحليلها.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Result */}
      {mutation.isError && (
        <Card className="rounded-2xl border-rose-200 bg-rose-50">
          <CardContent className="p-6 flex items-center gap-3 text-rose-700">
            <AlertCircle className="w-5 h-5" />
            <p className="font-bold">تعذر توليد التحليل. حاول مرة أخرى من فضلك.</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          {/* Health score + summary */}
          <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
            <CardContent className="p-6 lg:p-8">
              <div className="flex flex-col lg:flex-row items-center gap-8">
                <HealthGauge score={result.healthScore} />
                <div className="flex-1 space-y-3 text-center lg:text-right">
                  <h3 className="text-2xl font-extrabold text-foreground">
                    التقييم العام
                  </h3>
                  <p
                    className="text-base text-foreground/80 leading-relaxed font-medium"
                    data-testid="text-summary"
                  >
                    {result.summary}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top action */}
          <Card className="rounded-2xl border-none shadow-lg shadow-amber-200/30 bg-gradient-to-l from-amber-50 to-yellow-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-amber-200/60 rounded-2xl shrink-0">
                  <Target className="w-6 h-6 text-amber-700" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-700 uppercase tracking-wider">
                    الخطوة الأولى الموصى بها
                  </h4>
                  <p
                    className="text-lg font-extrabold text-amber-900 mt-1 leading-relaxed"
                    data-testid="text-top-action"
                  >
                    {result.topAction}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Strengths / Weaknesses */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ListCard
              title="نقاط القوة"
              items={result.strengths}
              icon={<CheckCircle2 className="w-5 h-5" />}
              accent="emerald"
              testId="list-strengths"
              emptyText="لم يتم تحديد نقاط قوة بعد."
            />
            <ListCard
              title="نقاط تحتاج تحسين"
              items={result.weaknesses}
              icon={<AlertCircle className="w-5 h-5" />}
              accent="rose"
              testId="list-weaknesses"
              emptyText="لا توجد ملاحظات سلبية."
            />
          </div>

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <Card className="rounded-2xl border-none shadow-lg shadow-black/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl font-bold">
                  <div className="p-2 bg-primary/10 rounded-xl">
                    <Lightbulb className="w-5 h-5 text-primary" />
                  </div>
                  التوصيات العملية
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.recommendations.map((r, i) => (
                  <RecommendationCard key={i} recommendation={r} index={i} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function RatioCard({
  icon,
  label,
  value,
  benchmark,
  inverse = false,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  benchmark: number;
  inverse?: boolean;
  testId: string;
}) {
  // For inverse metrics (like expense ratio), lower is better
  const isGood = inverse ? value <= benchmark : value >= benchmark;
  const isOk = inverse
    ? value <= benchmark * 1.2
    : value >= benchmark * 0.7;

  const tone = isGood
    ? "text-emerald-700 bg-emerald-100"
    : isOk
    ? "text-amber-700 bg-amber-100"
    : "text-rose-700 bg-rose-100";

  return (
    <Card
      className="rounded-2xl border-none shadow-md shadow-black/5 hover:shadow-lg transition-all"
      data-testid={`card-${testId}`}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-muted-foreground">{label}</span>
          <div className={`p-2 rounded-xl ${tone}`}>{icon}</div>
        </div>
        <div className="text-3xl font-black tabular-nums text-foreground" data-testid={`text-${testId}`}>
          {value.toFixed(1)}
          <span className="text-base font-bold opacity-70 mr-1">%</span>
        </div>
        <p className="text-xs text-muted-foreground font-medium mt-1">
          المعيار الصحي: {inverse ? "≤" : "≥"} {benchmark}%
        </p>
      </CardContent>
    </Card>
  );
}

function HealthGauge({ score }: { score: number }) {
  const angle = (score / 100) * 180;
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#f43f5e";
  const label = score >= 70 ? "ممتاز" : score >= 40 ? "متوسط" : "يحتاج انتباه";

  return (
    <div className="relative w-48 h-48 shrink-0" data-testid="gauge-health-score">
      <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
        <circle
          cx="100"
          cy="100"
          r="80"
          stroke="hsl(var(--muted))"
          strokeWidth="18"
          fill="none"
          opacity="0.3"
        />
        <circle
          cx="100"
          cy="100"
          r="80"
          stroke={color}
          strokeWidth="18"
          fill="none"
          strokeDasharray={`${(angle / 360) * 502.65} 502.65`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-black tabular-nums" style={{ color }}>
          {score}
        </div>
        <div className="text-xs text-muted-foreground font-bold mt-1">من 100</div>
        <div
          className="text-sm font-extrabold mt-2 px-3 py-1 rounded-full"
          style={{ background: `${color}20`, color }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

function ListCard({
  title,
  items,
  icon,
  accent,
  testId,
  emptyText,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
  accent: "emerald" | "rose";
  testId: string;
  emptyText: string;
}) {
  const colorMap = {
    emerald: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" },
    rose: { bg: "bg-rose-100", text: "text-rose-700", dot: "bg-rose-500" },
  };
  const c = colorMap[accent];
  return (
    <Card
      className="rounded-2xl border-none shadow-lg shadow-black/5"
      data-testid={`card-${testId}`}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg font-bold">
          <div className={`p-2 rounded-xl ${c.bg} ${c.text}`}>{icon}</div>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{emptyText}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((it, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm text-foreground/85 font-medium leading-relaxed"
                data-testid={`${testId}-item-${i}`}
              >
                <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${c.dot}`} />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationCard({
  recommendation,
  index,
}: {
  recommendation: { title: string; detail: string; priority: "high" | "medium" | "low" };
  index: number;
}) {
  const priorityMap = {
    high: { label: "أولوية عالية", color: "bg-rose-100 text-rose-700 border-rose-200" },
    medium: { label: "أولوية متوسطة", color: "bg-amber-100 text-amber-700 border-amber-200" },
    low: { label: "أولوية منخفضة", color: "bg-blue-100 text-blue-700 border-blue-200" },
  };
  const p = priorityMap[recommendation.priority];

  return (
    <div
      className="p-5 rounded-2xl bg-muted/30 border border-border/50 hover:border-primary/30 transition-all"
      data-testid={`recommendation-${index}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="font-extrabold text-foreground text-base">
          <span className="text-primary mr-1">#{index + 1}</span> {recommendation.title}
        </h4>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-md border ${p.color} shrink-0`}>
          {p.label}
        </span>
      </div>
      <p className="text-sm text-foreground/75 font-medium leading-relaxed">
        {recommendation.detail}
      </p>
    </div>
  );
}
