import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState as SharedErrorState } from "@/components/feedback/error-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Activity,
  AlertTriangle,
  TrendingUp,
  Calculator,
  Target,
  Receipt,
  Brain,
  CheckCircle2,
  AlertCircle,
  Info,
  Send,
  Wallet,
  Calendar,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Legend,
} from "recharts";

function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <SharedErrorState
      title="تعذّر تحميل البيانات"
      cause="حدث خطأ أثناء جلب هذا القسم. يمكنك المحاولة مرة أخرى."
      onRetry={onRetry}
    />
  );
}

const fmt = (n: number | undefined | null) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(Number(n || 0));
const fmtCurrency = (n: number) => `${fmt(n)} ر.س`;

type Health = {
  kpis: any;
  health: { score: number; components: { label: string; value: number; weight: number; explain: string }[] };
};

type Alert = {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  description: string;
  metric?: string;
};

const severityStyle: Record<Alert["severity"], { bg: string; border: string; icon: any; iconColor: string }> = {
  critical: { bg: "bg-destructive/10", border: "border-destructive/40", icon: AlertCircle, iconColor: "text-destructive" },
  warning:  { bg: "bg-orange-500/10", border: "border-orange-500/40", icon: AlertTriangle, iconColor: "text-orange-600 dark:text-orange-400" },
  info:     { bg: "bg-blue-500/10", border: "border-blue-500/40", icon: Info, iconColor: "text-blue-600 dark:text-blue-400" },
  success:  { bg: "bg-green-500/10", border: "border-green-500/40", icon: CheckCircle2, iconColor: "text-green-600 dark:text-green-400" },
};

export default function InsightsPage() {
  return (
    <div className="space-y-8" data-testid="page-insights">
      <header className="space-y-2">
        <div className="eyebrow text-muted-foreground/80">الذكاء</div>
        <h1
          className="font-display text-3xl md:text-4xl tracking-tight text-foreground"
          data-testid="text-page-title"
        >
          مركز القرارات
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          رؤى مالية لحظية تحوّل أرقامك إلى قرارات أفضل — صحة، إنذارات، توقعات، ومحاكاة.
        </p>
      </header>

      <Tabs defaultValue="cockpit" className="w-full">
        <div className="overflow-x-auto no-scrollbar">
          <TabsList className="ledger-tabs">
            <TabsTrigger value="cockpit" data-testid="tab-cockpit"><Activity   className="w-3.5 h-3.5 ms-1.5" />القيادة</TabsTrigger>
            <TabsTrigger value="alerts"  data-testid="tab-alerts"> <AlertTriangle className="w-3.5 h-3.5 ms-1.5" />الإنذارات</TabsTrigger>
            <TabsTrigger value="cash"    data-testid="tab-cash">   <TrendingUp className="w-3.5 h-3.5 ms-1.5" />تنبؤ النقد</TabsTrigger>
            <TabsTrigger value="sim"     data-testid="tab-sim">    <Calculator className="w-3.5 h-3.5 ms-1.5" />المحاكي</TabsTrigger>
            <TabsTrigger value="budget"  data-testid="tab-budget"> <Target     className="w-3.5 h-3.5 ms-1.5" />الميزانية</TabsTrigger>
            <TabsTrigger value="coach"   data-testid="tab-coach">  <Brain      className="w-3.5 h-3.5 ms-1.5" strokeWidth={1.75} />المستشار</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cockpit" className="mt-6"><CockpitTab /></TabsContent>
        <TabsContent value="alerts"  className="mt-6"><AlertsTab /></TabsContent>
        <TabsContent value="cash"    className="mt-6"><CashTab /></TabsContent>
        <TabsContent value="sim"     className="mt-6"><SimulatorTab /></TabsContent>
        <TabsContent value="budget"  className="mt-6"><BudgetTab /></TabsContent>
        <TabsContent value="coach"   className="mt-6"><CoachTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// 1) Cockpit (overview)
// ============================================================================
function CockpitTab() {
  const { data, isLoading, isError, refetch } = useQuery<Health>({ queryKey: ["/api/insights/health"] });
  const { data: taxes } = useQuery<any>({ queryKey: ["/api/insights/taxes"] });
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const k = data.kpis;
  const h = data.health;
  const scoreClamped = Math.max(0, Math.min(100, Number(h.score) || 0));
  const scoreToken =
    scoreClamped >= 75 ? "hsl(var(--chart-1))" : scoreClamped >= 50 ? "hsl(var(--chart-3))" : "hsl(var(--chart-4))";
  const scoreBadge = scoreClamped >= 75 ? "ممتاز" : scoreClamped >= 50 ? "متوسط" : "يحتاج اهتمام";

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-1 rounded-xl">
          <CardHeader>
            <div className="eyebrow text-muted-foreground/80">الصحة المالية</div>
            <CardTitle className="text-base font-semibold">تقييم شامل لوضعك</CardTitle>
            <CardDescription>من 100</CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-6">
            <div
              className="relative inline-flex items-center justify-center"
              role="progressbar"
              aria-valuenow={scoreClamped}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`مؤشر الصحة المالية: ${scoreClamped} من 100 — ${scoreBadge}`}
            >
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="hsl(var(--muted))"
                  strokeWidth="8"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke={scoreToken}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(scoreClamped / 100) * 326.7} 326.7`}
                  className="transition-all duration-700"
                />
              </svg>
              <div
                className="absolute font-display text-4xl tabular-nums tracking-tight"
                style={{ color: scoreToken }}
                data-testid="text-health-score"
              >
                {scoreClamped}
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: scoreToken }} />
              {scoreBadge}
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">مكوّنات النتيجة</CardTitle>
            <CardDescription>كل عامل ووزنه في النتيجة الإجمالية</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {h.components.map((c) => (
              <div key={c.label} data-testid={`row-component-${c.label}`}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{c.label} <span className="text-xs text-muted-foreground">({Math.round(c.weight * 100)}%)</span></span>
                  <span className="text-muted-foreground">{c.explain}</span>
                </div>
                <Progress value={c.value} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="الإيرادات" value={fmtCurrency(k.totalRevenue)} sub="إجمالي" />
        <KpiCard label="صافي الربح" value={fmtCurrency(k.netProfit)} sub={`هامش ${(k.netMargin * 100).toFixed(1)}%`} positive={k.netProfit >= 0} />
        <KpiCard label="النقد" value={fmtCurrency(k.cash)} sub="رصيد الصندوق" />
        <KpiCard label="حقوق الملكية" value={fmtCurrency(k.totalEquity)} sub={`أصول ${fmtCurrency(k.totalAssets)}`} />
        <KpiCard label="هامش الربح الإجمالي" value={`${(k.grossMargin * 100).toFixed(1)}%`} sub={`الحد الصحي > 30%`} />
        <KpiCard label="هامش الربح الصافي" value={`${(k.netMargin * 100).toFixed(1)}%`} sub="الحد الصحي > 10%" />
        <KpiCard label="نسبة المصروفات" value={`${(k.expenseRatio * 100).toFixed(0)}%`} sub="الحد الصحي < 70%" />
        <KpiCard label="النسبة الجارية" value={k.currentRatio.toFixed(2)} sub="السيولة الصحية > 1.5" />
      </div>

      {taxes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" />تقدير الضرائب والزكاة</CardTitle>
            <CardDescription>مؤشرات تخطيطية تساعدك على ادخار السيولة قبل الاستحقاق</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-muted-foreground text-sm">ضريبة القيمة المضافة (15%)</span>
                <span className="text-2xl font-bold" data-testid="text-vat">{fmtCurrency(taxes.vat.payable)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{taxes.vat.note}</p>
            </div>
            <div className="border rounded-xl p-4">
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-muted-foreground text-sm">الزكاة التقديرية (2.5%)</span>
                <span className="text-2xl font-bold" data-testid="text-zakat">{fmtCurrency(taxes.zakat.payable)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{taxes.zakat.note}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <Card data-testid={`card-kpi-${label}`}>
      <CardContent className="p-4">
        <div className="eyebrow mb-2">{label}</div>
        <div className={`font-display text-2xl font-semibold tabular-nums tracking-tight ${positive === false ? "text-loss" : "text-foreground"}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// 2) Alerts
// ============================================================================
function AlertsTab() {
  const { data, isLoading, isError, refetch } = useQuery<{ alerts: Alert[] }>({ queryKey: ["/api/insights/alerts"] });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  return (
    <div className="space-y-3">
      {data.alerts.map((a) => {
        const s = severityStyle[a.severity];
        const Icon = s.icon;
        return (
          <Card key={a.id} className={`${s.bg} ${s.border}`} data-testid={`alert-${a.id}`}>
            <CardContent className="p-4 flex gap-4">
              <Icon className={`w-6 h-6 shrink-0 mt-0.5 ${s.iconColor}`} />
              <div className="flex-1">
                <div className="flex flex-wrap justify-between gap-2 items-start">
                  <h3 className="font-bold">{a.title}</h3>
                  {a.metric && <Badge variant="outline" className="font-mono">{a.metric}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================================
// 3) Cash forecast
// ============================================================================
function CashTab() {
  const [days, setDays] = useState(90);
  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/insights/cash-forecast", days],
    queryFn: async () => fetch(`/api/insights/cash-forecast?days=${days}`).then((r) => r.json()),
  });
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const cushion = data.runwayDays;
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-4 gap-3">
        <KpiCard label="النقد الحالي" value={fmtCurrency(data.currentCash)} sub="رصيد الصندوق" />
        <KpiCard label="متوسط الدخل اليومي" value={fmtCurrency(data.avgDailyIn)} sub="آخر 90 يوم" />
        <KpiCard label="متوسط الصرف اليومي" value={fmtCurrency(data.avgDailyOut)} sub="آخر 90 يوم" />
        <KpiCard
          label="صافي يومي"
          value={fmtCurrency(data.avgDailyNet)}
          sub={cushion !== null ? `يكفي ${cushion} يوم` : data.avgDailyNet >= 0 ? "موجب — لا يوجد خطر نفاد" : "—"}
          positive={data.avgDailyNet >= 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            توقع رصيد النقد القادم
          </CardTitle>
          <CardDescription>إسقاط مبني على متوسط حركة آخر 90 يوم</CardDescription>
          <div className="flex gap-2 mt-2">
            {[30, 60, 90, 180].map((d) => (
              <Button key={d} variant={days === d ? "default" : "outline"} size="sm" onClick={() => setDays(d)} data-testid={`button-days-${d}`}>
                {d} يوم
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div dir="ltr" className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" tickFormatter={(v) => `${v}`} />
                <YAxis tickFormatter={(v) => fmt(v)} />
                <ReTooltip
                  formatter={(v: any) => fmtCurrency(v)}
                  labelFormatter={(l) => `بعد ${l} يوم`}
                />
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 4) What-If Simulator
// ============================================================================
function SimulatorTab() {
  const [priceChangePct, setPrice] = useState(0);
  const [costChangePct, setCost] = useState(0);
  const [newMonthlyExpense, setExp] = useState(0);
  const [expenseReductionPct, setRed] = useState(0);
  const [monthsAhead, setMonths] = useState(12);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();

  const sim = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/insights/simulate", {
        priceChangePct, costChangePct, newMonthlyExpense, expenseReductionPct, monthsAhead,
      }).then((r) => r.json()),
    onSuccess: (data) => setResult(data),
    onError: () => toast({ variant: "destructive", title: "تعذر تشغيل المحاكاة" }),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>المتغيرات</CardTitle>
          <CardDescription>عدّل القيم وشاهد التأثير على ربحيتك المتوقعة</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <SliderField label="تغيير الأسعار" value={priceChangePct} onChange={setPrice} min={-50} max={100} suffix="%" testid="slider-price" />
          <SliderField label="تغيير تكلفة المبيعات" value={costChangePct} onChange={setCost} min={-50} max={100} suffix="%" testid="slider-cost" />
          <SliderField label="تخفيض المصروفات التشغيلية" value={expenseReductionPct} onChange={setRed} min={0} max={80} suffix="%" testid="slider-reduction" />
          <div>
            <Label>مصروف ثابت شهري جديد (راتب موظف، إيجار…)</Label>
            <Input type="number" min={0} value={newMonthlyExpense} onChange={(e) => setExp(Number(e.target.value || 0))} className="mt-2" data-testid="input-new-expense" />
          </div>
          <div>
            <Label>عدد الأشهر القادمة</Label>
            <Input type="number" min={1} max={36} value={monthsAhead} onChange={(e) => setMonths(Number(e.target.value || 1))} className="mt-2" data-testid="input-months" />
          </div>
          <Button onClick={() => sim.mutate()} disabled={sim.isPending} className="w-full" data-testid="button-simulate">
            {sim.isPending ? "جارٍ الحساب..." : "شغّل المحاكاة"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>النتيجة</CardTitle>
          <CardDescription>مقارنة الوضع الحالي بالسيناريو المقترح</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <p className="text-muted-foreground text-center py-12">شغّل المحاكاة لرؤية النتائج</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="border rounded-lg p-3">
                  <div className="text-muted-foreground text-xs mb-1">الوضع الحالي / شهرياً</div>
                  <div>إيراد: {fmtCurrency(result.base.monthlyRevenue)}</div>
                  <div>مصروف: {fmtCurrency(result.base.monthlyExpense)}</div>
                  <div className="font-bold mt-1">ربح: {fmtCurrency(result.base.monthlyProfit)}</div>
                </div>
                <div className="border-2 border-primary rounded-lg p-3 bg-primary/5">
                  <div className="text-muted-foreground text-xs mb-1">السيناريو / شهرياً</div>
                  <div>إيراد: {fmtCurrency(result.scenario.monthlyRevenue)}</div>
                  <div>مصروف: {fmtCurrency(result.scenario.monthlyExpense)}</div>
                  <div className="font-bold mt-1">ربح: {fmtCurrency(result.scenario.monthlyProfit)}</div>
                </div>
              </div>
              <div className={`text-center p-3 rounded-lg font-bold ${result.scenario.profitDelta >= 0 ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive"}`} data-testid="text-profit-delta">
                {result.scenario.profitDelta >= 0 ? "+" : ""}{fmtCurrency(result.scenario.profitDelta)} شهرياً
                {" "}({result.scenario.profitDeltaPct >= 0 ? "+" : ""}{result.scenario.profitDeltaPct.toFixed(1)}%)
              </div>
              <div className="border-t pt-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">نقطة التعادل (إيراد شهري)</span><span className="font-bold">{fmtCurrency(result.breakEvenMonthlyRevenue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">هامش المساهمة</span><span className="font-bold">{(result.contributionMargin * 100).toFixed(1)}%</span></div>
              </div>
              <div dir="ltr" className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.series}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => fmt(v)} />
                    <ReTooltip formatter={(v: any) => fmtCurrency(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="cumCash" name="النقد المتراكم" stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line type="monotone" dataKey="profit" name="الربح الشهري" stroke="hsl(var(--chart-2))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, suffix, testid }: any) {
  return (
    <div>
      <div className="flex justify-between mb-2">
        <Label>{label}</Label>
        <span className="font-mono text-sm font-bold" data-testid={`${testid}-value`}>{value > 0 ? "+" : ""}{value}{suffix}</span>
      </div>
      <Slider value={[value]} onValueChange={(v) => onChange(v[0])} min={min} max={max} step={1} data-testid={testid} />
    </div>
  );
}

// ============================================================================
// 5) Budget vs Actual
// ============================================================================
function BudgetTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: bva, isLoading } = useQuery<{ rows: any[] }>({
    queryKey: ["/api/insights/budget-vs-actual", year, month],
    queryFn: async () => fetch(`/api/insights/budget-vs-actual?year=${year}&month=${month}`).then((r) => r.json()),
  });
  const { data: accounts } = useQuery<any[]>({ queryKey: ["/api/accounts"] });
  const { toast } = useToast();
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState("");

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/budgets", {
        accountId: Number(accountId), year, month, amount: Number(amount),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "تم حفظ الميزانية" });
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/insights/budget-vs-actual", year, month] });
    },
    onError: () => toast({ variant: "destructive", title: "فشل الحفظ" }),
  });

  const expenseAccounts = (accounts || []).filter((a: any) => !a.isHeader && (a.type === "expense" || a.type === "revenue"));
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" />الفترة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          <div>
            <Label>السنة</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28 mt-2" data-testid="input-year" />
          </div>
          <div>
            <Label>الشهر</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-32 mt-2" data-testid="select-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>إضافة / تعديل ميزانية</CardTitle>
          <CardDescription>حدّد سقف الإنفاق المخطط لكل بند هذا الشهر</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <Label>الحساب</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="mt-2" data-testid="select-account"><SelectValue placeholder="اختر حساباً" /></SelectTrigger>
              <SelectContent>
                {expenseAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>المبلغ المخطط (ر.س)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-2" data-testid="input-budget-amount" />
          </div>
          <Button onClick={() => save.mutate()} disabled={!accountId || !amount || save.isPending} data-testid="button-save-budget">
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المخطط مقابل الفعلي — {months[month - 1]} {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !bva?.rows.length ? (
            <p className="text-muted-foreground text-center py-8">لا توجد ميزانيات لهذا الشهر — أضف ميزانية أعلاه للبدء</p>
          ) : (
            <div className="space-y-3">
              {bva.rows.map((r) => {
                const variance = r.variance;
                const overBudget = r.type === "expense" ? variance > 0 : variance < 0;
                const pct = Math.min(100, Math.abs(r.budget > 0 ? (r.actual / r.budget) * 100 : 0));
                return (
                  <div key={r.accountId} data-testid={`row-budget-${r.accountId}`}>
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm mb-1">
                      <span className="font-medium">{r.code} — {r.nameAr}</span>
                      <span className={overBudget ? "text-destructive font-bold tabular-nums" : "text-green-600 dark:text-green-400 font-bold tabular-nums"}>
                        {fmtCurrency(r.actual)} / {fmtCurrency(r.budget)}
                        <span className="text-xs mr-2">({variance >= 0 ? "+" : ""}{r.variancePct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <Progress value={pct} className={`h-2 ${overBudget ? "[&>div]:bg-destructive" : ""}`} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 6) AI Coach
// ============================================================================
function CoachTab() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const { toast } = useToast();

  const ask = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/insights/ai-coach", { question }).then((r) => r.json()),
    onSuccess: (data) => {
      setHistory((h) => [{ q: question, a: data.answer }, ...h]);
      setQuestion("");
    },
    onError: () => toast({ variant: "destructive", title: "تعذر الحصول على إجابة" }),
  });

  const suggestions = [
    "هل أستطيع توظيف موظف جديد براتب 6000؟",
    "ما أكبر 3 مصاريف يجب أن أقلصها؟",
    "هل أنا في وضع صحي مالياً؟",
    "كم يجب أن أبيع شهرياً للوصول لربح 10,000؟",
  ];

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5 text-foreground/70" strokeWidth={1.75} />اسأل المستشار المالي</CardTitle>
          <CardDescription>سؤالك يُحلَّل بالاعتماد على أرقامك الفعلية اللحظية</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="اكتب سؤالك المالي هنا..."
            rows={3}
            data-testid="input-coach-question"
          />
          <Button onClick={() => ask.mutate()} disabled={!question.trim() || ask.isPending} className="w-full" data-testid="button-ask-coach">
            {ask.isPending ? <span>جارٍ التحليل…</span> : <><Send className="w-4 h-4 ml-2" />اسأل</>}
          </Button>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pt-2">
            {history.map((h, i) => (
              <div key={i} className="border rounded-xl p-4 bg-muted/30" data-testid={`coach-answer-${i}`}>
                <div className="text-sm font-bold mb-2 text-primary">س: {h.q}</div>
                <div className="text-sm whitespace-pre-line">{h.a}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">أسئلة مقترحة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {suggestions.map((s, i) => (
            <Button
              key={i}
              variant="outline"
              className="w-full text-right h-auto py-3 whitespace-normal text-sm justify-start"
              onClick={() => setQuestion(s)}
              data-testid={`button-suggestion-${i}`}
            >
              {s}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
