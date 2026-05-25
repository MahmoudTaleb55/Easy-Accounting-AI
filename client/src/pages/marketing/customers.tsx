import { MarketingLayout, MarketingHero, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

const TESTIMONIALS = [
  {
    nameAr: "سارة الخالد", nameEn: "Sarah Al-Khaled",
    roleAr: "المديرة الماليّة · شركة خُضر للتقنية", roleEn: "CFO · Khodr Technology",
    quoteAr: "في ثلاثة أيّام من الإطلاق، أغلقنا الربع الأوّل قبل الموعد بأسبوع. النظام يُفكّر معك، لا يكتفي بالتسجيل.",
    quoteEn: "Three days after launch, we closed Q1 a week early. The system thinks with you, not just records for you.",
    country: "🇸🇦",
  },
  {
    nameAr: "أحمد مظفّر", nameEn: "Ahmad Muzaffar",
    roleAr: "المؤسّس · مجموعة نجم للاستثمار", roleEn: "Founder · Najm Investment Group",
    quoteAr: "ثلاث شركات في ثلاث دول، ورؤية موحَّدة على شاشة واحدة. ما كنت أعتقد أنّ ذلك ممكناً بهذه البساطة.",
    quoteEn: "Three companies in three countries, one unified view on one screen. I didn't think that was possible this simply.",
    country: "🇦🇪",
  },
  {
    nameAr: "ليلى حسّان", nameEn: "Layla Hassan",
    roleAr: "مديرة الحسابات · مطاعم الجوهرة", roleEn: "Head of Accounts · Al-Jawhara Restaurants",
    quoteAr: "كنّا ندفع لمحاسب خارجيّ شهريّاً وكان الوضع أقلّ وضوحاً. الآن نملك النظام والتقارير ووقتنا.",
    quoteEn: "We used to pay an outside accountant monthly and had less clarity. Now we own the system, the reports, and our time.",
    country: "🇪🇬",
  },
]

export default function CustomersPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "العملاء" : "Customers"}
        title={ar ? "+١٢٬٠٠٠ شركة تثق بنا يوميّاً" : "12,000+ companies trust us daily"}
        subtitle={ar
          ? "من ناشئات القطاع التقنيّ إلى مجموعات متعدّدة الكيانات — محاسب ذكي يعمل حيث تعمل أنت."
          : "From tech startups to multi-entity groups — Smart Accountant works where you work."}
      />

      <section className="py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {[
            { v: "12K+",   l: ar ? "شركة نشطة"        : "active companies" },
            { v: "30+",    l: ar ? "دولة"               : "countries" },
            { v: "$2.1B+", l: ar ? "إجمالي الفواتير"   : "total invoiced" },
            { v: "99.97%", l: ar ? "وقت التشغيل"       : "uptime" },
          ].map((stat) => (
            <div key={stat.l} className="rounded-xl border border-card-border bg-card p-6 text-center">
              <div className="text-3xl font-bold text-foreground mb-1">{stat.v}</div>
              <div className="text-small text-muted-foreground">{stat.l}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div key={t.nameEn} className="rounded-xl border border-card-border bg-card p-6">
              <div className="text-2xl mb-4">"</div>
              <p className="text-foreground/80 leading-relaxed mb-6">
                {ar ? t.quoteAr : t.quoteEn}
              </p>
              <div className="flex items-center gap-3">
                <div className="text-2xl">{t.country}</div>
                <div>
                  <div className="font-semibold text-foreground">{ar ? t.nameAr : t.nameEn}</div>
                  <div className="text-small text-muted-foreground">{ar ? t.roleAr : t.roleEn}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <CTASection
        title={ar ? "انضم إليهم اليوم" : "Join them today"}
        subtitle={ar ? "ابدأ مجّاناً لمدة ١٤ يوماً. بدون بطاقة ائتمان." : "Start free for 14 days. No credit card required."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "تواصل مع فريق المبيعات" : "Talk to sales"}
        secondaryHref="/contact"
      />
    </MarketingLayout>
  )
}
