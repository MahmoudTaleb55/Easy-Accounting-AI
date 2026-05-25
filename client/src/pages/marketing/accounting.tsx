import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function AccountingPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "المحاسبة" : "Accounting"}
        title={ar ? "محاسبة مزدوجة. معيار IFRS. بدون تدخّل يدويّ." : "Double-entry. IFRS. No manual work."}
        subtitle={ar
          ? "نظام محاسبيّ متكامل يُسجّل كلّ قيد تلقائيّاً، يوازن المعادلة لحظيّاً، ويُنتج قوائم ماليّة جاهزة للتدقيق في أيّ وقت."
          : "A complete accounting system that posts every entry automatically, validates the equation in real time, and produces audit-ready financial statements anytime."}
      />

      <ComplianceBadges items={["IFRS", "IFRS 15", "IFRS 16", "IAS 9", "IAS 36", "SOC 2"]} />

      <FeaturesGrid features={ar ? [
        { icon: "📒", title: "دليل الحسابات", description: "شجرة حسابات قياسيّة وفق IFRS. أضف حسابات مخصّصة، وعدِّل التصنيفات حسب طبيعة نشاطك." },
        { icon: "✏️", title: "قيود يوميّة", description: "أدخل القيود يدويّاً أو دع الذكاء الاصطناعيّ يُنشئها من نصّ أو صورة. كلّ قيد متوازن ومرتبط بمستند." },
        { icon: "📈", title: "أستاذ عامّ حيّ", description: "اطّلع على أرصدة كلّ حساب لحظيّاً. بحث، تصفية، وتصدير بنقرة واحدة." },
        { icon: "🔍", title: "أثر تدقيق كامل", description: "كلّ قيد له ختم زمنيّ، ومستخدم، وسبب — لا يقبل التعديل. موافق لمتطلّبات التدقيق الخارجيّ." },
        { icon: "🏢", title: "تعدّد الكيانات", description: "أدر شركات متعدّدة بمعيار محاسبيّ موحَّد. توحيد القوائم في نقرات." },
        { icon: "📊", title: "قوائم ماليّة فوريّة", description: "الميزانيّة العموميّة، الدخل، والتدفّقات النقديّة — وفق IFRS، فوراً وبدون انتظار." },
      ] : [
        { icon: "📒", title: "Chart of accounts", description: "IFRS-standard account tree. Add custom accounts and adjust classifications to your business." },
        { icon: "✏️", title: "Journal entries", description: "Enter entries manually or let AI create them from text or images. Every entry is balanced and linked to a source." },
        { icon: "📈", title: "Live general ledger", description: "See every account balance in real time. Search, filter, and export in one click." },
        { icon: "🔍", title: "Full audit trail", description: "Every entry is timestamped, attributed, and reasoned — immutable. Compliant with external audit requirements." },
        { icon: "🏢", title: "Multi-entity", description: "Manage multiple companies under a unified accounting standard. Consolidated statements in clicks." },
        { icon: "📊", title: "Instant financial statements", description: "Balance sheet, income, and cash flow — per IFRS, instantly." },
      ]} />

      <CTASection
        title={ar ? "محاسبة احترافيّة بدون محاسب متفرّغ" : "Professional accounting without a full-time accountant"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على المنصة" : "See the platform"}
        secondaryHref="/platform"
      />
    </MarketingLayout>
  )
}
