import { MarketingLayout, MarketingHero } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function TermsPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  const sections = ar ? [
    {
      title: "١. قبول الشروط",
      body: "باستخدام منصّة محاسب ذكي أو التسجيل فيها، فإنّك توافق على هذه الشروط وسياسة الخصوصيّة. إن كنت تمثّل شركة، فأنت تؤكّد صلاحيّتك للتعاقد باسمها.",
    },
    {
      title: "٢. طبيعة الخدمة",
      body: "محاسب ذكي منصّة برمجيّة (SaaS) لإدارة الشؤون الماليّة. المنصّة أداة مساعدة ولا تُعدّ استشارةً ضريبيّةً أو قانونيّةً أو محاسبيّةً. للحصول على استشارة مهنيّة، يُرجى التواصل مع محاسب أو مستشار قانونيّ مرخَّص.",
    },
    {
      title: "٣. حساب المستخدم",
      body: "أنت مسؤول عن سرّيّة بيانات دخولك وعن جميع الأنشطة التي تجري عبر حسابك. يجب إبلاغنا فوراً في حال الاشتباه بأيّ استخدام غير مصرَّح به.",
    },
    {
      title: "٤. الاشتراك والفوترة",
      body: "تُفوَّت رسوم الاشتراك مقدَّماً على دوريّة شهريّة أو سنويّة. يمكنك إلغاء اشتراكك في أيّ وقت وستظلّ قادراً على الوصول إلى خدماتك حتى نهاية الفترة المدفوعة. لا نستردّ رسوم الفترات الماضية إلا في حالات استثنائيّة.",
    },
    {
      title: "٥. ملكيّة البيانات",
      body: "بياناتك ملكٌ لك بالكامل. نحن لا نمتلك ولا نستخدم بياناتك المالية لأيّ غرض سوى تقديم الخدمة لك. يحقّ لك تصدير بياناتك في أيّ وقت.",
    },
    {
      title: "٦. الاستخدام المقبول",
      body: "توافق على عدم استخدام المنصّة في أيّ نشاط مخالف للقانون، أو تحميل محتوى ضارّ، أو محاولة الوصول غير المصرَّح به إلى أنظمتنا أو بيانات عملاء آخرين.",
    },
    {
      title: "٧. تحديد المسؤوليّة",
      body: "في حدود ما يسمح به القانون، لا تتجاوز مسؤوليّتنا الكليّة تجاهك مبلغ ما دفعته للمنصّة في الأشهر الاثني عشر السابقة. لسنا مسؤولين عن الأضرار غير المباشرة أو الاحتماليّة.",
    },
    {
      title: "٨. إنهاء الخدمة",
      body: "يحقّ لنا إيقاف حسابك في حال انتهاك هذه الشروط بعد إشعار مسبق. يحقّ لك إنهاء اشتراكك في أيّ وقت.",
    },
    {
      title: "٩. القانون الواجب التطبيق",
      body: "تخضع هذه الشروط لقوانين دولة الإمارات العربيّة المتحدة. أيّ نزاع يُحسَم أوّلاً بالتفاوض الودّيّ، وإن تعذَّر ذلك فبالتحكيم وفق قواعد مركز دبي للتحكيم الدوليّ.",
    },
  ] : [
    {
      title: "1. Acceptance of terms",
      body: "By using or registering on the Smart Accountant platform, you agree to these terms and the Privacy Policy. If you represent a company, you confirm your authority to contract on its behalf.",
    },
    {
      title: "2. Nature of the service",
      body: "Smart Accountant is a software-as-a-service (SaaS) platform for financial management. The platform is an assistive tool and does not constitute tax, legal, or accounting advice. For professional advice, please consult a licensed accountant or legal advisor.",
    },
    {
      title: "3. User account",
      body: "You are responsible for the confidentiality of your login credentials and all activities conducted through your account. You must notify us immediately if you suspect any unauthorized use.",
    },
    {
      title: "4. Subscription & billing",
      body: "Subscription fees are billed in advance on a monthly or annual basis. You may cancel your subscription at any time and will retain access to your services until the end of the paid period. We do not refund past periods except in exceptional circumstances.",
    },
    {
      title: "5. Data ownership",
      body: "Your data is entirely yours. We do not own or use your financial data for any purpose other than providing the service to you. You may export your data at any time.",
    },
    {
      title: "6. Acceptable use",
      body: "You agree not to use the platform for any unlawful activity, upload harmful content, or attempt unauthorized access to our systems or other customers' data.",
    },
    {
      title: "7. Limitation of liability",
      body: "To the extent permitted by law, our total liability to you shall not exceed the amount you paid to the platform in the preceding twelve months. We are not liable for indirect or consequential damages.",
    },
    {
      title: "8. Termination",
      body: "We may suspend your account for breach of these terms after prior notice. You may terminate your subscription at any time.",
    },
    {
      title: "9. Governing law",
      body: "These terms are governed by the laws of the United Arab Emirates. Any dispute shall first be resolved through good-faith negotiation, and if that fails, through arbitration per the rules of the Dubai International Arbitration Centre.",
    },
  ]

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الشروط" : "Terms"}
        title={ar ? "شروط الخدمة" : "Terms of Service"}
        subtitle={ar
          ? "هذه الشروط تحكم علاقتنا معك. نؤمن بالشفافيّة لذا كتبناها بلغة واضحة."
          : "These terms govern our relationship with you. We believe in transparency, so we wrote them in plain language."}
      />

      <div className="py-8 text-small text-muted-foreground mb-8">
        {ar ? "آخر تحديث: ١٥ مايو ٢٠٢٦" : "Last updated: May 15, 2026"}
      </div>

      <div className="prose prose-neutral dark:prose-invert max-w-none space-y-10 pb-16">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold text-foreground mb-3">{s.title}</h2>
            <p className="text-foreground/75 leading-relaxed">{s.body}</p>
          </section>
        ))}
      </div>
    </MarketingLayout>
  )
}
