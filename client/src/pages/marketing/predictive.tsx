import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function PredictivePage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "تحليلات تنبؤية" : "Predictive Analytics"}
        title={ar ? "اعرف غدك الماليّ قبل أن يأتي" : "Know your financial future before it arrives"}
        subtitle={ar
          ? "تحليلات مالية تنبؤيّة مبنيّة على بياناتك الفعليّة. توقّع الإيرادات، المصروفات، والتدفّق النقديّ — لأفق ٢٤ شهراً."
          : "Predictive financial analytics built on your real data. Forecast revenue, expenses, and cash flow — up to 24 months ahead."}
      />

      <FeaturesGrid features={ar ? [
        { icon: "📉", title: "توقّع الإيرادات", description: "نماذج AI تُحلّل أنماط إيراداتك التاريخيّة وتُوقّع الشهر القادم بدقّة أعلى من المتوسّط الصناعيّ." },
        { icon: "🌊", title: "تحليل موسميّة التدفّق النقديّ", description: "اكتشف متى تكون فجوات السيولة المتوقَّعة وخطّط لتمويلها قبل وقوعها." },
        { icon: "🎯", title: "ميزانيّات تنبؤيّة", description: "قارن الميزانيّة الفعليّة بالمتوقَّعة لحظيّاً. التحليل يُظهر أين أنت الآن وأين ستكون نهاية الربع." },
        { icon: "🔬", title: "تحليل السيناريوهات", description: "صمّم سيناريوهات متفائلة ومتشائمة ومتوسّطة. قارن آثارها على الميزانيّة العموميّة." },
        { icon: "📊", title: "نمذجة تكلفة النمو", description: "إذا نمت ٣٠٪ في الإيرادات، كيف ستتصرّف التكاليف؟ النموذج يحسب للك نقطة التعادل تلقائيّاً." },
        { icon: "🤝", title: "تقارير جاهزة للمستثمرين", description: "تقارير مالية مُنسَّقة للمستثمرين وأعضاء مجلس الإدارة. تُصدَر ببضع نقرات." },
      ] : [
        { icon: "📉", title: "Revenue forecasting", description: "AI models analyze your historical revenue patterns and forecast next month with above-industry accuracy." },
        { icon: "🌊", title: "Cash flow seasonality analysis", description: "Discover when expected liquidity gaps will occur and plan funding before they happen." },
        { icon: "🎯", title: "Predictive budgeting", description: "Compare actual vs. forecast budget in real time. Analysis shows where you are now and where you'll be at quarter-end." },
        { icon: "🔬", title: "Scenario analysis", description: "Design optimistic, pessimistic, and base-case scenarios. Compare their impact on the balance sheet." },
        { icon: "📊", title: "Growth cost modeling", description: "If revenue grows 30%, how will costs behave? The model computes your breakeven point automatically." },
        { icon: "🤝", title: "Investor-ready reports", description: "Formatted financial reports for investors and board members. Exported in a few clicks." },
      ]} />

      <CTASection
        title={ar ? "ابدأ التخطيط بالأرقام الصحيحة" : "Start planning with the right numbers"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على كوكبت القرار" : "See Decision Cockpit"}
        secondaryHref="/ai/cockpit"
      />
    </MarketingLayout>
  )
}
