import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function AiAssistantPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "المساعد المحاسبي" : "AI Assistant"}
        title={ar ? "تحدّث بلغتك. يفهم دفاترك." : "Speak naturally. It understands your books."}
        subtitle={ar
          ? "مساعد ذكيّ مدرَّب على معايير IFRS وعلى دفاتر شركتك. يُسجّل القيود من نصّ أو صورة، يُجيب عن أسئلتك الماليّة، ويتوقّع ما يستحقّ فعله."
          : "An AI trained on IFRS and your own books. Posts entries from text or images, answers your financial questions, and anticipates what's next."}
      />

      <FeaturesGrid features={ar ? [
        { icon: "💬", title: "قيود من لغة عاديّة", description: "اكتب «دفعت ٥٠٠ دولار للمورّد نقداً» — يصنّف ويُسجّل القيد الصحيح وفق IFRS فوراً." },
        { icon: "📸", title: "قراءة من الصور والمستندات", description: "ارفع فاتورة أو إيصال — يستخرج البيانات، يُنشئ القيد، ويربطه بالمستند أصلاً." },
        { icon: "🔮", title: "محاكاة لحظيّة", description: "اسأل «ماذا لو ارتفعت الرواتب ١٥٪؟» — يعطيك تأثير القرار على التدفّق النقديّ والربحيّة في ثوانٍ." },
        { icon: "🌍", title: "متعدّد اللغات", description: "العربيّة، الإنجليزيّة، الفرنسيّة، الألمانيّة — تحدّث بأيّ لغة وسيفهمك ويُجيبك بها." },
        { icon: "🔍", title: "شفافيّة تامّة", description: "كلّ اقتراح له سند: رقم حساب IFRS، أو سياسة الشركة. لا اقتراحات عشوائيّة." },
        { icon: "🎙️", title: "تسجيل صوتيّ", description: "سجّل ملاحظاتك المالية بصوتك — يحوّلها إلى قيود ومهامّ مُنظَّمة." },
      ] : [
        { icon: "💬", title: "Natural-language entries", description: "Type \"paid $500 to vendor in cash\" — it classifies and posts the correct IFRS entry instantly." },
        { icon: "📸", title: "Read from images & documents", description: "Upload an invoice or receipt — it extracts data, creates the entry, and links it to the source document." },
        { icon: "🔮", title: "Live simulation", description: "Ask \"what if salaries rise 15%?\" — get the impact on cash flow and profitability in seconds." },
        { icon: "🌍", title: "Multi-language", description: "Arabic, English, French, German — talk in any language and it understands and replies in kind." },
        { icon: "🔍", title: "Full transparency", description: "Every suggestion is sourced: IFRS account number or company policy. No random suggestions." },
        { icon: "🎙️", title: "Voice recording", description: "Record your financial notes by voice — it converts them to organized entries and tasks." },
      ]} />

      <CTASection
        title={ar ? "جرّب المساعد المحاسبيّ اليوم" : "Try the AI assistant today"}
        subtitle={ar ? "أكثر من ٢٤٬٠٠٠ قيد يُسجَّل يوميّاً عبر المساعد." : "More than 24,000 entries posted daily via the assistant."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على كوكبت القرار" : "See Decision Cockpit"}
        secondaryHref="/ai/cockpit"
      />
    </MarketingLayout>
  )
}
