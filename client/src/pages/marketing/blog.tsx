import { MarketingLayout, MarketingHero, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

const POSTS = [
  {
    slug: "ifrs-for-smes",
    dateAr: "١٥ مايو ٢٠٢٦", dateEn: "May 15, 2026",
    tagAr: "معايير IFRS", tagEn: "IFRS Standards",
    titleAr: "دليل المبتدئ إلى معيار IFRS للمنشآت الصغيرة والمتوسطة",
    titleEn: "Beginner's guide to IFRS for SMEs",
    excerptAr: "معيار IFRS للمنشآت الصغيرة والمتوسّطة أبسط بكثير من الكامل. نشرح الفروق الجوهريّة وكيف تبدأ بتطبيقه اليوم.",
    excerptEn: "IFRS for SMEs is far simpler than the full standard. We explain the key differences and how to start applying it today.",
  },
  {
    slug: "ai-accounting",
    dateAr: "٣ مايو ٢٠٢٦", dateEn: "May 3, 2026",
    tagAr: "الذكاء الاصطناعيّ", tagEn: "AI",
    titleAr: "الذكاء الاصطناعيّ في المحاسبة: ما الذي يتغيّر فعلاً؟",
    titleEn: "AI in accounting: what's actually changing?",
    excerptAr: "ليس كلّ ما يُقال عن الذكاء الاصطناعيّ في المحاسبة دقيقاً. إليك التغييرات الجوهريّة الحقيقيّة وما يظلّ بحاجة إلى إنسان.",
    excerptEn: "Not everything said about AI in accounting is accurate. Here are the real structural changes and what still needs a human.",
  },
  {
    slug: "cash-flow-forecasting",
    dateAr: "٢٠ أبريل ٢٠٢٦", dateEn: "April 20, 2026",
    tagAr: "التخطيط المالي", tagEn: "Financial Planning",
    titleAr: "توقّع التدفّق النقديّ بدقّة: دليل عمليّ للشركات الناشئة",
    titleEn: "Accurate cash flow forecasting: a practical guide for startups",
    excerptAr: "الشركات لا تموت من قلّة الربح — تموت من شحّ النقد. نعلّمك بناء نموذج توقّع نقديّ يعمل فعلاً.",
    excerptEn: "Companies don't die from lack of profit — they die from cash scarcity. We teach you to build a cash forecast model that actually works.",
  },
  {
    slug: "vat-mena",
    dateAr: "٨ أبريل ٢٠٢٦", dateEn: "April 8, 2026",
    tagAr: "الضرائب", tagEn: "Tax",
    titleAr: "ضريبة القيمة المضافة في منطقة الشرق الأوسط وشمال أفريقيا: مقارنة شاملة ٢٠٢٦",
    titleEn: "VAT in MENA: a comprehensive 2026 comparison",
    excerptAr: "نسب مختلفة، إعفاءات مختلفة، جهات تنظيميّة مختلفة. دليل مقارن لضريبة القيمة المضافة في ٧ دول بمنطقتنا.",
    excerptEn: "Different rates, different exemptions, different regulators. A comparative guide to VAT in 7 countries in our region.",
  },
  {
    slug: "payroll-compliance",
    dateAr: "١ أبريل ٢٠٢٦", dateEn: "April 1, 2026",
    tagAr: "الرواتب", tagEn: "Payroll",
    titleAr: "امتثال الرواتب في منطقة الخليج: ما كلّ شركة يجب أن تعرفه",
    titleEn: "Payroll compliance in the Gulf: what every company must know",
    excerptAr: "التأمينات الاجتماعيّة، نظام حماية الأجور، ومكافأة نهاية الخدمة — الأخطاء الشائعة وكيف تتجنّبها.",
    excerptEn: "Social insurance, WPS, and EOSB — common mistakes and how to avoid them.",
  },
  {
    slug: "multi-entity-accounting",
    dateAr: "٢٢ مارس ٢٠٢٦", dateEn: "March 22, 2026",
    tagAr: "المحاسبة المتقدّمة", tagEn: "Advanced Accounting",
    titleAr: "المحاسبة لمجموعة شركات: التوحيد والإزالات الداخليّة",
    titleEn: "Accounting for a group of companies: consolidation and intercompany eliminations",
    excerptAr: "عندما تمتلك أكثر من شركة، المحاسبة تصبح أعقد. نشرح كيف تُعدّ قوائم موحَّدة بدون كوابيس.",
    excerptEn: "When you own more than one company, accounting gets complex. We explain how to prepare consolidated statements without nightmares.",
  },
]

export default function BlogPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "المدوّنة" : "Blog"}
        title={ar ? "رؤى ماليّة لمن يبني جادّاً" : "Financial insights for serious builders"}
        subtitle={ar
          ? "محاسبة، IFRS، ضرائب، والذكاء الاصطناعيّ في التمويل — مكتوبة بلغة الممارس، لا بلغة الأكاديميّ."
          : "Accounting, IFRS, tax, and AI in finance — written in a practitioner's language, not an academic's."}
      />

      <section className="py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {POSTS.map((post) => (
            <article key={post.slug} className="rounded-xl border border-card-border bg-card overflow-hidden hover:shadow-md transition-shadow duration-200">
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium">
                    {ar ? post.tagAr : post.tagEn}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {ar ? post.dateAr : post.dateEn}
                  </span>
                </div>
                <h3 className="font-semibold text-foreground mb-2 leading-snug">
                  {ar ? post.titleAr : post.titleEn}
                </h3>
                <p className="text-small text-muted-foreground leading-relaxed mb-4">
                  {ar ? post.excerptAr : post.excerptEn}
                </p>
                <span className="text-small font-medium text-primary hover:underline cursor-pointer">
                  {ar ? "اقرأ المزيد ←" : "Read more →"}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <CTASection
        title={ar ? "جرّب المنتج بنفسك" : "Try the product yourself"}
        subtitle={ar ? "لا تكتفِ بالقراءة — شاهد كيف يعمل النظام على بياناتك." : "Don't just read about it — see how the system works on your data."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
      />
    </MarketingLayout>
  )
}
