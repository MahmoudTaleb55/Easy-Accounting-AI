import { db } from "./db";
import { accounts, journalEntries, journalLines, transactions, budgets } from "@shared/schema";
import { eq, and, inArray, lte, gte, sql } from "drizzle-orm";

// All read functions in this module accept a `companyId` so insights are scoped
// to the active workspace. Callers must pass `req.membership.companyId`.

export interface AccountBalance {
  accountId: number;
  code: string;
  nameAr: string;
  type: string;
  subtype: string;
  balance: number;
}

export interface DateRange { start: Date; end: Date }

export async function computeBalances(companyId: number, range?: DateRange): Promise<AccountBalance[]> {
  const allAccounts = await db.select().from(accounts).where(eq(accounts.companyId, companyId));
  if (!allAccounts.length) return [];

  // Use SQL SUM+GROUP BY instead of fetching every row into memory.
  // For period scoping: P&L (revenue/expense) accounts sum lines within [start,end];
  // Balance-sheet accounts are cumulative as of `end`.
  let debitMap: Map<number, number>;
  let creditMap: Map<number, number>;

  if (range) {
    const startStr = range.start.toISOString().slice(0, 10);
    const endStr   = range.end.toISOString().slice(0, 10);

    const plIds = allAccounts.filter(a => a.type === "revenue" || a.type === "expense").map(a => a.id);
    const bsIds = allAccounts.filter(a => a.type !== "revenue" && a.type !== "expense").map(a => a.id);

    const aggQuery = (ids: number[], dateFrom?: string, dateTo?: string) =>
      ids.length === 0 ? Promise.resolve([] as { accountId: number; debit: string; credit: string }[]) :
      db.select({
        accountId: journalLines.accountId,
        debit:  sql<string>`COALESCE(SUM(${journalLines.debit}),  0)`,
        credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(
        eq(journalEntries.companyId, companyId),
        dateFrom ? gte(journalEntries.entryDate, dateFrom) : undefined,
        dateTo   ? lte(journalEntries.entryDate, dateTo)   : undefined,
        inArray(journalLines.accountId, ids),
      ))
      .groupBy(journalLines.accountId);

    const [plRows, bsRows] = await Promise.all([
      aggQuery(plIds, startStr, endStr),
      aggQuery(bsIds, undefined, endStr),
    ]);

    debitMap  = new Map();
    creditMap = new Map();
    for (const r of [...plRows, ...bsRows]) {
      debitMap.set(r.accountId,  Number(r.debit));
      creditMap.set(r.accountId, Number(r.credit));
    }
  } else {
    // No range — single aggregated query across all posted lines.
    const rows = await db.select({
      accountId: journalLines.accountId,
      debit:  sql<string>`COALESCE(SUM(${journalLines.debit}),  0)`,
      credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(eq(journalEntries.companyId, companyId))
    .groupBy(journalLines.accountId);

    debitMap  = new Map(rows.map(r => [r.accountId, Number(r.debit)]));
    creditMap = new Map(rows.map(r => [r.accountId, Number(r.credit)]));
  }

  return allAccounts
    .filter((a) => !a.isHeader)
    .map((a) => {
      const d = debitMap.get(a.id)  || 0;
      const c = creditMap.get(a.id) || 0;
      const isDebitNormal = a.type === "asset" || a.type === "expense";
      return {
        accountId: a.id,
        code: a.code,
        nameAr: a.nameAr,
        type: a.type,
        subtype: a.subtype,
        balance: isDebitNormal ? d - c : c - d,
      };
    });
}

export interface KPIs {
  totalRevenue: number;
  totalExpenses: number;
  totalCogs: number;
  totalOpEx: number;
  grossProfit: number;
  netProfit: number;
  totalAssets: number;
  totalCurrentAssets: number;
  totalLiabilities: number;
  totalCurrentLiabilities: number;
  totalEquity: number;
  cash: number;
  grossMargin: number;
  netMargin: number;
  operatingMargin: number;
  expenseRatio: number;
  currentRatio: number;
  quickRatio: number;
  debtToEquity: number;
}

export async function computeKPIs(companyId: number, range?: DateRange): Promise<KPIs> {
  const balances = await computeBalances(companyId, range);
  const sumWhere = (pred: (b: AccountBalance) => boolean) =>
    balances.filter(pred).reduce((s, b) => s + b.balance, 0);

  const totalRevenue = sumWhere((b) => b.type === "revenue");
  const totalCogs = sumWhere((b) => b.subtype === "cogs" || b.subtype === "contra_cogs");
  const totalOpEx = sumWhere((b) => b.subtype === "operating_expense");
  const totalExpenses = sumWhere((b) => b.type === "expense");
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = totalRevenue - totalExpenses;

  const totalCurrentAssets = sumWhere((b) => b.subtype === "current_asset");
  const totalNonCurrentAssets = sumWhere((b) => b.subtype === "non_current_asset" || b.subtype === "contra_asset");
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
  const totalCurrentLiabilities = sumWhere((b) => b.subtype === "current_liability");
  const totalNonCurrentLiabilities = sumWhere((b) => b.subtype === "non_current_liability");
  const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;
  const equityBase = sumWhere((b) => b.type === "equity");
  const totalEquity = equityBase + netProfit;
  const cash = balances.find((b) => b.code === "1110")?.balance ?? 0;
  const inventory = balances.find((b) => b.code === "1140")?.balance ?? 0;

  const safe = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    totalRevenue,
    totalExpenses,
    totalCogs,
    totalOpEx,
    grossProfit,
    netProfit,
    totalAssets,
    totalCurrentAssets,
    totalLiabilities,
    totalCurrentLiabilities,
    totalEquity,
    cash,
    grossMargin: safe(grossProfit, totalRevenue),
    netMargin: safe(netProfit, totalRevenue),
    operatingMargin: safe(totalRevenue - totalCogs - totalOpEx, totalRevenue),
    expenseRatio: safe(totalExpenses, totalRevenue),
    currentRatio: safe(totalCurrentAssets, totalCurrentLiabilities),
    quickRatio: safe(totalCurrentAssets - inventory, totalCurrentLiabilities),
    debtToEquity: safe(totalLiabilities, totalEquity || 1),
  };
}

// ============================================================================
// Health Score
// ============================================================================
export function computeHealthScore(k: KPIs): {
  score: number;
  components: { label: string; value: number; weight: number; explain: string }[];
} {
  const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

  const profitScore = k.totalRevenue > 0 ? clamp((k.netMargin / 0.15) * 100) : 0;
  const liquidityScore = k.totalCurrentLiabilities > 0
    ? clamp((k.currentRatio / 2) * 100)
    : k.totalCurrentAssets > 0 ? 100 : 0;
  const monthlyExp = k.totalExpenses / 3 || 1;
  const cashScore = clamp((k.cash / (monthlyExp * 3)) * 100);
  const disciplineScore = k.totalRevenue > 0 ? clamp(100 - (k.expenseRatio - 0.7) / 0.3 * 100) : 50;
  const solvencyScore = k.totalEquity > 0 ? clamp(100 - (k.debtToEquity / 3) * 100) : 0;

  const components = [
    { label: "الربحية",        value: profitScore,     weight: 0.30, explain: `هامش صافي ${(k.netMargin*100).toFixed(1)}%` },
    { label: "السيولة",        value: liquidityScore,  weight: 0.20, explain: `النسبة الجارية ${k.currentRatio.toFixed(2)}` },
    { label: "قوة النقد",      value: cashScore,       weight: 0.20, explain: `${k.cash.toFixed(0)} ر.س متوفر` },
    { label: "الانضباط",       value: disciplineScore, weight: 0.20, explain: `نسبة المصروفات ${(k.expenseRatio*100).toFixed(0)}%` },
    { label: "ملاءة مالية",    value: solvencyScore,   weight: 0.10, explain: `الدين/الملكية ${k.debtToEquity.toFixed(2)}` },
  ];
  const score = Math.round(components.reduce((s, c) => s + c.value * c.weight, 0));
  return { score, components };
}

// ============================================================================
// Cash Runway & Forecast
// ============================================================================
export async function computeCashFlow(companyId: number, daysBack = 90, range?: DateRange) {
  let days = Math.max(daysBack, 1);
  let recent: typeof transactions.$inferSelect[];

  if (range) {
    const startStr = range.start.toISOString().slice(0, 10);
    const endStr   = range.end.toISOString().slice(0, 10);
    days = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86400000) + 1);
    recent = await db.select().from(transactions).where(and(
      eq(transactions.companyId, companyId),
      gte(transactions.date, startStr),
      lte(transactions.date, endStr),
    ));
  } else {
    const cutoffStr = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
    recent = await db.select().from(transactions).where(and(
      eq(transactions.companyId, companyId),
      gte(transactions.date, cutoffStr),
    ));
  }

  const inflow  = recent.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const outflow = recent.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  return {
    avgDailyIn:  inflow  / days,
    avgDailyOut: outflow / days,
    avgDailyNet: (inflow - outflow) / days,
    totalIn:  inflow,
    totalOut: outflow,
    daysAnalyzed: days,
  };
}

// Pure sync helper — builds the cash projection from already-fetched KPIs and flow data.
// Extracted so that generateAlerts can reuse it without re-running computeKPIs.
function _buildCashProjectionSync(
  k: KPIs,
  flow: Awaited<ReturnType<typeof computeCashFlow>>,
  daysAhead: number,
) {
  const cash = k.cash;
  const series: { day: number; date: string; balance: number }[] = [];
  for (let d = 0; d <= daysAhead; d += 1) {
    const balance = cash + flow.avgDailyNet * d;
    series.push({
      day: d,
      date: new Date(Date.now() + d * 86400000).toISOString().slice(0, 10),
      balance: Math.round(balance * 100) / 100,
    });
  }
  let runwayDays: number | null = null;
  if (flow.avgDailyNet < 0 && cash > 0) {
    runwayDays = Math.floor(cash / Math.abs(flow.avgDailyNet));
  }
  return {
    currentCash: cash,
    avgDailyNet: flow.avgDailyNet,
    avgDailyIn:  flow.avgDailyIn,
    avgDailyOut: flow.avgDailyOut,
    runwayDays,
    series,
  };
}

export async function projectCash(companyId: number, daysAhead = 90, range?: DateRange) {
  // Run KPIs and cash-flow in parallel — previously sequential.
  const [k, flow] = await Promise.all([
    computeKPIs(companyId, range),
    computeCashFlow(companyId, 90, range),
  ]);
  return _buildCashProjectionSync(k, flow, daysAhead);
}

// ============================================================================
// Proactive Alerts
// ============================================================================
export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  description: string;
  metric?: string;
  category?: string;
}

export async function generateAlerts(companyId: number, range?: DateRange): Promise<Alert[]> {
  const alerts: Alert[] = [];
  // Run the three expensive fetches in parallel.
  // Previously this was sequential AND computeKPIs was called twice
  // (once directly + once inside projectCash → computeKPIs again).
  const [k, flow, txs] = await Promise.all([
    computeKPIs(companyId, range),
    computeCashFlow(companyId, 90, range),
    db.select().from(transactions).where(eq(transactions.companyId, companyId)),
  ]);
  const cash = _buildCashProjectionSync(k, flow, 90);

  if (cash.runwayDays !== null) {
    if (cash.runwayDays < 30) {
      alerts.push({
        id: "runway-critical",
        severity: "critical",
        title: "خطر سيولة عاجل ⚠️",
        description: `النقد المتوفر يكفي لـ ${cash.runwayDays} يوم فقط بمعدل الصرف الحالي. اتخذ إجراء فوراً (تقليل المصروفات / تسريع التحصيل).`,
        metric: `${cash.runwayDays} يوم`,
      });
    } else if (cash.runwayDays < 90) {
      alerts.push({
        id: "runway-warning",
        severity: "warning",
        title: "السيولة تتقلص",
        description: `النقد المتوفر يكفي لـ ${cash.runwayDays} يوم فقط. ابدأ التخطيط لتحسين التدفق النقدي.`,
        metric: `${cash.runwayDays} يوم`,
      });
    }
  }

  if (k.totalRevenue > 0 && k.expenseRatio > 0.9) {
    alerts.push({
      id: "expense-ratio-high",
      severity: k.expenseRatio > 1 ? "critical" : "warning",
      title: k.expenseRatio > 1 ? "أنت تخسر — المصروفات أكبر من الإيرادات" : "المصروفات قاربت الإيرادات",
      description: `نسبة المصروفات ${(k.expenseRatio * 100).toFixed(0)}% من الإيرادات. الهدف الصحي تحت 70%.`,
      metric: `${(k.expenseRatio * 100).toFixed(0)}%`,
    });
  }

  if (k.netProfit < 0) {
    alerts.push({
      id: "net-loss",
      severity: "warning",
      title: "صافي خسارة في الفترة",
      description: `الفترة الحالية تظهر خسارة صافية ${Math.abs(k.netProfit).toFixed(0)} ر.س. راجع أكبر المصروفات.`,
      metric: `${k.netProfit.toFixed(0)} ر.س`,
    });
  }

  const now = Date.now();
  const last30 = txs.filter(
    (t) => t.type === "expense" && new Date(t.date || 0).getTime() >= now - 30 * 86400000
  );
  const prev60_120 = txs.filter((t) => {
    const d = new Date(t.date || 0).getTime();
    return t.type === "expense" && d >= now - 120 * 86400000 && d < now - 30 * 86400000;
  });
  const sumByCat = (arr: typeof txs) =>
    arr.reduce<Record<string, number>>((m, t) => {
      m[t.category] = (m[t.category] || 0) + Number(t.amount);
      return m;
    }, {});
  const recentByCat = sumByCat(last30);
  const prevByCat = sumByCat(prev60_120);
  for (const [cat, recent] of Object.entries(recentByCat)) {
    const prevAvg = (prevByCat[cat] || 0) / 3;
    if (prevAvg > 50 && recent > prevAvg * 1.5) {
      alerts.push({
        id: `anomaly-${cat}`,
        severity: "warning",
        title: `زيادة غير معتادة في "${cat}"`,
        description: `صرفت ${recent.toFixed(0)} ر.س على ${cat} هذا الشهر، مقارنة بـ ${prevAvg.toFixed(0)} ر.س متوسط شهري سابق (+${(((recent / prevAvg) - 1) * 100).toFixed(0)}%).`,
        category: cat,
        metric: `+${(((recent / prevAvg) - 1) * 100).toFixed(0)}%`,
      });
    }
  }

  const last30Income = txs
    .filter((t) => t.type === "income" && new Date(t.date || 0).getTime() >= now - 30 * 86400000)
    .reduce((s, t) => s + Number(t.amount), 0);
  const prev30Income = txs
    .filter((t) => {
      const d = new Date(t.date || 0).getTime();
      return t.type === "income" && d >= now - 60 * 86400000 && d < now - 30 * 86400000;
    })
    .reduce((s, t) => s + Number(t.amount), 0);
  if (prev30Income > 0 && last30Income < prev30Income * 0.75) {
    alerts.push({
      id: "revenue-drop",
      severity: "warning",
      title: "انخفاض في الإيرادات",
      description: `إيرادات آخر 30 يوم ${last30Income.toFixed(0)} ر.س، مقارنة بـ ${prev30Income.toFixed(0)} ر.س للشهر السابق (${(((last30Income / prev30Income) - 1) * 100).toFixed(0)}%).`,
      metric: `${(((last30Income / prev30Income) - 1) * 100).toFixed(0)}%`,
    });
  }

  const expenseTxs = txs.filter((t) => t.type === "expense");
  if (expenseTxs.length > 5) {
    const amounts = expenseTxs.map((t) => Number(t.amount));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const std = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length);
    const recent = expenseTxs.filter((t) => new Date(t.date || 0).getTime() >= now - 30 * 86400000);
    for (const t of recent) {
      if (Number(t.amount) > mean + 3 * std && Number(t.amount) > 500) {
        alerts.push({
          id: `outlier-${t.id}`,
          severity: "info",
          title: `صرف غير عادي`,
          description: `${Number(t.amount).toFixed(0)} ر.س على "${t.description}" — أكبر بكثير من متوسط مصاريفك (${mean.toFixed(0)} ر.س).`,
          metric: `${Number(t.amount).toFixed(0)} ر.س`,
        });
        break;
      }
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "all-good",
      severity: "success",
      title: "كل شيء يبدو جيداً ✨",
      description: "لا توجد إنذارات في الوقت الحالي. استمر في متابعة أرقامك بانتظام.",
    });
  }

  return alerts;
}

// ============================================================================
// What-If Simulator
// ============================================================================
export interface ScenarioInput {
  priceChangePct: number;
  costChangePct: number;
  newMonthlyExpense: number;
  expenseReductionPct: number;
  monthsAhead: number;
}

export async function simulateScenario(companyId: number, input: ScenarioInput, range?: DateRange) {
  const k = await computeKPIs(companyId, range);
  const flow = await computeCashFlow(companyId, 90, range);
  const monthlyRevenue = flow.avgDailyIn * 30;
  const monthlyExpense = flow.avgDailyOut * 30;
  const cogsRatio = k.totalExpenses > 0 ? k.totalCogs / k.totalExpenses : 0;
  const monthlyCogs = monthlyExpense * cogsRatio;
  const monthlyOpEx = monthlyExpense - monthlyCogs;

  const newRevenue = monthlyRevenue * (1 + input.priceChangePct / 100);
  const newCogs = monthlyCogs * (1 + input.costChangePct / 100);
  const newOpEx = monthlyOpEx * (1 - input.expenseReductionPct / 100) + input.newMonthlyExpense;
  const newProfit = newRevenue - newCogs - newOpEx;
  const baseProfit = monthlyRevenue - monthlyExpense;

  const series: { month: number; revenue: number; expenses: number; profit: number; cumCash: number }[] = [];
  let cumCash = k.cash;
  for (let m = 1; m <= input.monthsAhead; m += 1) {
    cumCash += newProfit;
    series.push({
      month: m,
      revenue: Math.round(newRevenue),
      expenses: Math.round(newCogs + newOpEx),
      profit: Math.round(newProfit),
      cumCash: Math.round(cumCash),
    });
  }

  const contributionMargin = newRevenue > 0 ? (newRevenue - newCogs) / newRevenue : 0;
  const breakEvenRevenue = contributionMargin > 0 ? newOpEx / contributionMargin : 0;

  return {
    base: {
      monthlyRevenue: Math.round(monthlyRevenue),
      monthlyExpense: Math.round(monthlyExpense),
      monthlyProfit: Math.round(baseProfit),
    },
    scenario: {
      monthlyRevenue: Math.round(newRevenue),
      monthlyExpense: Math.round(newCogs + newOpEx),
      monthlyProfit: Math.round(newProfit),
      profitDelta: Math.round(newProfit - baseProfit),
      profitDeltaPct: baseProfit !== 0 ? ((newProfit - baseProfit) / Math.abs(baseProfit)) * 100 : 0,
    },
    breakEvenMonthlyRevenue: Math.round(breakEvenRevenue),
    contributionMargin,
    series,
  };
}

// ============================================================================
// Tax & Zakat Estimates (simplified — Saudi context)
// ============================================================================
export async function estimateTaxes(companyId: number, range?: DateRange) {
  const { storage } = await import("./storage");
  const settings = await storage.getSettings(companyId);
  const vatRate = Number(settings.vatRate);
  const zakatEnabled = settings.zakatEnabled;

  const k = await computeKPIs(companyId, range);
  const vatBase = Math.max(0, k.totalRevenue - k.totalCogs);
  const vatPayable = vatBase * vatRate;

  const zakatBase = Math.max(0, k.totalCurrentAssets - k.totalCurrentLiabilities);
  const zakatEstimate = zakatBase * 0.025;

  return {
    vat: {
      baseAmount: Math.round(vatBase * 100) / 100,
      rate: vatRate,
      payable: Math.round(vatPayable * 100) / 100,
      enabled: vatRate > 0,
      note: vatRate > 0
        ? `تقدير مبسط: ${(vatRate * 100).toFixed(1)}% × (الإيرادات - تكلفة المبيعات).`
        : "ضريبة القيمة المضافة معطّلة في الإعدادات (المعدل = 0%).",
    },
    zakat: {
      baseAmount: Math.round(zakatBase * 100) / 100,
      rate: 0.025,
      payable: Math.round(zakatEstimate * 100) / 100,
      enabled: zakatEnabled,
      note: zakatEnabled
        ? "تقدير مبسط: 2.5% × (الأصول المتداولة - الخصوم المتداولة). الزكاة الشرعية تحتاج تقييماً متخصصاً."
        : "الزكاة معطّلة في الإعدادات.",
    },
  };
}

// ============================================================================
// Budget vs Actual
// ============================================================================
export async function budgetVsActual(companyId: number, year: number, month: number) {
  const allBudgets = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.companyId, companyId), eq(budgets.year, year), eq(budgets.month, month)));

  const allAccounts = await db.select().from(accounts).where(eq(accounts.companyId, companyId));
  const accountById = new Map(allAccounts.map((a) => [a.id, a]));

  const entries = await db.select().from(journalEntries).where(eq(journalEntries.companyId, companyId));
  const entryIds = entries.map((e) => e.id);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const lines = entryIds.length
    ? await db.select().from(journalLines).where(inArray(journalLines.journalEntryId, entryIds))
    : [];

  const actualMap = new Map<number, number>();
  for (const l of lines) {
    const e = entryById.get(l.journalEntryId);
    if (!e) continue;
    const d = new Date(e.entryDate);
    if (d.getFullYear() === year && d.getMonth() + 1 === month) {
      const acc = accountById.get(l.accountId);
      if (!acc) continue;
      const isDebitNormal = acc.type === "asset" || acc.type === "expense";
      const delta = isDebitNormal
        ? Number(l.debit || 0) - Number(l.credit || 0)
        : Number(l.credit || 0) - Number(l.debit || 0);
      actualMap.set(l.accountId, (actualMap.get(l.accountId) || 0) + delta);
    }
  }

  return allBudgets
    .map((b) => {
      const acc = accountById.get(b.accountId);
      const actual = actualMap.get(b.accountId) || 0;
      const budget = Number(b.amount);
      return {
        accountId: b.accountId,
        code: acc?.code || "",
        nameAr: acc?.nameAr || "",
        type: acc?.type || "",
        budget,
        actual,
        variance: actual - budget,
        variancePct: budget > 0 ? ((actual - budget) / budget) * 100 : 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
