import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "./db";
import { assetComponents, type AssetComponent } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { PeriodKey } from "./fixed-assets";

// Using the OpenAI integration blueprint
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Transactions
  app.get(api.transactions.list.path, async (req, res) => {
    const allTransactions = await storage.getTransactions();
    res.json(allTransactions);
  });

  app.post(api.transactions.create.path, async (req, res) => {
    try {
      const input = api.transactions.create.input.parse(req.body);
      const transaction = await storage.createTransaction(input);
      res.status(201).json(transaction);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.transactions.delete.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    await storage.deleteTransaction(id);
    res.status(204).send();
  });

  app.get(api.transactions.summary.path, async (req, res) => {
    const allTransactions = await storage.getTransactions();
    let totalIncome = 0;
    let totalExpense = 0;
    
    allTransactions.forEach(tx => {
      const amount = parseFloat(tx.amount.toString());
      if (tx.type === "income") {
        totalIncome += amount;
      } else if (tx.type === "expense") {
        totalExpense += amount;
      }
    });

    res.json({
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense
    });
  });

  // Financial analysis (AI-powered recommendations)
  app.post(api.analysis.generate.path, async (req, res) => {
    try {
      const input = api.analysis.generate.input.parse(req.body);

      const systemPrompt = `أنت مستشار مالي خبير ومدرّب على المعايير الدولية لإعداد التقارير المالية (IFRS) وتحليل أداء المنشآت الصغيرة والمتوسطة. تتحدث العربية الفصحى البسيطة الواضحة. هدفك تقديم تحليل عملي قابل للتنفيذ يساعد صاحب العمل على اتخاذ قرارات أفضل.

ستصلك بيانات مالية موجزة بصيغة JSON. حلّلها وأعد ردّك **فقط** بصيغة JSON صالحة (بدون أي نص قبله أو بعده) بالشكل التالي تماماً:

{
  "healthScore": <عدد صحيح من 0 إلى 100 يعكس صحة الوضع المالي>,
  "summary": "<جملتان أو ثلاث تلخص الوضع العام بصراحة ومهنية>",
  "strengths": ["<نقطة قوة محددة مرتبطة بالأرقام>", ...],
  "weaknesses": ["<نقطة ضعف محددة مرتبطة بالأرقام>", ...],
  "recommendations": [
    { "title": "<عنوان قصير للتوصية>", "detail": "<شرح التوصية وكيفية تنفيذها>", "priority": "high" | "medium" | "low" },
    ...
  ],
  "topAction": "<أهم خطوة واحدة يجب اتخاذها فوراً، جملة واحدة محفّزة وعملية>"
}

قواعد:
- استخدم النسب المئوية والأرقام الفعلية في تحليلك (مثال: "هامش الربح الإجمالي 23% أقل من المعدل الصحي 30%").
- 3 إلى 5 توصيات كحد أقصى، مرتبة حسب الأولوية.
- لا تستخدم لغة جامدة ولا مصطلحات مبهمة، اشرح كأنك تتحدث لصاحب محل صغير.
- إذا كانت الأرقام إيجابية جداً، احتفل بذلك ولكن قدّم اقتراحات للنمو.
- إذا كانت الأرقام سلبية، كن صريحاً ولكن داعماً واقترح خطوات إنقاذ ملموسة.`;

      const userPayload = JSON.stringify(input, null, 2);

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `حلّل البيانات التالية وأعد ردّك بصيغة JSON فقط:\n${userPayload}` },
        ],
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(200).json({
          healthScore: 50,
          summary: "تعذر توليد تحليل مفصل، حاول مرة أخرى.",
          strengths: [],
          weaknesses: [],
          recommendations: [],
          topAction: "أعد المحاولة بعد قليل.",
        });
      }

      // Validate & clamp the AI output
      const result = {
        healthScore: Math.max(0, Math.min(100, Number(parsed.healthScore) || 50)),
        summary: String(parsed.summary || "").slice(0, 800),
        strengths: Array.isArray(parsed.strengths)
          ? parsed.strengths.slice(0, 8).map((s: any) => String(s).slice(0, 300))
          : [],
        weaknesses: Array.isArray(parsed.weaknesses)
          ? parsed.weaknesses.slice(0, 8).map((s: any) => String(s).slice(0, 300))
          : [],
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations.slice(0, 6).map((r: any) => ({
              title: String(r?.title || "توصية").slice(0, 120),
              detail: String(r?.detail || "").slice(0, 600),
              priority: ["high", "medium", "low"].includes(r?.priority) ? r.priority : "medium",
            }))
          : [],
        topAction: String(parsed.topAction || "راجع نتائجك المالية بشكل دوري.").slice(0, 300),
      };

      res.json(result);
    } catch (err) {
      console.error("Analysis error", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "حدث خطأ في توليد التحليل" });
    }
  });

  // ----- Chart of Accounts -----
  app.get(api.accounts.list.path, async (_req, res) => {
    const list = await storage.getAccounts();
    res.json(list);
  });

  app.post(api.accounts.create.path, async (req, res) => {
    try {
      const input = api.accounts.create.input.parse(req.body);
      const created = await storage.createAccount(input);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "تعذّر إنشاء الحساب" });
    }
  });

  // ----- Journal Entries -----
  app.get(api.journal.list.path, async (_req, res) => {
    const entries = await storage.getJournalEntries();
    res.json(entries);
  });

  app.post(api.journal.create.path, async (req, res) => {
    try {
      const input = api.journal.create.input.parse(req.body);
      const created = await storage.createJournalEntry(input);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      console.error("Journal create error", err);
      res.status(500).json({ message: "تعذّر إنشاء القيد" });
    }
  });

  app.delete(api.journal.delete.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    await storage.deleteJournalEntry(id);
    res.status(204).send();
  });

  // ----- Reports: Trial Balance -----
  app.get(api.reports.trialBalance.path, async (_req, res) => {
    const allAccounts = await storage.getAccounts();
    const entries = await storage.getJournalEntries();
    const debitMap = new Map<number, number>();
    const creditMap = new Map<number, number>();
    entries.forEach((je) =>
      je.lines.forEach((l) => {
        debitMap.set(l.accountId, (debitMap.get(l.accountId) || 0) + Number(l.debit || 0));
        creditMap.set(l.accountId, (creditMap.get(l.accountId) || 0) + Number(l.credit || 0));
      })
    );
    const rows = allAccounts
      .filter((a) => !a.isHeader)
      .map((a) => {
        const debit = debitMap.get(a.id) || 0;
        const credit = creditMap.get(a.id) || 0;
        // For asset/expense → balance = debit - credit; liability/equity/revenue → credit - debit
        const isDebitNormal = a.type === "asset" || a.type === "expense";
        const balance = isDebitNormal ? debit - credit : credit - debit;
        return {
          accountId: a.id,
          code: a.code,
          nameAr: a.nameAr,
          type: a.type,
          debit,
          credit,
          balance,
        };
      })
      .filter((r) => r.debit !== 0 || r.credit !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    res.json({ rows, totalDebit, totalCredit });
  });

  // ----- Reports: Balance Sheet -----
  app.get(api.reports.balanceSheet.path, async (_req, res) => {
    const allAccounts = await storage.getAccounts();
    const entries = await storage.getJournalEntries();
    const debitMap = new Map<number, number>();
    const creditMap = new Map<number, number>();
    entries.forEach((je) =>
      je.lines.forEach((l) => {
        debitMap.set(l.accountId, (debitMap.get(l.accountId) || 0) + Number(l.debit || 0));
        creditMap.set(l.accountId, (creditMap.get(l.accountId) || 0) + Number(l.credit || 0));
      })
    );

    const balanceFor = (a: typeof allAccounts[number]) => {
      const debit = debitMap.get(a.id) || 0;
      const credit = creditMap.get(a.id) || 0;
      const isDebitNormal = a.type === "asset" || a.type === "expense";
      return isDebitNormal ? debit - credit : credit - debit;
    };

    const items = (predicate: (a: typeof allAccounts[number]) => boolean) =>
      allAccounts
        .filter((a) => !a.isHeader && predicate(a))
        .map((a) => ({ code: a.code, nameAr: a.nameAr, balance: balanceFor(a) }))
        .filter((i) => i.balance !== 0)
        .sort((a, b) => a.code.localeCompare(b.code));

    const currentAssets = items((a) => a.subtype === "current_asset");
    const nonCurrentAssets = items((a) => a.subtype === "non_current_asset" || a.subtype === "contra_asset");
    const currentLiabilities = items((a) => a.subtype === "current_liability");
    const nonCurrentLiabilities = items((a) => a.subtype === "non_current_liability");
    const equityItems = items((a) => a.type === "equity");

    // Compute net income from period to add to equity
    const totalRevenue = allAccounts
      .filter((a) => a.type === "revenue")
      .reduce((s, a) => s + balanceFor(a), 0);
    const totalExpenses = allAccounts
      .filter((a) => a.type === "expense")
      .reduce((s, a) => s + balanceFor(a), 0);
    const netIncome = totalRevenue - totalExpenses;

    const totalCurrentAssets = currentAssets.reduce((s, x) => s + x.balance, 0);
    const totalNonCurrentAssets = nonCurrentAssets.reduce((s, x) => s + x.balance, 0);
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
    const totalCurrentLiabilities = currentLiabilities.reduce((s, x) => s + x.balance, 0);
    const totalNonCurrentLiabilities = nonCurrentLiabilities.reduce((s, x) => s + x.balance, 0);
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;
    const totalEquityBeforeIncome = equityItems.reduce((s, x) => s + x.balance, 0);
    const totalEquity = totalEquityBeforeIncome + netIncome;

    res.json({
      asOf: new Date().toISOString(),
      assets: {
        current: currentAssets,
        nonCurrent: nonCurrentAssets,
        totalCurrent: totalCurrentAssets,
        totalNonCurrent: totalNonCurrentAssets,
        total: totalAssets,
      },
      liabilities: {
        current: currentLiabilities,
        nonCurrent: nonCurrentLiabilities,
        totalCurrent: totalCurrentLiabilities,
        totalNonCurrent: totalNonCurrentLiabilities,
        total: totalLiabilities,
      },
      equity: {
        items: equityItems,
        netIncome,
        total: totalEquity,
      },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    });
  });

  // ============================================================================
  // Settings (singleton org settings)
  // ============================================================================
  app.get("/api/settings", async (_req, res) => {
    res.json(await storage.getSettings());
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const { upsertSettingsSchema } = await import("@shared/schema");
      const input = upsertSettingsSchema.parse(req.body);
      const updated = await storage.updateSettings(input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الإعدادات" });
    }
  });

  app.get("/api/localization/packs", async (_req, res) => {
    const { LOCALIZATION_PACKS } = await import("@shared/localization");
    res.json(Object.values(LOCALIZATION_PACKS));
  });

  // ============================================================================
  // HR — Employees, Attendance, Leaves, Payroll
  // ============================================================================
  const { insertEmployeeSchema, insertAttendanceSchema, insertLeaveSchema } = await import("@shared/schema");

  app.get("/api/hr/employees", async (_req, res) => res.json(await storage.getEmployees()));
  app.post("/api/hr/employees", async (req, res) => {
    try {
      const input = insertEmployeeSchema.parse(req.body);
      res.status(201).json(await storage.createEmployee(input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الموظف" });
    }
  });
  app.patch("/api/hr/employees/:id", async (req, res) => {
    try {
      const input = insertEmployeeSchema.partial().parse(req.body);
      res.json(await storage.updateEmployee(Number(req.params.id), input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر التحديث" });
    }
  });
  app.delete("/api/hr/employees/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Prevent deletion if linked payroll history exists
      const { db } = await import("./db");
      const { payrollLines } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const existing = await db.select().from(payrollLines).where(eq(payrollLines.employeeId, id)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({
          message: "لا يمكن حذف الموظف لأنه مرتبط بكشوف رواتب سابقة. يمكنك تعطيله بدلاً من ذلك.",
        });
      }
      await storage.deleteEmployee(id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "تعذر الحذف" });
    }
  });

  app.get("/api/hr/attendance", async (req, res) => {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const yearMonth = req.query.yearMonth as string | undefined;
    res.json(await storage.getAttendance(employeeId, yearMonth));
  });
  app.post("/api/hr/attendance", async (req, res) => {
    try {
      const input = insertAttendanceSchema.parse(req.body);
      res.status(201).json(await storage.upsertAttendance(input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الحضور" });
    }
  });

  app.get("/api/hr/leaves", async (req, res) => {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    res.json(await storage.getLeaves(employeeId));
  });
  app.post("/api/hr/leaves", async (req, res) => {
    try {
      const input = insertLeaveSchema.parse(req.body);
      res.status(201).json(await storage.createLeave(input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الإجازة" });
    }
  });
  app.delete("/api/hr/leaves/:id", async (req, res) => {
    await storage.deleteLeave(Number(req.params.id));
    res.status(204).send();
  });

  app.get("/api/hr/leave-balance/:employeeId", async (req, res) => {
    const { leaveBalance } = await import("./payroll");
    res.json(await leaveBalance(Number(req.params.employeeId)));
  });

  const payrollPeriodSchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  });

  app.get("/api/hr/payroll/preview", async (req, res) => {
    try {
      const { computePayrollPreview } = await import("./payroll");
      const { year, month } = payrollPeriodSchema.parse({
        year: req.query.year || new Date().getFullYear(),
        month: req.query.month || new Date().getMonth() + 1,
      });
      res.json({ year, month, lines: await computePayrollPreview(year, month) });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر حساب الرواتب" });
    }
  });

  app.post("/api/hr/payroll/run", async (req, res) => {
    try {
      const { runPayroll } = await import("./payroll");
      const { year, month } = payrollPeriodSchema.parse({
        year: req.body?.year || new Date().getFullYear(),
        month: req.body?.month || new Date().getMonth() + 1,
      });
      res.status(201).json(await runPayroll(year, month));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(400).json({ message: err?.message || "تعذر تنفيذ كشف الرواتب" });
    }
  });

  // ============================================================================
  // Decision Cockpit / Insights
  // ============================================================================
  const insights = await import("./insights");

  app.get("/api/insights/health", async (_req, res) => {
    const k = await insights.computeKPIs();
    const health = insights.computeHealthScore(k);
    res.json({ kpis: k, health });
  });

  app.get("/api/insights/alerts", async (_req, res) => {
    const alerts = await insights.generateAlerts();
    res.json({ alerts });
  });

  app.get("/api/insights/cash-forecast", async (req, res) => {
    const days = Number(req.query.days || 90);
    const forecast = await insights.projectCash(Math.min(Math.max(days, 7), 365));
    res.json(forecast);
  });

  const scenarioSchema = z.object({
    priceChangePct: z.coerce.number().min(-90).max(200).default(0),
    costChangePct: z.coerce.number().min(-90).max(200).default(0),
    newMonthlyExpense: z.coerce.number().min(0).default(0),
    expenseReductionPct: z.coerce.number().min(0).max(95).default(0),
    monthsAhead: z.coerce.number().int().min(1).max(36).default(12),
  });

  app.post("/api/insights/simulate", async (req, res) => {
    try {
      const input = scenarioSchema.parse(req.body);
      const result = await insights.simulateScenario(input);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "تعذر تشغيل المحاكاة" });
    }
  });

  app.get("/api/insights/taxes", async (_req, res) => {
    const t = await insights.estimateTaxes();
    res.json(t);
  });

  app.get("/api/insights/budget-vs-actual", async (req, res) => {
    const year = Number(req.query.year || new Date().getFullYear());
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const rows = await insights.budgetVsActual(year, month);
    res.json({ year, month, rows });
  });

  app.get("/api/budgets", async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const list = await storage.getBudgets(year, month);
    res.json(list);
  });

  app.post("/api/budgets", async (req, res) => {
    try {
      const { insertBudgetSchema } = await import("@shared/schema");
      const input = insertBudgetSchema.extend({
        year: z.coerce.number().int().min(2000).max(2100),
        month: z.coerce.number().int().min(1).max(12),
      }).parse(req.body);
      const acc = await storage.getAccounts();
      if (!acc.find((a) => a.id === input.accountId && !a.isHeader)) {
        return res.status(400).json({ message: "حساب غير صالح" });
      }
      const b = await storage.upsertBudget(input);
      res.status(201).json(b);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "فشل حفظ الميزانية" });
    }
  });

  app.delete("/api/budgets/:id", async (req, res) => {
    await storage.deleteBudget(Number(req.params.id));
    res.status(204).send();
  });

  // AI Decision Coach (with simple per-IP rate limit to prevent abuse)
  const coachLimiter = new Map<string, number[]>();
  app.post("/api/insights/ai-coach", async (req, res) => {
    try {
      const ip = (req.ip || req.headers["x-forwarded-for"] || "anon").toString();
      const now = Date.now();
      const win = (coachLimiter.get(ip) || []).filter((t) => now - t < 60_000);
      if (win.length >= 8) {
        return res.status(429).json({ message: "كثرة الطلبات — حاول بعد دقيقة" });
      }
      win.push(now);
      coachLimiter.set(ip, win);
      const question = String(req.body?.question || "").slice(0, 1000);
      if (!question.trim()) return res.status(400).json({ message: "أدخل سؤالك" });

      const k = await insights.computeKPIs();
      const cash = await insights.projectCash(90);
      const alerts = await insights.generateAlerts();
      const txs = await storage.getTransactions();

      const recentTxs = txs.slice(-15).map((t) => ({
        type: t.type,
        amount: Number(t.amount),
        category: t.category,
        description: t.description,
      }));

      const context = {
        kpis: {
          revenue: k.totalRevenue,
          expenses: k.totalExpenses,
          netProfit: k.netProfit,
          netMargin: `${(k.netMargin * 100).toFixed(1)}%`,
          grossMargin: `${(k.grossMargin * 100).toFixed(1)}%`,
          cash: k.cash,
          currentRatio: k.currentRatio.toFixed(2),
          totalAssets: k.totalAssets,
          totalLiabilities: k.totalLiabilities,
          totalEquity: k.totalEquity,
        },
        cashRunwayDays: cash.runwayDays,
        avgDailyNet: cash.avgDailyNet.toFixed(2),
        topAlerts: alerts.slice(0, 3).map((a) => `${a.severity}: ${a.title} — ${a.description}`),
        recentTransactions: recentTxs,
      };

      const systemPrompt = `أنت مستشار مالي ذكي خبير في معايير IFRS وفي قرارات الأعمال الصغيرة والمتوسطة في السوق السعودي.
- جاوب بالعربية الفصحى المختصرة، بأسلوب عملي مباشر بدون حشو.
- استخدم الأرقام الفعلية من السياق المُرفق ولا تخترع أرقاماً.
- نظّم جوابك في 3-5 نقاط واضحة (- نقطة:...).
- اختم برأي قاطع: "توصيتي: …" بجملة أو جملتين.
- إذا الأرقام لا تكفي للإجابة، قل ذلك صراحة واطلب البيانات الناقصة.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `سؤال صاحب العمل: ${question}\n\nالبيانات المالية الحالية:\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      });

      const answer = response.choices[0]?.message?.content || "تعذّر توليد إجابة.";
      res.json({ answer });
    } catch (err) {
      console.error("AI coach error", err);
      res.status(500).json({ message: "حدث خطأ في الحصول على نصيحة المستشار" });
    }
  });

  // Chat
  app.get(api.chat.list.path, async (req, res) => {
    const messages = await storage.getChatMessages();
    res.json(messages);
  });

  app.post(api.chat.message.path, async (req, res) => {
    try {
      const input = api.chat.message.input.parse(req.body);

      // Save user message (mark if image attached)
      const userContentForDb = input.imageData
        ? (input.content?.trim() || "📎 تم إرفاق فاتورة / إيصال")
        : input.content;

      await storage.createChatMessage({
        role: "user",
        content: userContentForDb,
      });

      const systemPrompt = `أنت مساعد محاسبي ذكي ذو شخصية ودودة تتحدث العربية الفصحى البسيطة. مهمتك مساعدة الأشخاص غير المحاسبين على تسجيل وفهم معاملاتهم المالية.

إذا أخبرك المستخدم عن مصروف أو إيراد، أو أرسل لك صورة فاتورة / إيصال:
1. استخرج: المبلغ الإجمالي، نوع المعاملة (مصروف/إيراد)، وصف مختصر مفيد، وفئة مناسبة (طعام، مواصلات، فواتير، تسوق، صحة، ترفيه، رواتب، مبيعات، ...).
2. أجب برسالة قصيرة ودافئة مؤكداً تسجيل المعاملة (مثلاً: "تم تسجيل مصروف 120 ر.س على البقالة ✅").
3. ثم أرفق في نهاية الرسالة كتلة JSON بالشكل التالي تماماً:
\`\`\`json
{
  "action": "add_transaction",
  "type": "expense" | "income",
  "amount": <number>,
  "description": "<string قصير>",
  "category": "<string>"
}
\`\`\`

إذا كانت الصورة فاتورة فيها عدة بنود، استخدم المجموع النهائي وضع الوصف باسم المتجر إن وُجد.
إذا لم تستطع استخراج المعاملة (الصورة غير واضحة أو الرسالة مجرد سؤال)، أجب بشكل مساعد دون كتلة JSON.
لا تستخدم كتلة JSON إلا عندما تريد إضافة معاملة فعلية.`;

      // Build user message - either text or multimodal (text + image)
      let userMessage: any;
      if (input.imageData) {
        const textPart = input.content?.trim() || "هذه صورة فاتورة، استخرج منها تفاصيل المعاملة وسجلها.";
        userMessage = {
          role: "user",
          content: [
            { type: "text", text: textPart },
            { type: "image_url", image_url: { url: input.imageData } },
          ],
        };
      } else {
        userMessage = { role: "user", content: input.content };
      }

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          userMessage,
        ],
      });

      const aiContent = response.choices[0]?.message?.content || "عذراً، لم أتمكن من معالجة طلبك.";

      // Validate AI action JSON with strict Zod schema before creating transaction
      const aiActionSchema = z.object({
        action: z.literal("add_transaction"),
        type: z.enum(["income", "expense"]),
        amount: z
          .union([z.number(), z.string()])
          .transform((v) => Number(v))
          .refine((n) => Number.isFinite(n) && n > 0, "amount must be positive"),
        description: z.string().min(1).max(200).default("معاملة"),
        category: z.string().min(1).max(50).default("أخرى"),
      });

      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const raw = JSON.parse(jsonMatch[1]);
          const parsed = aiActionSchema.safeParse(raw);
          if (parsed.success) {
            await storage.createTransaction({
              type: parsed.data.type,
              amount: parsed.data.amount,
              description: parsed.data.description,
              category: parsed.data.category,
            });
          } else {
            console.warn("AI action JSON failed validation:", parsed.error.format());
          }
        } catch (e) {
          console.error("Failed to parse AI action JSON", e);
        }
      }

      // Save assistant message (strip the JSON block from displayed content)
      const cleanContent = aiContent.replace(/```json\s*[\s\S]*?\s*```/g, "").trim();
      const assistantMessage = await storage.createChatMessage({
        role: "assistant",
        content: cleanContent || "تم! ✅",
      });

      res.json(assistantMessage);
    } catch (err) {
      console.error("Chat error", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      // Persist a graceful assistant fallback so the chat doesn't appear stuck
      try {
        const fallback = await storage.createChatMessage({
          role: "assistant",
          content: "عذراً، حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى من فضلك. 🙏",
        });
        return res.status(200).json(fallback);
      } catch {
        return res.status(500).json({ message: "حدث خطأ في معالجة الطلب" });
      }
    }
  });

  // ============================================================================
  // Fixed Assets (IAS 16 / IAS 36)
  // ============================================================================
  await registerFixedAssetRoutes(app);

  return httpServer;
}

async function registerFixedAssetRoutes(app: Express) {
  const {
    insertCompanySchema,
    insertFxRateSchema,
    insertAssetCategorySchema,
    insertFixedAssetSchema,
    insertAssetComponentSchema,
    DEPRECIATION_METHODS,
  } = await import("@shared/schema");
  const fa = await import("./fixed-assets");
  const {
    CASH_ACCOUNT_CODE,
  } = await import("@shared/coa-seed");

  const RETAINED_EARNINGS_CODE = "3020";

  async function resolveAccountId(code: string): Promise<number | null> {
    const acc = await storage.getAccountByCode(code);
    return acc?.id ?? null;
  }

  // Companies
  app.get("/api/companies", async (_req, res) => res.json(await storage.getCompanies()));
  app.post("/api/companies", async (req, res) => {
    try {
      const input = insertCompanySchema.parse(req.body);
      res.status(201).json(await storage.createCompany(input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الشركة" });
    }
  });
  app.patch("/api/companies/:id", async (req, res) => {
    try {
      const input = insertCompanySchema.partial().parse(req.body);
      res.json(await storage.updateCompany(Number(req.params.id), input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر التحديث" });
    }
  });

  // FX Rates
  app.get("/api/fx-rates", async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    res.json(await storage.getFxRates(companyId));
  });
  app.post("/api/fx-rates", async (req, res) => {
    try {
      const input = insertFxRateSchema.parse(req.body);
      res.status(201).json(await storage.createFxRate(input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ سعر الصرف" });
    }
  });
  app.delete("/api/fx-rates/:id", async (req, res) => {
    await storage.deleteFxRate(Number(req.params.id));
    res.status(204).send();
  });

  // Asset Categories
  app.get("/api/asset-categories", async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    res.json(await storage.getAssetCategories(companyId));
  });
  app.post("/api/asset-categories", async (req, res) => {
    try {
      const input = insertAssetCategorySchema.parse(req.body);
      res.status(201).json(await storage.createAssetCategory(input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ التصنيف" });
    }
  });
  app.patch("/api/asset-categories/:id", async (req, res) => {
    try {
      const input = insertAssetCategorySchema.partial().parse(req.body);
      res.json(await storage.updateAssetCategory(Number(req.params.id), input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر التحديث" });
    }
  });

  // Fixed Assets - list (with computed carrying)
  app.get("/api/fixed-assets", async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    const all = await storage.getFixedAssets(companyId);
    res.json(all.map((a) => ({
      ...a,
      carryingAmount: fa.carryingAmount({ cost: a.cost, accumDepreciation: a.accumDepreciation, accumImpairment: a.accumImpairment }),
    })));
  });

  app.get("/api/fixed-assets/:id", async (req, res) => {
    const id = Number(req.params.id);
    const asset = await storage.getFixedAsset(id);
    if (!asset) return res.status(404).json({ message: "الأصل غير موجود" });
    const [components, schedule, impairments, revaluations, disposalsList, depreciations] = await Promise.all([
      storage.getAssetComponents(id),
      storage.getSchedule(id),
      storage.getImpairmentEvents(id),
      storage.getRevaluationEvents(id),
      storage.getDisposals(id),
      storage.getDepreciationPostingsByAsset(id),
    ]);
    res.json({
      ...asset,
      carryingAmount: fa.carryingAmount({ cost: asset.cost, accumDepreciation: asset.accumDepreciation, accumImpairment: asset.accumImpairment }),
      components,
      schedule,
      impairments,
      revaluations,
      disposals: disposalsList,
      depreciations,
    });
  });

  app.post("/api/fixed-assets/preview-schedule", async (req, res) => {
    try {
      const body = z.object({
        cost: z.coerce.number().positive(),
        residual: z.coerce.number().nonnegative().default(0),
        usefulLifeMonths: z.coerce.number().int().positive(),
        method: z.enum(DEPRECIATION_METHODS),
        inServiceDate: z.string().min(1),
        unitsTotal: z.coerce.number().positive().optional().nullable(),
      }).parse(req.body);
      const sched = fa.generateSchedule({
        cost: body.cost,
        residual: body.residual,
        usefulLifeMonths: body.usefulLifeMonths,
        method: body.method,
        unitsTotal: body.unitsTotal ?? null,
        inServiceDate: body.inServiceDate,
        accumDepreciation: 0,
        accumImpairment: 0,
      });
      res.json({ schedule: sched });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر توليد الجدول" });
    }
  });

  app.post("/api/fixed-assets", async (req, res) => {
    try {
      const componentsSchema = z.array(insertAssetComponentSchema.omit({ assetId: true })).optional().default([]);
      const body = insertFixedAssetSchema.extend({
        components: componentsSchema,
      }).parse(req.body);
      // Validate references
      const cat = (await storage.getAssetCategories(body.companyId)).find((c) => c.id === body.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف الأصل غير صالح" });
      const cost = Number(body.txCost) * Number(body.fxRate ?? 1);
      const { components, customSchedule, ...rest } = body;
      const created = await storage.createFixedAsset({
        ...rest,
        cost,
        customSchedule: customSchedule ? JSON.stringify(customSchedule) : null,
      });

      for (const comp of components || []) {
        await storage.createAssetComponent({ ...comp, assetId: created.id });
      }
      // Generate planned schedule (best-effort; skip for units_of_production / custom)
      if (created.method !== "units_of_production" && created.method !== "custom") {
        const sched = fa.generateSchedule(fa.unitFromAsset(created));
        await storage.replaceSchedule(created.id, sched.map((r) => ({
          periodYear: r.year, periodMonth: r.month, plannedAmount: r.amount,
        })));
      }
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error(err);
      res.status(500).json({ message: "تعذر حفظ الأصل" });
    }
  });

  app.delete("/api/fixed-assets/:id", async (req, res) => {
    await storage.deleteFixedAsset(Number(req.params.id));
    res.status(204).send();
  });

  // Depreciation runs
  app.get("/api/depreciation-runs", async (req, res) => {
    const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
    const runs = await storage.getDepreciationRuns(companyId);
    res.json(runs);
  });

  app.get("/api/depreciation-runs/:id", async (req, res) => {
    const run = await storage.getDepreciationRun(Number(req.params.id));
    if (!run) return res.status(404).json({ message: "غير موجود" });
    const postings = await storage.getDepreciationPostings(run.id);
    res.json({ ...run, postings });
  });

  // Preview depreciation for a given month — returns per-asset amounts & totals
  const depRunBodySchema = z.object({
    companyId: z.coerce.number().int().positive(),
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    // Optional per-asset/per-component units for units_of_production assets.
    usage: z.array(z.object({
      assetId: z.coerce.number().int().positive(),
      componentId: z.coerce.number().int().positive().optional().nullable(),
      units: z.coerce.number().nonnegative(),
    })).optional().default([]),
  });

  function usageLookup(usage: Array<{ assetId: number; componentId?: number | null; units: number }>): (assetId: number, componentId?: number | null) => number {
    const map = new Map<string, number>();
    usage.forEach((u) => map.set(`${u.assetId}:${u.componentId ?? ""}`, u.units));
    return (assetId, componentId) => map.get(`${assetId}:${componentId ?? ""}`) ?? 0;
  }

  app.post("/api/depreciation-runs/preview", async (req, res) => {
    try {
      const body = depRunBodySchema.parse(req.body);
      const existing = await storage.findPostedRun(body.companyId, body.year, body.month);
      if (existing) {
        return res.status(409).json({ message: "تم ترحيل قيد إهلاك لهذا الشهر مسبقاً" });
      }
      const all = await storage.getFixedAssets(body.companyId);
      const cats = await storage.getAssetCategories(body.companyId);
      const catById = new Map(cats.map((c) => [c.id, c]));
      const usageOf = usageLookup(body.usage);
      const period: PeriodKey = { year: body.year, month: body.month };

      // Identify UoP units that lack provided usage so the UI can prompt for it
      const needsUsage: Array<{ assetId: number; componentId: number | null; assetName: string; method: string }> = [];

      const postings: { assetId: number; componentId?: number | null; amount: number; categoryId: number; assetName: string }[] = [];
      for (const a of all) {
        if (a.status !== "active") continue;
        const cat = catById.get(a.categoryId);
        if (!cat) continue;
        const comps = await storage.getAssetComponents(a.id);
        if (comps.length > 0) {
          for (const c of comps) {
            const u = fa.unitFromComponent(c, a.inServiceDate);
            const units = usageOf(a.id, c.id);
            if (u.method === "units_of_production" && units === 0) needsUsage.push({ assetId: a.id, componentId: c.id, assetName: `${a.name} / ${c.name}`, method: u.method });
            const amt = fa.depreciationForPeriod(u, period, units);
            if (amt > 0) postings.push({ assetId: a.id, componentId: c.id, amount: amt, categoryId: cat.id, assetName: `${a.name} / ${c.name}` });
          }
        } else {
          const u = fa.unitFromAsset(a);
          const units = usageOf(a.id, null);
          if (u.method === "units_of_production" && units === 0) needsUsage.push({ assetId: a.id, componentId: null, assetName: a.name, method: u.method });
          const amt = fa.depreciationForPeriod(u, period, units);
          if (amt > 0) postings.push({ assetId: a.id, amount: amt, categoryId: cat.id, assetName: a.name });
        }
      }
      const total = postings.reduce((s, p) => s + p.amount, 0);
      const byCategory = new Map<number, { categoryName: string; amount: number }>();
      postings.forEach((p) => {
        const cat = catById.get(p.categoryId)!;
        const cur = byCategory.get(p.categoryId) || { categoryName: cat.name, amount: 0 };
        cur.amount += p.amount;
        byCategory.set(p.categoryId, cur);
      });
      res.json({
        postings,
        total: Math.round(total * 100) / 100,
        byCategory: Array.from(byCategory.entries()).map(([categoryId, v]) => ({ categoryId, ...v })),
        needsUsage,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر توليد المعاينة" });
    }
  });

  // Confirm and post depreciation run -> creates JE
  app.post("/api/depreciation-runs/post", async (req, res) => {
    try {
      const body = depRunBodySchema.parse(req.body);

      const existing = await storage.findPostedRun(body.companyId, body.year, body.month);
      if (existing) return res.status(409).json({ message: "تم الترحيل مسبقاً لهذا الشهر" });

      const all = await storage.getFixedAssets(body.companyId);
      const cats = await storage.getAssetCategories(body.companyId);
      const catById = new Map(cats.map((c) => [c.id, c]));
      const usageOf = usageLookup(body.usage);

      type Posting = { assetId: number; componentId?: number | null; amount: number; noImpAmount: number; categoryId: number };
      const postings: Posting[] = [];
      const componentMap = new Map<number, AssetComponent[]>();
      const period: PeriodKey = { year: body.year, month: body.month };

      for (const a of all) {
        if (a.status !== "active") continue;
        const cat = catById.get(a.categoryId);
        if (!cat) continue;
        const comps = await storage.getAssetComponents(a.id);
        componentMap.set(a.id, comps);
        if (comps.length > 0) {
          for (const c of comps) {
            const u = fa.unitFromComponent(c, a.inServiceDate);
            const units = usageOf(a.id, c.id);
            if (u.method === "units_of_production" && units === 0) continue;
            const amt = fa.depreciationForPeriod(u, period, units);
            // Hypothetical depreciation if no impairment had happened (for IAS 36 cap)
            const noImpUnit = { ...u, accumDepreciation: Number(c.accumDepreciation), accumImpairment: 0 };
            const noImpAmt = fa.depreciationForPeriod(noImpUnit, period, units);
            if (amt > 0) postings.push({ assetId: a.id, componentId: c.id, amount: amt, noImpAmount: noImpAmt, categoryId: cat.id });
          }
        } else {
          const u = fa.unitFromAsset(a);
          const units = usageOf(a.id, null);
          if (u.method === "units_of_production" && units === 0) continue;
          const amt = fa.depreciationForPeriod(u, period, units);
          const noImpUnit = { ...u, accumDepreciation: Number(a.accumDepNoImpairment), accumImpairment: 0 };
          const noImpAmt = fa.depreciationForPeriod(noImpUnit, period, units);
          if (amt > 0) postings.push({ assetId: a.id, amount: amt, noImpAmount: noImpAmt, categoryId: cat.id });
        }
      }

      if (postings.length === 0) return res.status(400).json({ message: "لا يوجد إهلاك مستحق لهذا الشهر" });

      const byCat = new Map<number, { depExpenseAccountId: number; accumDepAccountId: number; amount: number }>();
      postings.forEach((p) => {
        const cat = catById.get(p.categoryId)!;
        const cur = byCat.get(p.categoryId) || { depExpenseAccountId: cat.depExpenseAccountId, accumDepAccountId: cat.accumulatedDepAccountId, amount: 0 };
        cur.amount += p.amount;
        byCat.set(p.categoryId, cur);
      });

      const periodStr = `${body.year}-${String(body.month).padStart(2, "0")}`;
      const built = fa.buildDepreciationJE(postings.reduce((s, p) => s + p.amount, 0), byCat, `إهلاك شهر ${periodStr}`);
      const je = await storage.createJournalEntry({
        description: built.description,
        entryDate: new Date(`${periodStr}-28`),
        source: "manual",
        lines: built.lines,
      });

      const run = await storage.createDepreciationRun({ companyId: body.companyId, year: body.year, month: body.month, postings });
      const posted = await storage.markRunPosted(run.id, je.id);
      await storage.markScheduledPosted(run.id, period, postings.map((p) => ({ assetId: p.assetId, componentId: p.componentId ?? null, amount: p.amount })));

      // Aggregate per-asset deltas before applying to DB (handles multi-component sums)
      type Delta = { accumDep: number; noImp: number };
      const assetDeltas = new Map<number, Delta>();
      for (const p of postings) {
        const cur = assetDeltas.get(p.assetId) || { accumDep: 0, noImp: 0 };
        cur.accumDep += p.amount;
        cur.noImp += p.noImpAmount;
        assetDeltas.set(p.assetId, cur);
        if (p.componentId) {
          const comps = componentMap.get(p.assetId) || [];
          const c = comps.find((x) => x.id === p.componentId);
          if (c) {
            await db.update(assetComponents).set({
              accumDepreciation: String(Number(c.accumDepreciation) + p.amount),
            }).where(eq(assetComponents.id, c.id));
          }
        }
      }
      for (const [assetId, d] of Array.from(assetDeltas.entries())) {
        const a = all.find((x) => x.id === assetId)!;
        await storage.updateFixedAssetBalances(a.id, {
          accumDepreciation: Number(a.accumDepreciation) + d.accumDep,
          accumDepNoImpairment: Number(a.accumDepNoImpairment) + d.noImp,
          lastDepreciatedPeriod: periodStr,
        });
      }
      res.status(201).json({ ...posted, journalEntryId: je.id });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error(err);
      res.status(500).json({ message: err?.message || "تعذر ترحيل الإهلاك" });
    }
  });

  // Impairment
  app.post("/api/fixed-assets/:id/impairment", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = z.object({
        eventDate: z.string().min(1),
        recoverableAmount: z.coerce.number().nonnegative(),
        notes: z.string().max(500).optional().default(""),
        confirm: z.boolean().optional().default(false),
      }).parse(req.body);
      const asset = await storage.getFixedAsset(id);
      if (!asset) return res.status(404).json({ message: "غير موجود" });
      const cat = (await storage.getAssetCategories(asset.companyId)).find((c) => c.id === asset.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف غير موجود" });

      const carrying = fa.carryingAmount({ cost: asset.cost, accumDepreciation: asset.accumDepreciation, accumImpairment: asset.accumImpairment });
      // IAS 36 cap: hypothetical carrying amount as if no impairment had ever been recorded.
      // We use the running counter `accumDepNoImpairment` (kept in sync by the depreciation
      // post handler). The hypothetical NBV cannot exceed (cost - accumDepNoImpairment).
      const hypoCarrying = Math.max(0, Number(asset.cost) - Number(asset.accumDepNoImpairment));
      let isReversal = false;
      let amount = 0;
      if (body.recoverableAmount < carrying) {
        amount = fa.impairmentLoss(carrying, body.recoverableAmount);
      } else if (body.recoverableAmount > carrying && Number(asset.accumImpairment) > 0) {
        amount = fa.impairmentReversal(carrying, body.recoverableAmount, hypoCarrying);
        isReversal = true;
      }
      const preview = {
        carrying, recoverableAmount: body.recoverableAmount, amount, isReversal,
        hypotheticalCarrying: hypoCarrying,
        reversalCap: Math.max(0, hypoCarrying - carrying),
        newCarrying: carrying + (isReversal ? amount : -amount),
      };
      if (!body.confirm) return res.json({ preview });

      if (amount <= 0.005) return res.status(400).json({ message: "لا يوجد فرق يتطلب قيد انخفاض" });
      const built = fa.buildImpairmentJE(cat, amount, isReversal, asset.name);
      const je = await storage.createJournalEntry({
        description: built.description,
        entryDate: new Date(body.eventDate),
        source: "manual",
        lines: built.lines,
      });
      const event = await storage.createImpairmentEvent({
        assetId: id,
        eventDate: body.eventDate,
        recoverableAmount: body.recoverableAmount,
        lossAmount: isReversal ? -amount : amount,
        journalEntryId: je.id,
        notes: body.notes,
      });
      const signedDelta = isReversal ? -amount : amount;
      const newAccumImp = Number(asset.accumImpairment) + signedDelta;
      await storage.updateFixedAssetBalances(id, { accumImpairment: newAccumImp });

      // Propagate impairment to components proportionally to current carrying
      // amount, so that future component-level depreciation reflects the
      // impairment per IAS 36. If there are no components, the asset-level
      // accumImpairment alone is used by `unitFromAsset`.
      const comps = await storage.getAssetComponents(id);
      if (comps.length > 0) {
        const carryings = comps.map((c) => Math.max(0, Number(c.cost) - Number(c.accumDepreciation) - Number(c.accumImpairment)));
        const totalCarry = carryings.reduce((s, v) => s + v, 0);
        if (totalCarry > 0.005) {
          let allocated = 0;
          for (let i = 0; i < comps.length; i++) {
            const c = comps[i];
            const isLast = i === comps.length - 1;
            const share = isLast ? signedDelta - allocated : Math.round((signedDelta * carryings[i] / totalCarry) * 100) / 100;
            allocated += share;
            const nextImp = Math.max(0, Number(c.accumImpairment) + share);
            await db.update(assetComponents).set({ accumImpairment: String(nextImp) }).where(eq(assetComponents.id, c.id));
          }
        }
      }

      res.status(201).json({ event, journalEntryId: je.id, preview });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر معالجة الانخفاض" });
    }
  });

  // Revaluation
  app.post("/api/fixed-assets/:id/revaluation", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = z.object({
        eventDate: z.string().min(1),
        fairValue: z.coerce.number().nonnegative(),
        method: z.enum(["elimination", "proportional"]).default("elimination"),
        notes: z.string().max(500).optional().default(""),
        confirm: z.boolean().optional().default(false),
      }).parse(req.body);
      const asset = await storage.getFixedAsset(id);
      if (!asset) return res.status(404).json({ message: "غير موجود" });
      const cat = (await storage.getAssetCategories(asset.companyId)).find((c) => c.id === asset.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف غير موجود" });

      const result = fa.applyRevaluation(
        Number(asset.cost),
        Number(asset.accumDepreciation),
        Number(asset.accumImpairment),
        Number(asset.revalSurplus),
        Number(asset.accumRevalLoss),
        body.fairValue,
        body.method
      );
      const preview = {
        result,
        current: {
          cost: Number(asset.cost),
          accumDep: Number(asset.accumDepreciation),
          accumImp: Number(asset.accumImpairment),
          surplus: Number(asset.revalSurplus),
          priorPLLoss: Number(asset.accumRevalLoss),
        },
      };
      if (!body.confirm) return res.json({ preview });

      const built = fa.buildRevaluationJE(
        cat,
        asset,
        { cost: Number(asset.cost), accumDep: Number(asset.accumDepreciation), accumImp: Number(asset.accumImpairment) },
        { cost: result.newGrossCost, accumDep: result.newAccumDep, accumImp: result.newAccumImp },
        result.surplusDelta,
        result.plImpact,
      );
      const je = await storage.createJournalEntry({
        description: built.description,
        entryDate: new Date(body.eventDate),
        source: "manual",
        lines: built.lines,
      });
      const event = await storage.createRevaluationEvent({
        assetId: id,
        eventDate: body.eventDate,
        fairValue: body.fairValue,
        method: body.method,
        surplusDelta: result.surplusDelta,
        plImpact: result.plImpact,
        journalEntryId: je.id,
        notes: body.notes,
      });
      // Update accumulated P&L loss tracker:
      //  - downward revaluations with negative plImpact ADD to the running loss
      //  - upward revaluations that reverse part of that loss SUBTRACT from it
      const newAccumRevalLoss = Math.max(
        0,
        Number(asset.accumRevalLoss) - Math.max(0, result.plImpact) + Math.max(0, -result.plImpact),
      );
      await storage.updateFixedAssetBalances(id, {
        cost: result.newGrossCost,
        accumDepreciation: result.newAccumDep,
        accumImpairment: result.newAccumImp,
        revalSurplus: Number(asset.revalSurplus) + result.surplusDelta,
        accumRevalLoss: newAccumRevalLoss,
      });
      res.status(201).json({ event, journalEntryId: je.id, preview });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر إعادة التقييم" });
    }
  });

  // Disposal
  app.post("/api/fixed-assets/:id/dispose", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = z.object({
        eventDate: z.string().min(1),
        proceeds: z.coerce.number().nonnegative().default(0),
        method: z.enum(["sale", "scrap", "writeoff"]).default("sale"),
        notes: z.string().max(500).optional().default(""),
        confirm: z.boolean().optional().default(false),
      }).parse(req.body);
      const asset = await storage.getFixedAsset(id);
      if (!asset) return res.status(404).json({ message: "غير موجود" });
      if (asset.status === "disposed") return res.status(400).json({ message: "تم استبعاد هذا الأصل مسبقاً" });
      const cat = (await storage.getAssetCategories(asset.companyId)).find((c) => c.id === asset.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف غير موجود" });

      const cashAccountId = await resolveAccountId(CASH_ACCOUNT_CODE);
      const reAccountId = await resolveAccountId(RETAINED_EARNINGS_CODE);
      if (!cashAccountId || !reAccountId) return res.status(500).json({ message: "حساب النقدية أو الأرباح المحتجزة غير موجود" });

      const result = fa.computeDisposal(Number(asset.cost), Number(asset.accumDepreciation), Number(asset.accumImpairment), Number(asset.revalSurplus), body.proceeds);
      const preview = { result, carrying: Number(asset.cost) - Number(asset.accumDepreciation) - Number(asset.accumImpairment) };
      if (!body.confirm) return res.json({ preview });

      const built = fa.buildDisposalJE(cat, asset, Number(asset.cost), Number(asset.accumDepreciation), Number(asset.accumImpairment), body.proceeds, result, cashAccountId, reAccountId);
      const je = await storage.createJournalEntry({
        description: built.description,
        entryDate: new Date(body.eventDate),
        source: "manual",
        lines: built.lines,
      });
      const event = await storage.createDisposal({
        assetId: id,
        eventDate: body.eventDate,
        proceeds: body.proceeds,
        method: body.method,
        gainLoss: result.gainLoss,
        surplusTransferred: result.surplusTransferred,
        journalEntryId: je.id,
        notes: body.notes,
      });
      await storage.updateFixedAssetBalances(id, {
        status: "disposed",
        revalSurplus: Number(asset.revalSurplus) - result.surplusTransferred,
      });
      res.status(201).json({ event, journalEntryId: je.id, preview });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر استبعاد الأصل" });
    }
  });
}
