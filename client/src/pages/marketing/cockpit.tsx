import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function CockpitPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "كوكبت القرار" : "Decision Cockpit"}
        title={ar ? "مركز القيادة الماليّ الحيّ" : "Live financial command center"}
        subtitle={ar
          ? "صحّة الشركة، توقّعات النقد، محاكي «ماذا لو»، والتنبيهات الذكيّة — في شاشة واحدة. اعرف ما يجري الآن وما سيجري غداً."
          : "Business health, cash forecast, what-if simulator, and smart alerts — in one screen. Know what's happening now and what will happen tomorrow."}
      />

      <FeaturesGrid features={ar ? [
        { icon: "💯", title: "نقاط الصحّة الماليّة", description: "مؤشّر مركَّب يقيس السيولة، الربحيّة، والاستدامة — يتجدّد يوميّاً ويُحلَّل بالذكاء الاصطناعيّ." },
        { icon: "📈", title: "توقّع التدفّق النقديّ", description: "توقّع التدفّق النقديّ لـ ٩٠ يوماً أو ٢٤ شهراً — مبنيّ على بياناتك الفعليّة لا على افتراضات عامّة." },
        { icon: "🎛️", title: "محاكي «ماذا لو»", description: "اسأل: «ماذا لو فتحت فرعاً جديداً؟» أو «ماذا لو خفّضت تكلفة المبيعات ١٠٪؟» — يُحسَب الأثر فوراً." },
        { icon: "🔔", title: "تنبيهات ذكيّة", description: "شذوذ في مصروف، خطر ازدواج قيد، تجاوز ميزانيّة — يُنبّهك قبل أن تتضخّم المشكلة." },
        { icon: "📊", title: "لوحة مخصَّصة", description: "أضف مؤشّرات الأداء التي تهمّك أنت. KPIs يختارها فريقك ويضبطها وفق استراتيجيّة الشركة." },
        { icon: "🤖", title: "مساعد القرار", description: "رؤى أسبوعيّة بالذكاء الاصطناعيّ: أين يستحقّ التركيز هذا الأسبوع، وما الرقم الذي ينبغي مراقبته." },
      ] : [
        { icon: "💯", title: "Financial health score", description: "A composite index measuring liquidity, profitability, and sustainability — refreshed daily and analyzed by AI." },
        { icon: "📈", title: "Cash flow forecast", description: "90-day or 24-month cash forecast — built on your actual data, not generic assumptions." },
        { icon: "🎛️", title: "What-if simulator", description: "Ask: \"What if I open a new branch?\" or \"What if I cut COGS 10%?\" — impact computed instantly." },
        { icon: "🔔", title: "Smart alerts", description: "Expense anomaly, likely duplicate, budget overrun — you're alerted before the problem compounds." },
        { icon: "📊", title: "Custom dashboard", description: "Add the KPIs that matter to your team and tune them to your company's strategy." },
        { icon: "🤖", title: "Decision assistant", description: "Weekly AI insights: where to focus this week, and which number to watch." },
      ]} />

      <CTASection
        title={ar ? "قوّة المعلومة في يدك" : "The power of insight in your hands"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "تحليلات تنبؤية" : "Predictive Analytics"}
        secondaryHref="/ai/predictive"
      />
    </MarketingLayout>
  )
}
