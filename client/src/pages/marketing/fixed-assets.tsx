import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function FixedAssetsPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الأصول الثابتة" : "Fixed Assets"}
        title={ar ? "دورة حياة الأصل الثابت — كاملةً وفق IFRS" : "Full fixed-asset lifecycle — IFRS-grade"}
        subtitle={ar
          ? "من الاقتناء إلى الاستبعاد. جداول إهلاك آليّة، إعادة تقييم، وانخفاض قيمة — وفق معيار IAS 16 وIFRS 16."
          : "From acquisition to disposal. Automatic depreciation schedules, revaluation, and impairment — per IAS 16 and IFRS 16."}
      />

      <ComplianceBadges items={["IAS 16", "IFRS 16", "IAS 36", "IFRS", "Depreciation Schedules"]} />

      <FeaturesGrid features={ar ? [
        { icon: "🏗️", title: "تسجيل الاقتناء", description: "أضف أصولك مع التكلفة، التاريخ، العمر النافع، والقيمة المتبقّية — وابدأ جدول الإهلاك فوراً." },
        { icon: "📉", title: "إهلاك آليّ", description: "القسط الثابت، المتناقص، أو وحدات الإنتاج — الجدول يُحسَب ويُسجَّل محاسبيّاً كلّ شهر بدون تدخّل." },
        { icon: "📈", title: "إعادة التقييم", description: "أعد تقييم الأصول وفق IAS 16. يُعدَّل السجلّ وتُسجَّل الفروق في حقوق الملكيّة أو الربح والخسارة." },
        { icon: "⚠️", title: "اختبار الانخفاض في القيمة", description: "طبّق اختبارات impairment وفق IAS 36. يُحسَب المبلغ القابل للاسترداد ويُقارَن بالقيمة الدفتريّة تلقائيّاً." },
        { icon: "🏢", title: "عقود الإيجار IFRS 16", description: "سجّل عقود الإيجار التشغيليّة والتموينيّة وفق IFRS 16. حقوق الاستخدام وأصول الالتزام بالإيجار محسوبة آليّاً." },
        { icon: "🗑️", title: "الاستبعاد والبيع", description: "سجّل بيع أو استبعاد الأصل. الربح أو الخسارة تُحسَب وتُسجَّل تلقائيّاً في قائمة الدخل." },
      ] : [
        { icon: "🏗️", title: "Acquisition recording", description: "Add assets with cost, date, useful life, and salvage value — and start the depreciation schedule immediately." },
        { icon: "📉", title: "Auto depreciation", description: "Straight-line, declining balance, or units of production — the schedule is computed and posted monthly without intervention." },
        { icon: "📈", title: "Revaluation", description: "Revalue assets per IAS 16. Records are adjusted and differences posted to equity or P&L." },
        { icon: "⚠️", title: "Impairment testing", description: "Apply IAS 36 impairment tests. Recoverable amount is computed and compared to carrying value automatically." },
        { icon: "🏢", title: "IFRS 16 leases", description: "Record operating and finance leases per IFRS 16. Right-of-use assets and lease liabilities computed automatically." },
        { icon: "🗑️", title: "Disposal & sale", description: "Record asset sale or disposal. Gain or loss is computed and posted to P&L automatically." },
      ]} />

      <CTASection
        title={ar ? "أصولك تحت السيطرة الكاملة" : "Your assets under full control"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على المنصة" : "See the platform"}
        secondaryHref="/platform"
      />
    </MarketingLayout>
  )
}
