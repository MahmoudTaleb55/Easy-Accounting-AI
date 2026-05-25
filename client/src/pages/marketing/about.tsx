import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function AboutPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "من نحن" : "About"}
        title={ar ? "مبنيّون للشركة الحديثة في كلّ مكان" : "Built for the modern business, everywhere"}
        subtitle={ar
          ? "فريق متعدّد الثقافات والجنسيّات، يؤمن بأنّ الشركات في منطقة الشرق الأوسط وشمال أفريقيا وخارجها تستحقّ نظاماً ماليّاً بمستوى ما يُستخدَم في فرانكفورت ونيويورك."
          : "A multicultural team that believes businesses in MENA and beyond deserve a financial system at the level of what's used in Frankfurt and New York."}
      />

      <div className="py-12">
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-10 text-center mb-12">
          <div className="text-6xl font-black text-primary mb-2">2021</div>
          <div className="text-muted-foreground">{ar ? "عام التأسيس" : "Founded"}</div>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {[
              { v: "30+", l: ar ? "دولة مدعومة" : "countries supported" },
              { v: "12K+", l: ar ? "شركة تثق بنا" : "companies trust us" },
              { v: "24K+", l: ar ? "قيد يوميّ عبر AI" : "daily AI-posted entries" },
              { v: "99.97%", l: ar ? "وقت تشغيل" : "uptime" },
            ].map((stat) => (
              <div key={stat.l}>
                <div className="text-3xl font-bold text-foreground">{stat.v}</div>
                <div className="text-small text-muted-foreground mt-1">{stat.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <FeaturesGrid features={ar ? [
        { icon: "🎯", title: "مهمّتنا", description: "نجعل الإدارة الماليّة الاحترافيّة في متناول كلّ شركة — بصرف النظر عن حجمها أو موقعها." },
        { icon: "👁️", title: "رؤيتنا", description: "عالَم تعمل فيه الشركات الصغيرة والمتوسّطة بنفس كفاءة المؤسّسات الكبرى ماليّاً." },
        { icon: "🌍", title: "تنوّعنا", description: "فريقنا من أكثر من ١٢ جنسيّة. نبني لعالَم متعدّد اللغات والثقافات لأنّنا نُجسّده بأنفسنا." },
        { icon: "🔬", title: "منهجيّتنا", description: "كلّ ميزة تبدأ بسؤال: هل تُحلّ مشكلة حقيقيّة؟ ثمّ نُصمّمها وفق أدقّ المعايير الدوليّة." },
        { icon: "🤝", title: "شراكاتنا", description: "نعمل مع مدقّقين معتمَدين ومستشارين قانونيّين في كلّ دولة نخدمها — لنكون صحيحين لا فقط قانونيّين." },
        { icon: "🔐", title: "التزامنا بالأمان", description: "SOC 2 Type II، تشفير AES-256، وأثر تدقيق لا يقبل التعديل — أمانك خطّ أحمر لا نتجاوزه." },
      ] : [
        { icon: "🎯", title: "Our mission", description: "Make professional financial management accessible to every company — regardless of size or location." },
        { icon: "👁️", title: "Our vision", description: "A world where SMBs operate with the same financial efficiency as large enterprises." },
        { icon: "🌍", title: "Our diversity", description: "Our team comes from 12+ nationalities. We build for a multilingual world because we embody it ourselves." },
        { icon: "🔬", title: "Our approach", description: "Every feature starts with a question: does it solve a real problem? Then we design it to the strictest international standards." },
        { icon: "🤝", title: "Our partnerships", description: "We work with certified auditors and legal advisors in every country we serve — to be correct, not just legal." },
        { icon: "🔐", title: "Our security commitment", description: "SOC 2 Type II, AES-256 encryption, and an immutable audit trail — your security is a red line we never cross." },
      ]} />

      <CTASection
        title={ar ? "انضم إلى مجتمع المحاسبة الذكيّة" : "Join the smart accounting community"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "تواصل معنا" : "Contact us"}
        secondaryHref="/contact"
      />
    </MarketingLayout>
  )
}
