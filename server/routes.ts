import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";

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

  return httpServer;
}
