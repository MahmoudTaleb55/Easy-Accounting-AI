import { MarketingLayout, MarketingHero, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export const OPENINGS = [
  {
    slug: "backend-engineer",
    titleAr: "مهندس بنيّة تحتيّة (Backend)", titleEn: "Backend Infrastructure Engineer",
    typeAr: "دوام كامل · عن بُعد", typeEn: "Full-time · Remote",
    locationAr: "في أيّ مكان",        locationEn: "Anywhere",
    deptAr: "هندسة", deptEn: "Engineering",
    descAr: "ابنِ الخدمات الأساسيّة التي تُشغِّل نظامنا المحاسبيّ بكفاءة عالية وأمان على مستوى المؤسّسات.",
    descEn: "Build the core services that power our accounting system with high efficiency and enterprise-grade security.",
  },
  {
    slug: "frontend-engineer",
    titleAr: "مهندس واجهات أماميّة (React / TypeScript)", titleEn: "Frontend Engineer (React / TypeScript)",
    typeAr: "دوام كامل · عن بُعد",   typeEn: "Full-time · Remote",
    locationAr: "في أيّ مكان",        locationEn: "Anywhere",
    deptAr: "هندسة", deptEn: "Engineering",
    descAr: "صمِّم تجارب مستخدم استثنائيّة لمنتج ماليّ تستخدمه شركات في ٣٠ دولة يوميّاً.",
    descEn: "Design exceptional user experiences for a financial product used by companies in 30 countries daily.",
  },
  {
    slug: "accounting-expert",
    titleAr: "خبير محاسبة ومعايير دوليّة", titleEn: "Accounting & IFRS Standards Expert",
    typeAr: "دوام كامل · عن بُعد أو مختلط", typeEn: "Full-time · Remote or hybrid",
    locationAr: "الرياض أو دبي أو عن بُعد", locationEn: "Riyadh, Dubai, or Remote",
    deptAr: "منتج وامتثال", deptEn: "Product & Compliance",
    descAr: "كن الصوت المحاسبيّ الصحيح داخل الفريق. تأكّد من أنّ كلّ ميزة صحيحة وفق IFRS وقوانين الدول.",
    descEn: "Be the correct accounting voice on the team. Ensure every feature is right per IFRS and local laws.",
  },
  {
    slug: "customer-success",
    titleAr: "مدير نجاح العملاء", titleEn: "Customer Success Manager",
    typeAr: "دوام كامل · مختلط",    typeEn: "Full-time · Hybrid",
    locationAr: "دبي أو الرياض",    locationEn: "Dubai or Riyadh",
    deptAr: "نجاح العملاء", deptEn: "Customer Success",
    descAr: "ساعد عملاءنا في تحقيق أقصى استفادة من المنتج وتحويلهم إلى سفراء شغوفين.",
    descEn: "Help our customers get maximum value from the product and turn them into passionate ambassadors.",
  },
]

export default function JobsPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الوظائف" : "Jobs"}
        title={ar ? "ابنِ مستقبل التمويل معنا" : "Build the future of finance with us"}
        subtitle={ar
          ? "فريق متعدّد الجنسيّات، بيئة عمل حاضنة، وأثر حقيقيّ في حياة الشركات. نبحث عن أشخاص يؤمنون بما نبنيه."
          : "A multinational team, an inclusive work environment, and a real impact on businesses. We're looking for people who believe in what we're building."}
      />

      <section className="py-10">
        <div className="space-y-4">
          {OPENINGS.map((job) => (
            <div
              key={job.slug}
              className="rounded-xl border border-card-border bg-card p-6 hover:shadow-md transition-shadow duration-200"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">
                      {ar ? job.titleAr : job.titleEn}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium">
                      {ar ? job.deptAr : job.deptEn}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-muted text-caption text-foreground/70">
                      {ar ? job.typeAr : job.typeEn}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-muted text-caption text-foreground/70">
                      📍 {ar ? job.locationAr : job.locationEn}
                    </span>
                  </div>
                  <p className="text-small text-muted-foreground">
                    {ar ? job.descAr : job.descEn}
                  </p>
                </div>
                <div className="flex flex-col sm:items-end gap-2 shrink-0">
                  <a
                    href={`/jobs/${job.slug}`}
                    className="inline-flex items-center h-9 px-4 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border hover:opacity-90 transition-opacity"
                    data-testid={`link-apply-${job.slug}`}
                  >
                    {ar ? "تقدَّم الآن" : "Apply now"}
                  </a>
                  <a
                    href={`/jobs/${job.slug}`}
                    className="text-caption text-primary hover:underline"
                  >
                    {ar ? "التفاصيل والمتطلّبات" : "Details & requirements"}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <CTASection
        title={ar ? "لم تجد وظيفتك؟" : "Don't see your role?"}
        subtitle={ar
          ? "أرسل سيرتك الذاتيّة على أيّ حال — نحن دائماً نبحث عن المميّزين."
          : "Send your CV anyway — we're always looking for exceptional people."}
        primaryLabel={ar ? "تواصل معنا" : "Get in touch"}
        primaryHref="/contact"
      />
    </MarketingLayout>
  )
}
