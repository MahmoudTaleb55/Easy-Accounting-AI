import { MarketingLayout, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"
import { useLocation } from "wouter"

const POSTS: Record<string, {
  slug: string
  dateAr: string; dateEn: string
  tagAr: string; tagEn: string
  titleAr: string; titleEn: string
  excerptAr: string; excerptEn: string
  readTimeAr: string; readTimeEn: string
  bodyAr: string[]; bodyEn: string[]
}> = {
  "ifrs-for-smes": {
    slug: "ifrs-for-smes",
    dateAr: "١٥ مايو ٢٠٢٦", dateEn: "May 15, 2026",
    tagAr: "معايير IFRS", tagEn: "IFRS Standards",
    titleAr: "دليل المبتدئ إلى معيار IFRS للمنشآت الصغيرة والمتوسطة",
    titleEn: "Beginner's guide to IFRS for SMEs",
    excerptAr: "معيار IFRS للمنشآت الصغيرة والمتوسّطة أبسط بكثير من الكامل. نشرح الفروق الجوهريّة وكيف تبدأ بتطبيقه اليوم.",
    excerptEn: "IFRS for SMEs is far simpler than the full standard. We explain the key differences and how to start applying it today.",
    readTimeAr: "٧ دقائق", readTimeEn: "7 min read",
    bodyAr: [
      "يُعدّ معيار IFRS للمنشآت الصغيرة والمتوسطة (IFRS for SMEs) نسخةً مبسَّطة من معايير IFRS الكاملة، مُصمَّمة لتلائم احتياجات الشركات التي لا تُدرج أسهمها في الأسواق المالية العامة.",
      "الفارق الجوهريّ: بدلاً من ٢٩٠٠ صفحة من المعايير الكاملة، يتضمّن معيار SMEs حوالي ٢٣٠ صفحة فقط، مع استبعاد المعالجات النادرة الاستخدام وتبسيط متطلّبات الإفصاح.",
      "المحاور الرئيسيّة: الاعتراف بالإيرادات، الأصول الثابتة والإهلاك، عقود الإيجار، مخصّصات نهاية الخدمة (IAS 19)، والقوائم المالية الختاميّة.",
      "كيف تبدأ: (١) حدِّد إطار التقرير المالي المناسب لبلدك، (٢) قيِّم السياسات المحاسبية الحالية، (٣) حدِّد فجوات الامتثال، (٤) ابدأ بالتطبيق التدريجيّ مع بيانات مقارنة.",
      "نصيحة عمليّة: استخدم برنامجاً محاسبيّاً مُعتمَداً بمعيار IFRS يُولِّد قيود اليومية وفق المعيار تلقائيّاً — هذا يُلغي ٨٠٪ من عبء الامتثال اليدويّ.",
    ],
    bodyEn: [
      "IFRS for SMEs is a simplified version of full IFRS, designed to meet the financial reporting needs of entities that do not have public accountability and publish general purpose financial statements.",
      "The core difference: instead of 2,900+ pages of full IFRS, the SME standard is roughly 230 pages, eliminating rarely-used options and simplifying disclosure requirements considerably.",
      "Key areas covered: revenue recognition, property, plant & equipment, leases, employee benefits (IAS 19 provisions), and the full suite of financial statements.",
      "How to get started: (1) confirm the applicable reporting framework in your country, (2) assess your current accounting policies, (3) identify compliance gaps, (4) begin phased adoption with comparative data.",
      "Practical tip: use IFRS-compliant accounting software that auto-generates journal entries to the correct standard — this eliminates roughly 80% of manual compliance work.",
    ],
  },
  "ai-accounting": {
    slug: "ai-accounting",
    dateAr: "٣ مايو ٢٠٢٦", dateEn: "May 3, 2026",
    tagAr: "الذكاء الاصطناعيّ", tagEn: "AI",
    titleAr: "الذكاء الاصطناعيّ في المحاسبة: ما الذي يتغيّر فعلاً؟",
    titleEn: "AI in accounting: what's actually changing?",
    excerptAr: "ليس كلّ ما يُقال عن الذكاء الاصطناعيّ في المحاسبة دقيقاً. إليك التغييرات الجوهريّة الحقيقيّة وما يظلّ بحاجة إلى إنسان.",
    excerptEn: "Not everything said about AI in accounting is accurate. Here are the real structural changes and what still needs a human.",
    readTimeAr: "٦ دقائق", readTimeEn: "6 min read",
    bodyAr: [
      "منذ ٢٠٢٣، دخل الذكاء الاصطناعيّ مجال المحاسبة بشكل فعليّ — لكن كثيراً من الادّعاءات المتداولة مبالَغ فيها أو مضلِّلة.",
      "ما يتغيّر فعلاً: (١) تصنيف المعاملات تلقائيّاً بدقّة تتجاوز ٩٥٪، (٢) استخراج بيانات الفواتير من الصور، (٣) اكتشاف الشذوذات والتكرار، (٤) التنبّؤ بالتدفّق النقديّ.",
      "ما لا يزال يحتاج إنساناً: (١) الأحكام المحاسبيّة الجوهريّة كتقديرات القيمة العادلة، (٢) قرارات السياسات المحاسبيّة، (٣) التحقّق من الصفقات غير الاعتياديّة، (٤) تواصل أصحاب المصلحة.",
      "المخاطر الحقيقيّة: الاعتماد الأعمى على النتائج دون مراجعة بشريّة، وإدخال بيانات حسّاسة في نماذج خارجيّة غير مُؤمَّنة.",
      "التوصية: استخدم الذكاء الاصطناعيّ للأتمتة الروتينيّة، لكن احتفظ بمحاسب مؤهَّل لاتّخاذ القرارات الجوهريّة ومراجعة النتائج.",
    ],
    bodyEn: [
      "Since 2023, AI has genuinely entered the accounting space — but many of the claims being made are exaggerated or misleading.",
      "What's actually changing: (1) automatic transaction classification with 95%+ accuracy, (2) invoice data extraction from images, (3) anomaly and duplicate detection, (4) cash flow prediction.",
      "What still needs a human: (1) material accounting judgments like fair value estimates, (2) accounting policy decisions, (3) verification of unusual transactions, (4) stakeholder communication.",
      "Real risks: blind reliance on AI output without human review, and feeding sensitive financial data into unsecured external models.",
      "Recommendation: use AI for routine automation, but retain a qualified accountant for material decisions and output review.",
    ],
  },
  "cash-flow-forecasting": {
    slug: "cash-flow-forecasting",
    dateAr: "٢٠ أبريل ٢٠٢٦", dateEn: "April 20, 2026",
    tagAr: "التخطيط المالي", tagEn: "Financial Planning",
    titleAr: "توقّع التدفّق النقديّ بدقّة: دليل عمليّ للشركات الناشئة",
    titleEn: "Accurate cash flow forecasting: a practical guide for startups",
    excerptAr: "الشركات لا تموت من قلّة الربح — تموت من شحّ النقد. نعلّمك بناء نموذج توقّع نقديّ يعمل فعلاً.",
    excerptEn: "Companies don't die from lack of profit — they die from cash scarcity. We teach you to build a cash forecast model that actually works.",
    readTimeAr: "٨ دقائق", readTimeEn: "8 min read",
    bodyAr: [
      "إحصائيّة صادمة: ٨٢٪ من حالات إفلاس الشركات الصغيرة ناتجة عن سوء إدارة التدفّق النقديّ — لا عن قلّة الربحيّة.",
      "الخطأ الشائع: معظم الشركات تخلط بين الربح والسيولة. يمكنك أن تكون رابحاً على الورق وتواجه أزمة سيولة في نفس الوقت.",
      "المكوّنات الأساسيّة للنموذج: (١) التدفّقات الداخلة المتوقَّعة (إيرادات + مُحصَّلات)، (٢) التدفّقات الخارجة الثابتة (إيجار + رواتب + أقساط)، (٣) التدفّقات الخارجة المتغيّرة، (٤) احتياطيّ الطوارئ.",
      "أفق التوقّع الموصى به: ١٣ أسبوعاً للتشغيل اليوميّ + ١٢ شهراً للتخطيط الاستراتيجيّ.",
      "أداة عمليّة: يمكن لأنظمة المحاسبة الذكيّة اليوم ربط بيانات القيود الفعليّة بنماذج التوقّع وتوليد سيناريوهات تلقائيّاً.",
    ],
    bodyEn: [
      "A sobering statistic: 82% of small business failures are caused by poor cash flow management — not lack of profitability.",
      "The common mistake: most companies confuse profit with liquidity. You can be profitable on paper and face a cash crisis simultaneously.",
      "Core model components: (1) projected inflows (revenue + collections), (2) fixed outflows (rent + salaries + loan payments), (3) variable outflows, (4) emergency reserve.",
      "Recommended forecast horizon: 13 weeks for operational management + 12 months for strategic planning.",
      "Practical tool: modern accounting systems can connect actual ledger data to forecast models and auto-generate scenarios — eliminating most manual spreadsheet work.",
    ],
  },
  "vat-mena": {
    slug: "vat-mena",
    dateAr: "٨ أبريل ٢٠٢٦", dateEn: "April 8, 2026",
    tagAr: "الضرائب", tagEn: "Tax",
    titleAr: "ضريبة القيمة المضافة في منطقة الشرق الأوسط وشمال أفريقيا: مقارنة شاملة ٢٠٢٦",
    titleEn: "VAT in MENA: a comprehensive 2026 comparison",
    excerptAr: "نسب مختلفة، إعفاءات مختلفة، جهات تنظيميّة مختلفة. دليل مقارن لضريبة القيمة المضافة في ٧ دول بمنطقتنا.",
    excerptEn: "Different rates, different exemptions, different regulators. A comparative guide to VAT in 7 countries in our region.",
    readTimeAr: "١٠ دقائق", readTimeEn: "10 min read",
    bodyAr: [
      "طُبِّقت ضريبة القيمة المضافة في منطقة الشرق الأوسط وشمال أفريقيا على مراحل منذ ٢٠١٨، وتتباين معدّلاتها ومتطلّباتها تباينًا جوهريّاً.",
      "السعوديّة (١٥٪): الأعلى في المنطقة. تُطبَّق على معظم السلع والخدمات. فوترة إلكترونيّة إلزاميّة عبر منصّة فاتورة.",
      "الإمارات (٥٪): تطبيق انتقائيّ مع إعفاءات واسعة للقطاع المالي والصحّي والتعليميّ.",
      "مصر (١٤٪): نظام VAT حديث العهد مع متطلّبات إقرار شهريّة.",
      "نصائح للامتثال متعدّد الدول: (١) لا تفترض أنّ المعالجة الضريبيّة متطابقة بين الدول، (٢) استخدم نظاماً يُدير الحسابات الضريبيّة لكلّ دولة منفصلاً، (٣) احتفظ بسجلّات بالعملة المحليّة.",
    ],
    bodyEn: [
      "VAT was introduced across MENA in phases since 2018, and the rates, exemptions, and filing requirements vary significantly by country.",
      "Saudi Arabia (15%): the highest rate in the region, applied to most goods and services. Electronic invoicing mandatory via Fatoora platform.",
      "UAE (5%): selective application with broad exemptions for financial services, healthcare, and education sectors.",
      "Egypt (14%): a newer VAT system with monthly filing requirements and evolving e-invoicing mandates.",
      "Multi-country compliance tips: (1) never assume tax treatment is identical across countries, (2) use software that manages tax accounts per country separately, (3) maintain records in local currency.",
    ],
  },
  "payroll-compliance": {
    slug: "payroll-compliance",
    dateAr: "١ أبريل ٢٠٢٦", dateEn: "April 1, 2026",
    tagAr: "الرواتب", tagEn: "Payroll",
    titleAr: "امتثال الرواتب في منطقة الخليج: ما كلّ شركة يجب أن تعرفه",
    titleEn: "Payroll compliance in the Gulf: what every company must know",
    excerptAr: "التأمينات الاجتماعيّة، نظام حماية الأجور، ومكافأة نهاية الخدمة — الأخطاء الشائعة وكيف تتجنّبها.",
    excerptEn: "Social insurance, WPS, and EOSB — common mistakes and how to avoid them.",
    readTimeAr: "٩ دقائق", readTimeEn: "9 min read",
    bodyAr: [
      "امتثال الرواتب في دول الخليج أكثر تعقيداً ممّا تبدو عليه — وأخطاؤه مُكلِّفة.",
      "التأمينات الاجتماعيّة: تختلف النسب بين الدول، وتُطبَّق على المواطنين فقط في معظمها (السعودية: ١٢٪ صاحب عمل + ١٠٪ موظّف).",
      "نظام حماية الأجور (WPS) في الإمارات: إلزاميّ لجميع الشركات. يُشترط دفع الرواتب إلكترونيّاً في الموعد المحدَّد أو تواجه غرامات فوريّة.",
      "مكافأة نهاية الخدمة (EOSB): تُحسَب وفق معادلات مختلفة في كلّ دولة. الخطأ الشائع: عدم مراعاة الراتب الأساسيّ بدلاً من الراتب الكلّيّ.",
      "التوصية: استخدم نظاماً يحسب مخصَّصات EOSB تلقائيّاً ويُسجِّلها قيداً مزدوجاً وفق IAS 19 — هذا يُلغي أكبر مصدر للأخطاء.",
    ],
    bodyEn: [
      "Payroll compliance in Gulf countries is more complex than it appears — and its mistakes are costly.",
      "Social insurance: rates vary by country and typically apply to nationals only (Saudi Arabia: 12% employer + 10% employee contribution).",
      "Wage Protection System (WPS) in UAE: mandatory for all companies. Salaries must be paid electronically on time or face immediate penalties.",
      "End of Service Benefits (EOSB): calculated using different formulas per country. Common mistake: using total salary instead of basic salary in the calculation.",
      "Recommendation: use a system that auto-calculates EOSB provisions and posts them as double-entry per IAS 19 — this eliminates the largest source of errors.",
    ],
  },
  "multi-entity-accounting": {
    slug: "multi-entity-accounting",
    dateAr: "٢٢ مارس ٢٠٢٦", dateEn: "March 22, 2026",
    tagAr: "المحاسبة المتقدّمة", tagEn: "Advanced Accounting",
    titleAr: "المحاسبة لمجموعة شركات: التوحيد والإزالات الداخليّة",
    titleEn: "Accounting for a group of companies: consolidation and intercompany eliminations",
    excerptAr: "عندما تمتلك أكثر من شركة، المحاسبة تصبح أعقد. نشرح كيف تُعدّ قوائم موحَّدة بدون كوابيس.",
    excerptEn: "When you own more than one company, accounting gets complex. We explain how to prepare consolidated statements without nightmares.",
    readTimeAr: "١١ دقيقة", readTimeEn: "11 min read",
    bodyAr: [
      "عند امتلاك أكثر من شركة، يصبح إعداد القوائم الماليّة الموحَّدة متطلَّباً محاسبيّاً أساسيّاً وفق IFRS 10.",
      "مفهوم التوحيد: دمج القوائم الماليّة لشركات المجموعة في قائمة واحدة تعكس المجموعة ككيان اقتصاديّ واحد.",
      "الإزالات الداخليّة: إلغاء المعاملات البينيّة (مبيعات داخليّة، قروض بين الشركات، توزيعات أرباح) لتجنّب الازدواج.",
      "تحويل العملات: عند وجود شركات تعمل بعملات مختلفة، تُحوَّل القوائم وفق IFRS وفق سعر الإغلاق للأصول والخصوم وسعر المتوسّط للدخل.",
      "الأداة العمليّة: أنظمة المحاسبة متعدّدة الكيانات تُجري التوحيد آليّاً بمعدّلات الصرف الحيّة — ما يُلغي أسابيع من العمل اليدويّ.",
    ],
    bodyEn: [
      "When you own more than one company, preparing consolidated financial statements becomes a core accounting requirement under IFRS 10.",
      "What consolidation means: combining the financial statements of all group entities into a single statement that reflects the group as one economic unit.",
      "Intercompany eliminations: canceling transactions between group entities (intercompany sales, loans, dividends) to avoid double-counting.",
      "Currency translation: when entities operate in different currencies, IFRS requires translating at closing rate for assets/liabilities and average rate for income.",
      "Practical tool: multi-entity accounting systems perform consolidation automatically at live exchange rates — eliminating weeks of manual work.",
    ],
  },
}

export default function BlogPostPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"
  const [location] = useLocation()
  const slug = location.replace(/^\/blog\//, "").split("/")[0]
  const post = POSTS[slug ?? ""]

  if (!post) {
    return (
      <MarketingLayout>
        <div className="py-24 text-center">
          <p className="text-muted-foreground">{ar ? "المقال غير موجود." : "Post not found."}</p>
          <a href="/blog" className="mt-4 inline-block text-primary hover:underline text-small">
            {ar ? "← العودة إلى المدوّنة" : "← Back to Blog"}
          </a>
        </div>
      </MarketingLayout>
    )
  }

  const body = ar ? post.bodyAr : post.bodyEn

  return (
    <MarketingLayout>
      <div className="max-w-3xl mx-auto py-10 lg:py-16 px-4">
        <a
          href="/blog"
          className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground mb-8 transition-colors"
          data-testid="link-back-blog"
        >
          {ar ? "→ المدوّنة" : "← Blog"}
        </a>

        <div className="flex items-center gap-2 mb-4">
          <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium">
            {ar ? post.tagAr : post.tagEn}
          </span>
          <span className="text-caption text-muted-foreground">
            {ar ? post.dateAr : post.dateEn}
          </span>
          <span className="text-caption text-muted-foreground">·</span>
          <span className="text-caption text-muted-foreground">
            {ar ? post.readTimeAr : post.readTimeEn}
          </span>
        </div>

        <h1 className="text-3xl lg:text-4xl font-bold text-foreground leading-tight mb-6">
          {ar ? post.titleAr : post.titleEn}
        </h1>

        <p className="text-body text-muted-foreground leading-relaxed mb-10 pb-10 border-b border-border">
          {ar ? post.excerptAr : post.excerptEn}
        </p>

        <div className="space-y-5">
          {body.map((paragraph, i) => (
            <p key={i} className="text-body text-foreground/85 leading-[1.85] font-light">
              {paragraph}
            </p>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <p className="text-small text-muted-foreground mb-4">
            {ar
              ? "هل وجدت هذا المقال مفيداً؟ جرِّب المنتج بنفسك."
              : "Found this article useful? Try the product yourself."}
          </p>
          <a
            href="/app"
            className="inline-flex items-center h-10 px-6 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border hover:opacity-90 transition-opacity"
            data-testid="link-cta-post"
          >
            {ar ? "ابدأ مجّاناً" : "Start free"}
          </a>
        </div>
      </div>

      <CTASection
        title={ar ? "جرِّب المنتج بنفسك" : "Try the product yourself"}
        subtitle={ar ? "لا تكتفِ بالقراءة — شاهد كيف يعمل النظام على بياناتك." : "Don't just read about it — see how the system works on your data."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
      />
    </MarketingLayout>
  )
}
