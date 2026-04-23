import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft, ArrowRight, Check, FileText, Receipt, Bot,
  ShieldCheck, Globe2, Workflow, BarChart3, Briefcase,
  Users, Wallet, TrendingUp, AlertTriangle, Lock, Database, ScrollText,
  MapPin, Activity, Scale, Radar, Brain, LineChart, Clock, Zap,
  Send, Search, Calendar, Building2, Command,
} from "lucide-react"
import { SiWhatsapp } from "react-icons/si"
import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppFooter } from "@/components/layout/AppFooter"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from "@/lib/utils"
import { useLocale, type Locale } from "@/contexts/locale-context"
import { useAuth } from "@/hooks/use-auth"

/* ============================================================================
   Landing page — محاسب ذكي / Smart Accountant
   Bilingual (AR/EN), direction-aware. Built on Phase 1 design system.
   ========================================================================== */

type Dict = ReturnType<typeof getCopy>

function getCopy(locale: Locale) {
  const ar = locale === "ar"
  return {
    ar,
    nav: {
      platform: ar ? "المنصّة" : "Platform",
      ai: ar ? "المساعد" : "Assistant",
      intelligence: ar ? "الذكاء الاستراتيجيّ" : "Intelligence",
      integrations: ar ? "التكاملات" : "Integrations",
      pricing: ar ? "الأسعار" : "Pricing",
      security: ar ? "الأمان" : "Security",
      useCases: ar ? "الاستخدامات" : "Use cases",
      faq: ar ? "الأسئلة" : "FAQ",
      openApp: ar ? "افتح التطبيق" : "Open app",
      demo: ar ? "اطلب عرضاً" : "Request demo",
      signIn: ar ? "تسجيل الدخول" : "Sign in",
    },
    hero: {
      tag: ar ? "الإصدار ٥٫٢ · ٢٤٬٠٠٠ قيد مُسجَّل اليوم" : "v5.2 · 24,000 entries posted today",
      h1a: ar ? "محاسبُك. مُدقِّقُك." : "Your bookkeeper.",
      h1b: ar ? "مديرُك المالي." : "Your auditor. Your CFO.",
      h1c: ar ? "في ذكاءٍ واحدٍ — لا ينام." : "Replaced by one AI that doesn't sleep.",
      sub: ar
        ? "لا تستأجر محاسباً. لا تنتظر تدقيقاً ربعيّاً. ذكاءٌ مُدرَّبٌ على IFRS وZATCA يقرأ كلّ فاتورة، يُسجّل كلّ قيد، ويُدقّق كلّ تسوية — في اللحظة التي تحدث."
        : "Don't hire a bookkeeper. Don't wait on a quarterly audit. An AI trained on IFRS and ZATCA reads every receipt, posts every entry, and audits every reconciliation — the moment it happens.",
      subEm: ar ? " بالعربيّة. بمعيار التدقيق." : " In Arabic. At audit grade.",
      ctaPrimary: ar ? "افتح التطبيق" : "Open the app",
      ctaSecondary: ar ? "شاهده يشتغل" : "Watch it work",
      ctaTertiary: ar ? "تسجيل الدخول" : "Sign in",
      replacing: ar ? "بديلٌ عن:" : "Replacing:",
      replacingRoles: ar
        ? ["مُحاسب", "مُحاسب ضرائب", "مُدقِّق داخليّ", "مُحلِّل مالي", "مدير مالي"]
        : ["Bookkeeper", "Tax accountant", "Internal auditor", "FP&A analyst", "CFO"],
      bullets: ar
        ? ["بدون بطاقة ائتمان", "١٤ يوماً مجاناً، بكلّ المزايا", "جاهز خلال ٥ دقائق"]
        : ["No credit card", "Full 14-day trial", "Set up in 5 minutes"],
      certBadge: ar ? "مُعتمَد من ZATCA · المرحلة الثانية" : "ZATCA-cleared · Phase 2",
      countriesLabel: ar ? "يعمل في" : "Live in",
      countries: [
        { f: "🇸🇦", n: ar ? "السعوديّة" : "KSA" },
        { f: "🇦🇪", n: ar ? "الإمارات"  : "UAE" },
        { f: "🇪🇬", n: ar ? "مصر"        : "Egypt" },
        { f: "🇰🇼", n: ar ? "الكويت"     : "Kuwait" },
        { f: "🇶🇦", n: ar ? "قطر"        : "Qatar" },
        { f: "🇯🇴", n: ar ? "الأردن"     : "Jordan" },
      ],
      mockTitle: ar ? "cockpit · محاسب ذكي" : "cockpit · Smart Accountant",
      chipAuto: { t: ar ? "قيد سُجِّل تلقائيّاً" : "Entry auto-posted", s: ar ? "فاتورة كهرباء · ١٥٠ ر.س" : "Electricity invoice · SAR 150" },
      chipProfit: { t: ar ? "هامش الربح ↑ ١٢٪" : "Profit margin ↑ 12%", s: ar ? "هذا الربع" : "Current quarter" },
      kpis: {
        revenue: ar ? "الإيرادات" : "Revenue",
        expenses: ar ? "المصروفات" : "Expenses",
        netCash: ar ? "صافي التدفّق" : "Net cash",
      },
      band: {
        eyebrow: ar ? "آخر ٣٠ يوماً" : "Last 30 days",
        title: ar ? "التدفّق النقديّ" : "Cash flow",
        ticks: ar ? ["د", "أ", "ش", "س"] : ["D", "J", "F", "M"],
      },
      entry: {
        title: ar ? "آخر قيد · #٢٤٧٨" : "Latest entry · #2478",
        balanced: ar ? "متوازن" : "Balanced",
        marketing: ar ? "مصروف تسويق" : "Marketing expense",
        cash: ar ? "النقديّة" : "Cash",
        amount: ar ? "١٢٠٠.٠٠" : "1,200.00",
      },
    },
    trust: {
      eyebrow: ar ? "البنية التي تحتها" : "What's underneath",
      headline: ar ? "ليست ادّعاءً." : "Not a claim.",
      sub1: ar ? "بنية مُعتمدة، وأطر تنظيميّة محسومة، وأرقام تشغيليّة قابلة للقياس." : "Audited posture, settled regulatory frames, and operating numbers you can measure.",
      sub2: ar ? "" : "",
      sub3: ar ? "" : "",
      pillars: ar ? [
        { l: "ZATCA المرحلة ٢", c: "فوترة إلكترونيّة معتمدة (Cleared)", k: "shield" },
        { l: "IFRS 15 · 16 · 9", c: "إيراد · إيجار · أدوات ماليّة", k: "scale" },
        { l: "PDPL · GDPR", c: "خصوصيّة بمعيار التحالف الأوروبيّ", k: "lock" },
        { l: "٧ هيئات تنظيميّة", c: "ZATCA · FTA · ETA · GAZT · CBB · QFC · OTA", k: "globe" },
      ] : [
        { l: "ZATCA Phase 2", c: "Cleared e-invoicing, end-to-end", k: "shield" },
        { l: "IFRS 15 · 16 · 9", c: "Revenue · leases · instruments", k: "scale" },
        { l: "PDPL · GDPR", c: "EU-grade privacy posture, day one", k: "lock" },
        { l: "7 regulators covered", c: "ZATCA · FTA · ETA · GAZT · CBB · QFC · OTA", k: "globe" },
      ],
      metrics: [
        { v: ar ? "٢.٤ مليار+" : "$2.4B+",  l: ar ? "قيمة قيود مُسجَّلة" : "in posted entries" },
        { v: ar ? "٩٩.٩٩٪"     : "99.99%",  l: ar ? "جاهزيّة المنصّة" : "platform uptime" },
        { v: "< 120ms",                       l: ar ? "زمن استجابة API" : "API latency" },
        { v: "SOC 2",                         l: ar ? "Type II · معتمد" : "Type II audited", mono: true },
      ],
    },
    why: {
      eyebrow: ar ? "لماذا محاسب ذكي" : "Why Smart Accountant",
      title1: ar ? "المحاسبة لم تتغيّر منذ خمسين عاماً." : "Accounting hasn't changed in fifty years.",
      title2: ar ? "حتى الآن." : "Until now.",
      lead: ar
        ? "معظم برامج المحاسبة مجرّد دفتر إلكترونيّ: تكتب فيه ما كنت ستكتبه على الورق. نحن بدأنا من سؤال آخر — ماذا لو فَهِمَ النظام معاملاتك، وسجّل قيودك بنفسه، وأخبرك بما ينبغي فعله غداً؟"
        : "Most accounting software is just a digital ledger: you type what you'd otherwise write on paper. We started from a different question — what if the system understood your transactions, posted the entries for you, and told you what to do tomorrow?",
      sub: ar
        ? "الجواب هو محاسب ذكي: نظام محاسبيّ متكامل وفق IFRS، يعمل فيه الذكاء الاصطناعيّ من الأساس — لا كإضافة سطحيّة."
        : "The answer is Smart Accountant: a complete IFRS-compliant accounting system with an AI layer that works from the roots — not bolted on top.",
      principles: ar ? [
        { n: "01", t: "ذكاء حقيقيّ، لا مجرّد واجهة", b: "الذكاء الاصطناعيّ هنا ليس ميزة مضافة، بل قلب النظام. يقرأ الفاتورة، يصنّفها، يقترح القيد الصحيح وفق IFRS، ويتعلّم من تعديلاتك. تكتب «دفعت ١٢٠ للمورّد»، فيكتمل القيد بنفسه." },
        { n: "02", t: "محلّيّ بعمق، عالميّ بمعيار", b: "ضريبة القيمة المضافة، الزكاة، التأمينات، مكافأة نهاية الخدمة، إجازات العمل، التقويم الهجريّ — جاهزة في سبع دول. والأساس دائماً IFRS، فدفاترك يقرأها المدقّق في الرياض والمستثمر في لندن بالمنطق نفسه." },
        { n: "03", t: "أرقام تستحقّ الثقة", b: "كلّ قيد مزدوج، متوازن، مرتبط بمستند، له أثر تدقيق لا يُمسّ. المعادلات تُراجَع لحظيّاً. لا حقول مفتوحة، ولا أرقام «تقريبيّة»، ولا مفاجآت في آخر السنة." },
        { n: "04", t: "أداة قرار، لا مجرّد دفتر", b: "مركز قيادة حيّ يقيس صحّة شركتك، يتوقّع تدفّقك النقديّ، يحاكي سيناريوهات «ماذا لو؟»، ويُحدّثك بعربيّة واضحة عبر مساعد ذكيّ يفهم سياقك الماليّ." },
      ] : [
        { n: "01", t: "Real intelligence, not a sticker on top", b: "AI isn't a side feature. It reads your invoice, classifies it, proposes the correct IFRS entry, and learns from your corrections. Type \"paid 120 to vendor\" and the full entry posts itself." },
        { n: "02", t: "Local where it matters, global by design", b: "VAT, Zakat, social insurance, end-of-service, work calendars, Ramadan — built in for seven countries. The base is always IFRS, so your books read the same to an auditor in Riyadh and an investor in London." },
        { n: "03", t: "Numbers you can trust", b: "Every entry is double-entry, balanced, with a digital source and immutable audit trail. Equations validate live. No free-form fields, no \"approximate\" numbers, no year-end surprises." },
        { n: "04", t: "Built for decisions, not just records", b: "A live decision cockpit measuring your business health, forecasting cash, simulating \"what-if?\", and reaching you in clear language from an AI assistant that understands your financial context." },
      ],
    },
    capabilities: {
      eyebrow: ar ? "القدرات الجوهريّة" : "Core capabilities",
      title: ar ? "كلّ ما تحتاجه لإدارة ماليّتك. ولا شيء سوى ذلك." : "Everything you need to run finance. Nothing you don't.",
      lead: ar
        ? "من أوّل فاتورة إلى آخر قائمة ماليّة جاهزة للتدقيق. سبع دول. أربع عملات. IFRS من الجذور."
        : "From the first invoice to audit-ready financials. Seven countries. Four currencies. IFRS at the core.",
      cockpit: {
        tag: ar ? "المركز" : "Center",
        title: ar ? "مركز القرار" : "Decision cockpit",
        body: ar
          ? "صحّة الشركة، توقّعات النقد، محاكي «ماذا لو»، والتنبيهات الذكيّة — في شاشة واحدة."
          : "Financial health, cash forecast, what-if simulator, and smart alerts — in one place.",
        kpis: [
          { label: ar ? "نقاط الصحّة" : "Health score", value: ar ? "٨٤" : "84",     delta: "+6", positive: true, compact: true },
          { label: ar ? "السيولة"      : "Liquidity",   value: ar ? "٢.٣x" : "2.3x", delta: "+0.2", positive: true, compact: true },
          { label: ar ? "تنبيهات"     : "Alerts",       value: ar ? "٣" : "3",       delta: ar ? "جديدة" : "new", warning: true, compact: true },
        ],
      },
      ai: {
        tag: ar ? "الذكاء" : "AI",
        title: ar ? "المساعد المحاسبيّ" : "Accounting assistant",
        body: ar ? "اكتب بالعربيّة. صوّر فاتورتك. اطلب تقريرك." : "Talk in your language. Snap an invoice. Ask for a report.",
        chat1: ar ? "سجّل ١٢٠٠ ر.س تسويقاً نقديّاً" : "Post 1,200 marketing expense in cash",
        chat2: ar
          ? "تمّ. القيد #٢٤٧٨ متوازن، وإجمالي التسويق هذا الشهر ٤,١٠٠ ر.س."
          : "Done. Entry #2478 is balanced; marketing this month is 4,100.",
      },
      local: {
        title: ar ? "سبع دول، حزمة محلّيّة لكلّ منها" : "Seven countries, a local pack for each",
        body: ar
          ? "ضريبة القيمة المضافة، الزكاة، التأمينات الاجتماعيّة، حساب نهاية الخدمة، إجازات العمل والتقويم الهجريّ — جاهزة في كلّ دولة."
          : "VAT, Zakat, social insurance, end-of-service formulas, work calendars and the Hijri calendar — preconfigured per country.",
        chips: ar
          ? ["السعوديّة", "الإمارات", "مصر", "الكويت", "قطر", "الأردنّ", "International"]
          : ["Saudi Arabia", "UAE", "Egypt", "Kuwait", "Qatar", "Jordan", "International"],
      },
      assets: {
        title: ar ? "الأصول الثابتة بمعيار IFRS" : "Fixed assets, IFRS-grade",
        body: ar
          ? "دورة حياة كاملة: اقتناء، إهلاك، إعادة تقييم، انخفاض قيمة، استبعاد. جداول آليّة وأثر تدقيق لا يُمسّ."
          : "Full lifecycle: acquisition, depreciation, revaluation, impairment, disposal. Automated schedules and an immutable audit trail.",
        m1: ar ? "طريقة الإهلاك" : "Method",
        m1v: ar ? "قسط ثابت" : "Straight line",
        m2: ar ? "العمر النافع" : "Useful life",
        m2v: ar ? "٦٠ شهراً" : "60 months",
        m3: ar ? "القيمة المتبقّية" : "Salvage",
        m3v: ar ? "٥,٠٠٠" : "5,000",
      },
      payroll: {
        title: ar ? "الرواتب والموارد البشريّة" : "Payroll & HR",
        body: ar ? "IAS 19. تأمينات. مخصّص نهاية الخدمة. قيد شهريّ آليّ." : "IAS 19. Social insurance. EOSB accrual. Auto monthly entry.",
      },
      reports: {
        title: ar ? "القوائم الماليّة" : "Financial statements",
        body: ar ? "الميزانيّة، الدخل، التدفّقات النقديّة — وفق IFRS، فوراً." : "Balance sheet, income, cash flow — IFRS, instant.",
      },
      multi: {
        title: ar ? "شركات وعملات متعدّدة" : "Multi-entity & currency",
        body: ar ? "توحيد، تحويل، نظرة واحدة لكامل المجموعة." : "Consolidate, translate, group view.",
      },
    },
    aiSection: {
      tag: ar ? "المساعد المحاسبيّ" : "Accounting assistant",
      h1: ar ? "تحدّث بلغتك،" : "Speak naturally,",
      h2: ar ? "يفهم دفاترك." : "it understands your books.",
      lead: ar
        ? "مساعد ذكيّ مدرَّب على معايير IFRS وعلى دفاتر شركتك أنت. يُسجّل القيود من نصّ أو صورة، يُجيب عن أسئلتك الماليّة، ويتوقّع ما يستحقّ فعله."
        : "An assistant trained on IFRS and on your own books. It posts entries from text or images, answers your financial questions, and anticipates what's next.",
      bullets: ar ? [
        ["قيود من لغة عاديّة", "اكتب «دفعت ٣٠٠ ثمن قهوة» — يصنّف ويسجّل."],
        ["قراءة من الصور", "ارفع فاتورة، يستخرج بياناتها وينشئ القيد."],
        ["محاكاة لحظيّة", "اسأل «ماذا لو ارتفعت الرواتب ١٠٪؟» — يصلك الجواب في ثوانٍ."],
        ["شفافيّة تامّة", "كلّ اقتراح له سند: رقم حساب، أو معيار IFRS، أو سياسة الشركة."],
      ] : [
        ["Natural-language entries", "Type \"paid 300 for coffee\" — it classifies and posts."],
        ["Read from images", "Upload an invoice; it extracts data and posts the entry."],
        ["Live simulation", "Ask \"what if salaries rise 10%?\" — answer in seconds."],
        ["Full transparency", "Every suggestion is sourced: account, IFRS standard, or company policy."],
      ],
      cta: ar ? "جرّب المساعد" : "Try the assistant",
      mockTitle: ar ? "assistant · محاسب ذكي" : "assistant · Smart Accountant",
      chat: {
        u1: ar
          ? "أرفقت فاتورة كهرباء بـ ٤٥٠ ر.س. سجّلها، وقل لي أين نقف من ميزانيّة المرافق."
          : "I uploaded a 450 utility invoice. Post it and tell me where we stand against the utilities budget.",
        a1Pre: ar ? "تمّ. أنشأتُ القيد " : "Done. Created entry ",
        a1Num: ar ? "#٢٤٨١" : "#2481",
        utilities: ar ? "مصروف مرافق" : "Utilities expense",
        payable: ar ? "ذمم دائنة" : "Accounts payable",
        amount: ar ? "٤٥٠.٠٠" : "450.00",
        budget: ar
          ? ["ميزانيّة المرافق هذا الشهر:", "١,٨٢٠ / ٢,٥٠٠", "· المتبقّي ٢٧٪."]
          : ["Utilities budget this month:", "1,820 / 2,500", "· 27% left."],
        u2: ar ? "احسب أثر رفع الرواتب ١٠٪ على التدفّق النقديّ." : "Show me the impact of a 10% salary raise on cash flow.",
      },
    },
    showcase: {
      eyebrow: ar ? "منتج حقيقيّ. لا مجرّد واجهة." : "A real product. Not a mockup.",
      title: ar ? "مركز قيادة ماليّ واحد" : "One financial command center",
      lead: ar
        ? "كلّ ما يجري في ماليّة شركتك — واضح، مفهوم، جاهز للقرار في ثوانٍ."
        : "Everything happening in your finances — visible, understood, decision-ready in seconds.",
      mockTitle: ar ? "cockpit · محاسب ذكي · Default Company" : "cockpit · Smart Accountant · Default Company",
      sidebar: ar
        ? ["الرئيسيّة", "المعاملات", "القيود", "التقارير", "مركز القرار", "الموارد البشريّة", "الأصول", "الإعدادات"]
        : ["Home", "Transactions", "Entries", "Reports", "Cockpit", "HR", "Assets", "Settings"],
      kpis: {
        revenue: ar ? "الإيرادات" : "Revenue",
        expenses: ar ? "المصروفات" : "Expenses",
        netCash: ar ? "صافي التدفّق" : "Net cash",
        health: ar ? "الصحّة" : "Health",
        healthVal: ar ? "٨٤/١٠٠" : "84/100",
        healthDelta: ar ? "ممتاز" : "Excellent",
      },
      cash: {
        eyebrow: ar ? "التدفّق النقديّ · توقّعات ٩٠ يوماً" : "Cash flow · 90-day forecast",
        title: ar ? "المسار الأرجح" : "Most likely path",
        delta: ar ? "+١٤.٦٪" : "+14.6%",
      },
      alerts: {
        title: ar ? "تنبيهات" : "Alerts",
        late: { l: ar ? "فاتورة متأخّرة" : "Overdue invoice", d: ar ? "المورّد ٣ · ٤,٥٠٠ ر.س" : "Vendor 3 · 4,500" },
        gosi: { l: ar ? "استحقاق التأمينات" : "GOSI due", d: ar ? "خلال ٧ أيّام" : "in 7 days" },
        budget: { l: ar ? "متابعة الميزانيّة" : "Budget check", d: ar ? "التسويق · ضمن الحدّ" : "Marketing · on budget" },
      },
      coachLabel: ar ? "رؤية المساعد: " : "Assistant insight: ",
      coachBody: ar
        ? "تجاوزت مصروفات السفر الميزانيّة الشهريّة بنسبة ١٨٪. أقترح مراجعة سياسة الموافقات على المبالغ فوق ٢,٠٠٠ ر.س."
        : "Travel spend is 18% over the monthly budget. Suggest reviewing the approval policy for items above 2,000.",
      legend: ["Cash Forecast", "Health Score", "What-If Simulator", "Smart Alerts", "AI Coach"],
    },
    predictive: {
      eyebrow: ar ? "الذكاء الاستراتيجيّ" : "Strategic intelligence",
      title: ar ? "رأس مالك،" : "Your capital,",
      title2: ar ? "بعقلٍ يرى الـ٢٤ شهراً القادمة." : "with a mind that sees 24 months ahead.",
      lead: ar
        ? "محرّكٌ تنبّؤيٌّ مدرَّبٌ على دفاترك، وموسميّتك، وعقودك، وسلوك مدفوعاتك. لا يُخبرك فقط أين تقفُ اليوم — يُخبرك متى توظّف، ومتى تؤجّل، وأينَ يُحدِثُ كلُّ ريالٍ أكبرَ أثر."
        : "A predictive engine trained on your books, your seasonality, your contracts, and your payment behavior. Not just where you stand today — when to hire, when to delay, and where each riyal makes the most impact.",
      forecastTitle: ar ? "التوقّع النقديّ · ٢٤ شهراً" : "Cash forecast · 24 months",
      bandLabel: ar ? "نطاق الثقة ٩٠٪" : "90% confidence band",
      scenarios: ar ? [
        { k: "base",         t: "الأساس",            d: "النموّ الحاليّ مستمرّ.",         v: "+١٨٪",  positive: true },
        { k: "aggressive",   t: "توسّع متسارع",       d: "توظيف ٣ مهندسين هذا الربع.",      v: "−٧٪",   positive: false },
        { k: "conservative", t: "تحفّظ تكتيكيّ",      d: "تأجيل غير الجوهريّ ٩٠ يوماً.",    v: "+٣١٪",  positive: true },
      ] : [
        { k: "base",         t: "Baseline",          d: "Current growth holds.",           v: "+18%",  positive: true },
        { k: "aggressive",   t: "Aggressive scale",  d: "Hire 3 engineers this quarter.",  v: "−7%",   positive: false },
        { k: "conservative", t: "Tactical hold",     d: "Defer non-essential 90 days.",    v: "+31%",  positive: true },
      ],
      pillars: ar ? [
        { i: "brain",  t: "محرّك تنبّؤ نقديّ",        b: "نموذجٌ يجمع الموسميّة، عقودك، ومدفوعاتك المتأخّرة، فيرسم مساراً واقعيّاً للنقد لا تخميناً." },
        { i: "scale",  t: "محاكي قرارات",              b: "«ماذا لو وظّفتُ؟ ماذا لو رفعتُ السعر ١٠٪؟» — جوابٌ بالأرقام في ثوانٍ، مع أثرٍ على كلّ بندٍ في القائمة." },
        { i: "compass", t: "بوصلة الأولويّات",         b: "ترتيبٌ آليّ لما يستحقّ انتباهك هذا الأسبوع، مرتّبٌ بالأثر الماليّ لا بترتيب الإشعارات." },
      ] : [
        { i: "brain",  t: "Predictive cash engine",   b: "A model that fuses seasonality, your contracts, and your late payments into a realistic cash path — not a guess." },
        { i: "scale",  t: "Decision simulator",       b: "“What if I hire? What if I raise prices 10%?” — answers in seconds, with the line-item impact on every statement." },
        { i: "compass", t: "Priority compass",        b: "An auto-ranked list of what deserves your attention this week — sorted by financial impact, not notification order." },
      ],
    },
    auditor: {
      eyebrow: ar ? "المدقّق الحيّ" : "Live auditor",
      title: ar ? "كلّ قيدٍ يُراجَعُ لحظةَ كتابته." : "Every entry, audited the moment it lands.",
      lead: ar
        ? "طبقةُ تدقيقٍ مستمرّةٌ تعملُ في الخلفيّة: ترصُدُ الشذوذ، تكتشفُ الازدواج، تتحقّقُ من الامتثال متعدّد الولايات، وتُبرزُ ما يحتاجُ نظرَك — قبل أن يصلَ المدقّقُ الخارجيّ بأشهر."
        : "A continuous audit layer running in the background: it spots anomalies, catches duplicates, validates multi-jurisdiction compliance, and surfaces what needs your eye — months before the external auditor arrives.",
      feedTitle: ar ? "تدفّق المراجعة · مباشر" : "Audit feed · live",
      feedSub: ar ? "آخر ٦٠ ثانية" : "Last 60 seconds",
      signals: ar ? [
        { tone: "warn",   t: "شذوذ في مصروف",          d: "فاتورة مورّد ٢٧٫٤k — أعلى من المعدّل الشهريّ بـ٤٫٢σ.", tag: "AI" },
        { tone: "danger", t: "احتمال ازدواج",          d: "قيدٌ مطابقٌ بنسبة ٩٨٪ سُجِّلَ قبل ساعتين.",         tag: "DUP" },
        { tone: "info",   t: "تحقّق امتثال · ضريبة",   d: "VAT 15% مُطبَّق صحيحاً · فاتورة #٣٠٤١.",            tag: "VAT" },
        { tone: "ok",     t: "موازنة مزدوجة",          d: "٤٢ قيداً — مجموعها صفر، توازنٌ تامّ.",             tag: "OK"  },
      ] : [
        { tone: "warn",   t: "Expense anomaly",         d: "Vendor invoice 27.4k — 4.2σ above monthly mean.",   tag: "AI" },
        { tone: "danger", t: "Likely duplicate",        d: "98% match to entry posted 2h ago.",                 tag: "DUP" },
        { tone: "info",   t: "Tax compliance check",    d: "VAT 15% correctly applied · invoice #3041.",        tag: "VAT" },
        { tone: "ok",     t: "Double-entry balance",    d: "42 entries — net zero, fully balanced.",            tag: "OK"  },
      ],
      jurisdictions: ar ? [
        { c: "السعوديّة", r: "ضريبة القيمة المضافة · الزكاة · ZATCA Phase 2" },
        { c: "الإمارات",   r: "VAT · UAE Corporate Tax · FTA e-invoicing" },
        { c: "مصر",       r: "VAT · ضريبة الدخل · الفوترة الإلكترونيّة" },
        { c: "الكويت",     r: "ضريبة الدخل للشركات · الزكاة" },
      ] : [
        { c: "Saudi Arabia", r: "VAT · Zakat · ZATCA Phase 2"         },
        { c: "UAE",          r: "VAT · UAE Corporate Tax · FTA e-inv." },
        { c: "Egypt",        r: "VAT · Income tax · e-invoicing"       },
        { c: "Kuwait",       r: "Corporate income tax · Zakat"         },
      ],
      jurEyebrow: ar ? "امتثالٌ متعدّد الولايات · مُحدَّثٌ تلقائيّاً" : "Multi-jurisdiction compliance · auto-updated",
    },
    integrations: {
      eyebrow: ar ? "التكاملات" : "Integrations",
      title: ar ? "متّصلٌ بكلِّ ما تستخدمُه شركتُك بالفعل." : "Plugs into the stack your business already runs on.",
      lead: ar
        ? "ZATCA المرحلة الثانية، البنوك السعوديّة، منصّات التجارة المحلّيّة، ومدفوعات الخليج — كلّها مربوطة من اليوم الأوّل، بلا وسطاء ولا تحويلات يدويّة."
        : "ZATCA Phase 2, Saudi banks, regional commerce platforms, and Gulf payment rails — wired in from day one. No middleware, no manual exports.",
      groups: ar ? [
        {
          k: "compliance", t: "الامتثال والفوترة",
          items: [
            { n: "ZATCA · المرحلة ٢", b: "ربطٌ مباشرٌ مع فاتورة" },
            { n: "هيئة الزكاة",        b: "إقرارات تلقائيّة" },
            { n: "GAZT · مصر",         b: "الفوترة الإلكترونيّة" },
            { n: "FTA · الإمارات",     b: "VAT + ضريبة الشركات" },
          ],
        },
        {
          k: "banks", t: "البنوك",
          items: [
            { n: "الراجحي",       b: "كشوفات + مطابقة" },
            { n: "الأهلي السعودي", b: "Open Banking" },
            { n: "الإمارات NBD",   b: "API مباشر" },
            { n: "QNB",            b: "Bank feeds" },
          ],
        },
        {
          k: "commerce", t: "التجارة والمدفوعات",
          items: [
            { n: "سلّة",     b: "مزامنة طلبات + مخزون" },
            { n: "زِد",      b: "Webhook لحظيّ" },
            { n: "فودكس",    b: "نقاط بيع المطاعم" },
            { n: "Mada",     b: "تسوية البطاقات" },
            { n: "STC Pay",  b: "محفظة رقميّة" },
            { n: "Apple Pay", b: "بطاقات + iOS" },
          ],
        },
      ] : [
        {
          k: "compliance", t: "Compliance & e-invoicing",
          items: [
            { n: "ZATCA · Phase 2",   b: "Direct Fatoora link" },
            { n: "Saudi Zakat Auth.",  b: "Automated returns" },
            { n: "Egypt e-Tax",        b: "e-invoicing" },
            { n: "UAE FTA",            b: "VAT + Corp Tax" },
          ],
        },
        {
          k: "banks", t: "Banks",
          items: [
            { n: "Al Rajhi",           b: "Statements + match" },
            { n: "Saudi National",     b: "Open Banking" },
            { n: "Emirates NBD",       b: "Direct API" },
            { n: "QNB",                b: "Bank feeds" },
          ],
        },
        {
          k: "commerce", t: "Commerce & payments",
          items: [
            { n: "Salla",     b: "Order + inventory sync" },
            { n: "Zid",       b: "Live webhooks" },
            { n: "Foodics",   b: "F&B point of sale" },
            { n: "Mada",      b: "Card settlement" },
            { n: "STC Pay",   b: "Digital wallet" },
            { n: "Apple Pay", b: "Cards + iOS" },
          ],
        },
      ],
      footnote: ar ? "وأكثر من ٤٠ تكاملاً جاهزاً عبر REST API و Webhooks." : "Plus 40+ ready integrations via REST API and webhooks.",
      spineTitle: ar ? "طبقة الامتثال الموحّدة" : "Unified compliance layer",
      spineSub:   ar ? "بين الجهات التنظيميّة وبنوكِك ومنافذ بيعك — مزامنةٌ حيّةٌ، بلا وسطاء."
                    : "Between regulators, your banks, and your sales channels — live sync, no middlemen.",
      lanes: {
        regulators: ar ? "الجهات التنظيميّة"   : "Regulators",
        banks:      ar ? "البنوك"               : "Banks",
        commerce:   ar ? "تجارة ونقاط بيع"      : "Commerce & POS",
      },
      live:       ar ? "متّصلٌ ومتزامن" : "Live & synced",
    },
    pricing: {
      eyebrow: ar ? "الأسعار" : "Pricing",
      title: ar ? "اختر موقفك من الماليّة." : "Choose your finance posture.",
      lead: ar
        ? "ثلاثُ مواقفَ، لا ثلاثُ حِزَم. كلّ موقفٍ يفتحُ قدراً مختلفاً من السيطرة على رقمِك التالي."
        : "Three postures, not three plans. Each one unlocks a different degree of control over your next number.",
      billing: { monthly: ar ? "شهريّاً" : "Monthly", yearly: ar ? "سنويّاً · وفّر ٢٠٪" : "Yearly · save 20%" },
      currency: ar ? "ر.س" : "SAR",
      perMonth: ar ? "/شهريّاً" : "/mo",
      mostPopular: ar ? "الموقفُ الأمثل" : "Optimal posture",
      inactionLabel: ar ? "كلفةُ الانتظار · في الشهر" : "Cost of waiting · per month",
      inaction: ar ? [
        { v: "٤٢ ساعة", t: "مطابقةٌ يدويّة في جداول Excel" },
        { v: "٣ مخاطر",  t: "تأخير ZATCA أو خطأ ضريبيّ" },
        { v: "قرارٌ فائت", t: "تحرّكٌ متأخّرٌ على رقمٍ ميّت" },
      ] : [
        { v: "42 hrs",   t: "manual reconciliation in spreadsheets" },
        { v: "3 risks",  t: "ZATCA delays or VAT errors" },
        { v: "1 missed", t: "decision made on a stale number" },
      ],
      forecastCaption: ar ? "ما يراه ذكاؤنا الاستراتيجيّ" : "What our strategic AI sees",
      tiers: ar ? [
        {
          k: "starter", n: "Starter", posture: "اِبدأ بنظافة",
          desc: "للمؤسّسين والشركات الناشئة.",
          price: "٢٤٩",
          features: [
            "حتى ٣ مستخدمين",
            "ZATCA Phase 2 + الزكاة",
            "حتى ٥٠٠ فاتورة شهريّاً",
            "بنك واحد + سلّة/زِد",
            "تقارير IFRS الأساسيّة",
            "دعم بالعربيّة عبر البريد",
          ],
          cta: "ابدأ مجّاناً",
        },
        {
          k: "growth", n: "Growth", posture: "اِقرأ المستقبل", popular: true,
          desc: "للفرق الماليّة المتنامية.",
          price: "٧٤٩",
          features: [
            "حتى ١٠ مستخدمين بصلاحيّات دقيقة",
            "ذكاء استراتيجيّ + توقّع ٢٤ شهراً",
            "فواتير غير محدودة",
            "كلّ التكاملات المحلّيّة + بنوك",
            "متعدّد العملات والشركات",
            "محاكي «ماذا لو»",
            "دعم أولويّة + onboarding مخصّص",
          ],
          cta: "ابدأ تجربة ١٤ يوماً",
        },
        {
          k: "enterprise", n: "Enterprise", posture: "اِحكُم المنظومة",
          desc: "للمجموعات والشركات الكبرى.",
          price: ar ? "تواصل معنا" : "Custom",
          customPrice: true,
          features: [
            "مستخدمون غير محدودين",
            "توحيد متعدّد الكيانات",
            "SSO · SCIM · SAML",
            "بيئة مخصّصة + SLA ٩٩٫٩٩٪",
            "مدير حساب + مهندس حلول",
            "تدقيق أمنيّ مشترك",
            "تخصيص Workflow متقدّم",
          ],
          cta: "تواصل مع المبيعات",
        },
      ] : [
        {
          k: "starter", n: "Starter", posture: "Start clean",
          desc: "For founders and early-stage teams.",
          price: "249",
          features: [
            "Up to 3 users",
            "ZATCA Phase 2 + Zakat",
            "500 invoices per month",
            "1 bank feed + Salla/Zid",
            "Core IFRS reports",
            "Arabic email support",
          ],
          cta: "Start free",
        },
        {
          k: "growth", n: "Growth", posture: "Read the future", popular: true,
          desc: "For growing finance teams.",
          price: "749",
          features: [
            "Up to 10 users with fine-grained roles",
            "Strategic intelligence + 24-mo forecast",
            "Unlimited invoices",
            "All local integrations + banks",
            "Multi-currency · multi-entity",
            "“What-if” simulator",
            "Priority support + onboarding",
          ],
          cta: "Start 14-day trial",
        },
        {
          k: "enterprise", n: "Enterprise", posture: "Command the system",
          desc: "For groups and large enterprises.",
          price: "Custom",
          customPrice: true,
          features: [
            "Unlimited users",
            "Multi-entity consolidation",
            "SSO · SCIM · SAML",
            "Dedicated tenant + 99.99% SLA",
            "Account manager + solutions engineer",
            "Joint security review",
            "Advanced workflow customization",
          ],
          cta: "Contact sales",
        },
      ],
      assurances: ar
        ? ["بدون بطاقة ائتمان", "ألغِ متى شئت", "اضمن استرجاع المبلغ ٣٠ يوماً", "تخفيض ٢٠٪ سنويّاً"]
        : ["No credit card", "Cancel anytime", "30-day money back", "20% off yearly"],
    },
    automation: {
      eyebrow: ar ? "الأتمتة" : "Automation",
      title: ar ? "المهامّ التي تستنزف يومك — تختفي." : "The tasks that drain your day. Gone.",
      lead: ar
        ? "من لحظة وصول الفاتورة إلى بريدك، حتى ظهور أثرها في تقريرك الماليّ — بلا خطوة يدويّة واحدة بينهما."
        : "From the moment an invoice hits your inbox to its impact showing up in your reports — not one manual step in between.",
      beforeTitle: ar ? "اليوم بدون النظام" : "Your day without the system",
      beforeSub:   ar ? "خمس خطوات يدويّة، يوم ونصف انتظار" : "Five manual steps. A day-and-a-half of waiting.",
      afterTitle:  ar ? "اليوم مع محاسب ذكي" : "Your day with Smart Accountant",
      afterSub:    ar ? "خطوة واحدة منك، الباقي يحدث وحده" : "One step from you. The rest just happens.",
      totalLabel:  ar ? "الإجمالي" : "Total",
      manualTotal: ar ? "≈ ١٣ ساعة في الأسبوع" : "≈ 13 hrs / week",
      autoTotal:   ar ? "أقلّ من ١٥ دقيقة" : "Under 15 min",
      manual: ar ? [
        { t: "تجمع الفواتير من ٣ صناديق بريد", time: "٢٢ دقيقة" },
        { t: "تكتب البنود يدويّاً في Excel", time: "١٤ دقيقة" },
        { t: "تختار الحساب الصحيح من ٢٤٠ حساباً", time: "٧ دقائق" },
        { t: "تنتظر موافقة المدير الماليّ", time: "يوم ونصف" },
        { t: "تُحدِّث القائمة الماليّة بنفسك", time: "١١ دقيقة" },
      ] : [
        { t: "Collect invoices from 3 inboxes", time: "22 min" },
        { t: "Type line items into Excel by hand", time: "14 min" },
        { t: "Pick the right account out of 240", time: "7 min" },
        { t: "Wait for the CFO's approval", time: "1.5 days" },
        { t: "Refresh the financial statement yourself", time: "11 min" },
      ],
      auto: ar ? [
        { t: "ينسحب البريد إلى المنصّة", time: "لحظيّ" },
        { t: "النظام يقرأ، يفهم، يقترح القيد", time: "ثانية" },
        { t: "يطابق الحساب الصحيح وفق سياقك", time: "ثانية" },
        { t: "يُوجَّه للموافقة بالقواعد التي وضعتها", time: "دقيقتان" },
        { t: "تنعكس التقارير لحظيّاً", time: "فوريّ" },
      ] : [
        { t: "Inbox auto-syncs into the platform", time: "Instant" },
        { t: "AI reads, understands, drafts the entry", time: "1 sec" },
        { t: "Right account chosen from your context", time: "1 sec" },
        { t: "Routed for approval by your own rules", time: "2 min" },
        { t: "Reports re-render in real time", time: "Instant" },
      ],
      cases: ar ? [
        { t: "فاتورة مورّد", d: "صورة ← استخراج ← قيد مدين/دائن متوازن في الحساب الصحيح، بلا نقرة واحدة.", m: "5210 / 2110 · ٤٥٠.٠٠" },
        { t: "موظّف جديد", d: "أدخل البيانات مرّة واحدة. الراتب الشهريّ، التأمينات (الموظّف والشركة)، ومخصّص نهاية الخدمة — تُحسب آليّاً وفق IAS 19.", m: "6010 / 6011 / 6012" },
        { t: "أصل ثابت", d: "اشترِ الأصل، حدّد عمره النافع، فيُجدوَل الإهلاك حتى آخر شهر تلقائيّاً وفق IFRS.", m: "1500 → 5500 / 1510" },
      ] : [
        { t: "Vendor invoice", d: "Image → extraction → balanced debit/credit posted to the right account, no clicks.", m: "5210 / 2110 · 450.00" },
        { t: "New hire", d: "Enter data once. Monthly salary, social insurance (employee/employer), and EOSB are computed automatically per IAS 19.", m: "6010 / 6011 / 6012" },
        { t: "Fixed asset", d: "Acquire the asset, set its useful life — depreciation is scheduled to the last month, IFRS-aligned.", m: "1500 → 5500 / 1510" },
      ],
    },
    security: {
      eyebrow: ar ? "الأمان والثقة" : "Security & trust",
      title: ar ? "بياناتك الماليّة — محميّة بمعايير المؤسّسات." : "Your financial data — secured to enterprise standards.",
      lead: ar
        ? "لا تنازل في الأمان. كلّ ما يلمسه الذكاء الاصطناعيّ يبقى داخل بيئتك، ولا يُستخدم لتدريب أيّ نموذج خارجيّ."
        : "No shortcuts on security. Everything the AI touches stays in your tenant — never used to train external models.",
      items: ar ? [
        { t: "SOC 2 Type II", d: "تدقيق مستقلّ سنويّ على ضوابط الأمان والتوفّر والسرّيّة.", m: "Audited · Q1 2026" },
        { t: "تشفير من الطرف إلى الطرف", d: "AES-256 للبيانات الساكنة، وTLS 1.3 لها أثناء النقل.", m: "AES-256 · TLS 1.3" },
        { t: "أثر تدقيق وفق IFRS", d: "كلّ قيد له ختم زمنيّ، ومستخدم، وسبب — لا يقبل التعديل.", m: "Immutable ledger" },
        { t: "بيانات مقيمة في المنطقة", d: "خوادم في الرياض ودبيّ. الملكيّة لك، والتصدير متاح في أيّ لحظة.", m: "RUH · DXB · Bahrain" },
      ] : [
        { t: "SOC 2 Type II", d: "Annual independent audit of security, availability, and confidentiality controls.", m: "Audited · Q1 2026" },
        { t: "End-to-end encryption", d: "AES-256 at rest, TLS 1.3 in transit.", m: "AES-256 · TLS 1.3" },
        { t: "IFRS audit trail", d: "Every entry timestamped, attributed, and reasoned — immutable.", m: "Immutable ledger" },
        { t: "Region-resident data", d: "Servers in Riyadh and Dubai. You own your data; export anytime.", m: "RUH · DXB · Bahrain" },
      ],
    },
    useCases: {
      eyebrow: ar ? "من يستخدم محاسب ذكي" : "Who uses Smart Accountant",
      title: ar ? "منتج واحد. ثلاث فرق. نتيجة واحدة: الوضوح." : "One product. Three teams. One outcome: clarity.",
      tabsAria: ar ? "فئات المستخدمين" : "User segments",
      outcomes: ar ? "النتائج" : "Outcomes",
      personas: ar ? [
        {
          key: "founder", tab: "للمؤسّسين",
          headline: "اعرف أرقام شركتك بدقّة، في أيّ لحظة.",
          quote: "«قبل محاسب ذكي، كنت أنتظر نهاية الشهر لأعرف: ربحنا أم خسرنا؟ اليوم أعرف الجواب قبل أن أوافق على المصروف.»",
          author: "هاني الشمريّ · مؤسّس شركة لوجستيّات",
          outcomes: [
            "نقاط صحّة ماليّة تتجدّد يوميّاً",
            "توقّع تدفّق نقديّ لـ ٩٠ يوماً قادمة",
            "محاكاة القرار قبل اتّخاذه: «ماذا لو وظّفت ٣ مهندسين؟»",
            "ملخّص تنفيذيّ بالعربيّة يصلك كلّ أسبوع",
          ],
        },
        {
          key: "accountant", tab: "للمحاسبين",
          headline: "وقتك للقرار، لا للترحيل.",
          quote: "«الذكاء يكتب القيود، وأنا أراجع. وفّرت ١٢ ساعة في الأسبوع، والقوائم تخرج متوازنة من أوّل مرّة.»",
          author: "د. سارة العتيبيّ · CPA · مكتب محاسبة",
          outcomes: [
            "قيود مزدوجة آليّة، قابلة للمراجعة",
            "تطابق فوريّ بين الأستاذ العامّ والقوائم",
            "أثر تدقيق كامل لكلّ قيد ولكلّ تعديل",
            "تصدير مباشر للهيئة · ZATCA-ready",
          ],
        },
        {
          key: "team", tab: "للفِرق الماليّة",
          headline: "فريق واحد. نظام واحد. مصدر حقيقة واحد.",
          quote: "«كنّا نعمل على خمسة ملفّات Excel. اليوم يفتح المدير الماليّ الشاشة نفسها التي يفتحها المحلّل ومسؤول الرواتب.»",
          author: "نورة العليّ · CFO · شركة تقنيّة",
          outcomes: [
            "صلاحيّات بحسب الدور (RBAC) مع سجلّ نشاط",
            "موافقات متعدّدة المستويات على المدفوعات",
            "توحيد متعدّد الشركات والعملات",
            "تقارير IFRS جاهزة للتدقيق فوراً",
          ],
        },
      ] : [
        {
          key: "founder", tab: "For founders",
          headline: "Know your company's numbers, exactly, at any moment.",
          quote: "\"Before Smart Accountant I waited for month-end to know if we made or lost money. Now I know before I approve the expense.\"",
          author: "Hani Al-Shamri · Founder, logistics company",
          outcomes: [
            "Daily-refreshed financial health score",
            "90-day cash forecast",
            "What-if simulation before you decide: \"hire 3 engineers?\"",
            "Weekly executive summary in your inbox",
          ],
        },
        {
          key: "accountant", tab: "For accountants",
          headline: "Your time for decisions, not data entry.",
          quote: "\"The AI writes the entries, I review. I save 12 hours a week — and statements balance the first time.\"",
          author: "Dr. Sarah Al-Otaibi · CPA, accounting firm",
          outcomes: [
            "Auto, reviewable double-entry bookkeeping",
            "Instant GL-to-statements reconciliation",
            "Full audit trail per entry and per edit",
            "Direct authority export, ZATCA-ready",
          ],
        },
        {
          key: "team", tab: "For finance teams",
          headline: "One team. One system. One source of truth.",
          quote: "\"We worked across five Excel files. Now the CFO opens the same cockpit as the analyst and the payroll lead.\"",
          author: "Noura Al-Ali · CFO, tech company",
          outcomes: [
            "Role-based access (RBAC) with activity log",
            "Multi-level approvals on payments",
            "Multi-entity, multi-currency consolidation",
            "Audit-ready IFRS reports, instantly",
          ],
        },
      ],
    },
    compliance: {
      eyebrow: ar ? "تقويم الامتثال · ٢٠٢٦" : "Compliance Calendar · 2026",
      title: ar ? "٤٧ موعداً تنظيميّاً. ٦ دول. صفر فاتك." : "47 deadlines. 6 countries. Zero misses.",
      lead: ar
        ? "كلّ هيئة ضريبيّة في المنطقة لها لُغتها ومواعيدها. نتعقّبها كلّها هنا، ونُذكِّرك قبلها بأسبوع. أنت لا تفتح هذه الصفحة — نحن نُغلقها لك."
        : "Every regulator in MENA speaks its own dialect of deadlines. We track them all here and remind you a week ahead. You don't open this page — we close it for you.",
      stats: [
        { v: ar ? "٤٧" : "47",  l: ar ? "موعداً نتعقّبه" : "deadlines tracked" },
        { v: ar ? "٦"  : "6",   l: ar ? "دول مدعومة"   : "countries covered"  },
        { v: ar ? "٧"  : "7",   l: ar ? "أيّام تذكير مسبق" : "days advance notice" },
        { v: ar ? "٠"  : "0",   l: ar ? "غرامات تأخير عند عملائنا" : "late penalties at our clients" },
      ],
      months: ar
        ? ["ينا","فبر","مار","أبر","ماي","يون","يول","أغس","سبت","أكت","نوف","ديس"]
        : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
      todayLabel: ar ? "اليوم" : "Today",
      legend: [
        { k: "vat",     l: ar ? "ضريبة القيمة المضافة" : "VAT" },
        { k: "income",  l: ar ? "ضريبة الدخل / الشركات" : "Income / Corporate" },
        { k: "zakat",   l: ar ? "زكاة" : "Zakat" },
        { k: "esr",     l: ar ? "ESR / حوكمة" : "ESR / governance" },
        { k: "excise",  l: ar ? "ضرائب انتقائيّة" : "Excise" },
      ] as const,
      countries: [
        {
          k: "sa", flag: "🇸🇦", n: ar ? "السعوديّة" : "Saudi Arabia", regulator: "ZATCA",
          ds: [
            { m: 1,  k: "vat",     t: ar ? "إقرار VAT يناير" : "VAT return Jan" },
            { m: 4,  k: "vat",     t: ar ? "إقرار VAT أبريل" : "VAT return Apr" },
            { m: 4,  k: "zakat",   t: ar ? "زكاة سنويّة" : "Annual Zakat" },
            { m: 4,  k: "income",  t: ar ? "ضريبة الشركات" : "Corporate tax" },
            { m: 7,  k: "vat",     t: ar ? "إقرار VAT يوليو" : "VAT return Jul" },
            { m: 10, k: "vat",     t: ar ? "إقرار VAT أكتوبر" : "VAT return Oct" },
          ],
        },
        {
          k: "ae", flag: "🇦🇪", n: ar ? "الإمارات" : "UAE", regulator: "FTA",
          ds: [
            { m: 1,  k: "vat",     t: ar ? "VAT 201 ر١" : "VAT 201 Q1" },
            { m: 4,  k: "vat",     t: ar ? "VAT 201 ر٢" : "VAT 201 Q2" },
            { m: 6,  k: "esr",     t: ar ? "إخطار ESR" : "ESR notification" },
            { m: 7,  k: "vat",     t: ar ? "VAT 201 ر٣" : "VAT 201 Q3" },
            { m: 9,  k: "income",  t: ar ? "ضريبة الشركات" : "Corporate tax" },
            { m: 10, k: "vat",     t: ar ? "VAT 201 ر٤" : "VAT 201 Q4" },
            { m: 12, k: "esr",     t: ar ? "تقرير ESR" : "ESR report" },
          ],
        },
        {
          k: "eg", flag: "🇪🇬", n: ar ? "مصر" : "Egypt", regulator: "ETA",
          ds: [
            { m: 2,  k: "vat",     t: ar ? "VAT شهريّ" : "Monthly VAT" },
            { m: 4,  k: "income",  t: ar ? "إقرار شركات" : "Corporate filing" },
            { m: 5,  k: "vat",     t: ar ? "VAT شهريّ" : "Monthly VAT" },
            { m: 8,  k: "vat",     t: ar ? "VAT شهريّ" : "Monthly VAT" },
            { m: 11, k: "vat",     t: ar ? "VAT شهريّ" : "Monthly VAT" },
          ],
        },
        {
          k: "kw", flag: "🇰🇼", n: ar ? "الكويت" : "Kuwait", regulator: "MoF",
          ds: [
            { m: 1,  k: "excise",  t: ar ? "ضريبة انتقائيّة ر١" : "Excise Q1" },
            { m: 4,  k: "zakat",   t: ar ? "زكاة سنويّة" : "Annual Zakat" },
            { m: 4,  k: "income",  t: ar ? "ضريبة دخل" : "Income tax" },
            { m: 7,  k: "excise",  t: ar ? "انتقائيّة ر٢" : "Excise Q2" },
            { m: 10, k: "excise",  t: ar ? "انتقائيّة ر٣" : "Excise Q3" },
          ],
        },
        {
          k: "qa", flag: "🇶🇦", n: ar ? "قطر" : "Qatar", regulator: "GTA",
          ds: [
            { m: 4,  k: "income",  t: ar ? "ضريبة دخل" : "Income tax" },
            { m: 6,  k: "esr",     t: ar ? "تقارير DTT" : "DTT reports" },
            { m: 7,  k: "excise",  t: ar ? "انتقائيّة ر٢" : "Excise Q2" },
            { m: 10, k: "excise",  t: ar ? "انتقائيّة ر٣" : "Excise Q3" },
          ],
        },
        {
          k: "jo", flag: "🇯🇴", n: ar ? "الأردن" : "Jordan", regulator: "ISTD",
          ds: [
            { m: 3,  k: "vat",     t: ar ? "VAT ثنائيّ" : "Bi-monthly VAT" },
            { m: 4,  k: "income",  t: ar ? "ضريبة دخل" : "Income tax" },
            { m: 5,  k: "vat",     t: ar ? "VAT ثنائيّ" : "Bi-monthly VAT" },
            { m: 7,  k: "vat",     t: ar ? "VAT ثنائيّ" : "Bi-monthly VAT" },
            { m: 9,  k: "vat",     t: ar ? "VAT ثنائيّ" : "Bi-monthly VAT" },
            { m: 11, k: "vat",     t: ar ? "VAT ثنائيّ" : "Bi-monthly VAT" },
          ],
        },
      ] as const,
      caption: ar
        ? "البيانات أعلاه مأخوذة من أحدث جداول ZATCA · FTA · ETA · MoF · GTA · ISTD. نُحدّثها أسبوعيّاً."
        : "Sourced from the latest ZATCA · FTA · ETA · MoF · GTA · ISTD calendars. Updated weekly.",
    },
    manifesto: {
      eyebrow: ar ? "بيان" : "Manifesto",
      kicker: ar ? "نحن نؤمن بأنّ" : "We believe that",
      lines: ar ? [
        { t: "الماليّة لغةٌ", em: "تستحقّ من يُتقنها" },
        { t: "والمحاسبة ذاكرةٌ", em: "تستحقّ من يحرسها" },
        { t: "وكلّ قرارٍ مُؤجَّل", em: "ضريبةٌ على المستقبل" },
      ] : [
        { t: "Finance is a language",   em: "that deserves to be spoken well." },
        { t: "Accounting is a memory",  em: "that deserves to be guarded." },
        { t: "Every deferred decision", em: "is a tax on the future." },
      ],
      footnote: ar
        ? "لذلك بنينا منصّةً لا تعدّ لك فحسب — بل تُفكّر معك."
        : "That is why we built a platform that doesn't just count — it thinks with you.",
      sig: ar ? "محاسب ذكي · فريق التأسيس" : "Smart Accountant · founding team",
    },
    productTour: {
      eyebrow: ar ? "داخل المنتج" : "Inside the product",
      title: ar ? "هذه ليست رسومات. هذه الشاشات نفسها." : "Not diagrams. These are the actual screens.",
      lead: ar
        ? "كلّ وحدة هنا تعمل اليوم — عربيّةٌ في الجوهر منذ السطر الأوّل، ومُعتمدةٌ من الهيئات التنظيميّة في كلّ سوق نخدمه."
        : "Every module here ships today — Arabic-first from the first line of code, certified by the regulators in every market we serve.",
      modules: ar ? [
        {
          k: "invoice", n: "وحدة ٠١",
          title: "فاتورة معتمدة من ZATCA — دفعة واحدة.",
          body: "ارسم الفاتورة، أضف البنود، وأرسلها. التطبيق يحسب الضريبة، يولّد رمز QR التوقيع، ويُرسلها بطريقتك المُفضّلة — بريد، WhatsApp، أو رابط دفع.",
          bullets: ["رمز QR متوافق مع المرحلة الثانية", "إرسال عبر WhatsApp مدمج", "قوالب لا تنتهي · علامتك التجاريّة"],
          align: "right",
        },
        {
          k: "vat", n: "وحدة ٠٢",
          title: "إقرار VAT جاهز للتقديم — بنقرة.",
          body: "الإقرار يُملأ من نفسه طوال الربع. عند الموعد، تجد كلّ الأرقام منطبقة على نموذج هيئة الزكاة، تراجع، تُقدِّم، تنتهي.",
          bullets: ["مطابقة لحظيّة مع الأستاذ العامّ", "تنبيه قبل ١٤ يوماً من موعد التقديم", "أثر تدقيق كامل لكلّ بند في الإقرار"],
          align: "left",
        },
        {
          k: "multi", n: "وحدة ٠٣",
          title: "كيانات متعدّدة، عملات متعدّدة، حقيقة واحدة.",
          body: "أَدِر كلّ شركاتك من حساب واحد. كلّ كيان بعملته ودولته وضريبته، والتوحيد يحدث آليّاً وفق IFRS 10.",
          bullets: ["٧ هيئات تنظيميّة في الحساب نفسه", "توحيد فوريّ بسعر الصرف الحقيقيّ", "صلاحيّات متفرّعة لكلّ كيان"],
          align: "right",
        },
        {
          k: "command", n: "وحدة ٠٤",
          title: "كلّ شيء على بُعد ⌘K.",
          body: "اطبع ما تريد فعله — لا أين هو في القائمة. النظام يفهم: «فاتورة لـعميل جدّة»، «تقرير الربع»، «أوقف موافقة الدفع لمطعم النور».",
          bullets: ["لغة طبيعيّة، عربيّ وإنجليزيّ", "تنفيذ مباشر — ليس مجرّد بحث", "اختصارات قابلة للتخصيص"],
          align: "left",
        },
      ] : [
        {
          k: "invoice", n: "Module 01",
          title: "ZATCA-cleared invoices — one shot.",
          body: "Draft, add items, send. The app computes the tax, generates the signed QR, and sends it your way — email, WhatsApp, or a pay-link.",
          bullets: ["Phase-2 compliant QR code", "WhatsApp send, built in", "Endless templates · your brand"],
          align: "right",
        },
        {
          k: "vat", n: "Module 02",
          title: "A VAT return that's ready to file — one click.",
          body: "The return self-fills all quarter. When it's due, every number is mapped to ZATCA's form. Review, file, done.",
          bullets: ["Live ledger reconciliation", "14-day filing-deadline alerts", "Full audit trail per return line"],
          align: "left",
        },
        {
          k: "multi", n: "Module 03",
          title: "Many entities, many currencies, one truth.",
          body: "Run all your companies from one account. Every entity in its currency, country, and tax — consolidation runs automatically per IFRS 10.",
          bullets: ["7 regulators in the same account", "Real-time consolidation at live FX", "Per-entity branched permissions"],
          align: "right",
        },
        {
          k: "command", n: "Module 04",
          title: "Everything is one ⌘K away.",
          body: "Type what you want to do — not where it lives. The system understands: \"invoice for the Jeddah customer\", \"this quarter's report\", \"hold payment for Al-Noor restaurant\".",
          bullets: ["Natural language, Arabic & English", "Direct execution — not just search", "Customizable keyboard shortcuts"],
          align: "left",
        },
      ],
    },
    testimonials: {
      eyebrow: ar ? "الذين انتقلوا إلينا" : "Who switched to us",
      title: ar
        ? "ليست شعاراتٍ على شريحة. أرقامٌ، أسماءٌ، ومدنٌ — وكلّ ساعةٍ مُستردّة موثّقة."
        : "Not logos on a slide. Numbers, names, and cities — every recovered hour documented.",
      lead: ar
        ? "كلّ شهادةٍ هنا تأتي مع الأثر الذي يمكن قياسه: ساعات وفّرناها، أيّامٌ اختصرناها، رياضٌ لم تُهدر. اطلبها بالاسم وسنُريك الفاتورة."
        : "Every quote here ships with measurable impact: hours saved, days cut, riyals not wasted. Ask us by name and we'll show you the receipts.",
      stats: ar ? [
        { n: "+٤٬٢٠٠", l: "مالك أعمال نشط",        s: "+١٢٪ شهريّاً" },
        { n: "٧",       l: "دول · ٤ هيئات تنظيميّة", s: "السعوديّة، الإمارات، مصر…" },
        { n: "٢٫١ مليار ر.س", l: "فُوتر عبر النظام في ٢٠٢٥", s: "بزيادة ٣٫٤× عن ٢٠٢٤" },
        { n: "٪٩٩٫٩٧",  l: "وقت تشغيل مُؤكَّد",      s: "آخر ١٢ شهراً · status.smart.sa" },
      ] : [
        { n: "4,200+",  l: "active business owners",      s: "+12% month over month" },
        { n: "7",       l: "countries · 4 regulators",    s: "KSA, UAE, Egypt, and more" },
        { n: "SAR 2.1B+", l: "invoiced through us in 2025", s: "3.4× growth over 2024" },
        { n: "99.97%",  l: "verified uptime",             s: "trailing 12 mo · status.smart.sa" },
      ],
      switchedLabel: ar ? "حلّوا محلّ:" : "Replacing:",
      switchedFrom: ["QuickBooks", "Xero", "Zoho Books", "SAP", "Microsoft Excel"],
      featured: ar ? {
        q: "في اليوم التاسع من الإطلاق، أَغلقتُ الربع الأوّل قبل موعده بأسبوع، وأرسلتُ الإقرار الضريبيّ بنقرتَين. كنّا ندفع لـ QuickBooks أربعة آلاف ريال شهريّاً ومحاسباً خارجيّاً ضعفها — اليوم النظام يفعل ما يفعلانه ويرى ما لا يرَيانه. أصبحت الماليّة عندنا غرفةً مضاءة لا غرفةً تخاف الدخول إليها.",
        n: "ريما خالد",
        r: "المديرة الماليّة",
        c: "شركة الواحة للتجارة · جدّة 🇸🇦",
        since: "عميلة منذ مارس ٢٠٢٤",
        kpis: [
          { v: "١٤ ساعة", l: "وفّرتها أسبوعيّاً" },
          { v: "٧ أيّام",   l: "إغلاق الربع · من ١٩ يوماً" },
          { v: "٠",          l: "موعد ZATCA فاتني" },
        ],
        switched: "QuickBooks Online",
      } : {
        q: "Nine days after launch, I closed Q1 a week early and filed VAT in two clicks. We were paying QuickBooks SAR 4K/month and an outsourced accountant twice that — today the platform does what they did and sees what they missed. Finance became a lit room, not one we feared walking into.",
        n: "Reema Khaled",
        r: "Chief Financial Officer",
        c: "Al-Waha Trading · Jeddah 🇸🇦",
        since: "Customer since March 2024",
        kpis: [
          { v: "14 hrs", l: "recovered every week" },
          { v: "7 days",  l: "to close Q · was 19" },
          { v: "0",       l: "ZATCA deadlines missed" },
        ],
        switched: "QuickBooks Online",
      },
      items: ar ? [
        {
          q: "ثلاث شركات في ثلاث دول، وكنتُ أعيش بين ثلاثة أنظمة. اليوم أراها كلّها على شاشة واحدة، مُوحَّدةً بـ ر.س لحظيّاً.",
          n: "ياسر الحمّادي", r: "الرئيس التنفيذيّ",
          c: "مجموعة الحمّادي القابضة · دبي 🇦🇪",
          ind: "مجموعة قابضة", since: "منذ ٢٠٢٣",
          kpi: { v: "٪٤١", l: "اختصار وقت التوحيد الشهريّ" },
          switched: "Xero + Excel",
        },
        {
          q: "أرسل الفاتورة عبر WhatsApp، يدفعها العميل من نفس الرابط، وأرى القيد منعكساً في الأستاذ قبل أن أُغلق الشاشة.",
          n: "نور الدين الفقيه", r: "صاحب مؤسّسة",
          c: "النور للحلول الرقميّة · القاهرة 🇪🇬",
          ind: "خدمات تقنيّة", since: "منذ ٢٠٢٥",
          kpi: { v: "٢٫٣ يوم", l: "متوسّط التحصيل · من ١٧ يوماً" },
          switched: "Zoho Books",
        },
        {
          q: "لمّا سألتُه عن سيولة الربع القادم، أعطاني الإجابة بعربيّة فصيحة وجدولاً يُظهر التحدّي قبل ثلاثة أشهر من حدوثه.",
          n: "عبدالرحمن الكواري", r: "مدير العمليّات",
          c: "الخليج للمقاولات · الدوحة 🇶🇦",
          ind: "مقاولات وإنشاءات", since: "منذ ٢٠٢٤",
          kpi: { v: "٣ أشهر", l: "تنبؤّ مسبق بنقص السيولة" },
          switched: "SAP Business One",
        },
        {
          q: "المدقّق الخارجيّ طلب الوصول، فتحتُ له حساباً للقراءة فقط في دقيقة. خرج راضياً، وأنا لم أُرسل ملفّاً واحداً.",
          n: "ليلى العتيبي", r: "محاسبة قانونيّة",
          c: "مكتب العتيبي للاستشارات · الكويت 🇰🇼",
          ind: "استشارات ماليّة", since: "منذ ٢٠٢٥",
          kpi: { v: "٠ ملفّ", l: "أُرسل خارج النظام في تدقيق ٢٠٢٥" },
          switched: "Excel + Google Drive",
        },
        {
          q: "كنّا ندفع لمحاسب خارجيّ ٤٬٥٠٠ ريال شهريّاً. اليوم نملك النظام، والتقارير، والوقت — بثُلث المبلغ.",
          n: "خالد المعشّر", r: "مؤسِّس",
          c: "كنفّة للمأكولات · عمّان 🇯🇴",
          ind: "مطاعم وضيافة", since: "منذ ٢٠٢٤",
          kpi: { v: "٪٦٧", l: "خفض تكلفة المحاسبة الشهريّة" },
          switched: "محاسب خارجيّ",
        },
        {
          q: "في الموسم، نُصدر ٤٠٠ فاتورة في أسبوع. النظام يُدير الموقف بهدوء — لا ساعة عمل ضائعة، لا فاتورة منسيّة، لا VAT خاطئ.",
          n: "هند الشهراني", r: "مديرة العمليّات",
          c: "أنوار الديكور · الرياض 🇸🇦",
          ind: "تنظيم فعاليّات", since: "منذ ٢٠٢٤",
          kpi: { v: "٤٠٠ فاتورة", l: "في أسبوع ذروة · بـ٠ خطأ" },
          switched: "نظام داخليّ مخصّص",
        },
      ] : [
        {
          q: "Three companies, three countries — I used to live between three systems. Today I see them on one screen, consolidated in SAR in real time.",
          n: "Yasser Al-Hammadi", r: "Chief Executive Officer",
          c: "Al-Hammadi Holding · Dubai 🇦🇪",
          ind: "Holding group", since: "Since 2023",
          kpi: { v: "−41%", l: "monthly consolidation time" },
          switched: "Xero + Excel",
        },
        {
          q: "I send the invoice over WhatsApp, the client pays from the same link, and the entry hits the ledger before I close the tab.",
          n: "Noureddine Al-Faqih", r: "Founder",
          c: "Al-Noor Digital · Cairo 🇪🇬",
          ind: "Tech services", since: "Since 2025",
          kpi: { v: "2.3 days", l: "avg collection · was 17" },
          switched: "Zoho Books",
        },
        {
          q: "When I asked about next quarter's liquidity, it answered in fluent Arabic with a chart showing the squeeze three months before it happened.",
          n: "Abdulrahman Al-Kuwari", r: "Chief Operating Officer",
          c: "Gulf Contracting · Doha 🇶🇦",
          ind: "Construction", since: "Since 2024",
          kpi: { v: "3 months", l: "advance liquidity warning" },
          switched: "SAP Business One",
        },
        {
          q: "The external auditor asked for access. I opened a read-only account in a minute. He left satisfied — and I sent zero files.",
          n: "Layla Al-Otaibi", r: "Chartered accountant",
          c: "Al-Otaibi Advisory · Kuwait City 🇰🇼",
          ind: "Financial advisory", since: "Since 2025",
          kpi: { v: "0 files", l: "sent outside the system in 2025 audit" },
          switched: "Excel + Google Drive",
        },
        {
          q: "We used to pay an outside accountant SAR 4,500/month. Today we own the system, the reports, and the time — at one-third the cost.",
          n: "Khaled Al-Mu'asher", r: "Founder",
          c: "Knafeh & Co. · Amman 🇯🇴",
          ind: "Restaurants & hospitality", since: "Since 2024",
          kpi: { v: "−67%", l: "monthly accounting cost" },
          switched: "Outsourced accountant",
        },
        {
          q: "In peak season we issue 400 invoices a week. The platform handles it without flinching — no lost hour, no forgotten invoice, no wrong VAT.",
          n: "Hind Al-Shahrani", r: "Operations Director",
          c: "Anwar Decor · Riyadh 🇸🇦",
          ind: "Events & production", since: "Since 2024",
          kpi: { v: "400 invoices", l: "in a peak week · 0 errors" },
          switched: "Custom in-house tool",
        },
      ],
    },
    faq: {
      eyebrow: ar ? "الأسئلة الشائعة" : "Frequently asked",
      title: ar ? "سؤال مباشر، إجابة مباشرة." : "Straight question, straight answer.",
      qs: ar ? [
        { q: "هل النظام متوافق فعلاً مع IFRS؟", a: "نعم. النظام مبنيّ من الأساس وفق IFRS: قيد مزدوج إلزاميّ، دليل حسابات قياسيّ، اعتراف بالإيراد، إهلاك الأصول، مخصّص نهاية الخدمة (IAS 19)، وقوائم ماليّة تُولَّد آليّاً. ولكلّ دولة حزمة محلّيّة فوق هذا الأساس." },
        { q: "هل تُستخدم بياناتي لتدريب نماذج الذكاء الاصطناعيّ؟", a: "لا. بياناتك ملكك وحدك. يعمل الذكاء الاصطناعيّ داخل بيئتك، ولا يُشارَك منها شيء مع أيّ نموذج خارجيّ لأغراض التدريب. هذا منصوص عليه في عقد الخدمة، وقابل للتدقيق." },
        { q: "ما الدول المدعومة؟", a: "حاليّاً: السعوديّة، الإمارات، مصر، الكويت، قطر، الأردنّ، وحزمة International. تشمل كلّ حزمة: العملة، ضريبة القيمة المضافة، الزكاة (حيث تنطبق)، التأمينات، صيغة نهاية الخدمة، إجازات العمل، والتقويم المحلّيّ." },
        { q: "كم يستغرق الإعداد؟", a: "أقلّ من خمس دقائق للحساب الأوّل. اختر الدولة، أنشئ الشركة، وستجد دليل الحسابات وفق IFRS جاهزاً. الفرق الكبيرة عادةً تُكمل الإعداد الشامل (ربط البنوك، استيراد البيانات، الصلاحيّات) في يومين." },
        { q: "هل يمكن استيراد بياناتي من نظام آخر؟", a: "نعم. نستورد من Excel وQuickBooks وXero وZoho Books وSAP. أثناء الاستيراد، يفحص الذكاء الاصطناعيّ الترميز ويقترح المطابقات لدليل حساباتك وفق IFRS." },
        { q: "هل يدعم النظام التدقيق الخارجيّ؟", a: "نعم. أثر التدقيق كامل، ولا يقبل التعديل. يمكنك إنشاء حساب «مدقّق خارجيّ» بصلاحيّات قراءة فقط على كلّ القيود والمستندات الداعمة." },
      ] : [
        { q: "Is the system genuinely IFRS-compliant?", a: "Yes. It's built IFRS-first: enforced double-entry, a standard chart of accounts, revenue recognition, asset depreciation, end-of-service provision (IAS 19), and auto-generated statements. Each country adds a local pack on top." },
        { q: "Do you train AI models on my data?", a: "No. Your data is yours. The AI runs in your tenant and never shares anything with external models for training. It's written in your service agreement and auditable." },
        { q: "Which countries are supported?", a: "Today: Saudi Arabia, UAE, Egypt, Kuwait, Qatar, Jordan, plus an International pack. Each includes currency, VAT, Zakat (where applicable), social insurance, end-of-service formula, work calendars, and the local calendar." },
        { q: "How long does setup take?", a: "Under five minutes for the first account. Pick the country, create the company, and you'll find a ready IFRS chart of accounts. Larger teams typically complete full setup (bank connections, data import, roles) in two days." },
        { q: "Can I import data from another system?", a: "Yes. We import from Excel, QuickBooks, Xero, Zoho Books, and SAP. During import, the AI inspects coding and suggests mappings to your IFRS chart of accounts." },
        { q: "Does it support external audit?", a: "Yes. The audit trail is full and immutable, with the ability to create a read-only \"external auditor\" account across all entries and supporting documents." },
      ],
    },
    finalCta: {
      h1: ar ? "ابدأ بإدارة ماليّتك" : "Start running your finances",
      h2: ar ? "كما تستحقّ." : "the way they deserve.",
      sub: ar ? "١٤ يوماً مجاناً. كلّ المزايا. بدون بطاقة. ألغِ متى شئت." : "14 days free. Every feature. No card. Cancel anytime.",
      cta: ar ? "افتح التطبيق" : "Open the app",
      ctaDemo: ar ? "تحدّث إلى المبيعات" : "Talk to sales",
      orWatch: ar ? "أو شاهد" : "Or watch",
      orLink: ar ? "جولة في ٣ دقائق" : "a 3-minute tour",
      orWatchSuffix: ".",
    },
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const { locale, dir } = useLocale()
  const t = getCopy(locale)
  // Session-aware: signed-in visitors land directly in the app; guests
  // see Sign in / Sign up.
  const { isAuthenticated, isLoading } = useAuth()
  const openAppHref = !isLoading && isAuthenticated ? "/app" : "/signin"
  const signInHref = !isLoading && isAuthenticated ? "/app" : "/signin"

  return (
    <div className="bg-background text-foreground" dir={dir} lang={locale}>
      <AppNavbar
        links={[
          { label: t.nav.platform,     href: "#platform" },
          { label: t.nav.intelligence, href: "#intelligence" },
          { label: t.nav.integrations, href: "#integrations" },
          { label: t.nav.security,     href: "#security" },
          { label: t.nav.pricing,      href: "#pricing" },
          { label: t.nav.faq,          href: "#faq" },
        ]}
        ctaLabel={t.nav.openApp}
        ctaHref={openAppHref}
        secondaryLabel={t.nav.demo}
        secondaryHref="/demo"
        tertiaryLabel={t.nav.signIn}
        tertiaryHref={signInHref}
      />
      <ReadingProgress ar={t.ar} />
      <ChapterIndex ar={t.ar} />
      <main className="overflow-x-clip">
        <Hero t={t} />
        <Manifesto t={t} />
        <TrustStrip t={t} />
        <WhyDifferent t={t} />
        <CoreCapabilities t={t} />
        <AIAssistant t={t} />
        <DashboardShowcase t={t} />
        <ProductTour t={t} />
        <PredictiveCapital t={t} />
        <Automation t={t} />
        <LiveAuditor t={t} />
        <LocalIntegrations t={t} />
        <ComplianceCalendar t={t} />
        <Security t={t} />
        <UseCases t={t} />
        <Testimonials t={t} />
        <Interstitial ar={t.ar} />
        <Pricing t={t} />
        <FAQ t={t} />
        <FinalCTA t={t} />
      </main>
      <AppFooter />
    </div>
  )
}

/* Direction-aware arrow used in CTAs (points toward the reading flow's end). */
function CtaArrow({ ar }: { ar: boolean }) {
  return ar ? <ArrowLeft className="size-4" /> : <ArrowRight className="size-4" />
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Editorial chapter opener — used by every section to establish narrative   */
/*  spine. Massive serif title (Latin) / weighted Arabic, chapter mark,       */
/*  optional italic resolve line, optional lead. Adapts to dark/light bands.  */
/* ────────────────────────────────────────────────────────────────────────── */

function Chapter({
  num, eyebrow, title, italic, lead, ar, dark = false, align = "split",
}: {
  num: string
  eyebrow?: string
  title: React.ReactNode
  italic?: React.ReactNode
  lead?: React.ReactNode
  ar: boolean
  dark?: boolean
  align?: "split" | "stack"
}) {
  const ink  = dark ? "text-background" : "text-foreground"
  const mute = dark ? "text-background/65" : "text-muted-foreground"
  const line = dark ? "bg-background/15" : "bg-border"

  const head = (
    <>
      <div className={cn("flex items-baseline gap-3 mb-7 lg:mb-9", mute)}>
        <span className="font-mono text-2xs tracking-[0.28em] uppercase">
          ch · {num}
        </span>
        <span aria-hidden className={cn("h-px flex-1", line)} />
        {eyebrow && (
          <span className={cn("text-2xs", ar ? "tracking-normal" : "font-mono uppercase tracking-[0.18em]")}>
            {eyebrow}
          </span>
        )}
      </div>
      <h2
        className={cn(
          "text-[clamp(2.25rem,5.4vw,4.25rem)]",
          ar ? "font-semibold tracking-normal leading-[1.18]" : "font-display tracking-[-0.025em] leading-[0.98]",
          ink,
        )}
      >
        {title}
        {italic && (
          <>
            <br />
            <span className={cn(ar ? "font-semibold opacity-60" : "display-italic opacity-65")}>
              {italic}
            </span>
          </>
        )}
      </h2>
    </>
  )

  if (align === "stack" || !lead) {
    return (
      <div className="max-w-4xl mb-14 lg:mb-20">
        {head}
        {lead && (
          <p className={cn("mt-7 max-w-2xl text-lg lg:text-xl leading-[1.6]", dark ? "text-background/80" : "text-foreground/80")}>
            {lead}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 mb-16 lg:mb-24">
      <div className="lg:col-span-6">{head}</div>
      <div className="lg:col-span-5 lg:col-start-8 lg:pt-10">
        <p className={cn("text-lg lg:text-xl leading-[1.6]", dark ? "text-background/82" : "text-foreground/82")}>
          {lead}
        </p>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Chapter index — quiet floating right rail (LTR) / left rail (RTL).        */
/*  Editorial magazine convention: a printed table-of-contents that "lives"   */
/*  alongside the body. Active chapter highlights as the reader scrolls.       */
/*  Hidden below lg to preserve mobile reading rhythm.                         */
/* ────────────────────────────────────────────────────────────────────────── */

const CHAPTER_TOC: ReadonlyArray<{ n: string; id: string; ar: string; en: string }> = [
  { n: "00", id: "belief",       ar: "إيمان",        en: "Belief"        },
  { n: "01", id: "trust",        ar: "ثقة",          en: "Trust"         },
  { n: "02", id: "platform",     ar: "مبادئ",        en: "Principles"    },
  { n: "03", id: "capabilities", ar: "قدرات",        en: "Capabilities"  },
  { n: "04", id: "ai",           ar: "ذكاء",         en: "Intelligence"  },
  { n: "05", id: "showcase",     ar: "كوكبت",        en: "Cockpit"       },
  { n: "06", id: "modules",      ar: "موديولز",      en: "Modules"       },
  { n: "07", id: "intelligence", ar: "تنبّؤ",         en: "Foresight"     },
  { n: "08", id: "automation",   ar: "تشغيل آليّ",   en: "Automation"    },
  { n: "09", id: "auditor",      ar: "تدقيق",        en: "Audit"         },
  { n: "10", id: "integrations", ar: "تكاملات",      en: "Integrations"  },
  { n: "11", id: "compliance",   ar: "امتثال",       en: "Compliance"    },
  { n: "12", id: "security",     ar: "أمان",         en: "Security"      },
  { n: "13", id: "use-cases",    ar: "حالات",        en: "Use cases"     },
  { n: "14", id: "customers",    ar: "شهادات",       en: "Voices"        },
  { n: "15", id: "pricing",      ar: "خطط",          en: "Plans"         },
  { n: "16", id: "faq",          ar: "أسئلة",        en: "Questions"     },
  { n: "17", id: "cta",          ar: "خاتمة",        en: "Close"         },
] as const

function ChapterIndex({ ar }: { ar: boolean }) {
  const [active, setActive] = useState<string>("belief")

  useEffect(() => {
    const targets = CHAPTER_TOC
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null)

    if (targets.length === 0) return

    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top of the viewport that is intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0 && visible[0].target.id) {
          setActive(visible[0].target.id)
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    )
    targets.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <nav
      aria-label={ar ? "فهرس الفصول" : "Chapter index"}
      className={cn(
        "hidden lg:flex fixed top-1/2 -translate-y-1/2 z-30 flex-col gap-1.5 select-none",
        ar ? "left-6" : "right-6",
      )}
      data-testid="chapter-index"
    >
      {CHAPTER_TOC.map((c) => {
        const isActive = active === c.id
        const label = ar ? c.ar : c.en
        return (
          <a
            key={c.id}
            href={`#${c.id}`}
            data-testid={`chapter-link-${c.id}`}
            className={cn(
              "group flex items-center gap-2.5 py-0.5 transition-colors",
              ar ? "flex-row-reverse" : "flex-row",
              isActive
                ? "text-foreground"
                : "text-muted-foreground/55 hover:text-foreground/80",
            )}
          >
            <span
              className={cn(
                "font-mono text-[10px] tabular-nums tracking-[0.18em]",
                isActive ? "opacity-100" : "opacity-65",
              )}
            >
              {c.n}
            </span>
            <span
              aria-hidden
              className={cn(
                "h-px transition-all duration-300",
                isActive
                  ? "w-7 bg-foreground"
                  : "w-3 bg-foreground/25 group-hover:w-5 group-hover:bg-foreground/55",
              )}
            />
            <span
              className={cn(
                "text-[10.5px] tracking-wide transition-opacity",
                ar ? "tracking-normal" : "uppercase font-mono",
                isActive
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-80",
              )}
            >
              {label}
            </span>
          </a>
        )
      })}
    </nav>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Reading progress — 1px emerald hairline at the very top of the viewport,  */
/*  fills as the reader descends. Long-form journalism convention (NYT, The   */
/*  Atlantic). Pairs with ChapterIndex: index = where, progress = how far.    */
/*  Ignored by users on small screens? No — the hairline is universal.        */
/* ────────────────────────────────────────────────────────────────────────── */

function ReadingProgress({ ar }: { ar: boolean }) {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    let raf = 0
    const update = () => {
      const doc = document.documentElement
      const total = doc.scrollHeight - window.innerHeight
      const next = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0
      setPct(next)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  return (
    <div
      aria-hidden
      className="fixed top-0 inset-x-0 z-40 h-px pointer-events-none"
    >
      <div
        className="h-full bg-primary/85"
        style={{
          width: `${(pct * 100).toFixed(2)}%`,
          marginLeft: ar ? "auto" : undefined,
          marginRight: ar ? undefined : "auto",
          transition: "width 90ms linear",
        }}
        data-testid="reading-progress"
      />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Interstitial — an unnumbered "breath" between chapters. Editorial books   */
/*  use blank pages or epigraphs to mark a tonal shift; SaaS pages never do.  */
/*  Placed between Voices (14) and Plans (15) to slow the reader before       */
/*  commerce. Pure typography on quiet ground; no chapter mark.                */
/* ────────────────────────────────────────────────────────────────────────── */

function Interstitial({ ar }: { ar: boolean }) {
  return (
    <section
      className="relative bg-background border-b border-border"
      data-testid="section-interstitial"
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-32 lg:py-44 text-center">
        {/* Top centered hairline mark — like a printer's ornament. */}
        <div className="mx-auto mb-12 lg:mb-16 inline-flex items-center gap-3 text-muted-foreground">
          <span aria-hidden className="h-px w-10 bg-border" />
          <span aria-hidden className="size-1 rounded-full bg-primary/70" />
          <span aria-hidden className="h-px w-10 bg-border" />
        </div>

        <p
          className={cn(
            "mx-auto max-w-3xl text-balance",
            ar
              ? "text-[clamp(1.875rem,4vw,3rem)] font-light tracking-normal leading-[1.4] text-foreground"
              : "font-display italic text-[clamp(1.875rem,4vw,3rem)] tracking-[-0.015em] leading-[1.12] text-foreground",
          )}
        >
          {ar ? "الأرقامُ لا تكذب." : "Numbers don't lie."}{" "}
          <span className="text-muted-foreground/85">
            {ar ? "لكنّها تتأخّر." : "But they arrive late."}
          </span>
        </p>

        <div className="mt-12 lg:mt-16 inline-flex items-center gap-3 text-muted-foreground">
          <span aria-hidden className="h-px w-8 bg-border" />
          <span className={cn(
            "text-2xs tracking-[0.28em] uppercase",
            ar ? "tracking-normal" : "font-mono",
          )}>
            {ar ? "بين فصلين" : "between chapters"}
          </span>
          <span aria-hidden className="h-px w-8 bg-border" />
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  1 · Hero                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function Hero({ t }: { t: Dict }) {
  // Self-contained dark hero — explicit tokens override page theme.
  // Charcoal with warm undertone (not pure black), warm bone text, brighter emerald.
  const HERO_BG    = "hsl(220 18% 6%)"
  const HERO_INK   = "hsl(40 18% 95%)"
  const HERO_MUTE  = "hsl(40 6% 62%)"
  const HERO_LINE  = "hsl(220 10% 16%)"
  const HERO_GLOW  = "hsl(158 70% 52%)"
  const HERO_GLOW_10 = "hsla(158, 70%, 52%, 0.10)"
  const HERO_GLOW_18 = "hsla(158, 70%, 52%, 0.18)"
  const HERO_GLOW_12 = "hsla(158, 70%, 52%, 0.12)"
  const HERO_CARD  = "hsl(220 14% 9%)"

  return (
    <section
      id="cover"
      className="relative overflow-hidden"
      style={{ background: HERO_BG, color: HERO_INK }}
    >
      {/* Faint architectural grid — distinctive, not decorative noise */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none opacity-[0.035]"
        style={{
          backgroundImage: `linear-gradient(${HERO_INK} 1px, transparent 1px), linear-gradient(90deg, ${HERO_INK} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 30%, black 40%, transparent 90%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 30%, black 40%, transparent 90%)",
        }}
      />
      {/* Single warm vignette anchored to product side */}
      <div
        aria-hidden
        className={cn(
          "absolute -z-10 top-0 h-[90%] w-[60%] pointer-events-none",
          t.ar ? "left-0" : "right-0",
        )}
        style={{
          background: `radial-gradient(50% 60% at 50% 30%, ${HERO_GLOW_10}, transparent 72%)`,
        }}
      />
      {/* Hairline rule, top */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: HERO_LINE }} />
      {/* Designed seam — short tonal step at the bottom edge so the dark→light handoff
          to TrustStrip below reads as authored, not as an abrupt section switch */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-20 pointer-events-none"
        style={{
          background: `linear-gradient(to bottom, transparent 0%, ${HERO_BG} 100%)`,
        }}
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px" style={{ background: HERO_LINE }} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-14 lg:pt-20 pb-20 lg:pb-28">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">

          {/* ── Editorial column ──────────────────────────────────────── */}
          <div className={cn("lg:col-span-7", t.ar ? "lg:order-last" : "")}>
            {/* Edition slug — set as printed mark, not a SaaS pill */}
            <div className="flex items-baseline gap-3 pb-3 border-b" style={{ borderColor: HERO_LINE }}>
              <span aria-hidden className="size-1 translate-y-[-2px] rounded-full" style={{ background: HERO_GLOW }} />
              <span
                className={cn("text-2xs", t.ar ? "tracking-normal" : "font-mono uppercase tracking-[0.22em]")}
                style={{ color: HERO_MUTE }}
              >
                {t.hero.tag}
              </span>
            </div>

            {/* Editorial display headline — dramatic three-beat */}
            <h1
              className={cn(
                "mt-9 text-[clamp(2.75rem,7.4vw,5.75rem)]",
                t.ar
                  ? "font-semibold tracking-normal leading-[1.18]"
                  : "font-display tracking-[-0.02em] leading-[0.98]",
              )}
              data-testid="heading-hero"
              style={{ color: HERO_INK }}
            >
              {t.hero.h1a}<br />
              {t.hero.h1b}<br />
              <span
                className={cn(t.ar ? "" : "display-italic")}
                style={{ color: HERO_GLOW }}
              >
                {t.hero.h1c}
              </span>
            </h1>

            <p
              className="mt-8 max-w-xl text-base lg:text-lg leading-[1.65]"
              style={{ color: HERO_MUTE }}
            >
              {t.hero.sub}
              <span style={{ color: HERO_INK }}>{t.hero.subEm}</span>
            </p>

            {/* CTAs — primary emerald, secondary ghost-on-dark */}
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a
                href="/signin"
                data-testid="button-hero-cta-primary"
                className="inline-flex items-center gap-2 px-6 h-12 rounded-md text-sm font-semibold tracking-tight transition-all hover:brightness-110"
                style={{ background: HERO_GLOW, color: HERO_BG }}
              >
                {t.hero.ctaPrimary}
                <CtaArrow ar={t.ar} />
              </a>
              <a
                href="/demo"
                data-testid="button-hero-cta-secondary"
                className="inline-flex items-center gap-2 px-5 h-12 rounded-md text-sm font-medium transition-colors group"
                style={{ color: HERO_INK, border: `1px solid ${HERO_LINE}` }}
              >
                <span className="inline-block size-1.5 rounded-full" style={{ background: HERO_GLOW }} />
                {t.hero.ctaSecondary}
                <ArrowRight className={cn("size-4 transition-transform group-hover:translate-x-0.5", t.ar && "rotate-180")} />
              </a>
            </div>

            {/* The role-replacement ticker — the audacious claim */}
            <div className="mt-12 pt-6" style={{ borderTop: `1px solid ${HERO_LINE}` }}>
              <div
                className={cn(
                  "text-2xs mb-3",
                  t.ar ? "tracking-normal" : "font-mono uppercase tracking-[0.18em]",
                )}
                style={{ color: HERO_MUTE }}
              >
                {t.hero.replacing}
              </div>
              <ul
                className="flex flex-wrap items-baseline gap-x-5 gap-y-2.5 list-none p-0 m-0"
                style={{ color: HERO_INK }}
              >
                {t.hero.replacingRoles.map((role) => (
                  <li key={role} className="inline-flex items-baseline gap-2">
                    {t.ar ? (
                      <>
                        <span
                          aria-hidden
                          className="font-mono text-sm leading-none"
                          style={{ color: HERO_GLOW }}
                        >
                          ×
                        </span>
                        <span className="text-base lg:text-lg font-semibold leading-none">
                          {role}
                        </span>
                      </>
                    ) : (
                      <span
                        className="text-base lg:text-lg font-display italic leading-none"
                        style={{
                          textDecoration: "line-through",
                          textDecorationColor: HERO_GLOW,
                          textDecorationThickness: "1.5px",
                        }}
                      >
                        {role}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Editorial broadsheet — pure type, no UI chrome ─────────── */}
          <div className={cn("lg:col-span-5", t.ar ? "lg:order-first" : "")}>
            <HeroEditorialPlate t={t} />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Hero editorial plate — printed-broadsheet typography on the dark canvas.  */
/*  No card, no border, no shadow, no fake browser chrome. Just type and      */
/*  hairlines, like the front page of the FT or a Bloomberg Businessweek      */
/*  cover. The data points are the same; the form is the message.            */
/* ────────────────────────────────────────────────────────────────────────── */

function HeroEditorialPlate({ t }: { t: Dict }) {
  const ar  = t.ar
  const INK   = "hsl(40 18% 95%)"
  const MUTE  = "hsl(40 6% 62%)"
  const LINE  = "hsl(220 10% 18%)"
  const GLOW  = "hsl(158 70% 52%)"
  const cur   = ar ? "ر.س" : "SAR"
  const txn   = ar ? "#٢٤٧٨" : "#2478"

  const colMono = (txt: string) => cn("text-2xs", ar ? "tracking-normal" : "font-mono uppercase tracking-[0.2em]")

  return (
    <div className="relative" data-testid="hero-editorial-plate">
      {/* Top printer's slug — date + provenance */}
      <div className="flex items-baseline gap-3 pb-3 border-b" style={{ borderColor: LINE }}>
        <span aria-hidden className="size-1 translate-y-[-2px] rounded-full" style={{ background: GLOW }} />
        <span className={colMono("")} style={{ color: MUTE }}>
          {ar ? "محدَّث الآن · إصدار 5.2" : "live · edition 5.2"}
        </span>
        <span className="flex-1" />
        <span className={colMono("")} style={{ color: MUTE }}>
          {ar ? "كشف يوميّ" : "daily statement"}
        </span>
      </div>

      {/* Eyebrow caption above the monumental number */}
      <div className={cn("mt-7 mb-3 text-2xs", ar ? "" : "font-mono uppercase tracking-[0.18em]")} style={{ color: MUTE }}>
        {t.hero.kpis.netCash} · {ar ? "آخر ٣٠ يوماً" : "last 30 days"}
      </div>

      {/* The single masthead number — set as page-defining type. */}
      <div className="flex items-baseline gap-3">
        <span
          className={cn(
            "tabular-nums leading-[0.92]",
            ar ? "font-semibold tracking-tight" : "font-display tracking-[-0.035em]",
          )}
          style={{ color: INK, fontSize: "clamp(3.75rem, 8vw, 6.5rem)" }}
        >
          {ar ? "١٠٣,٥٩٠" : "103,590"}
        </span>
        <span className="font-mono text-sm pb-2" style={{ color: MUTE }}>{cur}</span>
      </div>

      {/* Delta line in emerald — the only colored mark on the plate */}
      <div className={cn("mt-2 mb-7 text-xs", ar ? "" : "font-mono")} style={{ color: GLOW }}>
        +14.6% &nbsp;·&nbsp; {ar ? "مقارنةً بالشهر الماضي" : "vs prior month"}
      </div>

      <div className="h-px" style={{ background: LINE }} />

      {/* Two-up tabular row — revenues / expenses set as broadsheet columns */}
      <div className="grid grid-cols-2 gap-x-8 py-6">
        <div>
          <div className={cn("text-2xs mb-2", ar ? "" : "font-mono uppercase tracking-[0.16em]")} style={{ color: MUTE }}>
            {t.hero.kpis.revenue}
          </div>
          <div className={cn("font-mono tabular-nums", "text-[1.65rem] leading-none")} style={{ color: INK }}>
            {ar ? "٢٤٢,٣٠٠" : "242,300"}
          </div>
          <div className="text-2xs font-mono mt-1.5" style={{ color: GLOW }}>+8.4%</div>
        </div>
        <div>
          <div className={cn("text-2xs mb-2", ar ? "" : "font-mono uppercase tracking-[0.16em]")} style={{ color: MUTE }}>
            {t.hero.kpis.expenses}
          </div>
          <div className={cn("font-mono tabular-nums", "text-[1.65rem] leading-none")} style={{ color: INK }}>
            {ar ? "١٣٨,٧١٠" : "138,710"}
          </div>
          <div className="text-2xs font-mono mt-1.5" style={{ color: MUTE }}>−2.1%</div>
        </div>
      </div>

      <div className="h-px" style={{ background: LINE }} />

      {/* Latest entry — set as printed ledger excerpt, no table chrome */}
      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 pt-6 mb-3">
        <span className={cn("text-2xs", ar ? "" : "font-mono uppercase tracking-[0.16em]")} style={{ color: MUTE }}>
          {t.hero.entry.title}
        </span>
        <span aria-hidden style={{ color: MUTE }}>·</span>
        <span className={cn("text-2xs", ar ? "" : "font-mono uppercase tracking-[0.16em]")} style={{ color: GLOW }}>
          {t.hero.entry.balanced}
        </span>
      </div>

      <div className="font-mono text-xs space-y-2">
        <div className="grid grid-cols-12 items-baseline gap-x-3">
          <span className="col-span-2" style={{ color: MUTE }}>5110</span>
          <span className="col-span-5 font-sans text-sm" style={{ color: INK }}>{t.hero.entry.marketing}</span>
          <span className="col-span-3 text-end tabular-nums" style={{ color: INK }}>{t.hero.entry.amount}</span>
          <span className="col-span-2 text-end" style={{ color: MUTE }}>—</span>
        </div>
        <div className="grid grid-cols-12 items-baseline gap-x-3">
          <span className="col-span-2" style={{ color: MUTE }}>1010</span>
          <span className="col-span-5 font-sans text-sm" style={{ color: INK }}>{t.hero.entry.cash}</span>
          <span className="col-span-3 text-end" style={{ color: MUTE }}>—</span>
          <span className="col-span-2 text-end tabular-nums" style={{ color: INK }}>{t.hero.entry.amount}</span>
        </div>
      </div>

      {/* Editorial footnote — the human meaning behind the numbers */}
      <div className="mt-7 pt-5 border-t" style={{ borderColor: LINE }}>
        <p className={cn("text-2xs leading-relaxed", ar ? "" : "italic")} style={{ color: MUTE }}>
          {ar
            ? "مدوَّن منذ ٧ ثوانٍ · من فاتورة كهرباء واردة عبر البريد · بدون لمس بشريّ."
            : "Posted 7s ago · from an electricity invoice received by email · no human touch."}
        </p>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  2 · Trust strip                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function TrustStrip({ t }: { t: Dict }) {
  const pillarIcon: Record<string, React.ReactNode> = {
    shield: <ShieldCheck className="size-3.5" />,
    scale:  <Scale       className="size-3.5" />,
    lock:   <Lock        className="size-3.5" />,
    globe:  <Globe2      className="size-3.5" />,
  }
  return (
    <section id="trust" className="border-y border-border ">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Eyebrow + headline row */}
        <div className="py-8 lg:py-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 border-b border-border/60">
          <div>
            <div className="eyebrow eyebrow-lead mb-2"><span className="chapter-index">01</span>{t.trust.eyebrow}</div>
            <div className="text-base lg:text-lg leading-relaxed text-foreground max-w-2xl">
              <span className="font-semibold">{t.trust.headline}</span>{" "}
              <span className="text-muted-foreground">{t.trust.sub1}</span>
            </div>
          </div>
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            <span>verified · {new Date().getFullYear()}</span>
          </div>
        </div>

        {/* Bloomberg-style ticker — regulators + metrics on one rule, hairline dividers, mono numerics */}
        <div className="py-6 lg:py-7 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 divide-x divide-border [&>*]:px-4 lg:[&>*]:px-5 first:[&>*]:ps-0 last:[&>*]:pe-0 rtl:divide-x-reverse">
          {t.trust.pillars.map((p) => (
            <div key={p.l} className="flex flex-col gap-1.5 min-w-0" data-testid={`pillar-${p.k}`}>
              <div className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground inline-flex items-center gap-1.5">
                <span className="text-foreground/60">{pillarIcon[p.k]}</span>
                <span className="truncate">{p.l}</span>
                {p.k === "shield" && (
                  <span className="inline-flex size-1 rounded-full bg-success ms-0.5" aria-hidden />
                )}
              </div>
              <div className="text-xs text-foreground leading-snug truncate" title={p.c}>{p.c}</div>
            </div>
          ))}
          {t.trust.metrics.map((m) => (
            <div key={m.l} className="flex flex-col gap-1.5 min-w-0">
              <div className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground truncate">{m.l}</div>
              <div className={cn(
                "text-foreground leading-none",
                m.mono ? "font-mono text-base" : "font-display text-xl font-semibold tracking-tight",
              )}>{m.v}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  3 · Why different                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function WhyDifferent({ t }: { t: Dict }) {
  return (
    <section id="platform" className="py-28 lg:py-40 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter
          ar={t.ar}
          num="02"
          eyebrow={t.why.eyebrow}
          title={t.why.title1}
          italic={t.why.title2}
          lead={
            <>
              {t.why.lead}{" "}
              <span className="text-muted-foreground">{t.why.sub}</span>
            </>
          }
        />

        {/* Principles — typographic only, hairline-divided rows. No cards, no grid noise. */}
        <div className="border-t border-border">
          {t.why.principles.map((p, i) => (
            <div
              key={p.n}
              className="grid lg:grid-cols-12 gap-6 lg:gap-12 py-10 lg:py-14 border-b border-border group"
              data-testid={`principle-${i}`}
            >
              <div className="lg:col-span-3 flex lg:flex-col gap-3 lg:gap-2">
                <span className="font-mono text-2xs uppercase tracking-[0.22em] text-muted-foreground">
                  {t.ar ? `المبدأ ${String(i + 1).padStart(2, "0")}` : `Principle ${String(i + 1).padStart(2, "0")}`}
                </span>
                <span className="font-mono text-xs text-primary tracking-[0.18em]">{p.n}</span>
              </div>
              <div className="lg:col-span-9">
                <h3
                  className={cn(
                    "text-[clamp(1.5rem,2.8vw,2.4rem)] mb-4 max-w-3xl",
                    t.ar
                      ? "font-semibold leading-[1.25]"
                      : "font-display tracking-[-0.012em] leading-[1.08]",
                    "text-foreground",
                  )}
                >
                  {p.t}
                </h3>
                <p className="text-base lg:text-lg leading-[1.65] text-muted-foreground max-w-3xl">
                  {p.b}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  4 · Core capabilities — Bento grid                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function CoreCapabilities({ t }: { t: Dict }) {
  const c = t.capabilities
  // Echo the hero's vocabulary — second dark band, deliberately composed
  const D_BG    = "hsl(220 18% 6%)"
  const D_INK   = "hsl(40 18% 95%)"
  const D_MUTE  = "hsl(40 6% 62%)"
  const D_LINE  = "hsl(220 10% 16%)"
  const D_GLOW  = "hsl(158 70% 52%)"
  const D_CARD  = "hsl(220 14% 9%)"
  const D_GLOW_18 = "hsla(158, 70%, 52%, 0.18)"

  // Other capabilities, listed editorially (not in a grid)
  const otherCaps = [
    { icon: <Bot className="size-4" />,        title: c.ai.title,      body: c.ai.body },
    { icon: <Globe2 className="size-4" />,     title: c.local.title,   body: c.local.body },
    { icon: <Briefcase className="size-4" />,  title: c.assets.title,  body: c.assets.body },
    { icon: <Users className="size-4" />,      title: c.payroll.title, body: c.payroll.body },
    { icon: <ScrollText className="size-4" />, title: c.reports.title, body: c.reports.body },
    { icon: <Wallet className="size-4" />,     title: c.multi.title,   body: c.multi.body },
  ]

  return (
    <section
      id="capabilities"
      className="relative isolate overflow-hidden py-28 lg:py-40"
      style={{ background: D_BG, color: D_INK }}
    >
      {/* Tonal seams — bridge from light section above and to the next below */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: D_LINE }} />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px" style={{ background: D_LINE }} />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-20 pointer-events-none"
        style={{ background: `linear-gradient(to bottom, ${D_BG} 0%, transparent 100%)` }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-20 pointer-events-none"
        style={{ background: `linear-gradient(to top, ${D_BG} 0%, transparent 100%)` }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter
          ar={t.ar} dark
          num="03"
          eyebrow={c.eyebrow}
          title={c.title}
          lead={c.lead}
        />

        {/* Hero capability — Cockpit shown large, asymmetric */}
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center mb-20 lg:mb-28">
          <div className="lg:col-span-5">
            <div
              className={cn("text-2xs mb-5", t.ar ? "tracking-normal" : "font-mono uppercase tracking-[0.2em]")}
              style={{ color: D_GLOW }}
            >
              {c.cockpit.tag}
            </div>
            <h3
              className={cn(
                "text-[clamp(2rem,4vw,3rem)] mb-5",
                t.ar ? "font-semibold leading-[1.2]" : "font-display tracking-[-0.018em] leading-[1.05]",
              )}
              style={{ color: D_INK }}
            >
              {c.cockpit.title}
            </h3>
            <p className="text-lg leading-[1.6]" style={{ color: D_MUTE }}>
              {c.cockpit.body}
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {c.cockpit.kpis.map((k) => (
                <div
                  key={k.label}
                  className="rounded-md p-3"
                  style={{ background: D_CARD, border: `1px solid ${D_LINE}` }}
                >
                  <div className="text-2xs mb-1.5" style={{ color: D_MUTE }}>{k.label}</div>
                  <div className="text-base font-mono leading-none" style={{ color: D_INK }}>{k.value}</div>
                  {k.delta && (
                    <div className="text-2xs font-mono mt-1.5" style={{ color: D_GLOW }}>{k.delta}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div
              className="rounded-xl overflow-hidden"
              style={{
                boxShadow: `0 0 0 1px ${D_GLOW_18}, 0 32px 80px -20px rgba(0,0,0,0.7), 0 12px 32px -8px rgba(0,0,0,0.5)`,
              }}
            >
              <div className="bg-card p-5 lg:p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">
                    {c.cockpit.tag}
                  </span>
                  <BarChart3 className="size-4 text-muted-foreground" />
                </div>
                <SparkChart compact />
              </div>
            </div>
          </div>
        </div>

        {/* Editorial list — divided rows, no boxes */}
        <div className="border-t" style={{ borderColor: D_LINE }}>
          {otherCaps.map((cap, i) => (
            <div
              key={cap.title}
              className="grid lg:grid-cols-12 gap-4 lg:gap-8 py-8 lg:py-10 items-baseline border-b"
              style={{ borderColor: D_LINE }}
              data-testid={`capability-${i}`}
            >
              <div className="lg:col-span-1 font-mono text-xs" style={{ color: D_MUTE }}>
                {String(i + 4).padStart(2, "0")}
              </div>
              <div className="lg:col-span-1" style={{ color: D_GLOW }}>
                {cap.icon}
              </div>
              <div className="lg:col-span-3">
                <h4
                  className={cn(
                    "text-lg lg:text-xl leading-snug",
                    t.ar ? "font-semibold" : "font-display tracking-[-0.005em]",
                  )}
                  style={{ color: D_INK }}
                >
                  {cap.title}
                </h4>
              </div>
              <div className="lg:col-span-7">
                <p className="text-base leading-[1.6]" style={{ color: D_MUTE }}>
                  {cap.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  5 · AI Assistant — split layout                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function AIAssistant({ t }: { t: Dict }) {
  const a = t.aiSection
  return (
    <section id="ai" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter
          num="04"
          eyebrow={a.tag}
          title={<>{a.h1}<br />{a.h2}</>}
          ar={t.ar}
          align="stack"
        />
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-5 lg:col-start-8">
            <p className="text-lg leading-relaxed text-muted-foreground mb-6">{a.lead}</p>
            <ul className="space-y-3.5">
              {a.bullets.map(([title, body]) => (
                <li key={title} className="flex gap-3">
                  <Check className="size-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-foreground">{title}</div>
                    <div className="text-sm text-muted-foreground">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button variant="outline" asChild>
                <a href="/signin">{a.cta}<CtaArrow ar={t.ar} /></a>
              </Button>
            </div>
          </div>

          {/* Editorial transcript — no chat bubbles, set as printed dialogue */}
          <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1" data-testid="ai-transcript">
            <div className="flex items-baseline gap-3 pb-3 border-b border-border">
              <span aria-hidden className="size-1 translate-y-[-2px] rounded-full bg-success" />
              <span className={cn("text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.2em]", "text-muted-foreground")}>
                {t.ar ? "محادثة · ٢٠٢٦.٠٤.٢٣ · ٠٩:٤١" : "transcript · 2026.04.23 · 09:41"}
              </span>
              <span className="flex-1" />
              <span className={cn("text-2xs text-muted-foreground", t.ar ? "" : "font-mono uppercase tracking-[0.2em]")}>
                {a.mockTitle}
              </span>
            </div>

            <div className="space-y-8 lg:space-y-9 mt-7">
              {/* You · question 1 */}
              <div className="grid grid-cols-12 gap-x-5 lg:gap-x-7">
                <div className={cn("col-span-3 lg:col-span-2 text-2xs pt-2", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
                  {t.ar ? "أنت" : "you"}
                </div>
                <p className={cn("col-span-9 lg:col-span-10", t.ar ? "text-lg leading-[1.7]" : "font-display italic text-xl leading-[1.4]")}>
                  {a.chat.u1}
                </p>
              </div>

              {/* System · answer with set-type ledger */}
              <div className="grid grid-cols-12 gap-x-5 lg:gap-x-7">
                <div className={cn("col-span-3 lg:col-span-2 text-2xs pt-2", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-primary")}>
                  {t.ar ? "النظام" : "system"}
                </div>
                <div className="col-span-9 lg:col-span-10 space-y-4">
                  <p className={cn(t.ar ? "text-lg leading-[1.7]" : "font-display italic text-xl leading-[1.4]")}>
                    {a.chat.a1Pre}
                    <span className="font-mono not-italic text-base text-primary tabular-nums">{a.chat.a1Num}</span>:
                  </p>
                  <div className="font-mono text-xs space-y-2 py-2 border-y border-border/60">
                    <div className="grid grid-cols-12 items-baseline gap-x-3 pt-2">
                      <span className="col-span-2 text-muted-foreground">5210</span>
                      <span className="col-span-6 font-sans text-sm text-foreground">{a.chat.utilities}</span>
                      <span className="col-span-2 text-end tabular-nums text-foreground">{a.chat.amount}</span>
                      <span className="col-span-2 text-end text-muted-foreground">—</span>
                    </div>
                    <div className="grid grid-cols-12 items-baseline gap-x-3 pb-2">
                      <span className="col-span-2 text-muted-foreground">2110</span>
                      <span className="col-span-6 font-sans text-sm text-foreground">{a.chat.payable}</span>
                      <span className="col-span-2 text-end text-muted-foreground">—</span>
                      <span className="col-span-2 text-end tabular-nums text-foreground">{a.chat.amount}</span>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/75 leading-relaxed">
                    {a.chat.budget[0]} <span className="font-mono tabular-nums">{a.chat.budget[1]}</span> {a.chat.budget[2]}
                  </p>
                </div>
              </div>

              {/* You · question 2 */}
              <div className="grid grid-cols-12 gap-x-5 lg:gap-x-7">
                <div className={cn("col-span-3 lg:col-span-2 text-2xs pt-2", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
                  {t.ar ? "أنت" : "you"}
                </div>
                <p className={cn("col-span-9 lg:col-span-10", t.ar ? "text-lg leading-[1.7]" : "font-display italic text-xl leading-[1.4]")}>
                  {a.chat.u2}
                </p>
              </div>

              {/* System · drafting */}
              <div className="grid grid-cols-12 gap-x-5 lg:gap-x-7">
                <div className={cn("col-span-3 lg:col-span-2 text-2xs pt-2", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-primary")}>
                  {t.ar ? "النظام" : "system"}
                </div>
                <div className={cn(
                  "col-span-9 lg:col-span-10 text-2xs text-muted-foreground flex items-center gap-2",
                  t.ar ? "" : "font-mono uppercase tracking-[0.16em]",
                )}>
                  <span aria-hidden className="inline-block w-2 h-px bg-muted-foreground" />
                  {t.ar ? "يكتب الإجابة…" : "drafting reply"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  6 · Dashboard showcase                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function DashboardShowcase({ t }: { t: Dict }) {
  const s = t.showcase
  return (
    <section id="showcase" className="py-24 lg:py-32  border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="05" eyebrow={s.eyebrow} title={s.title} lead={s.lead} ar={t.ar} />

        {/* Editorial broadsheet — set type, hairlines, no card chrome */}
        <div className="mt-12 lg:mt-16" data-testid="showcase-broadsheet">
          {/* Masthead */}
          <div className="flex items-baseline gap-3 pb-3 border-b-2 border-foreground">
            <span aria-hidden className="size-1.5 translate-y-[-2px] rounded-full bg-success" />
            <span className={cn("text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.2em]")}>
              {t.ar ? "نشرة يوميّة · إصدار 5.2" : "daily briefing · edition 5.2"}
            </span>
            <span className="flex-1" />
            <span className={cn("text-2xs text-muted-foreground", t.ar ? "" : "font-mono uppercase tracking-[0.2em]")}>
              {s.mockTitle}
            </span>
          </div>

          {/* Four-up KPI broadsheet — divided columns, monumental numerals */}
          <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-border">
            {[
              { l: s.kpis.revenue,  v: t.ar ? "٢٤٢,٣٠٠" : "242,300", d: "+8.4%",  pos: true,  hl: false },
              { l: s.kpis.expenses, v: t.ar ? "١٣٨,٧١٠" : "138,710", d: "−2.1%",  pos: false, hl: false },
              { l: s.kpis.netCash,  v: t.ar ? "١٠٣,٥٩٠" : "103,590", d: "+14.6%", pos: true,  hl: true  },
              { l: s.kpis.health,   v: s.kpis.healthVal,              d: s.kpis.healthDelta, pos: true, hl: false },
            ].map((k, i) => (
              <div
                key={i}
                className={cn(
                  "py-8 lg:py-10 px-5 lg:px-7 border-border",
                  i > 0 && "border-s",
                  i === 2 && "lg:border-s-0 border-t lg:border-t-0",
                  i === 3 && "border-t lg:border-t-0",
                  k.hl && "bg-foreground text-background",
                )}
              >
                <div className={cn(
                  "text-2xs mb-3",
                  t.ar ? "" : "font-mono uppercase tracking-[0.16em]",
                  k.hl ? "text-background/65" : "text-muted-foreground",
                )}>
                  {k.l}
                </div>
                <div
                  className={cn(
                    "tabular-nums leading-[0.95] mb-2",
                    t.ar ? "font-semibold tracking-tight" : "font-display tracking-[-0.025em]",
                  )}
                  style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.5rem)" }}
                >
                  {k.v}
                </div>
                <div className={cn(
                  "text-2xs font-mono",
                  k.hl ? "text-background/70" : k.pos ? "text-success" : "text-muted-foreground",
                )}>
                  {k.d}
                </div>
              </div>
            ))}
          </div>

          {/* Body row: cash trend feature + alerts column */}
          <div className="grid lg:grid-cols-12 py-10 lg:py-14 border-b border-border">
            <div className="lg:col-span-7 lg:pe-12 lg:border-e lg:border-border">
              <div className={cn("text-2xs mb-2", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
                {s.cash.eyebrow}
              </div>
              <h4 className={cn(
                "mb-7",
                t.ar ? "text-2xl lg:text-3xl font-semibold leading-tight" : "font-display text-3xl lg:text-4xl tracking-[-0.018em] leading-[1.05]",
              )}>
                {s.cash.title}
              </h4>

              {/* Weekly cash narrative — set as printed series, no canvas chart */}
              <div className="font-mono text-sm">
                {[
                  { wk: t.ar ? "الأسبوع ١٤" : "WK 14", v: t.ar ? "٨٩,٢٠٠"  : "89,200",  d: "+6.2%",  cur: false },
                  { wk: t.ar ? "الأسبوع ١٥" : "WK 15", v: t.ar ? "٩٤,٥٠٠"  : "94,500",  d: "+5.9%",  cur: false },
                  { wk: t.ar ? "الأسبوع ١٦" : "WK 16", v: t.ar ? "٩٨,٧٧٠"  : "98,770",  d: "+4.5%",  cur: false },
                  { wk: t.ar ? "الأسبوع ١٧" : "WK 17", v: t.ar ? "١٠٣,٥٩٠" : "103,590", d: "+14.6%", cur: true  },
                ].map((row, i) => (
                  <div
                    key={i}
                    className={cn(
                      "grid grid-cols-12 items-baseline gap-x-3 py-2 border-b border-border/50 last:border-0",
                      row.cur && "bg-foreground/[0.025]",
                    )}
                  >
                    <span className={cn("col-span-3 text-2xs", t.ar ? "" : "uppercase tracking-[0.16em]", "text-muted-foreground")}>
                      {row.wk}
                    </span>
                    <span className={cn("col-span-5 tabular-nums", row.cur ? "text-foreground font-semibold" : "text-foreground/85")}>
                      {row.v}
                    </span>
                    <span className={cn("col-span-3 text-end text-xs tabular-nums", "text-success")}>
                      {row.d}
                    </span>
                    <span className="col-span-1 text-end text-muted-foreground text-xs">
                      {row.cur ? (t.ar ? "←" : "→") : ""}
                    </span>
                  </div>
                ))}
              </div>

              <div className={cn("mt-4 text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.16em]", "text-success")}>
                {s.cash.delta} · {t.ar ? "اتّجاه صاعد متّصل" : "uninterrupted upward trend"}
              </div>
            </div>

            <div className="lg:col-span-5 mt-10 lg:mt-0 lg:ps-12">
              <div className={cn("text-2xs mb-5", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
                {s.alerts.title}
              </div>
              <div className="space-y-5">
                {[
                  { type: "warning", l: s.alerts.late.l,   d: s.alerts.late.d   },
                  { type: "info",    l: s.alerts.gosi.l,   d: s.alerts.gosi.d   },
                  { type: "success", l: s.alerts.budget.l, d: s.alerts.budget.d },
                ].map((al, i) => (
                  <div key={i} className="grid grid-cols-12 gap-x-3 items-baseline pb-4 border-b border-border/50 last:border-0">
                    <span aria-hidden className={cn(
                      "col-span-1 mt-1.5 inline-block w-1.5 h-1.5 rounded-full",
                      al.type === "warning" ? "bg-warning" : al.type === "success" ? "bg-success" : "bg-primary",
                    )} />
                    <div className="col-span-11">
                      <div className={cn("text-base leading-snug", t.ar ? "font-medium" : "font-medium")}>{al.l}</div>
                      <div className="text-xs text-muted-foreground leading-snug mt-1">{al.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Editorial footnote — coach commentary set as letterpress callout */}
          <div className="grid lg:grid-cols-12 gap-x-10 py-7">
            <div className={cn("lg:col-span-3 text-2xs mb-2 lg:mb-0", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
              {s.coachLabel}
            </div>
            <p className={cn("lg:col-span-9 text-base leading-relaxed text-foreground/85", t.ar ? "" : "font-display italic text-lg")}>
              {s.coachBody}
            </p>
          </div>

          {/* Quiet sidebar nav as printed contents row */}
          <div className="border-t border-border pt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className={cn("text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
              {t.ar ? "في هذا العدد" : "in this issue"}
            </span>
            {s.sidebar.map((l, i) => (
              <span
                key={l}
                className={cn(
                  "text-xs",
                  i === 4 ? "text-foreground font-medium border-b border-foreground pb-0.5" : "text-muted-foreground",
                )}
              >
                {l}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          {s.legend.map((l) => (
            <span key={l} className="flex items-center gap-1.5"><span className="status-dot bg-primary" />{l}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  2.5 · Manifesto — full-bleed typographic anchor                           */
/* ────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────── */
/*  Manifesto — Articles of Founding.                                         */
/*  This is the page's emotional anchor. It is set as a constitutional        */
/*  document, not a landing-page section. Three Articles, each on its own     */
/*  rule, each set in monumental type, each given the silence to land.        */
/*  No gradient mesh. No chips. No italic on Arabic. No colored period.       */
/*  The page must look like it was printed, not deployed.                     */
/* ────────────────────────────────────────────────────────────────────────── */

function Manifesto({ t }: { t: Dict }) {
  const m  = t.manifesto
  const ar = t.ar
  const articleNum = (i: number) =>
    ar ? ["الأوّل", "الثاني", "الثالث"][i] : ["I", "II", "III"][i]
  const articleLabel = ar ? "المادّة" : "Article"

  return (
    <section
      id="belief"
      className="relative bg-foreground text-background py-28 lg:py-44"
      data-testid="section-manifesto"
    >
      {/* No gradient. No glow. Just the page edge as a printed rule. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-background/20" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-background/20" />

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">

        {/* Top printer's slug — date, document title, reading direction */}
        <div className="flex items-baseline gap-3 pb-3 mb-16 lg:mb-24 border-b border-background/15">
          <span aria-hidden className="size-1 translate-y-[-2px] rounded-full bg-primary" />
          <span className={cn("text-2xs", ar ? "tracking-normal" : "font-mono uppercase tracking-[0.22em]", "text-background/70")}>
            {ar ? "بيان · وثيقة التأسيس · ٢٠٢٦" : "belief · articles of founding · mmxxvi"}
          </span>
          <span className="flex-1" />
          <span className={cn("text-2xs", ar ? "tracking-normal" : "font-mono uppercase tracking-[0.22em]", "text-background/55")}>
            {ar ? "اقرأ ببطء" : "read slowly"}
          </span>
        </div>

        {/* Lead-in — the declarative sentence that opens the document */}
        <p className={cn(
          "mb-20 lg:mb-28 max-w-4xl",
          ar
            ? "text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.4] text-background"
            : "font-display text-4xl sm:text-5xl lg:text-6xl tracking-[-0.025em] leading-[1.04] text-background",
        )}>
          {m.kicker}<span className="text-primary">.</span>
        </p>

        {/* The three Articles. Each Article gets its own page-feel: a rule    */}
        {/* across the top, a tiny printer's mark naming it, and the body of   */}
        {/* the Article set in monumental display type with breath.            */}
        <div className="space-y-20 lg:space-y-32">
          {m.lines.map((l, i) => (
            <article
              key={i}
              className="relative pt-8 border-t border-background/15"
              data-testid={`manifesto-line-${i}`}
            >
              <div className="mb-7 lg:mb-10">
                <span className={cn(
                  "text-2xs",
                  ar ? "tracking-normal" : "font-mono uppercase tracking-[0.22em]",
                  "text-primary",
                )}>
                  {articleLabel} &nbsp;·&nbsp; {articleNum(i)}
                </span>
              </div>

              <h2 className={cn(
                "text-background",
                ar
                  ? "text-[clamp(2.5rem,7vw,5.75rem)] font-semibold leading-[1.18] tracking-tight"
                  : "font-display text-[clamp(2.75rem,7.4vw,6rem)] tracking-[-0.028em] leading-[1.02]",
              )}>
                <span>{l.t}</span>{" "}
                <span className="text-background/65">{l.em}.</span>
              </h2>
            </article>
          ))}
        </div>

        {/* Closing rule + footnote + signature — set as colophon */}
        <div className="mt-24 lg:mt-32 pt-8 border-t border-background/20 grid lg:grid-cols-12 gap-8 lg:gap-10">
          <p className={cn(
            "lg:col-span-8 text-background/85",
            ar
              ? "text-lg lg:text-xl leading-[1.7]"
              : "font-display italic text-xl lg:text-2xl leading-snug",
          )}>
            {m.footnote}
          </p>
          <div className="lg:col-span-4 lg:text-end self-end">
            <span className={cn(
              "text-2xs",
              ar ? "tracking-normal" : "font-mono uppercase tracking-[0.22em]",
              "text-background/65",
            )}>
              — {m.sig}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  6.45 · Testimonials — named MENA personas                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function Testimonials({ t }: { t: Dict }) {
  const ts = t.testimonials
  const f = ts.featured
  const fInit = f.n.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")
  return (
    <section id="customers" className="relative py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="14" eyebrow={ts.eyebrow} title={ts.title} lead={ts.lead} ar={t.ar} />

        {/* Proof-stats — broadsheet four-up, no card chrome */}
        <div className="border-y-2 border-foreground mb-16 lg:mb-24">
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {ts.stats.map((s, i) => (
              <div
                key={i}
                className={cn(
                  "py-7 lg:py-9 px-5 lg:px-7 border-border",
                  i > 0 && "border-s",
                  (i === 2) && "lg:border-s border-t lg:border-t-0",
                  (i === 3) && "border-t lg:border-t-0",
                )}
                data-testid={`testimonial-stat-${i}`}
              >
                <div
                  className={cn(
                    "tabular-nums leading-none tracking-tight mb-2",
                    t.ar ? "font-semibold" : "font-display",
                  )}
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
                >
                  {s.n}
                </div>
                <div className="mt-2.5 text-sm leading-snug text-foreground">{s.l}</div>
                <div className={cn("mt-1.5 text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.16em]", "text-muted-foreground")}>
                  {s.s}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Featured testimonial — set as a printed pull-quote, no card */}
        <figure className="mb-20 lg:mb-28" data-testid="testimonial-featured">
          {/* Top printer's mark */}
          <div className="flex items-baseline gap-3 pb-3 border-b border-border mb-10 lg:mb-14">
            <span aria-hidden className="size-1 translate-y-[-2px] rounded-full bg-primary" />
            <span className={cn("text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.22em]", "text-muted-foreground")}>
              {t.ar ? "تقرير ميدانيّ · عميلةٌ موثّقة" : "field report · verified customer"}
            </span>
            <span className="flex-1" />
            <span className={cn("text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.22em]", "text-muted-foreground")}>
              {f.since}
            </span>
          </div>

          {/* The quote — set monumental, no curly-quote glyph crutch */}
          <blockquote
            className={cn(
              "max-w-4xl mb-10 lg:mb-14 text-foreground",
              t.ar
                ? "text-2xl sm:text-3xl lg:text-4xl font-semibold leading-[1.5] tracking-tight"
                : "font-display text-3xl sm:text-4xl lg:text-5xl tracking-[-0.022em] leading-[1.12]",
            )}
          >
            {f.q}
          </blockquote>

          {/* Attribution + KPIs as a single broadsheet row */}
          <div className="grid lg:grid-cols-12 gap-y-8 lg:gap-x-10 pt-7 border-t border-border">
            <figcaption className="lg:col-span-5">
              <div className={cn("text-2xs mb-2", t.ar ? "" : "font-mono uppercase tracking-[0.18em]", "text-muted-foreground")}>
                — {t.ar ? "بقلم" : "by"}
              </div>
              <div className="text-base font-semibold text-foreground">{f.n}</div>
              <div className="text-sm text-muted-foreground mt-0.5">{f.r}</div>
              <div className="text-sm text-foreground/80 mt-0.5">{f.c}</div>
              <div className={cn("mt-4 text-2xs", t.ar ? "" : "font-mono uppercase tracking-[0.16em]", "text-muted-foreground")}>
                {ts.switchedLabel}{" "}
                <span className="text-foreground/85">
                  <span aria-hidden>×</span>{" "}{f.switched}
                </span>
              </div>
            </figcaption>

            {/* Three KPIs as set type, no boxes */}
            <div className="lg:col-span-7 grid grid-cols-3 gap-x-5 lg:gap-x-8">
              {f.kpis.map((k, i) => (
                <div
                  key={i}
                  className={cn("ps-5 lg:ps-6 border-s border-border", i === 0 && "ps-0 lg:ps-0 border-s-0")}
                  data-testid={`featured-kpi-${i}`}
                >
                  <div
                    className={cn(
                      "tabular-nums leading-none tracking-tight mb-2 text-foreground",
                      t.ar ? "font-semibold" : "font-display",
                    )}
                    style={{ fontSize: "clamp(1.75rem, 3.6vw, 2.5rem)" }}
                  >
                    {k.v}
                  </div>
                  <div className="text-2xs lg:text-xs leading-snug text-muted-foreground">
                    {k.l}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </figure>

        {/* Grid of remaining testimonials */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {ts.items.map((it, i) => {
            const initials = it.n.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")
            const tints = [
              "bg-foreground text-background",
              "bg-foreground text-background",
              "bg-foreground text-background",
            ]
            const tint = tints[i % tints.length]
            return (
              <figure
                key={it.n}
                className="group rounded-xl border border-border bg-card p-6 lg:p-7 flex flex-col gap-5"
                data-testid={`testimonial-${i}`}
              >
                {/* Top: 5 stars + verified */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-0.5" aria-label={t.ar ? "تقييم خمس نجوم" : "Five stars"}>
                    {Array.from({ length: 5 }).map((_, s) => (
                      <svg key={s} viewBox="0 0 20 20" className="size-4 fill-warning" aria-hidden>
                        <path d="M10 1.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L10 14.85l-5.25 2.8 1-5.85L1.5 7.65l5.9-.85L10 1.5z" />
                      </svg>
                    ))}
                  </div>
                  <span className="inline-flex items-center gap-1 text-2xs font-mono text-success uppercase tracking-wider">
                    <Check className="size-3" />
                    {t.ar ? "موثّقة" : "Verified"}
                  </span>
                </div>

                <blockquote className="text-base leading-relaxed text-foreground/90 relative flex-1">
                  <span
                    aria-hidden
                    className="absolute -top-2 -start-1 text-3xl text-primary/30 font-serif leading-none select-none"
                  >
                    “
                  </span>
                  <span className="relative">{it.q}</span>
                </blockquote>

                {/* KPI ribbon */}
                <div className="rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5 flex items-baseline gap-3">
                  <span className="font-mono text-lg font-semibold text-primary tabular-nums tracking-tight whitespace-nowrap">
                    {it.kpi.v}
                  </span>
                  <span className="text-2xs leading-snug text-foreground/80">{it.kpi.l}</span>
                </div>

                <figcaption className="mt-auto pt-4 border-t border-border flex items-center gap-3">
                  <div
                    aria-hidden
                    className={cn(
                      "size-11 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0",
                      tint
                    )}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate">{it.n}</div>
                    <div className="text-2xs text-muted-foreground truncate">{it.r}</div>
                    <div className="text-2xs text-foreground/70 mt-0.5 truncate">{it.c}</div>
                  </div>
                </figcaption>

                <div className="flex items-center justify-between gap-2 -mt-1">
                  <span className="font-mono text-2xs text-primary border border-primary/30 bg-primary/5 rounded px-1.5 py-0.5">
                    {it.ind}
                  </span>
                  <span className="font-mono text-2xs text-muted-foreground">{it.since}</span>
                </div>

                <div className="-mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <span className="font-mono uppercase tracking-wider">{ts.switchedLabel}</span>
                  <span className="text-foreground/70 line-through decoration-loss/50 decoration-[1.5px]">
                    {it.switched}
                  </span>
                </div>
              </figure>
            )
          })}
        </div>

        {/* Switched-from wordmark strip */}
        <div className="rounded-xl border border-border  p-5 lg:p-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <span className="text-2xs font-mono uppercase tracking-wider text-muted-foreground">
            {t.ar
              ? "محاسب ذكي حلّ محلّ"
              : "Smart Accountant has replaced"}
          </span>
          {ts.switchedFrom.map((s) => (
            <span
              key={s}
              className="text-base font-semibold text-foreground/60 grayscale hover:text-foreground hover:grayscale-0 transition-colors"
              data-testid={`switched-from-${s}`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  6.4 · Product Tour — module-by-module screenshots                         */
/* ────────────────────────────────────────────────────────────────────────── */

function ProductTour({ t }: { t: Dict }) {
  const p = t.productTour
  const mocks: Record<string, React.ReactNode> = {
    invoice: <InvoiceMock t={t} />,
    vat:     <VatReturnMock t={t} />,
    multi:   <MultiOrgMock t={t} />,
    command: <CommandMock t={t} />,
  }
  return (
    <section id="modules" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="06" eyebrow={p.eyebrow} title={p.title} lead={p.lead} ar={t.ar} />

        <div className="space-y-20 lg:space-y-28">
          {p.modules.map((m) => {
            const flipped = m.align === "left"
            return (
              <div
                key={m.k}
                className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center"
                data-testid={`module-${m.k}`}
              >
                <div className={cn(
                  "lg:col-span-5",
                  flipped ? "lg:order-2" : "lg:order-1"
                )}>
                  <div className="font-mono text-2xs text-primary tracking-widest mb-3">{m.n}</div>
                  <h3 className="text-2xl lg:text-3xl font-semibold text-foreground tracking-tight leading-snug mb-4">
                    {m.title}
                  </h3>
                  <p className="text-base leading-relaxed text-muted-foreground mb-6">
                    {m.body}
                  </p>
                  <ul className="space-y-2.5">
                    {m.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm text-foreground/85 leading-relaxed">
                        <Check className="size-4 text-primary flex-shrink-0 mt-0.5" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={cn(
                  "lg:col-span-7",
                  flipped ? "lg:order-1" : "lg:order-2"
                )}>
                  {mocks[m.k]}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── Module 01: Invoice mock with QR + ZATCA badge + WhatsApp action ── */
function InvoiceMock({ t }: { t: Dict }) {
  const ar = t.ar
  const items = ar
    ? [
        { d: "خدمات استشاريّة · يناير", q: "١", p: "٣٬٥٠٠٫٠٠", x: "٣٬٥٠٠٫٠٠" },
        { d: "تطوير لوحة تحكّم", q: "١", p: "٢٬٢٠٠٫٠٠", x: "٢٬٢٠٠٫٠٠" },
        { d: "صيانة شهر فبراير", q: "١", p: "١٬٣٠٠٫٠٠", x: "١٬٣٠٠٫٠٠" },
      ]
    : [
        { d: "Consulting services · January", q: "1", p: "3,500.00", x: "3,500.00" },
        { d: "Dashboard development",        q: "1", p: "2,200.00", x: "2,200.00" },
        { d: "February maintenance",         q: "1", p: "1,300.00", x: "1,300.00" },
      ]
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex-1 text-center font-mono text-2xs text-muted-foreground tracking-wide">
          invoice · INV-2478
        </div>
      </div>

      <div className="p-6 lg:p-7 grid grid-cols-12 gap-5">
        {/* Header */}
        <div className="col-span-12 flex items-start justify-between gap-4 pb-5 border-b border-border">
          <div>
            <div className="text-2xs text-muted-foreground mb-1">{ar ? "فاتورة ضريبيّة" : "Tax invoice"}</div>
            <div className="text-lg font-semibold text-foreground tabular-nums">#INV-2478</div>
            <div className="font-mono text-2xs text-muted-foreground mt-1">{ar ? "تاريخ الإصدار · ١٢ مارس ٢٠٢٦" : "Issued · 12 Mar 2026"}</div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="brand" size="sm" className="font-mono text-2xs">
              <ShieldCheck className="size-3" />
              ZATCA · {ar ? "المرحلة ٢" : "Phase 2"}
            </Badge>
            <span className="text-2xs text-muted-foreground">{ar ? "إلى" : "To"}: {ar ? "شركة الجوهرة للاستثمار" : "Al-Jawhara Investments Co."}</span>
          </div>
        </div>

        {/* Line items */}
        <div className="col-span-12 lg:col-span-8 -mx-2 sm:mx-0 overflow-x-auto">
         <table className="w-full min-w-[360px] text-2xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-start font-medium pb-2">{ar ? "البند" : "Item"}</th>
                <th className="text-end font-medium pb-2 w-10">{ar ? "كمّ" : "Qty"}</th>
                <th className="text-end font-medium pb-2 w-20">{ar ? "السعر" : "Price"}</th>
                <th className="text-end font-medium pb-2 w-20">{ar ? "المجموع" : "Total"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-2 text-foreground/90">{it.d}</td>
                  <td className="py-2 text-end font-mono text-muted-foreground">{it.q}</td>
                  <td className="py-2 text-end font-mono text-muted-foreground">{it.p}</td>
                  <td className="py-2 text-end font-mono text-foreground">{it.x}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 pt-3 border-t border-border space-y-1.5 text-2xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{ar ? "المجموع الفرعيّ" : "Subtotal"}</span>
              <span className="font-mono text-foreground">{ar ? "٧٬٠٠٠٫٠٠" : "7,000.00"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{ar ? "ضريبة القيمة المضافة · ١٥٪" : "VAT · 15%"}</span>
              <span className="font-mono text-foreground">{ar ? "١٬٠٥٠٫٠٠" : "1,050.00"}</span>
            </div>
            <div className="flex justify-between pt-1.5 mt-1.5 border-t border-border/60">
              <span className="text-sm font-semibold text-foreground">{ar ? "الإجماليّ المستحقّ" : "Total due"}</span>
              <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
                {ar ? "٨٬٠٥٠٫٠٠ ر.س" : "SAR 8,050.00"}
              </span>
            </div>
          </div>
        </div>

        {/* QR + ZATCA */}
        <div className="col-span-12 lg:col-span-4 flex flex-col items-center gap-2 lg:border-s lg:border-border lg:ps-5">
          <ZatcaQR />
          <div className="text-2xs text-muted-foreground text-center leading-relaxed">
            {ar ? "رمز QR موقّع رقميّاً · مُستخرَج من فاضورة" : "Cryptographically signed QR · Fatoora gateway"}
          </div>
        </div>

        {/* Actions */}
        <div className="col-span-12 flex flex-wrap items-center gap-2 pt-4 border-t border-border">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
            data-testid="invoice-mock-send"
          >
            <Send className="size-3.5" />
            {ar ? "إرسال" : "Send"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground"
          >
            <SiWhatsapp className="size-3.5 text-[#25D366]" />
            WhatsApp
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground"
          >
            <FileText className="size-3.5" />
            PDF
          </button>
          <div className="ms-auto text-2xs text-muted-foreground font-mono">
            {ar ? "محفوظ تلقائيّاً قبل ثانيتَين" : "Auto-saved 2s ago"}
          </div>
        </div>
      </div>
    </div>
  )
}

/* Decorative ZATCA-style QR pattern (purely visual — not a real code). */
function ZatcaQR() {
  // Deterministic pseudo-random pattern from a simple hash so it stays stable.
  const cells: boolean[] = []
  for (let i = 0; i < 21 * 21; i++) {
    const x = i % 21, y = Math.floor(i / 21)
    // Finder squares (top-left, top-right, bottom-left)
    const inFinder = (cx: number, cy: number) =>
      x >= cx && x < cx + 7 && y >= cy && y < cy + 7
    if (inFinder(0, 0) || inFinder(14, 0) || inFinder(0, 14)) {
      const lx = inFinder(0, 0) ? x : inFinder(14, 0) ? x - 14 : x
      const ly = inFinder(0, 0) ? y : inFinder(0, 14) ? y - 14 : y
      const onBorder = lx === 0 || lx === 6 || ly === 0 || ly === 6
      const onCenter = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4
      cells.push(onBorder || onCenter)
      continue
    }
    // Pseudo-random data cells
    cells.push(((x * 73 + y * 131 + (x ^ y) * 19) % 7) < 3)
  }
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <svg viewBox="0 0 21 21" className="size-28 lg:size-32" aria-hidden>
        {cells.map((on, i) =>
          on ? (
            <rect
              key={i}
              x={i % 21}
              y={Math.floor(i / 21)}
              width="1"
              height="1"
              fill="hsl(var(--foreground))"
            />
          ) : null
        )}
      </svg>
    </div>
  )
}

/* ── Module 02: VAT return ready-to-file mock ── */
function VatReturnMock({ t }: { t: Dict }) {
  const ar = t.ar
  const rows = ar ? [
    { l: "المبيعات الخاضعة للضريبة", v: "٤٢٢٬٧٥٠٫٠٠", t: "ضريبة المخرجات", tv: "٦٣٬٤١٢٫٥٠", tone: "out" },
    { l: "الصادرات (صفريّة)",         v: "٨٧٬٢٠٠٫٠٠",  t: "—",                tv: "٠٫٠٠",       tone: "neutral" },
    { l: "المشتريات الخاضعة للضريبة", v: "١٩٨٬٤٠٠٫٠٠", t: "ضريبة المدخلات",   tv: "٢٩٬٧٦٠٫٠٠", tone: "in" },
    { l: "تعديلات",                     v: "٤٬٢٠٠٫٠٠",   t: "—",                tv: "٦٣٠٫٠٠",     tone: "neutral" },
  ] : [
    { l: "Taxable sales",       v: "422,750.00", t: "Output tax", tv: "63,412.50", tone: "out" },
    { l: "Exports (zero-rated)", v: "87,200.00",  t: "—",          tv: "0.00",      tone: "neutral" },
    { l: "Taxable purchases",   v: "198,400.00", t: "Input tax",  tv: "29,760.00", tone: "in" },
    { l: "Adjustments",         v: "4,200.00",   t: "—",          tv: "630.00",    tone: "neutral" },
  ]
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex-1 text-center font-mono text-2xs text-muted-foreground tracking-wide">
          vat-return · Q1-2026
        </div>
      </div>
      <div className="p-6 lg:p-7 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow mb-1">{ar ? "إقرار ضريبة القيمة المضافة" : "VAT return"}</div>
            <div className="text-lg font-semibold text-foreground">{ar ? "الربع الأوّل · ٢٠٢٦" : "Q1 · 2026"}</div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="success" size="sm" className="font-mono">
              <Check className="size-3" />
              {ar ? "جاهز للتقديم" : "Ready to file"}
            </Badge>
            <div className="text-2xs text-muted-foreground flex items-center gap-1.5">
              <Calendar className="size-3" />
              {ar ? "موعد التقديم · ٣٠ أبريل" : "Filing due · Apr 30"}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full min-w-[440px] text-2xs">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground">
                <th className="text-start px-3 py-2 font-medium">{ar ? "البند" : "Box"}</th>
                <th className="text-end px-3 py-2 font-medium w-24">{ar ? "القيمة" : "Amount"}</th>
                <th className="text-start px-3 py-2 font-medium w-24">{ar ? "الضريبة" : "Tax"}</th>
                <th className="text-end px-3 py-2 font-medium w-24">{ar ? "المبلغ" : "Value"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground/90">{r.l}</td>
                  <td className="px-3 py-2 text-end font-mono text-foreground">{r.v}</td>
                  <td className={cn(
                    "px-3 py-2 text-2xs",
                    r.tone === "out" ? "text-loss" : r.tone === "in" ? "text-success" : "text-muted-foreground"
                  )}>{r.t}</td>
                  <td className={cn(
                    "px-3 py-2 text-end font-mono",
                    r.tone === "out" ? "text-loss" : r.tone === "in" ? "text-success" : "text-muted-foreground"
                  )}>{r.tv}</td>
                </tr>
              ))}
              <tr className="border-t border-primary/30 bg-accent/40">
                <td className="px-3 py-2.5 text-sm font-semibold text-foreground" colSpan={3}>
                  {ar ? "الصافي المستحقّ للهيئة" : "Net payable to authority"}
                </td>
                <td className="px-3 py-2.5 text-end font-mono text-sm font-semibold text-foreground tabular-nums">
                  {ar ? "٣٤٬٢٨٢٫٥٠" : "34,282.50"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
          >
            <ShieldCheck className="size-3.5" />
            {ar ? "تقديم لـ ZATCA" : "Submit to ZATCA"}
          </button>
          <div className="ms-auto text-2xs text-muted-foreground font-mono">
            {ar ? "أثر تدقيق · ٤٢ بنداً مرتبطاً" : "Audit trail · 42 linked entries"}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Module 03: Multi-org / multi-currency mock ── */
function MultiOrgMock({ t }: { t: Dict }) {
  const ar = t.ar
  const orgs = ar ? [
    { f: "🇸🇦", n: "محاسب ذكي · المملكة",   c: "ر.س", b: "١٫٢٤ مليون", reg: "ZATCA",  ok: true },
    { f: "🇦🇪", n: "Smart Accountant FZ",  c: "د.إ", b: "٨٤٠ ألف",     reg: "FTA",    ok: true },
    { f: "🇪🇬", n: "محاسب ذكي · مصر",       c: "ج.م", b: "٤٫٢٠ مليون",  reg: "ETA",    ok: true },
    { f: "🇰🇼", n: "محاسب ذكي · الكويت",    c: "د.ك", b: "٢٢٠ ألف",     reg: "—",      ok: true },
    { f: "🇯🇴", n: "محاسب ذكي · الأردن",    c: "د.أ", b: "١١٢ ألف",     reg: "ISTD",   ok: false },
  ] : [
    { f: "🇸🇦", n: "Smart Accountant · KSA",  c: "SAR", b: "1.24M",  reg: "ZATCA", ok: true },
    { f: "🇦🇪", n: "Smart Accountant FZ",     c: "AED", b: "840K",   reg: "FTA",   ok: true },
    { f: "🇪🇬", n: "Smart Accountant · EG",   c: "EGP", b: "4.20M",  reg: "ETA",   ok: true },
    { f: "🇰🇼", n: "Smart Accountant · KW",   c: "KWD", b: "220K",   reg: "—",     ok: true },
    { f: "🇯🇴", n: "Smart Accountant · JO",   c: "JOD", b: "112K",   reg: "ISTD",  ok: false },
  ]
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex-1 text-center font-mono text-2xs text-muted-foreground tracking-wide">
          entities · consolidated
        </div>
      </div>
      <div className="p-6 lg:p-7">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <div className="eyebrow mb-1 flex items-center gap-2">
              <Building2 className="size-3.5 text-primary" />
              {ar ? "الكيانات والفروع" : "Entities & branches"}
            </div>
            <div className="text-lg font-semibold text-foreground">{ar ? "٥ كيانات · ٤ عملات" : "5 entities · 4 currencies"}</div>
          </div>
          <div className="text-end">
            <div className="text-2xs text-muted-foreground">{ar ? "مُوحَّد بـ ر.س" : "Consolidated in SAR"}</div>
            <div className="font-mono text-base font-semibold text-foreground tabular-nums">
              {ar ? "٨٫٤١ مليون" : "8.41M"}
            </div>
          </div>
        </div>

        <ul className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {orgs.map((o, i) => (
            <li key={i} className="flex items-center gap-3 px-3.5 py-3 bg-card">
              <span className="text-xl leading-none flex-shrink-0" aria-hidden>{o.f}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{o.n}</div>
                <div className="font-mono text-2xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>{o.c}</span>
                  <span className="text-border">·</span>
                  <span>{o.reg}</span>
                  {o.ok ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <span className="size-1 rounded-full bg-success" />
                      {ar ? "مُتزامِن" : "in sync"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <span className="size-1 rounded-full bg-warning" />
                      {ar ? "بانتظار الإعداد" : "setup pending"}
                    </span>
                  )}
                </div>
              </div>
              <div className="font-mono text-sm text-foreground tabular-nums whitespace-nowrap">{o.b}</div>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2.5 flex items-center gap-2.5">
          <Activity className="size-3.5 text-foreground/70 flex-shrink-0" strokeWidth={1.75} />
          <div className="text-2xs text-foreground/85 leading-relaxed">
            {ar
              ? "التوحيد يجري لحظيّاً عند سعر الصرف الحقيقيّ · IFRS 10"
              : "Consolidation runs in real time at live FX · IFRS 10"}
          </div>
          <div className="ms-auto font-mono text-2xs text-primary">
            {ar ? "ر.س ١ ≈ د.إ ٠٫٩٨" : "SAR 1 ≈ AED 0.98"}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Module 04: Command palette mock ── */
function CommandMock({ t }: { t: Dict }) {
  const ar = t.ar
  const results = ar ? [
    { i: <Receipt className="size-3.5" />,    p: "إنشاء", t: "فاتورة لـ شركة الجوهرة · ٨٬٠٥٠ ر.س", k: "↵" },
    { i: <BarChart3 className="size-3.5" />,  p: "افتح",  t: "تقرير الربح والخسارة · الربع الأوّل ٢٠٢٦", k: "⌘1" },
    { i: <ShieldCheck className="size-3.5" />,p: "أنشئ",  t: "إقرار VAT · جاهز للتقديم لـ ZATCA",       k: "⌘V" },
    { i: <Users className="size-3.5" />,      p: "أوقف",  t: "موافقة الدفع لـ مطعم النور · ١٬٢٠٠ ر.س",   k: "⌘P" },
    { i: <Brain className="size-3.5" />,      p: "اسأل",  t: "هل التدفّق النقديّ كافٍ لرواتب فبراير؟",   k: "⌘?" },
  ] : [
    { i: <Receipt className="size-3.5" />,    p: "New",     t: "Invoice for Al-Jawhara Co. · SAR 8,050", k: "↵" },
    { i: <BarChart3 className="size-3.5" />,  p: "Open",    t: "P&L report · Q1 2026",                   k: "⌘1" },
    { i: <ShieldCheck className="size-3.5" />,p: "Generate",t: "VAT return · ready to file with ZATCA",  k: "⌘V" },
    { i: <Users className="size-3.5" />,      p: "Hold",    t: "Payment approval for Al-Noor · SAR 1,200",k: "⌘P" },
    { i: <Brain className="size-3.5" />,      p: "Ask",     t: "Is cash enough for February payroll?",   k: "⌘?" },
  ]
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden relative">
      <div className="relative">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
          </div>
          <div className="flex-1 text-center font-mono text-2xs text-muted-foreground tracking-wide">
            command · ⌘K
          </div>
        </div>
        <div className="p-5 lg:p-6">
          {/* Input row */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 mb-4">
            <Search className="size-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 text-sm text-foreground">
              {ar ? "فاتورة لـ" : "invoice for"}
              <span className="text-muted-foreground">{ar ? " شركة الجوهرة" : " Al-Jawhara"}</span>
              <span className="inline-block w-px h-4 bg-foreground align-middle ms-1" />
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground border border-border bg-card rounded px-1.5 py-0.5">
              <Command className="size-3" />K
            </kbd>
          </div>

          {/* Results */}
          <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-2 px-1">
            {ar ? "اقتراحات" : "Suggestions"}
          </div>
          <ul className="rounded-lg border border-border overflow-hidden divide-y divide-border">
            {results.map((r, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2.5",
                  i === 0 ? "bg-accent text-accent-foreground" : "bg-card"
                )}
              >
                <span className={cn(
                  "size-7 rounded-md border flex items-center justify-center flex-shrink-0",
                  i === 0
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-muted/40 border-border text-muted-foreground"
                )}>
                  {r.i}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-2xs font-mono text-muted-foreground uppercase tracking-wider mb-0.5">
                    {r.p}
                  </div>
                  <div className="text-sm text-foreground truncate">{r.t}</div>
                </div>
                <kbd className="font-mono text-2xs text-muted-foreground border border-border bg-card rounded px-1.5 py-0.5 flex-shrink-0">
                  {r.k}
                </kbd>
              </li>
            ))}
          </ul>
          <div className="mt-3 px-1 flex items-center gap-3 text-2xs text-muted-foreground">
            <span className="font-mono">↑↓ {ar ? "تنقّل" : "navigate"}</span>
            <span className="font-mono">↵ {ar ? "نفّذ" : "run"}</span>
            <span className="font-mono">esc {ar ? "إغلاق" : "close"}</span>
            <span className="ms-auto font-mono text-primary">{ar ? "يفهم العربيّة والإنجليزيّة" : "understands Arabic & English"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  6.5 · Predictive Capital — strategic AI intelligence                       */
/* ────────────────────────────────────────────────────────────────────────── */

function PredictiveCapital({ t }: { t: Dict }) {
  const p = t.predictive
  const pillarIcons: Record<string, React.ReactNode> = {
    brain:   <Brain     className="size-4" />,
    scale:   <Scale     className="size-4" />,
    compass: <LineChart className="size-4" />,
  }
  return (
    <section id="intelligence" className="relative py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter
          num="07"
          eyebrow={p.eyebrow}
          title={<>{p.title}<br /><span className="text-primary">{p.title2}</span></>}
          lead={p.lead}
          ar={t.ar}
        />

        <div className="grid lg:grid-cols-12 gap-6">
          {/* Forecast viz */}
          <div className="lg:col-span-7">
            <BentoCard className="h-full">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="eyebrow mb-1">{p.forecastTitle}</div>
                  <div className="text-sm font-medium text-foreground tabular-nums">
                    {t.ar ? "٢٫٤ مليون → ٣٫٢ مليون" : "2.4M → 3.2M"}
                  </div>
                </div>
                <Badge variant="success" size="sm" className="font-mono">+33%</Badge>
              </div>
              <ForecastChart />
              <div className="mt-3 flex items-center gap-2 text-2xs text-muted-foreground">
                <span className="inline-block w-3 h-1.5 rounded-sm bg-primary/15" />
                <span>{p.bandLabel}</span>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2">
                {p.scenarios.map((s) => (
                  <div
                    key={s.k}
                    className={cn(
                      "rounded-md border p-3 transition-colors",
                      s.k === "base"
                        ? "border-primary/30 bg-accent/40"
                        : "border-border bg-card"
                    )}
                    data-testid={`scenario-${s.k}`}
                  >
                    <div className="flex items-baseline justify-between mb-1.5">
                      <div className="text-xs font-medium text-foreground">{s.t}</div>
                      <div className={cn(
                        "text-xs font-mono tabular-nums",
                        s.positive ? "text-success" : "text-loss"
                      )}>
                        {s.v}
                      </div>
                    </div>
                    <div className="text-2xs text-muted-foreground leading-snug">{s.d}</div>
                  </div>
                ))}
              </div>
            </BentoCard>
          </div>

          {/* Three pillars */}
          <div className="lg:col-span-5 grid gap-4">
            {p.pillars.map((pl) => (
              <BentoCard key={pl.t}>
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-md bg-accent text-accent-foreground border border-accent-border flex items-center justify-center flex-shrink-0">
                    {pillarIcons[pl.i]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground mb-1">{pl.t}</div>
                    <p className="text-2xs text-muted-foreground leading-relaxed">{pl.b}</p>
                  </div>
                </div>
              </BentoCard>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* Forecast chart — historical solid line + projected dashed line + 90% confidence band. */
function ForecastChart() {
  // Historical (left half) → dashed projection (right half).
  const hist = "M0 105 L30 102 L60 96 L90 98 L120 88 L150 82 L180 75 L210 68 L240 62"
  const proj = "M240 62 L270 55 L300 48 L330 40 L360 32 L390 26 L420 20 L450 14 L480 8"
  // 90% confidence band — fan widens with time.
  const bandTop = "M240 62 L270 50 L300 38 L330 26 L360 18 L390 10 L420 4 L450 0 L480 -4"
  const bandBot = "M240 62 L270 60 L300 58 L330 54 L360 50 L390 46 L420 40 L450 34 L480 30"
  return (
    <svg viewBox="0 0 480 130" className="w-full h-32" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="bandFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.16" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="histFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.14" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* axis hairline */}
      <line x1="0" y1="125" x2="480" y2="125" stroke="hsl(var(--border))" strokeWidth="1" />
      {/* history fill */}
      <path d={`${hist} L240 125 L0 125 Z`} fill="url(#histFill)" />
      {/* confidence band (filled fan) */}
      <path
        d={`${bandTop} L480 30 L450 34 L420 40 L390 46 L360 50 L330 54 L300 58 L270 60 L240 62 Z`}
        fill="url(#bandFill)"
      />
      {/* historical solid line */}
      <path d={hist} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {/* projected dashed line */}
      <path d={proj} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.8" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
      {/* today marker */}
      <line x1="240" y1="0" x2="240" y2="125" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx="240" cy="62" r="3" fill="hsl(var(--primary))" />
      <circle cx="240" cy="62" r="6" fill="hsl(var(--primary))" fillOpacity="0.18" />
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  7 · Automation                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function Automation({ t }: { t: Dict }) {
  const aut = t.automation

  return (
    <section id="automation" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="08" eyebrow={aut.eyebrow} title={aut.title} lead={aut.lead} ar={t.ar} />

        {/* Before / After lanes */}
        <div className="grid md:grid-cols-2 gap-0 border border-border rounded-xl overflow-hidden">
          {/* Before lane — manual */}
          <div className="bg-muted/30 p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4 mb-5 pb-4 border-b border-border/70">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Clock className="size-3.5 text-loss/80 flex-shrink-0" />
                  <span className="eyebrow">{aut.beforeTitle}</span>
                </div>
                <p className="text-2xs text-muted-foreground leading-relaxed">{aut.beforeSub}</p>
              </div>
              <div className="text-end flex-shrink-0">
                <div className="text-2xs text-muted-foreground">{aut.totalLabel}</div>
                <div className="font-mono text-sm text-loss tabular-nums mt-0.5">{aut.manualTotal}</div>
              </div>
            </div>
            <ol className="space-y-3">
              {aut.manual.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 group"
                  data-testid={`manual-step-${i}`}
                >
                  <span className="font-mono text-2xs text-muted-foreground tabular-nums pt-0.5 w-5 flex-shrink-0">
                    0{i + 1}
                  </span>
                  <span className="text-sm text-foreground/65 line-through decoration-loss/50 decoration-1 leading-relaxed flex-1">
                    {s.t}
                  </span>
                  <span className="font-mono text-2xs text-loss/80 tabular-nums whitespace-nowrap pt-0.5">
                    {s.time}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* After lane — autonomous */}
          <div className="bg-card p-6 lg:p-8 relative">
            <div className="relative">
              <div className="flex items-start justify-between gap-4 mb-5 pb-4 border-b border-primary/15">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Zap className="size-3.5 text-primary flex-shrink-0" />
                    <span className="eyebrow text-primary">{aut.afterTitle}</span>
                  </div>
                  <p className="text-2xs text-muted-foreground leading-relaxed">{aut.afterSub}</p>
                </div>
                <div className="text-end flex-shrink-0">
                  <div className="text-2xs text-muted-foreground">{aut.totalLabel}</div>
                  <div className="font-mono text-sm text-primary tabular-nums mt-0.5">{aut.autoTotal}</div>
                </div>
              </div>
              <ol className="space-y-3">
                {aut.auto.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3"
                    data-testid={`auto-step-${i}`}
                  >
                    <span className="size-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="size-3 text-primary" />
                    </span>
                    <span className="text-sm text-foreground leading-relaxed flex-1">
                      {s.t}
                    </span>
                    <span className="font-mono text-2xs text-primary tabular-nums whitespace-nowrap pt-0.5">
                      {s.time}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="mt-10 grid md:grid-cols-3 gap-0 border border-border rounded-xl overflow-hidden">
          {aut.cases.map((c) => (
            <div key={c.t} className="bg-card p-7">
              <h3 className="text-base font-semibold text-foreground mb-2">{c.t}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{c.d}</p>
              <div className="font-mono text-2xs text-primary border-t border-border/60 pt-3">{c.m}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  7.5 · Live Auditor — continuous AI audit layer                             */
/* ────────────────────────────────────────────────────────────────────────── */

function LiveAuditor({ t }: { t: Dict }) {
  const a = t.auditor
  return (
    <section id="auditor" className="py-24 lg:py-32  border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="09" eyebrow={a.eyebrow} title={a.title} lead={a.lead} ar={t.ar} />

        <div className="grid lg:grid-cols-12 gap-6">
          {/* Live audit feed */}
          <div className="lg:col-span-7">
            <BentoCard className="h-full">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-2 rounded-full bg-success" aria-hidden />
                  <div className="text-sm font-medium text-foreground">{a.feedTitle}</div>
                </div>
                <div className="text-2xs text-muted-foreground font-mono">{a.feedSub}</div>
              </div>
              <div className="space-y-3">
                {a.signals.map((sig) => (
                  <AuditSignal
                    key={`${sig.tag}-${sig.t}`}
                    tone={sig.tone as "ok" | "info" | "warn" | "danger"}
                    t={sig.t}
                    d={sig.d}
                    tag={sig.tag}
                  />
                ))}
              </div>
            </BentoCard>
          </div>

          {/* Multi-jurisdiction compliance */}
          <div className="lg:col-span-5">
            <BentoCard className="h-full">
              <div className="eyebrow mb-4 flex items-center gap-2">
                <Globe2 className="size-3.5 text-primary" />
                <span>{a.jurEyebrow}</span>
              </div>
              <ul className="divide-y divide-border -my-3">
                {a.jurisdictions.map((j) => (
                  <li key={j.c} className="py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{j.c}</div>
                      <div className="text-2xs text-muted-foreground mt-0.5 truncate">{j.r}</div>
                    </div>
                    <Check className="size-4 text-success flex-shrink-0 mt-0.5" />
                  </li>
                ))}
              </ul>
            </BentoCard>
          </div>
        </div>
      </div>
    </section>
  )
}

function AuditSignal({
  tone, t, d, tag,
}: { tone: "ok" | "info" | "warn" | "danger"; t: string; d: string; tag: string }) {
  const dotColor =
    tone === "ok"     ? "bg-success" :
    tone === "info"   ? "bg-info" :
    tone === "warn"   ? "bg-warning" :
    "bg-loss"
  const tagStyle =
    tone === "ok"     ? "bg-success/10 text-success border-success/20" :
    tone === "info"   ? "bg-info/10 text-info border-info/20" :
    tone === "warn"   ? "bg-warning/10 text-warning border-warning/20" :
    "bg-loss/10 text-loss border-loss/20"
  return (
    <div className="flex items-start gap-3">
      <span className={cn("status-dot mt-1.5 flex-shrink-0", dotColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{t}</div>
        <div className="text-2xs text-muted-foreground mt-0.5 leading-relaxed">{d}</div>
      </div>
      <span className={cn(
        "text-2xs font-mono px-1.5 py-0.5 rounded border tabular-nums",
        tagStyle,
      )}>
        {tag}
      </span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  7.7 · Local Integrations — MENA-native stack                                */
/* ────────────────────────────────────────────────────────────────────────── */

function LocalIntegrations({ t }: { t: Dict }) {
  const i = t.integrations
  const groupIcon: Record<string, React.ReactNode> = {
    compliance: <ScrollText className="size-3.5" />,
    banks:      <Wallet     className="size-3.5" />,
    commerce:   <Globe2     className="size-3.5" />,
  }
  const regulators = i.groups.find((g) => g.k === "compliance")!
  const banks      = i.groups.find((g) => g.k === "banks")!
  const commerce   = i.groups.find((g) => g.k === "commerce")!

  /* A compact node chip — used for every regulator / bank / commerce platform. */
  const Node = ({ n, b }: { n: string; b: string }) => (
    <div className="group relative rounded-lg border border-card-border bg-card px-3 py-2 hover:border-primary/40 transition-all min-w-0">
      <div className="text-xs font-semibold text-foreground truncate" title={n}>{n}</div>
      <div className="text-2xs text-muted-foreground truncate mt-0.5" title={b}>{b}</div>
    </div>
  )

  const LaneHeader = ({ k, label }: { k: string; label: string }) => (
    <div className="flex items-center gap-2 mb-3">
      <div className="size-6 rounded-md bg-accent text-accent-foreground border border-accent-border flex items-center justify-center">
        {groupIcon[k]}
      </div>
      <div className="eyebrow text-foreground/80">{label}</div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )

  return (
    <section id="integrations" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="10" eyebrow={i.eyebrow} title={i.title} lead={i.lead} ar={t.ar} />

        {/* Compliance topology — regulators above, spine in the middle, operational rails below */}
        <div className="relative">
          {/* Decorative connector lines (lg+ only) */}
          <svg
            aria-hidden="true"
            className="hidden lg:block absolute inset-0 w-full h-full pointer-events-none"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <defs>
              <linearGradient id="conn-up" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="conn-dn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Up-going (spine → regulators) */}
            {[15, 38, 62, 85].map((x) => (
              <line key={`u-${x}`} x1={x} y1="38" x2={x} y2="6" stroke="url(#conn-up)" strokeWidth="0.15" />
            ))}
            {/* Down-going (spine → banks/commerce) */}
            {[10, 25, 40, 60, 75, 90].map((x) => (
              <line key={`d-${x}`} x1={x} y1="62" x2={x} y2="96" stroke="url(#conn-dn)" strokeWidth="0.15" />
            ))}
          </svg>

          {/* Regulators lane — TOP */}
          <div className="relative">
            <LaneHeader k="compliance" label={i.lanes.regulators} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10 lg:mb-14">
              {regulators.items.map((it) => <Node key={it.n} {...it} />)}
            </div>
          </div>

          {/* Spine — the unified compliance layer */}
          <div className="relative rounded-xl border border-border bg-card px-6 py-6 lg:px-8 lg:py-7 mb-10 lg:mb-14 overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 relative">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="size-1.5 rounded-full bg-success" />
                  <span className="text-2xs uppercase tracking-wider text-success font-medium">{i.live}</span>
                </div>
                <div className="text-lg lg:text-xl font-semibold text-foreground tracking-tight">{i.spineTitle}</div>
                <div className="text-xs lg:text-sm text-muted-foreground mt-1 leading-relaxed max-w-xl">{i.spineSub}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-md border border-border flex items-center justify-center">
                  <Workflow className="size-4 text-foreground/70" strokeWidth={1.75} />
                </div>
                <div className="size-9 rounded-md border border-border flex items-center justify-center">
                  <ShieldCheck className="size-4 text-foreground/70" strokeWidth={1.75} />
                </div>
                <div className="size-9 rounded-md border border-border flex items-center justify-center">
                  <Activity className="size-4 text-foreground/70" strokeWidth={1.75} />
                </div>
              </div>
            </div>
          </div>

          {/* Operational rails — BOTTOM */}
          <div className="grid lg:grid-cols-2 gap-x-10 gap-y-10 relative">
            <div>
              <LaneHeader k="banks" label={i.lanes.banks} />
              <div className="grid grid-cols-2 gap-3">
                {banks.items.map((it) => <Node key={it.n} {...it} />)}
              </div>
            </div>
            <div>
              <LaneHeader k="commerce" label={i.lanes.commerce} />
              <div className="grid grid-cols-2 gap-3">
                {commerce.items.map((it) => <Node key={it.n} {...it} />)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 text-center">
          <span className="text-2xs text-muted-foreground">{i.footnote}</span>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  8 · Compliance Calendar — MENA-wide year-at-a-glance                      */
/* ────────────────────────────────────────────────────────────────────────── */

const KIND_STYLES: Record<string, { bg: string; ring: string; dot: string; chip: string }> = {
  vat:    { bg: "bg-primary/12",   ring: "ring-primary/30",   dot: "bg-primary",     chip: "text-primary" },
  income: { bg: "bg-warning/15",   ring: "ring-warning/35",   dot: "bg-warning",     chip: "text-warning" },
  zakat:  { bg: "bg-info/12",      ring: "ring-info/30",      dot: "bg-info",        chip: "text-info" },
  esr:    { bg: "bg-foreground/8", ring: "ring-foreground/25",dot: "bg-foreground/70",chip: "text-foreground/80" },
  excise: { bg: "bg-loss/12",      ring: "ring-loss/30",      dot: "bg-loss",        chip: "text-loss" },
}

function ComplianceCalendar({ t }: { t: Dict }) {
  const c = t.compliance
  const todayMonth = new Date().getMonth() + 1 // 1..12
  const todayPercent = ((todayMonth - 0.5) / 12) * 100

  return (
    <section
      id="compliance"
      className="relative py-24 lg:py-32 border-b border-border overflow-hidden"
      data-testid="section-compliance"
    >
      {/* Quiet ambient backdrop — emerald wash from the side the eye reads from */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background: t.ar
            ? "radial-gradient(45% 55% at 90% 10%, hsl(158 64% 28% / 0.08), transparent 70%)"
            : "radial-gradient(45% 55% at 10% 10%, hsl(158 64% 28% / 0.08), transparent 70%)",
        }}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="11" eyebrow={c.eyebrow} title={c.title} lead={c.lead} ar={t.ar} />

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 rounded-xl overflow-hidden border border-border mb-10">
          {c.stats.map((s) => (
            <div key={s.l} className="bg-card p-5 lg:p-6">
              <div className="text-3xl lg:text-4xl font-semibold text-foreground tracking-tight tabular-nums">
                {s.v}
              </div>
              <div className="mt-1 text-2xs text-muted-foreground leading-snug">{s.l}</div>
            </div>
          ))}
        </div>

        {/* Calendar surface */}
        <div className="card-premium relative rounded-none border border-card-border bg-card overflow-hidden">
          {/* Months header */}
          <div className="grid grid-cols-[8.5rem_repeat(12,minmax(0,1fr))] border-b border-border bg-muted/30">
            <div className="px-4 py-3 font-mono text-2xs uppercase tracking-widest text-muted-foreground">
              {t.ar ? "الجهة · الدولة" : "Regulator · Country"}
            </div>
            {c.months.map((m, i) => {
              const isToday = i + 1 === todayMonth
              return (
                <div
                  key={m}
                  className={cn(
                    "px-1 py-3 text-center font-mono text-2xs tracking-wide border-l border-border/60",
                    isToday ? "text-primary font-semibold" : "text-muted-foreground"
                  )}
                  data-testid={`cal-month-${i + 1}`}
                >
                  {m}
                </div>
              )
            })}
          </div>

          {/* Today vertical guideline overlay */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-12 w-px bg-primary/40"
            style={{
              left: t.ar ? undefined : `calc(8.5rem + (100% - 8.5rem) * ${todayPercent / 100})`,
              right: t.ar ? `calc(8.5rem + (100% - 8.5rem) * ${todayPercent / 100})` : undefined,
            }}
          >
            <span
              className={cn(
                "absolute -top-2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider bg-primary text-primary-foreground whitespace-nowrap",
                t.ar && "translate-x-1/2"
              )}
            >
              {c.todayLabel}
            </span>
          </div>

          {/* Country rows */}
          {c.countries.map((co, ri) => (
            <div
              key={co.k}
              className={cn(
                "grid grid-cols-[8.5rem_repeat(12,minmax(0,1fr))] items-stretch",
                ri !== c.countries.length - 1 && "border-b border-border/60"
              )}
              data-testid={`cal-row-${co.k}`}
            >
              {/* Country label */}
              <div className="px-4 py-4 flex items-center gap-2.5 bg-muted/20 border-l border-border/40">
                <span className="text-lg leading-none" aria-hidden>{co.flag}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground leading-tight truncate">{co.n}</div>
                  <div className="font-mono text-2xs text-muted-foreground tracking-wide">{co.regulator}</div>
                </div>
              </div>
              {/* 12 month cells */}
              {Array.from({ length: 12 }, (_, mi) => {
                const monthNum = mi + 1
                const isToday = monthNum === todayMonth
                const dls = co.ds.filter((d) => d.m === monthNum)
                return (
                  <div
                    key={mi}
                    className={cn(
                      "relative min-h-[64px] px-1 py-2 border-l border-border/50 flex flex-col gap-1 items-stretch justify-start",
                      isToday && "bg-primary/[0.04]"
                    )}
                  >
                    {dls.map((d, di) => {
                      const s = KIND_STYLES[d.k] ?? KIND_STYLES.vat
                      return (
                        <div
                          key={di}
                          title={d.t}
                          className={cn(
                            "group/pill relative cursor-default",
                            "rounded-md px-1.5 py-1 ring-1",
                            s.bg, s.ring,
                          )}
                          data-testid={`cal-pill-${co.k}-${monthNum}-${di}`}
                        >
                          <div className="flex items-center gap-1">
                            <span className={cn("size-1.5 rounded-full flex-shrink-0", s.dot)} />
                            <span className={cn("text-[10px] font-medium leading-tight truncate", s.chip)}>
                              {d.t}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}

          {/* Legend strip */}
          <div className="border-t border-border bg-muted/20 px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
              {t.ar ? "المفتاح" : "Legend"}
            </span>
            {c.legend.map((l) => {
              const s = KIND_STYLES[l.k] ?? KIND_STYLES.vat
              return (
                <span key={l.k} className="inline-flex items-center gap-1.5 text-2xs text-foreground/80">
                  <span className={cn("size-2 rounded-full", s.dot)} />
                  {l.l}
                </span>
              )
            })}
          </div>
        </div>

        {/* Caption */}
        <p className="mt-5 text-2xs text-muted-foreground text-center max-w-3xl mx-auto leading-relaxed">
          {c.caption}
        </p>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  9 · Security & trust                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function Security({ t }: { t: Dict }) {
  const sec = t.security
  const icons = [
    <ShieldCheck className="size-5" />,
    <Lock className="size-5" />,
    <ScrollText className="size-5" />,
    <MapPin className="size-5" />,
  ]
  return (
    <section id="security" className="py-24 lg:py-32  border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="12" eyebrow={sec.eyebrow} title={sec.title} lead={sec.lead} ar={t.ar} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 rounded-xl overflow-hidden border border-border">
          {sec.items.map((it, i) => (
            <div key={it.t} className="bg-card p-7 lg:p-8">
              <div className="text-primary/70 mb-5">{icons[i]}</div>
              <h3 className="text-base font-semibold text-foreground mb-2">{it.t}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-5">{it.d}</p>
              <div className="font-mono text-2xs uppercase tracking-widest text-muted-foreground pt-4 border-t border-border/60">
                {it.m}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  9 · Use cases                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function UseCases({ t }: { t: Dict }) {
  const u = t.useCases
  const personas = u.personas
  const [active, setActive] = useState(personas[0].key)
  const current = personas.find((p) => p.key === active) ?? personas[0]

  return (
    <section id="use-cases" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="13" eyebrow={u.eyebrow} title={u.title} ar={t.ar} align="stack" />

        <div role="tablist" aria-label={u.tabsAria} className="flex flex-wrap gap-1 border-b border-border mb-10">
          {personas.map((p, i) => {
            const selected = active === p.key
            return (
              <button
                key={p.key}
                id={`persona-tab-${p.key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`persona-panel-${p.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(p.key)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
                  e.preventDefault()
                  // In RTL, ArrowLeft = next; in LTR, ArrowRight = next.
                  const forwardKey = t.ar ? "ArrowLeft" : "ArrowRight"
                  const dir = e.key === forwardKey ? 1 : -1
                  const next = (i + dir + personas.length) % personas.length
                  setActive(personas[next].key)
                  document.getElementById(`persona-tab-${personas[next].key}`)?.focus()
                }}
                data-testid={`tab-persona-${p.key}`}
                className={cn(
                  "px-5 py-3 text-sm font-medium -mb-px border-b-2 transition-colors outline-none",
                  selected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {p.tab}
              </button>
            )
          })}
        </div>

        <div
          id={`persona-panel-${current.key}`}
          role="tabpanel"
          aria-labelledby={`persona-tab-${current.key}`}
          className="grid lg:grid-cols-12 gap-12 animate-fade-in"
          key={current.key}
        >
          <div className="lg:col-span-7">
            <h3 className="text-2xl lg:text-3xl font-semibold text-foreground tracking-tight leading-snug mb-6">
              {current.headline}
            </h3>
            <blockquote className={cn("border-primary mb-6", t.ar ? "border-r-2 pr-5" : "border-l-2 pl-5")}>
              <p className="text-lg leading-relaxed text-foreground/80 italic">{current.quote}</p>
              <footer className="mt-3 text-sm text-muted-foreground">{current.author}</footer>
            </blockquote>
          </div>
          <div className="lg:col-span-5">
            <div className="eyebrow mb-4">{u.outcomes}</div>
            <ul className="space-y-3.5">
              {current.outcomes.map((o) => (
                <li key={o} className="flex gap-3 text-sm text-foreground/85 leading-relaxed">
                  <Check className="size-4 text-primary flex-shrink-0 mt-1" />
                  {o}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  9.5 · Pricing — transparent tiers                                          */
/* ────────────────────────────────────────────────────────────────────────── */

type PricingTier = {
  k: string
  n: string
  posture: string
  desc: string
  price: string
  features: readonly string[]
  cta: string
  popular?: boolean
  customPrice?: boolean
}

/* Mini-forecast bars rendered inside the Growth tier — visualizes the predictive layer. */
function MiniForecast({ ar }: { ar: boolean }) {
  const bars = [42, 58, 51, 67, 79, 88]
  const max = 100
  return (
    <div className="mt-4 mb-6 rounded-lg border border-card-border  px-3.5 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs text-muted-foreground tracking-wide uppercase">
          {ar ? "توقّع ٦ أشهر" : "6-mo outlook"}
        </span>
        <span className="text-2xs text-success font-medium tabular-nums">
          {ar ? "+ ٢٤٫٣٪" : "+ 24.3%"}
        </span>
      </div>
      <svg viewBox="0 0 180 44" className="w-full h-10" aria-hidden="true">
        {/* baseline */}
        <line x1="0" y1="42" x2="180" y2="42" stroke="hsl(var(--border))" strokeWidth="0.5" />
        {bars.map((v, i) => {
          const x = i * 30 + 6
          const h = (v / max) * 38
          const y = 42 - h
          const projected = i >= 4
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width="18"
                height={h}
                rx="2"
                fill={projected ? "transparent" : "hsl(var(--primary))"}
                stroke={projected ? "hsl(var(--primary))" : "none"}
                strokeWidth="1"
                strokeDasharray={projected ? "2 2" : undefined}
                opacity={projected ? 0.7 : 1}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Pricing({ t }: { t: Dict }) {
  const p = t.pricing
  const [yearly, setYearly] = useState(true)
  const yearlyMultiplier = 0.8 // 20% off yearly
  const tiers = p.tiers as readonly PricingTier[]

  const monthlyRef = useRef<HTMLButtonElement>(null)
  const yearlyRef  = useRef<HTMLButtonElement>(null)

  const selectBilling = (next: boolean) => {
    setYearly(next)
    // Move focus to the newly-selected radio (per WAI-ARIA radiogroup pattern)
    requestAnimationFrame(() => (next ? yearlyRef : monthlyRef).current?.focus())
  }

  const onToggleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key === "ArrowLeft" || e.key === "ArrowRight" ||
      e.key === "ArrowUp"   || e.key === "ArrowDown"
    ) {
      e.preventDefault()
      selectBilling(!yearly)
    }
  }

  const billingLabel = t.ar ? "دورة الفوترة" : "Billing cycle"

  // Asymmetric column spans (lg+); mobile stacks
  const tierSpan = (k: string) =>
    k === "growth" ? "lg:col-span-5" : k === "starter" ? "lg:col-span-3" : "lg:col-span-4"

  return (
    <section id="pricing" className="relative py-24 lg:py-32 border-b border-border ">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Chapter num="15" eyebrow={p.eyebrow} title={p.title} lead={p.lead} ar={t.ar} />

        {/* Cost of waiting strip — anchors pricing in the cost of NOT acting */}
        <div className="mx-auto max-w-4xl mb-10 lg:mb-12 rounded-xl border border-loss/25 bg-loss/[0.04] px-5 py-4 lg:px-7 lg:py-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="size-1.5 rounded-full bg-loss/80" />
            <span className="eyebrow text-loss/90">{p.inactionLabel}</span>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
            {p.inaction.map((it) => (
              <div key={it.t} className="min-w-0">
                <div className="text-xl lg:text-2xl font-semibold text-loss tracking-tight tabular-nums">{it.v}</div>
                <div className="text-2xs text-muted-foreground mt-1 leading-snug">{it.t}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Billing radiogroup */}
        <div className="flex justify-center mb-10">
          <div
            role="radiogroup"
            aria-label={billingLabel}
            onKeyDown={onToggleKey}
            className="inline-flex items-center gap-1 p-1 rounded-full border border-border bg-card"
          >
            {[
              { v: false, label: p.billing.monthly, id: "pricing-monthly", ref: monthlyRef },
              { v: true,  label: p.billing.yearly,  id: "pricing-yearly",  ref: yearlyRef  },
            ].map((opt) => {
              const active = yearly === opt.v
              return (
                <button
                  key={opt.id}
                  ref={opt.ref}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectBilling(opt.v)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={opt.id}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Asymmetric tier grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {tiers.map((tier) => {
            const isCustom = tier.customPrice
            const popular = tier.popular
            const displayPrice = isCustom
              ? tier.price
              : yearly
                ? formatYearly(tier.price, yearlyMultiplier, t.ar)
                : tier.price
            return (
              <div
                key={tier.k}
                data-testid={`pricing-tier-${tier.k}`}
                className={cn(
                  "relative rounded-none border bg-card flex flex-col",
                  tierSpan(tier.k),
                  popular
                    ? "border-foreground/30 lg:-my-4 p-7 lg:p-9"
                    : "border-card-border p-7 lg:p-7",
                )}
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-primary text-primary-foreground text-2xs font-medium tracking-wide">
                    {p.mostPopular}
                  </span>
                )}

                {/* Posture eyebrow — the signature framing */}
                <div className={cn(
                  "text-2xs tracking-wider uppercase mb-2",
                  popular ? "text-primary" : "text-muted-foreground",
                )}>
                  · {tier.posture} ·
                </div>

                <div className="mb-4">
                  <div className={cn(
                    "font-semibold text-foreground",
                    popular ? "text-lg" : "text-base",
                  )}>{tier.n}</div>
                  <div className="text-2xs text-muted-foreground mt-1 leading-snug">{tier.desc}</div>
                </div>

                <div
                  className={cn("pb-5 mb-5 border-b border-border", popular && "pb-6 mb-6")}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {isCustom ? (
                    <div className="text-2xl lg:text-3xl font-semibold text-foreground tracking-tight">{displayPrice}</div>
                  ) : (
                    <div className="flex items-baseline gap-1.5 tabular-nums">
                      <span className="text-2xs text-muted-foreground self-start mt-2">{p.currency}</span>
                      <span className={cn(
                        "font-semibold text-foreground tracking-tight",
                        popular ? "text-5xl" : "text-4xl",
                      )}>{displayPrice}</span>
                      <span className="text-xs text-muted-foreground">{p.perMonth}</span>
                    </div>
                  )}
                </div>

                {/* Mini predictive forecast — only the popular tier */}
                {popular && (
                  <>
                    <div className="text-2xs text-muted-foreground -mt-2">{p.forecastCaption}</div>
                    <MiniForecast ar={t.ar} />
                  </>
                )}

                <ul className="space-y-2.5 mb-7 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground/85">
                      <Check className={cn(
                        "size-4 flex-shrink-0 mt-0.5",
                        popular ? "text-primary" : "text-foreground/60",
                      )} />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={popular ? "default" : "outline"}
                  size={popular ? "lg" : "default"}
                  className="w-full"
                  asChild
                  data-testid={`button-pricing-${tier.k}`}
                >
                  <a href={isCustom ? "/demo" : "/signup"}>{tier.cta}</a>
                </Button>
              </div>
            )
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-2xs text-muted-foreground">
          {p.assurances.map((a) => (
            <span key={a} className="inline-flex items-center gap-1.5">
              <Check className="size-3 text-success" />
              <span>{a}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/* Format a monthly tier price under yearly billing (apply discount + Arabic numerals). */
function formatYearly(monthly: string, mult: number, ar: boolean): string {
  // Try to parse the numeric portion (handles Arabic-Indic and Latin digits).
  const arabicMap: Record<string, string> = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" }
  const normalized = monthly.replace(/[٠-٩]/g, (d) => arabicMap[d] ?? d).replace(/[^0-9.]/g, "")
  const n = parseFloat(normalized)
  if (!isFinite(n)) return monthly
  const discounted = Math.round(n * mult)
  if (!ar) return discounted.toLocaleString("en-US")
  // Render in Arabic-Indic digits.
  return discounted
    .toLocaleString("en-US")
    .replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[parseInt(d, 10)])
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 10 · FAQ                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function FAQ({ t }: { t: Dict }) {
  return (
    <section
      id="faq"
      className="relative py-24 lg:py-32 "
      style={{ borderBottom: "1px solid hsl(220 18% 6%)" }}
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="eyebrow eyebrow-lead mb-3"><span className="chapter-index">16</span>{t.faq.eyebrow}</div>
          <h2 className="text-display text-foreground">{t.faq.title}</h2>
        </div>
        <Accordion type="single" collapsible className="border-t border-border">
          {t.faq.qs.map((item, i) => (
            <AccordionItem key={i} value={`q-${i}`} className="border-b border-border">
              <AccordionTrigger className="text-start py-5 text-base font-medium text-foreground hover:no-underline">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="pb-6 text-sm text-muted-foreground leading-relaxed">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 11 · Final CTA                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function FinalCTA({ t }: { t: Dict }) {
  const f = t.finalCta
  // Final CTA — full-bleed dark editorial close, mirrors hero so the page lands on the same chord.
  const D_BG   = "hsl(220 18% 6%)"
  const D_INK  = "hsl(40 18% 95%)"
  const D_MUTE = "hsl(40 6% 62%)"
  const D_LINE = "hsl(220 10% 16%)"
  const D_GLOW = "hsl(158 70% 52%)"
  return (
    <section
      id="cta"
      className="relative overflow-hidden py-28 lg:py-44 scroll-mt-24"
      style={{ background: D_BG, color: D_INK }}
      data-testid="section-final-cta"
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: D_LINE }} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background: `radial-gradient(60% 55% at 50% 110%, ${D_GLOW}25, transparent 70%)`,
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-baseline gap-3 mb-10 lg:mb-14" style={{ color: D_MUTE }}>
          <span className="font-mono text-2xs tracking-[0.28em] uppercase">ch · 17</span>
          <span aria-hidden className="h-px flex-1" style={{ background: D_LINE }} />
          <span className={cn("text-2xs", t.ar ? "tracking-normal" : "font-mono uppercase tracking-[0.18em]")}>
            {t.ar ? "آخر فصل" : "Final chapter"}
          </span>
        </div>
        <h2
          className={cn(
            "text-[clamp(2.75rem,7vw,5.75rem)]",
            t.ar
              ? "font-semibold leading-[1.12] tracking-normal"
              : "font-display leading-[0.98] tracking-[-0.025em]",
          )}
          style={{ color: D_INK }}
        >
          {f.h1}
          <br />
          <span className={t.ar ? "font-semibold" : "display-italic"} style={{ color: D_GLOW }}>
            {f.h2}
          </span>
          <span style={{ color: D_GLOW }}>.</span>
        </h2>
        <p
          className={cn(
            "mt-10 max-w-2xl text-lg lg:text-xl",
            t.ar ? "leading-[1.7]" : "leading-[1.55]",
          )}
          style={{ color: "hsla(40, 12%, 88%, 0.78)" }}
        >
          {f.sub}
        </p>
        <div className="mt-12 lg:mt-16 flex flex-wrap items-center gap-4">
          <Button
            size="xl"
            data-testid="button-final-cta"
            asChild
            style={{ background: D_INK, color: D_BG }}
            className="hover:opacity-90"
          >
            <a href="/signin" className="gap-2">
              {f.cta}
              <CtaArrow ar={t.ar} />
            </a>
          </Button>
          <Button
            size="xl"
            variant="outline"
            asChild
            className="hover:bg-transparent"
            style={{ borderColor: D_LINE, color: D_INK, background: "transparent" }}
          >
            <a href="/demo" data-testid="button-final-cta-demo">{f.ctaDemo}</a>
          </Button>
          <div className="basis-full text-xs mt-2" style={{ color: D_MUTE }}>
            {f.orWatch}{" "}
            <a
              href="#showcase"
              className="underline-offset-4 hover:underline"
              style={{ color: D_GLOW }}
            >
              {f.orLink}
            </a>
            {f.orWatchSuffix}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helper components                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function BrowserFrame({
  children, title, subtle = false, large = false,
}: { children: React.ReactNode; title: string; subtle?: boolean; large?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        subtle ? "shadow-md" : large ? "shadow-xl" : "shadow-lg",
      )}
    >
      {/* Editorial product caption — replaces cliché macOS traffic-lights.    */}
      {/* A single emerald accent bar + mono title + tiny static "live" mark.  */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/40">
        <span aria-hidden className="h-3.5 w-[3px] rounded-sm bg-primary/80" />
        <div className="flex-1 min-w-0 font-mono text-2xs text-foreground/70 tracking-[0.12em] truncate">
          {title}
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground/85">
          <span aria-hidden className="size-1 rounded-full bg-success" />
          live
        </span>
      </div>
      {children}
    </div>
  )
}

function MiniKPI({
  label, value, delta, positive, highlight, compact, warning,
}: {
  label: string; value: string; delta?: string;
  positive?: boolean; highlight?: boolean; compact?: boolean; warning?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        highlight
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border",
      )}
    >
      <div className={cn("text-2xs", highlight ? "text-background/70" : "text-muted-foreground")}>{label}</div>
      <div className={cn(
        "font-semibold tabular-nums tracking-tight mt-0.5",
        compact ? "text-base" : "text-xl",
      )}>
        {value}
      </div>
      {delta && (
        <div className={cn(
          "text-2xs mt-1 font-mono",
          warning && !highlight ? "text-warning"
            : positive && !highlight ? "text-success"
            : highlight ? "text-background/70"
            : "text-muted-foreground"
        )}>
          {delta}
        </div>
      )}
    </div>
  )
}

function SparkChart({ compact = false }: { compact?: boolean }) {
  const h = compact ? 40 : 80
  return (
    <svg viewBox={`0 0 320 ${h}`} className="w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={compact
          ? "M0 30 L40 28 L80 22 L120 24 L160 16 L200 18 L240 12 L280 8 L320 4 L320 40 L0 40 Z"
          : "M0 60 L40 55 L80 48 L120 52 L160 36 L200 42 L240 28 L280 18 L320 10 L320 80 L0 80 Z"}
        fill="url(#sparkFill)"
      />
      <path
        d={compact
          ? "M0 30 L40 28 L80 22 L120 24 L160 16 L200 18 L240 12 L280 8 L320 4"
          : "M0 60 L40 55 L80 48 L120 52 L160 36 L200 42 L240 28 L280 18 L320 10"}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ChatBubble({
  role, children, typing,
}: { role: "user" | "ai"; children?: React.ReactNode; typing?: boolean }) {
  const isAI = role === "ai"
  return (
    <div className={cn("flex", isAI ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
          isAI
            ? "bg-card border border-border text-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {typing ? (
          <span className="inline-flex gap-1 py-1">
            <span className="size-1.5 rounded-full bg-current opacity-40" />
            <span className="size-1.5 rounded-full bg-current opacity-60" />
            <span className="size-1.5 rounded-full bg-current opacity-80" />
          </span>
        ) : children}
      </div>
    </div>
  )
}

function FloatingChip({
  icon, title, subtitle, accent,
}: { icon: React.ReactNode; title: string; subtitle: string; accent?: "success" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-center gap-2.5">
      <div className={cn(
        "size-7 rounded-md flex items-center justify-center",
        accent === "success"
          ? "bg-success/10 text-success border border-success/20"
          : "bg-accent text-accent-foreground border border-accent-border"
      )}>
        {icon}
      </div>
      <div>
        <div className="text-xs font-medium text-foreground leading-tight">{title}</div>
        <div className="text-2xs text-muted-foreground leading-tight mt-0.5">{subtitle}</div>
      </div>
    </div>
  )
}

function Metric({ value, label, mono }: { value: string; label: string; mono?: boolean }) {
  return (
    <div className="bg-card p-5 lg:p-6">
      <div className={cn(
        "text-2xl lg:text-3xl font-semibold text-foreground tabular-nums tracking-tight",
        mono && "font-mono"
      )}>
        {value}
      </div>
      <div className="text-2xs text-muted-foreground mt-1.5 uppercase tracking-widest">{label}</div>
    </div>
  )
}

function BentoCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "card-premium rounded-xl border border-card-border bg-card p-6 lg:p-7",
      "shadow-sm transition-all duration-200",
      className
    )}>
      {children}
    </div>
  )
}

function AlertRow({ type, label, detail }: {
  type: "warning" | "info" | "success"; label: string; detail: string
}) {
  const dotColor =
    type === "warning" ? "bg-warning" :
    type === "info" ? "bg-info" :
    "bg-success"
  const Icon =
    type === "warning" ? AlertTriangle :
    type === "info" ? Database :
    Check
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn("status-dot mt-1.5 flex-shrink-0", dotColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-2xs text-foreground font-medium truncate">{label}</div>
        <div className="text-2xs text-muted-foreground truncate mt-0.5">{detail}</div>
      </div>
      <Icon className="size-3 text-muted-foreground flex-shrink-0 mt-1" />
    </div>
  )
}
