import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

interface CountryConfig {
  code: string
  flagEm: string
  nameAr: string
  nameEn: string
  subtitleAr: string
  subtitleEn: string
  badges: string[]
  featuresAr: Array<{ icon: string; title: string; description: string }>
  featuresEn: Array<{ icon: string; title: string; description: string }>
}

const COUNTRIES: Record<string, CountryConfig> = {
  sa: {
    code: "sa", flagEm: "🇸🇦", nameAr: "المملكة العربية السعودية", nameEn: "Saudi Arabia",
    subtitleAr: "ضريبة القيمة المضافة، الزكاة، التأمينات الاجتماعيّة، ومكافأة نهاية الخدمة — كلّها مُهيَّأة مسبقاً وفق أنظمة المملكة.",
    subtitleEn: "VAT, Zakat, GOSI, and end-of-service benefits — all pre-configured per Saudi regulations.",
    badges: ["VAT 15%", "Zakat", "GOSI", "IFRS", "GAZT", "Wage Protection System"],
    featuresAr: [
      { icon: "🧾", title: "ضريبة القيمة المضافة ١٥٪", description: "احتساب وتسجيل وتقديم ضريبة القيمة المضافة وفق اشتراطات الهيئة التنظيميّة للمملكة." },
      { icon: "🌙", title: "الزكاة", description: "حساب الزكاة السنويّة وفق أسس وعاء الزكاة المعتمدة. توثيق ومراجعة كاملة." },
      { icon: "🏥", title: "التأمينات الاجتماعيّة (GOSI)", description: "حصّتا الموظّف والشركة محسوبتان آليّاً مع كلّ دفعة رواتب، مع التحقّق من نسب GOSI الصحيحة." },
      { icon: "📋", title: "مكافأة نهاية الخدمة", description: "حساب شهريّ تلقائيّ وفق نظام العمل السعوديّ، مع مخصَّص يُسجَّل محاسبيّاً وفق IAS 19." },
      { icon: "💳", title: "حماية الأجور (WPS)", description: "توليد ملفّات WPS المطلوبة لمسيرات الرواتب. امتثال تلقائيّ." },
      { icon: "📊", title: "تقارير إدارة الثروات", description: "تقارير مالية موافقة للمعايير المحاسبيّة السعوديّة (SOCPA) ومعايير IFRS في آنٍ واحد." },
    ],
    featuresEn: [
      { icon: "🧾", title: "VAT 15%", description: "Compute, record, and file VAT per Saudi regulatory requirements." },
      { icon: "🌙", title: "Zakat", description: "Annual Zakat computation per approved base. Full documentation and review." },
      { icon: "🏥", title: "GOSI contributions", description: "Employee and employer shares computed automatically with each payroll run, using correct GOSI rates." },
      { icon: "📋", title: "End-of-service benefits", description: "Monthly auto-computation per Saudi Labor Law, with IAS 19-compliant accrual." },
      { icon: "💳", title: "Wage Protection System (WPS)", description: "Generate required WPS files for payroll runs. Automatic compliance." },
      { icon: "📊", title: "SOCPA & IFRS reporting", description: "Financial reports compliant with both Saudi SOCPA standards and IFRS simultaneously." },
    ],
  },
  ae: {
    code: "ae", flagEm: "🇦🇪", nameAr: "الإمارات العربية المتحدة", nameEn: "United Arab Emirates",
    subtitleAr: "ضريبة القيمة المضافة الاتحاديّة، إقرارات هيئة الضرائب (FTA)، والامتثال للأنظمة الإماراتيّة — مُهيَّأ مسبقاً.",
    subtitleEn: "Federal VAT, FTA returns, and UAE regulatory compliance — pre-configured and ready.",
    badges: ["VAT 5%", "FTA", "IFRS", "DIFC", "Free Zones", "Corporate Tax 9%"],
    featuresAr: [
      { icon: "🧾", title: "ضريبة القيمة المضافة ٥٪", description: "احتساب وتقديم الإقرارات لهيئة الضرائب الاتحاديّة (FTA) بشكل آليّ وسليم." },
      { icon: "🏢", title: "ضريبة الشركات ٩٪", description: "تطبيق ضريبة الشركات الاتحاديّة مع الاستثناءات والمعاملة الخاصّة للمناطق الحرّة." },
      { icon: "🌴", title: "المناطق الحرّة", description: "إعداد مخصَّص لشركات المناطق الحرّة (JAFZA، DMCC، ADGM) مع متطلّباتها الخاصّة." },
      { icon: "💼", title: "DIFC / ADGM", description: "امتثال كامل لمتطلّبات مراكز DIFC وADGM المالية وفق معايير IFRS الدوليّة." },
      { icon: "📋", title: "مكافأة نهاية الخدمة", description: "حساب وفق قانون العمل الإماراتيّ مع مخصَّص IAS 19 شهريّ تلقائيّ." },
      { icon: "📊", title: "تقارير مُتوافقة مع FTA", description: "إقرارات ضريبيّة جاهزة للتقديم لهيئة الضرائب، بصيغها القياسيّة المعتمدة." },
    ],
    featuresEn: [
      { icon: "🧾", title: "VAT 5%", description: "Compute and submit FTA returns automatically and correctly." },
      { icon: "🏢", title: "Corporate Tax 9%", description: "Apply federal corporate tax with free zone exemptions and special treatments." },
      { icon: "🌴", title: "Free Zones", description: "Custom setup for JAFZA, DMCC, ADGM companies with their specific requirements." },
      { icon: "💼", title: "DIFC / ADGM", description: "Full compliance for DIFC and ADGM financial center requirements per international IFRS standards." },
      { icon: "📋", title: "End-of-service benefits", description: "Computed per UAE Labour Law with automatic monthly IAS 19 accrual." },
      { icon: "📊", title: "FTA-compliant reports", description: "Tax returns ready for FTA submission in approved standard formats." },
    ],
  },
  eg: {
    code: "eg", flagEm: "🇪🇬", nameAr: "مصر", nameEn: "Egypt",
    subtitleAr: "ضريبة القيمة المضافة والدخل، والامتثال لهيئة الضرائب المصريّة (ETA) — مُهيَّأ مسبقاً.",
    subtitleEn: "VAT, income tax, and ETA compliance — pre-configured and ready.",
    badges: ["VAT 14%", "ETA", "IFRS", "Income Tax", "Social Insurance"],
    featuresAr: [
      { icon: "🧾", title: "ضريبة القيمة المضافة ١٤٪", description: "احتساب وتقديم إقرارات الضريبة على القيمة المضافة لهيئة الضرائب المصريّة." },
      { icon: "💼", title: "ضريبة الدخل على الأرباح", description: "حساب ضريبة الدخل التجاريّ والصناعيّ وفق الشرائح المصريّة المعتمدة." },
      { icon: "👷", title: "التأمينات الاجتماعيّة", description: "حساب اشتراكات التأمينات الاجتماعيّة للموظّف والشركة وفق قانون التأمين الاجتماعيّ المصريّ." },
      { icon: "📋", title: "استحقاقات نهاية الخدمة", description: "حساب مكافأة نهاية الخدمة وفق قانون العمل المصريّ مع مخصَّص IAS 19." },
      { icon: "🏦", title: "الفاتورة الإلكترونيّة ETA", description: "توافق مع منظومة الفوترة الإلكترونيّة لهيئة الضرائب المصريّة." },
      { icon: "📊", title: "تقارير ETA", description: "إقرارات ضريبيّة جاهزة للتقديم لهيئة الضرائب المصريّة." },
    ],
    featuresEn: [
      { icon: "🧾", title: "VAT 14%", description: "Compute and file VAT returns with the Egyptian Tax Authority (ETA)." },
      { icon: "💼", title: "Corporate income tax", description: "Compute commercial and industrial income tax per Egyptian tax brackets." },
      { icon: "👷", title: "Social insurance", description: "Employee and employer social insurance contributions per Egyptian Social Insurance Law." },
      { icon: "📋", title: "End-of-service", description: "End-of-service computation per Egyptian Labour Law with IAS 19 accrual." },
      { icon: "🏦", title: "ETA e-invoicing", description: "Compliant with ETA's e-invoicing system requirements." },
      { icon: "📊", title: "ETA reports", description: "Tax returns ready for ETA submission." },
    ],
  },
  kw: {
    code: "kw", flagEm: "🇰🇼", nameAr: "الكويت", nameEn: "Kuwait",
    subtitleAr: "الامتثال لهيئة الضرائب الكويتيّة، ضريبة الشركات الأجنبيّة، وقوانين العمل المحلّيّة — جاهز مسبقاً.",
    subtitleEn: "Kuwait tax authority compliance, foreign corporate tax, and local labour law — pre-configured.",
    badges: ["Corporate Tax", "IFRS", "CBK", "Social Insurance", "Labour Law"],
    featuresAr: [
      { icon: "🏢", title: "ضريبة الشركات الأجنبيّة", description: "تطبيق ضريبة الشركات على الشركات الأجنبيّة والشركات المشتركة وفق قانون الضرائب الكويتيّ." },
      { icon: "🏥", title: "التأمينات الاجتماعيّة", description: "اشتراكات المؤسّسة العامّة للتأمينات الاجتماعيّة — محسوبة آليّاً مع كلّ راتب." },
      { icon: "📋", title: "استحقاقات نهاية الخدمة", description: "حساب مكافأة نهاية الخدمة وفق قانون العمل الكويتيّ مع مخصَّص IAS 19 شهريّ." },
      { icon: "🌙", title: "ساعات العمل والجمعة", description: "احتساب أيّام العمل الصحيحة وعطل نهاية الأسبوع وفق العرف الكويتيّ." },
      { icon: "💱", title: "الدينار الكويتيّ", description: "دعم كامل للعملة والتقريب والتحويلات الصرفيّة." },
      { icon: "📊", title: "تقارير وفق IFRS", description: "قوائم ماليّة وفق IFRS متوافقة مع متطلّبات بنك الكويت المركزيّ وجهات التنظيم." },
    ],
    featuresEn: [
      { icon: "🏢", title: "Foreign corporate tax", description: "Apply corporate tax on foreign and joint-venture companies per Kuwait tax law." },
      { icon: "🏥", title: "Social insurance (PIFSS)", description: "PIFSS contributions computed automatically with each payroll run." },
      { icon: "📋", title: "End-of-service", description: "End-of-service computation per Kuwait Labour Law with monthly IAS 19 accrual." },
      { icon: "🌙", title: "Work hours & weekends", description: "Correct working-day computation with Kuwait weekend convention." },
      { icon: "💱", title: "Kuwaiti Dinar", description: "Full currency support with correct rounding and exchange handling." },
      { icon: "📊", title: "IFRS reports", description: "Financial statements per IFRS compliant with CBK and regulatory requirements." },
    ],
  },
  qa: {
    code: "qa", flagEm: "🇶🇦", nameAr: "قطر", nameEn: "Qatar",
    subtitleAr: "قوانين العمل القطريّة، حماية الأجور، وضريبة الشركات — مُهيَّأ مسبقاً وجاهز.",
    subtitleEn: "Qatar labour law, wage protection, and corporate tax — pre-configured and ready.",
    badges: ["Corporate Tax 10%", "IFRS", "QFC", "WPS", "Labour Law"],
    featuresAr: [
      { icon: "🏢", title: "ضريبة الشركات ١٠٪", description: "تطبيق ضريبة الدخل على الشركات وفق قانون ضريبة الدخل القطريّ." },
      { icon: "🏟️", title: "QFC — مركز قطر للمال", description: "دعم خاصّ لشركات مركز قطر للمال بمتطلّباتها الضريبيّة والتنظيميّة الخاصّة." },
      { icon: "💳", title: "حماية الأجور (WPS)", description: "توليد ملفّات WPS القطريّة للمسيرات. امتثال تلقائيّ." },
      { icon: "📋", title: "استحقاقات نهاية الخدمة", description: "حساب وفق قانون العمل القطريّ مع مخصَّص IAS 19 شهريّ." },
      { icon: "🌙", title: "أيّام العمل القطريّة", description: "احتساب صحيح لأيّام العمل وعطل نهاية الأسبوع والأعياد الرسميّة في قطر." },
      { icon: "📊", title: "تقارير وفق IFRS", description: "قوائم ماليّة متوافقة مع متطلّبات مصرف قطر المركزيّ." },
    ],
    featuresEn: [
      { icon: "🏢", title: "Corporate Tax 10%", description: "Apply income tax on companies per Qatar income tax law." },
      { icon: "🏟️", title: "QFC — Qatar Financial Centre", description: "Special support for QFC companies with their specific tax and regulatory requirements." },
      { icon: "💳", title: "Wage Protection System (WPS)", description: "Generate Qatar WPS files for payroll. Automatic compliance." },
      { icon: "📋", title: "End-of-service", description: "Computed per Qatar Labour Law with monthly IAS 19 accrual." },
      { icon: "🌙", title: "Qatar working days", description: "Correct working-day computation with Qatar weekend and official holiday convention." },
      { icon: "📊", title: "IFRS reports", description: "Financial statements compliant with Qatar Central Bank requirements." },
    ],
  },
  jo: {
    code: "jo", flagEm: "🇯🇴", nameAr: "الأردن", nameEn: "Jordan",
    subtitleAr: "ضريبة المبيعات والدخل، هيئة ضريبة الدخل والمبيعات الأردنيّة (ISTD)، وقوانين العمل — جاهز مسبقاً.",
    subtitleEn: "Sales tax, income tax, ISTD compliance, and Jordan labour law — pre-configured and ready.",
    badges: ["Sales Tax 16%", "Income Tax", "ISTD", "IFRS", "SSC", "Labour Law"],
    featuresAr: [
      { icon: "🧾", title: "ضريبة المبيعات ١٦٪", description: "احتساب وتسجيل وتقديم ضريبة المبيعات لهيئة ضريبة الدخل والمبيعات (ISTD)." },
      { icon: "💼", title: "ضريبة الدخل", description: "حساب ضريبة الدخل على الشركات والأفراد وفق الشرائح الأردنيّة." },
      { icon: "🏥", title: "الضمان الاجتماعيّ (SSC)", description: "اشتراكات مؤسّسة الضمان الاجتماعيّ الأردنيّة — محسوبة آليّاً." },
      { icon: "📋", title: "استحقاقات نهاية الخدمة", description: "حساب مكافأة نهاية الخدمة وفق قانون العمل الأردنيّ مع مخصَّص IAS 19." },
      { icon: "💱", title: "الدينار الأردنيّ", description: "دعم كامل للعملة مع تحويلات صرفيّة دقيقة." },
      { icon: "📊", title: "تقارير ISTD", description: "إقرارات ضريبيّة جاهزة للتقديم لهيئة ضريبة الدخل والمبيعات." },
    ],
    featuresEn: [
      { icon: "🧾", title: "Sales Tax 16%", description: "Compute, record, and file sales tax with ISTD." },
      { icon: "💼", title: "Income tax", description: "Compute corporate and individual income tax per Jordan tax brackets." },
      { icon: "🏥", title: "SSC contributions", description: "Jordan Social Security Corporation contributions computed automatically." },
      { icon: "📋", title: "End-of-service", description: "Computed per Jordan Labour Law with IAS 19 accrual." },
      { icon: "💱", title: "Jordanian Dinar", description: "Full currency support with accurate exchange handling." },
      { icon: "📊", title: "ISTD reports", description: "Tax returns ready for ISTD submission." },
    ],
  },
  international: {
    code: "international", flagEm: "🌍", nameAr: "International", nameEn: "International",
    subtitleAr: "نظام واحد يعمل في أكثر من ٣٠ دولة. IFRS في القلب، وقوانين الدولة على الجانب.",
    subtitleEn: "One system working in 30+ countries. IFRS at the core, local law at the edge.",
    badges: ["IFRS", "IASB", "SEC", "FCA", "PCAOB", "PEPPOL", "GDPR", "30+ countries"],
    featuresAr: [
      { icon: "🌍", title: "تصميم عالميّ", description: "النظام مبنيّ للعمل في أيّ دولة من البداية — ليس تعريباً لنظام غربيّ، بل بناء جديد للعالم كلّه." },
      { icon: "📋", title: "IFRS في القلب", description: "المعايير الدوليّة لإعداد التقارير الماليّة هي الأساس الوحيد. ليس اختياراً، هو المعيار الافتراضيّ." },
      { icon: "🔌", title: "شبكة التكامل العالميّة", description: "PEPPOL، SWIFT، SEPA، Stripe — تكاملات عالميّة جاهزة دون إعداد مخصَّص." },
      { icon: "🗃️", title: "متعدّد العملات", description: "سجّل معاملاتك بأيّ عملة. توحيد تلقائيّ بعملتك الرئيسيّة وفق IAS 21." },
      { icon: "🔒", title: "GDPR وحماية البيانات", description: "امتثال كامل للائحة الأوروبيّة لحماية البيانات ولوائح حماية البيانات في المنطقة." },
      { icon: "📊", title: "جهات تنظيميّة مدعومة", description: "IASB · SEC · FCA · PCAOB · FTA · ETA · CBB · ISTD وأكثر من ٣٠ جهة حول العالم." },
    ],
    featuresEn: [
      { icon: "🌍", title: "Global by design", description: "Built to work in any country from day one — not a localized Western system, but a new build for the whole world." },
      { icon: "📋", title: "IFRS at the core", description: "International Financial Reporting Standards are the only base. Not an option — the default." },
      { icon: "🔌", title: "Global integration network", description: "PEPPOL, SWIFT, SEPA, Stripe — global integrations ready without custom setup." },
      { icon: "🗃️", title: "Multi-currency", description: "Record transactions in any currency. Automatic consolidation in your functional currency per IAS 21." },
      { icon: "🔒", title: "GDPR & data protection", description: "Full compliance with the European GDPR and regional data protection regulations." },
      { icon: "📊", title: "Supported regulators", description: "IASB · SEC · FCA · PCAOB · FTA · ETA · CBB · ISTD and 30+ regulators worldwide." },
    ],
  },
}

export function CountryPage({ countryCode }: { countryCode: string }) {
  const { locale } = useLocale()
  const ar = locale === "ar"
  const cfg = COUNTRIES[countryCode] ?? COUNTRIES["international"]

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={cfg.flagEm + " " + (ar ? cfg.nameAr : cfg.nameEn)}
        title={ar ? `محاسب ذكي في ${cfg.nameAr}` : `Smart Accountant for ${cfg.nameEn}`}
        subtitle={ar ? cfg.subtitleAr : cfg.subtitleEn}
      />

      <ComplianceBadges items={cfg.badges} />

      <FeaturesGrid features={ar ? cfg.featuresAr : cfg.featuresEn} />

      <CTASection
        title={ar ? `جاهز للبدء في ${cfg.nameAr}؟` : `Ready to start in ${cfg.nameEn}?`}
        subtitle={ar ? "ابدأ مجّاناً لمدة ١٤ يوماً. بدون بطاقة ائتمان." : "Start free for 14 days. No credit card required."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على كل الدول" : "See all countries"}
        secondaryHref="/countries/international"
      />
    </MarketingLayout>
  )
}
