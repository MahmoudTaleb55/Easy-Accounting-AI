import { useRef, useState } from "react"
import {
  ArrowLeft, ArrowRight, Check, FileText, Receipt, Bot,
  Sparkles, ShieldCheck, Globe2, Workflow, BarChart3, Briefcase,
  Users, Wallet, TrendingUp, AlertTriangle, Lock, Database, ScrollText,
  MapPin, Activity, Scale, Radar, Brain, LineChart,
} from "lucide-react"
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
      tag: ar ? "إصدار جديد · بقوّة GPT-5.2" : "New release · Powered by GPT-5.2",
      h1a: ar ? "ذكاءٌ ماليٌّ،" : "Financial intelligence,",
      h1b: ar ? "يقودُ قراراتك التالية." : "engineered for your next decision.",
      sub: ar
        ? "ليست محاسبة فحسب. منصّةٌ ماليّةٌ مبنيّةٌ على IFRS، يَدرسُ فيها ذكاءٌ اصطناعيّ كلَّ ريالٍ يدخلُ ويخرج، يتوقّعُ تدفّقَك النقديّ، ويرصُدُ ما يستحقُّ انتباهَك قبلَ أن يصبحَ مشكلة."
        : "More than accounting. An IFRS-grade financial platform where AI reads every transaction, forecasts your cash, and surfaces what deserves your attention — before it becomes a problem.",
      subEm: ar ? " عربيّة في الجوهر، عالميّة في التصميم." : " Arabic-first, global by design.",
      ctaPrimary: ar ? "افتح التطبيق" : "Open the app",
      ctaSecondary: ar ? "اطلب عرضاً مباشراً" : "Book a live demo",
      ctaTertiary: ar ? "تسجيل الدخول" : "Sign in",
      bullets: ar
        ? ["بدون بطاقة ائتمان", "١٤ يوماً مجاناً، بكلّ المزايا", "جاهز خلال ٥ دقائق"]
        : ["No credit card", "Full 14-day trial", "Set up in 5 minutes"],
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
      eyebrow: ar ? "يثق بنا" : "Trusted by",
      headline: ar ? "٢٠٠٠+" : "2,000+",
      sub1: ar ? "شركة وفريق ماليّ" : "businesses & finance teams",
      sub2: ar ? "في" : "across",
      sub3: ar ? "٧ دول" : "7 countries",
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
      flow: ar
        ? ["ارفع الفاتورة", "الذكاء يقرأ ويصنّف", "يُسجّل القيد", "يُحدّث الميزانيّة", "التقرير حيّ"]
        : ["Drop the invoice", "AI reads & classifies", "Posts the entry", "Updates the budget", "Live report"],
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
      <main className="overflow-x-clip">
        <Hero t={t} />
        <TrustStrip t={t} />
        <WhyDifferent t={t} />
        <CoreCapabilities t={t} />
        <AIAssistant t={t} />
        <DashboardShowcase t={t} />
        <PredictiveCapital t={t} />
        <Automation t={t} />
        <LiveAuditor t={t} />
        <LocalIntegrations t={t} />
        <Security t={t} />
        <UseCases t={t} />
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
/*  1 · Hero                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function Hero({ t }: { t: Dict }) {
  return (
    <section className="relative pt-16 pb-24 lg:pt-24 lg:pb-32 brand-grain">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 brand-mesh [mask-image:radial-gradient(70%_55%_at_50%_30%,black,transparent)]"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 -z-10 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-xs">
              <span className="status-dot bg-success animate-pulse" />
              <span className="text-xs text-muted-foreground">{t.hero.tag}</span>
            </div>

            <h1 className="mt-6 text-display-lg text-foreground">
              {t.hero.h1a}
              <br />
              <span className="text-primary">{t.hero.h1b}</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t.hero.sub}
              <span className="text-foreground/80">{t.hero.subEm}</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" data-testid="button-hero-cta-primary" asChild>
                <a href="/signin" className="gap-2">
                  {t.hero.ctaPrimary}
                  <CtaArrow ar={t.ar} />
                </a>
              </Button>
              <Button size="lg" variant="outline" data-testid="button-hero-cta-secondary" asChild>
                <a href="/demo">{t.hero.ctaSecondary}</a>
              </Button>
              <Button size="lg" variant="ghost" data-testid="button-hero-cta-tertiary" asChild>
                <a href="/signin">{t.hero.ctaTertiary}</a>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              {t.hero.bullets.map((b) => (
                <span key={b} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-success" />{b}
                </span>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6">
            <HeroProductMockup t={t} />
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroProductMockup({ t }: { t: Dict }) {
  const startSide = t.ar ? "-left-4" : "-right-4"
  const endSide   = t.ar ? "-right-4" : "-left-4"
  return (
    <div className="relative">
      <div className={cn("absolute -bottom-6 z-10 hidden md:block", startSide)}>
        <FloatingChip
          icon={<Sparkles className="size-3.5" />}
          title={t.hero.chipAuto.t}
          subtitle={t.hero.chipAuto.s}
        />
      </div>
      <div className={cn("absolute -top-4 z-10 hidden md:block", endSide)}>
        <FloatingChip
          icon={<TrendingUp className="size-3.5" />}
          title={t.hero.chipProfit.t}
          subtitle={t.hero.chipProfit.s}
          accent="success"
        />
      </div>

      <BrowserFrame title={t.hero.mockTitle}>
        <div className="grid grid-cols-3 gap-3 p-4">
          <MiniKPI label={t.hero.kpis.revenue} value={t.ar ? "٢٤٢,٣٠٠" : "242,300"} delta="+8.4%" positive />
          <MiniKPI label={t.hero.kpis.expenses} value={t.ar ? "١٣٨,٧١٠" : "138,710"} delta="-2.1%" />
          <MiniKPI label={t.hero.kpis.netCash} value={t.ar ? "١٠٣,٥٩٠" : "103,590"} delta="+14.6%" positive highlight />
        </div>
        <div className="px-4 pb-3">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="eyebrow mb-1">{t.hero.band.eyebrow}</div>
                <div className="text-sm font-medium text-foreground">{t.hero.band.title}</div>
              </div>
              <div className="flex gap-1.5">
                {t.hero.band.ticks.map((tk, i) => (
                  <span key={tk} className={cn("text-2xs", i === 2 ? "text-foreground font-medium border-b border-primary pb-0.5" : "text-muted-foreground")}>
                    {tk}
                  </span>
                ))}
              </div>
            </div>
            <SparkChart />
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className="rounded-md border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
              <div className="text-xs font-medium text-foreground">{t.hero.entry.title}</div>
              <Badge variant="success" size="sm">{t.hero.entry.balanced}</Badge>
            </div>
            <table className="w-full text-2xs">
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="px-3 py-2 text-muted-foreground font-mono">5110</td>
                  <td className="px-3 py-2 text-foreground">{t.hero.entry.marketing}</td>
                  <td className="px-3 py-2 text-foreground font-mono text-end tabular-nums">{t.hero.entry.amount}</td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-end">—</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-muted-foreground font-mono">1010</td>
                  <td className="px-3 py-2 text-foreground">{t.hero.entry.cash}</td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-end">—</td>
                  <td className="px-3 py-2 text-foreground font-mono text-end tabular-nums">{t.hero.entry.amount}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </BrowserFrame>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  2 · Trust strip                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function TrustStrip({ t }: { t: Dict }) {
  const wordmarks = ["ARAMEX", "Almosafer", "TALABAT", "Anghami", "Mubadala", "STC pay", "Careem"]
  return (
    <section className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 lg:py-12">
        <div className="grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-3">
            <div className="eyebrow mb-2">{t.trust.eyebrow}</div>
            <div className="text-sm text-foreground/85 leading-relaxed">
              <span className="font-semibold text-foreground">{t.trust.headline}</span> {t.trust.sub1}
              <br />{t.trust.sub2} <span className="font-semibold text-foreground">{t.trust.sub3}</span>
            </div>
          </div>
          <div className="lg:col-span-9">
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 opacity-70">
              {wordmarks.map((w) => (
                <span key={w} className="font-display text-sm md:text-base font-semibold tracking-wide text-foreground/70 whitespace-nowrap">
                  {w}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border">
          {t.trust.metrics.map((m) => (
            <Metric key={m.l} value={m.v} label={m.l} mono={m.mono} />
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
    <section id="platform" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 mb-16">
          <div className="lg:col-span-5">
            <div className="eyebrow mb-4">{t.why.eyebrow}</div>
            <h2 className="text-display text-foreground">
              {t.why.title1}
              <br />
              <span className="text-muted-foreground/70">{t.why.title2}</span>
            </h2>
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <p className="text-lg leading-relaxed text-foreground/80">{t.why.lead}</p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t.why.sub}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border">
          {t.why.principles.map((p) => (
            <div key={p.n} className="bg-card p-8 lg:p-10">
              <div className="flex items-start gap-6">
                <div className="font-mono text-xs text-primary tracking-widest pt-1">{p.n}</div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-3 leading-snug">{p.t}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{p.b}</p>
                </div>
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
  return (
    <section id="capabilities" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-14">
          <div className="eyebrow mb-3">{c.eyebrow}</div>
          <h2 className="text-display text-foreground">{c.title}</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{c.lead}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 lg:gap-5">
          <BentoCard className="md:col-span-4 md:row-span-2">
            <div className="flex items-start justify-between">
              <div>
                <Badge variant="brand" size="sm" className="mb-3">{c.cockpit.tag}</Badge>
                <h3 className="text-2xl font-semibold text-foreground mb-2">{c.cockpit.title}</h3>
                <p className="text-sm text-muted-foreground max-w-md leading-relaxed">{c.cockpit.body}</p>
              </div>
              <BarChart3 className="size-5 text-primary/60" />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {c.cockpit.kpis.map((k) => (
                <MiniKPI key={k.label} {...k} />
              ))}
            </div>
            <div className="mt-4 rounded-md border border-border bg-card p-3">
              <SparkChart compact />
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2 md:row-span-2">
            <Badge variant="brand" size="sm" className="mb-3">{c.ai.tag}</Badge>
            <h3 className="text-xl font-semibold text-foreground mb-2">{c.ai.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{c.ai.body}</p>
            <div className="mt-5 space-y-3">
              <ChatBubble role="user">{c.ai.chat1}</ChatBubble>
              <ChatBubble role="ai">{c.ai.chat2}</ChatBubble>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-3">
            <div className="flex items-start gap-4">
              <Globe2 className="size-5 text-primary/60 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">{c.local.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{c.local.body}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {c.local.chips.map((x) => (
                    <span key={x} className="text-2xs px-2 py-1 rounded border border-border text-muted-foreground bg-background">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-3">
            <div className="flex items-start gap-4">
              <Briefcase className="size-5 text-primary/60 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">{c.assets.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{c.assets.body}</p>
                <div className="mt-4 grid grid-cols-3 gap-3 text-2xs">
                  <div><div className="text-muted-foreground">{c.assets.m1}</div><div className="font-mono text-foreground">{c.assets.m1v}</div></div>
                  <div><div className="text-muted-foreground">{c.assets.m2}</div><div className="font-mono text-foreground">{c.assets.m2v}</div></div>
                  <div><div className="text-muted-foreground">{c.assets.m3}</div><div className="font-mono text-foreground">{c.assets.m3v}</div></div>
                </div>
              </div>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2">
            <Users className="size-5 text-primary/60 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">{c.payroll.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{c.payroll.body}</p>
          </BentoCard>

          <BentoCard className="md:col-span-2">
            <ScrollText className="size-5 text-primary/60 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">{c.reports.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{c.reports.body}</p>
          </BentoCard>

          <BentoCard className="md:col-span-2">
            <Wallet className="size-5 text-primary/60 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">{c.multi.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{c.multi.body}</p>
          </BentoCard>
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
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-5 lg:col-start-8">
            <Badge variant="brand" size="md" className="mb-4">
              <Bot className="size-3.5" />
              {a.tag}
            </Badge>
            <h2 className="text-display text-foreground mb-5">
              {a.h1}<br />{a.h2}
            </h2>
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

          <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1">
            <BrowserFrame title={a.mockTitle} subtle>
              <div className="p-5 space-y-4">
                <ChatBubble role="user">{a.chat.u1}</ChatBubble>
                <ChatBubble role="ai">
                  {a.chat.a1Pre}<span className="font-mono text-primary">{a.chat.a1Num}</span>:
                  <div className="mt-3 rounded border border-border overflow-hidden">
                    <table className="w-full text-2xs">
                      <tbody>
                        <tr className="border-b border-border/60 bg-muted/30">
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">5210</td>
                          <td className="px-3 py-1.5">{a.chat.utilities}</td>
                          <td className="px-3 py-1.5 font-mono text-end">{a.chat.amount}</td>
                          <td className="px-3 py-1.5 font-mono text-end text-muted-foreground">—</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">2110</td>
                          <td className="px-3 py-1.5">{a.chat.payable}</td>
                          <td className="px-3 py-1.5 font-mono text-end text-muted-foreground">—</td>
                          <td className="px-3 py-1.5 font-mono text-end">{a.chat.amount}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 text-xs text-foreground/80">
                    {a.chat.budget[0]} <span className="font-mono">{a.chat.budget[1]}</span> {a.chat.budget[2]}
                  </div>
                </ChatBubble>
                <ChatBubble role="user">{a.chat.u2}</ChatBubble>
                <ChatBubble role="ai" typing />
              </div>
            </BrowserFrame>
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
    <section id="showcase" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="eyebrow mb-3">{s.eyebrow}</div>
          <h2 className="text-display text-foreground">{s.title}</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{s.lead}</p>
        </div>

        <BrowserFrame title={s.mockTitle} large>
          <div className="grid grid-cols-12 gap-4 p-5">
            <div className="col-span-2 space-y-1">
              {s.sidebar.map((l, i) => (
                <div
                  key={l}
                  className={cn(
                    "px-2.5 py-1.5 rounded text-2xs",
                    i === 4 ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                  )}
                >
                  {l}
                </div>
              ))}
            </div>
            <div className="col-span-10 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <MiniKPI label={s.kpis.revenue}  value={t.ar ? "٢٤٢,٣٠٠" : "242,300"} delta="+8.4%" positive />
                <MiniKPI label={s.kpis.expenses} value={t.ar ? "١٣٨,٧١٠" : "138,710"} delta="-2.1%" />
                <MiniKPI label={s.kpis.netCash}  value={t.ar ? "١٠٣,٥٩٠" : "103,590"} delta="+14.6%" positive highlight />
                <MiniKPI label={s.kpis.health}   value={s.kpis.healthVal} delta={s.kpis.healthDelta} positive />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 rounded-md border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="eyebrow mb-1">{s.cash.eyebrow}</div>
                      <div className="text-sm font-medium text-foreground">{s.cash.title}</div>
                    </div>
                    <Badge variant="success" size="sm">{s.cash.delta}</Badge>
                  </div>
                  <SparkChart />
                </div>
                <div className="rounded-md border border-border bg-card p-4">
                  <div className="eyebrow mb-2">{s.alerts.title}</div>
                  <div className="space-y-2.5">
                    <AlertRow type="warning" label={s.alerts.late.l}   detail={s.alerts.late.d} />
                    <AlertRow type="info"    label={s.alerts.gosi.l}   detail={s.alerts.gosi.d} />
                    <AlertRow type="success" label={s.alerts.budget.l} detail={s.alerts.budget.d} />
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-primary/20 bg-accent/40 p-3 flex items-start gap-3">
                <Sparkles className="size-4 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-2xs leading-relaxed text-foreground/85">
                  <span className="font-medium text-foreground">{s.coachLabel}</span>
                  {s.coachBody}
                </div>
              </div>
            </div>
          </div>
        </BrowserFrame>

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
    <section id="intelligence" className="relative py-24 lg:py-32 border-b border-border overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 brand-mesh opacity-60 [mask-image:radial-gradient(60%_50%_at_50%_40%,black,transparent)]"
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-8 mb-14">
          <div className="lg:col-span-7">
            <div className="eyebrow mb-3">{p.eyebrow}</div>
            <h2 className="text-display text-foreground">
              {p.title}
              <br />
              <span className="text-primary">{p.title2}</span>
            </h2>
          </div>
          <div className="lg:col-span-5 self-end">
            <p className="text-base leading-relaxed text-muted-foreground">{p.lead}</p>
          </div>
        </div>

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
                        : "border-border bg-card hover-elevate"
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
  const flowIcons = [
    <Receipt className="size-4" />,
    <Bot className="size-4" />,
    <FileText className="size-4" />,
    <Workflow className="size-4" />,
    <BarChart3 className="size-4" />,
  ]

  return (
    <section id="automation" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-8 mb-14">
          <div className="lg:col-span-6">
            <div className="eyebrow mb-3">{aut.eyebrow}</div>
            <h2 className="text-display text-foreground">{aut.title}</h2>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 self-end">
            <p className="text-base leading-relaxed text-muted-foreground">{aut.lead}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 lg:p-10 overflow-x-auto">
          <div className="flex items-center justify-between gap-3 min-w-[640px]">
            {aut.flow.map((label, i) => (
              <div key={label} className="flex items-center gap-3 flex-1">
                <div className="flex flex-col items-center text-center flex-1">
                  <div className="size-10 rounded-full bg-accent text-accent-foreground border border-accent-border flex items-center justify-center mb-2.5">
                    {flowIcons[i]}
                  </div>
                  <div className="text-xs font-medium text-foreground">{label}</div>
                  <div className="font-mono text-2xs text-muted-foreground mt-1">0{i + 1}</div>
                </div>
                {i < aut.flow.length - 1 && (
                  <div className="flex-shrink-0 w-8 h-px bg-border relative">
                    <CtaArrow ar={t.ar} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid md:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
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
    <section id="auditor" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-8 mb-14">
          <div className="lg:col-span-7">
            <div className="eyebrow mb-3 flex items-center gap-2">
              <Radar className="size-3.5 text-primary" />
              <span>{a.eyebrow}</span>
            </div>
            <h2 className="text-display text-foreground">{a.title}</h2>
          </div>
          <div className="lg:col-span-5 self-end">
            <p className="text-base leading-relaxed text-muted-foreground">{a.lead}</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-6">
          {/* Live audit feed */}
          <div className="lg:col-span-7">
            <BentoCard className="h-full">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="relative flex size-2">
                    <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                  </span>
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
    <div className="group relative rounded-lg border border-card-border bg-card px-3 py-2 hover:border-primary/40 hover:shadow-sm transition-all min-w-0">
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
    <section id="integrations" className="py-24 lg:py-32 border-b border-border bg-gradient-to-b from-background to-card/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="grid lg:grid-cols-12 gap-8 mb-12 lg:mb-16">
          <div className="lg:col-span-7">
            <div className="eyebrow mb-3">{i.eyebrow}</div>
            <h2 className="text-display text-foreground">{i.title}</h2>
          </div>
          <div className="lg:col-span-5 self-end">
            <p className="text-base leading-relaxed text-muted-foreground">{i.lead}</p>
          </div>
        </div>

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
          <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/[0.08] via-primary/[0.04] to-primary/[0.08] px-6 py-6 lg:px-8 lg:py-7 mb-10 lg:mb-14 overflow-hidden">
            {/* Pulse line */}
            <svg aria-hidden="true" className="absolute inset-x-0 bottom-0 w-full h-6" viewBox="0 0 400 24" preserveAspectRatio="none">
              <path
                d="M0 12 Q 50 4, 100 12 T 200 12 T 300 12 T 400 12"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="1"
                strokeOpacity="0.55"
                strokeDasharray="4 4"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.6s" repeatCount="indefinite" />
              </path>
            </svg>
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 relative">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="size-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />
                  <span className="text-2xs uppercase tracking-wider text-success font-medium">{i.live}</span>
                </div>
                <div className="text-lg lg:text-xl font-semibold text-foreground tracking-tight">{i.spineTitle}</div>
                <div className="text-xs lg:text-sm text-muted-foreground mt-1 leading-relaxed max-w-xl">{i.spineSub}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <Sparkles className="size-4 text-primary" />
                </div>
                <div className="size-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <ShieldCheck className="size-4 text-primary" />
                </div>
                <div className="size-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <Activity className="size-4 text-primary" />
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
/*  8 · Security                                                              */
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
    <section id="security" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 mb-14 items-end">
          <div className="lg:col-span-7">
            <div className="eyebrow mb-3">{sec.eyebrow}</div>
            <h2 className="text-display text-foreground">{sec.title}</h2>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="text-base leading-relaxed text-muted-foreground">{sec.lead}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border border-border">
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
        <div className="max-w-2xl mb-12">
          <div className="eyebrow mb-3">{u.eyebrow}</div>
          <h2 className="text-display text-foreground">{u.title}</h2>
        </div>

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
    <div className="mt-4 mb-6 rounded-lg border border-card-border bg-card/60 px-3.5 py-3">
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
    <section id="pricing" className="relative py-24 lg:py-32 border-b border-border bg-card/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section heading */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="eyebrow mb-3">{p.eyebrow}</div>
          <h2 className="text-display text-foreground">{p.title}</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{p.lead}</p>
        </div>

        {/* Cost of waiting strip — anchors pricing in the cost of NOT acting */}
        <div className="mx-auto max-w-4xl mb-10 lg:mb-12 rounded-xl border border-loss/25 bg-loss/[0.04] px-5 py-4 lg:px-7 lg:py-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="size-1.5 rounded-full bg-loss/80 animate-pulse motion-reduce:animate-none" />
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
                  "relative rounded-2xl border bg-card flex flex-col",
                  tierSpan(tier.k),
                  popular
                    ? "border-primary/40 shadow-lg ring-1 ring-primary/15 lg:-my-4 p-7 lg:p-9 bg-gradient-to-b from-primary/[0.04] to-card"
                    : "border-card-border shadow-xs p-7 lg:p-7",
                )}
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-primary text-primary-foreground text-2xs font-medium tracking-wide shadow-sm">
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
    <section id="faq" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="eyebrow mb-3">{t.faq.eyebrow}</div>
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
  return (
    <section id="cta" className="py-24 lg:py-32 scroll-mt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={cn(
          "relative overflow-hidden rounded-2xl border border-primary/20 p-10 lg:p-16",
          t.ar ? "bg-gradient-to-bl from-primary/[0.08] via-background to-background"
              : "bg-gradient-to-br from-primary/[0.08] via-background to-background"
        )}>
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <h2 className="text-display-lg text-foreground">
                {f.h1}<br /><span className="text-primary">{f.h2}</span>
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground max-w-xl">{f.sub}</p>
            </div>
            <div className="lg:col-span-5 lg:text-end">
              <div className="flex flex-wrap lg:justify-end gap-3">
                <Button size="xl" data-testid="button-final-cta" asChild>
                  <a href="/signin" className="gap-2">
                    {f.cta}
                    <CtaArrow ar={t.ar} />
                  </a>
                </Button>
                <Button size="xl" variant="outline" asChild>
                  <a href="/demo" data-testid="button-final-cta-demo">{f.ctaDemo}</a>
                </Button>
              </div>
              <div className="mt-5 text-xs text-muted-foreground lg:text-end">
                {f.orWatch} <a href="#showcase" className="text-primary underline-offset-4 hover:underline">{f.orLink}</a>{f.orWatchSuffix}
              </div>
            </div>
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
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex-1 text-center font-mono text-2xs text-muted-foreground tracking-wide">
          {title}
        </div>
        <div className="size-2.5" />
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
            <span className="size-1.5 rounded-full bg-current opacity-40 animate-pulse" />
            <span className="size-1.5 rounded-full bg-current opacity-60 animate-pulse [animation-delay:120ms]" />
            <span className="size-1.5 rounded-full bg-current opacity-80 animate-pulse [animation-delay:240ms]" />
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
    <div className="rounded-lg border border-border bg-card shadow-md px-3 py-2.5 flex items-center gap-2.5 backdrop-blur">
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
      "rounded-xl border border-card-border bg-card p-6 lg:p-7 shadow-xs hover:shadow-sm transition-shadow",
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
