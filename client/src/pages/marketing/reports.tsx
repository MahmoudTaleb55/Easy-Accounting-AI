import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function ReportsPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "التقارير المالية" : "Financial Reports"}
        title={ar ? "قوائم ماليّة جاهزة للتدقيق — فوراً" : "Audit-ready financial statements — instantly"}
        subtitle={ar
          ? "الميزانيّة العموميّة، قائمة الدخل، وقائمة التدفّقات النقديّة — وفق IFRS، بنقرة واحدة، في أيّ وقت."
          : "Balance sheet, income statement, and cash flow statement — per IFRS, one click, anytime."}
      />

      <ComplianceBadges items={["IFRS", "IAS 1", "IAS 7", "IFRS 15", "IFRS 16", "IAS 8"]} />

      <FeaturesGrid features={ar ? [
        { icon: "⚖️", title: "الميزانيّة العموميّة", description: "الأصول، الالتزامات، وحقوق الملكيّة — مُرتَّبة وفق IAS 1 بتصنيف جارٍ وغير جارٍ." },
        { icon: "📊", title: "قائمة الدخل", description: "الإيرادات، تكلفة المبيعات، المصروفات التشغيليّة، والصافي — محسوبة من قيودك فوريّاً." },
        { icon: "💸", title: "قائمة التدفّقات النقديّة", description: "التدفّقات التشغيليّة والاستثماريّة والتمويليّة — بالطريقة المباشرة أو غير المباشرة." },
        { icon: "🔄", title: "تقرير التغيّر في حقوق الملكيّة", description: "احتياطيات، أرباح مُحتجزة، وتغيّرات رأس المال — وفق متطلّبات IFRS." },
        { icon: "📝", title: "إيضاحات القوائم الماليّة", description: "أضف إيضاحاتك وسياساتك المحاسبيّة — كلّها منظَّمة جاهزة للمراجع الخارجيّ." },
        { icon: "📤", title: "تصدير وطباعة", description: "صدِّر إلى PDF أو Excel. متعدّد اللغات، متعدّد العملات، مخصَّص بعلامتك التجاريّة." },
      ] : [
        { icon: "⚖️", title: "Balance sheet", description: "Assets, liabilities, and equity — arranged per IAS 1 with current and non-current classification." },
        { icon: "📊", title: "Income statement", description: "Revenue, cost of sales, operating expenses, and net income — computed from your entries instantly." },
        { icon: "💸", title: "Cash flow statement", description: "Operating, investing, and financing cash flows — direct or indirect method." },
        { icon: "🔄", title: "Statement of changes in equity", description: "Reserves, retained earnings, and capital changes — per IFRS requirements." },
        { icon: "📝", title: "Notes to financial statements", description: "Add your notes and accounting policies — all organized and ready for the external auditor." },
        { icon: "📤", title: "Export & print", description: "Export to PDF or Excel. Multi-language, multi-currency, branded with your logo." },
      ]} />

      <CTASection
        title={ar ? "تقاريرك جاهزة في ثوانٍ" : "Your reports ready in seconds"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على المنصة" : "See the platform"}
        secondaryHref="/platform"
      />
    </MarketingLayout>
  )
}
