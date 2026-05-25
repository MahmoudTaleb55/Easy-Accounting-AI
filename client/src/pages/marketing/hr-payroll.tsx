import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function HrPayrollPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الرواتب والموارد البشرية" : "Payroll & HR"}
        title={ar ? "رواتب آليّة. امتثال IAS 19. في كلّ دولة." : "Automated payroll. IAS 19. Every country."}
        subtitle={ar
          ? "أدر موظّفيك، احسب رواتبهم، وسجّل القيود المحاسبيّة تلقائيّاً — وفق معيار IAS 19 وقواعد كلّ دولة."
          : "Manage employees, compute payroll, and post accounting entries automatically — per IAS 19 and each country's rules."}
      />

      <ComplianceBadges items={["IAS 19", "IFRS", "Social Insurance", "EOSB", "Multi-country"]} />

      <FeaturesGrid features={ar ? [
        { icon: "👥", title: "سجلّ الموظّفين", description: "أضف الموظّفين، حدّد رواتبهم ومزاياهم وبيانات الضريبة — مرّة واحدة، وتُحسَب كلّ شهر آليّاً." },
        { icon: "💰", title: "حساب الرواتب الشهريّة", description: "الراتب الأساسيّ، بدلات، خصومات، التأمينات الاجتماعيّة (الموظّف والشركة) — كلّها محسوبة وفق قواعد كلّ دولة." },
        { icon: "📋", title: "مخصّص نهاية الخدمة", description: "حساب تلقائيّ لمخصّص نهاية الخدمة وفق IAS 19 وقوانين كلّ دولة. القيد يُسجَّل شهريّاً بدون تدخّل." },
        { icon: "📅", title: "إدارة الإجازات", description: "تتبّع الإجازة السنويّة، المرضيّة، والأمومة — مع أيّام العمل الصحيحة لكلّ دولة." },
        { icon: "📊", title: "قيد راتب شهريّ آليّ", description: "في نهاية كلّ شهر، يُسجَّل قيد الراتب الكامل وفق IFRS مباشرةً في الأستاذ العامّ." },
        { icon: "📄", title: "قسائم رواتب احترافيّة", description: "أصدر قسائم رواتب تفصيليّة لكلّ موظّف، مع خيار الإرسال المباشر." },
      ] : [
        { icon: "👥", title: "Employee register", description: "Add employees, define salaries, benefits, and tax data — once, computed every month automatically." },
        { icon: "💰", title: "Monthly payroll", description: "Base salary, allowances, deductions, social insurance (employee and employer) — all computed per each country's rules." },
        { icon: "📋", title: "End-of-service accrual", description: "Automatic EOSB accrual per IAS 19 and local law. Entry posted monthly without intervention." },
        { icon: "📅", title: "Leave management", description: "Track annual, sick, and maternity leave — with correct working days per country." },
        { icon: "📊", title: "Auto monthly payroll entry", description: "At month-end, the full payroll journal entry is posted to the GL per IFRS." },
        { icon: "📄", title: "Professional payslips", description: "Issue detailed payslips for every employee, with direct-send option." },
      ]} />

      <CTASection
        title={ar ? "رواتب دقيقة. امتثال تلقائيّ." : "Accurate payroll. Automatic compliance."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على المنصة" : "See the platform"}
        secondaryHref="/platform"
      />
    </MarketingLayout>
  )
}
