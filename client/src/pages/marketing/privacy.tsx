import { MarketingLayout, MarketingHero } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function PrivacyPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  const sections = ar ? [
    {
      title: "١. البيانات التي نجمعها",
      body: "نجمع المعلومات التي تزوّدنا بها مباشرةً عند التسجيل، كالاسم والبريد الإلكترونيّ ومعلومات الشركة. نجمع أيضاً بيانات الاستخدام التقنيّة (عناوين IP، المتصفّح، توقيت الجلسات) لتحسين أداء المنصّة.",
    },
    {
      title: "٢. كيف نستخدم بياناتك",
      body: "نستخدم بياناتك لتقديم الخدمة وتحسينها، وإرسال الإشعارات المتعلّقة بحسابك، والتواصل معك بشأن التحديثات والعروض (يمكنك إلغاء الاشتراك في أيّ وقت). لا نبيع بياناتك لأيّ طرف ثالث بأيّ حال.",
    },
    {
      title: "٣. مشاركة البيانات",
      body: "قد نشارك بياناتك مع موفّري خدمات موثوقين يساعدوننا في تشغيل المنصّة (مثل البنية التحتيّة السحابيّة والمدفوعات)، وذلك بموجب اتفاقيّات سرّيّة صارمة. لن نشارك بياناتك مع أطراف ثالثة لأغراض تسويقيّة.",
    },
    {
      title: "٤. أمان البيانات",
      body: "نحمي بياناتك بتشفير AES-256 أثناء التخزين وTLS 1.3 أثناء النقل. نجري تدقيقات أمنيّة دوريّة وامتثلنا لمعيار SOC 2 Type II. لا يمكن لأيّ موظّف لدينا الاطّلاع على بياناتك المالية دون إذن صريح منك.",
    },
    {
      title: "٥. حقوقك",
      body: "يحقّ لك طلب الاطّلاع على بياناتك، تصحيحها، حذفها، أو تصديرها في أيّ وقت. يمكنك ممارسة هذه الحقوق عبر لوحة الإعدادات أو التواصل مع فريق الخصوصيّة على privacy@smartacc.io.",
    },
    {
      title: "٦. الاحتفاظ بالبيانات",
      body: "نحتفظ ببياناتك طوال مدّة اشتراكك وبعدها لمدّة ٩٠ يوماً تُتاح لك خلالها استعادتها. بعد ذلك تُحذَف نهائيّاً من أنظمتنا.",
    },
    {
      title: "٧. ملفّات تعريف الارتباط",
      body: "نستخدم ملفّات تعريف ارتباط ضروريّة لتشغيل المنصّة وتذكّر تفضيلاتك. يمكنك التحكّم في ملفّات الارتباط الاختياريّة من خلال إعدادات المتصفّح.",
    },
    {
      title: "٨. التغييرات على هذه السياسة",
      body: "سنُبلّغك بأيّ تغييرات جوهريّة على هذه السياسة عبر البريد الإلكترونيّ أو إشعار داخل التطبيق قبل نفاذها بـ ٣٠ يوماً على الأقلّ.",
    },
  ] : [
    {
      title: "1. Data we collect",
      body: "We collect information you provide directly when registering, such as name, email, and company details. We also collect technical usage data (IP addresses, browser, session timestamps) to improve platform performance.",
    },
    {
      title: "2. How we use your data",
      body: "We use your data to provide and improve the service, send account-related notifications, and communicate updates and offers (you can unsubscribe anytime). We never sell your data to any third party.",
    },
    {
      title: "3. Data sharing",
      body: "We may share your data with trusted service providers who help us run the platform (e.g., cloud infrastructure and payments), under strict confidentiality agreements. We will not share your data with third parties for marketing purposes.",
    },
    {
      title: "4. Data security",
      body: "We protect your data with AES-256 encryption at rest and TLS 1.3 in transit. We conduct periodic security audits and are SOC 2 Type II compliant. No employee can access your financial data without your explicit permission.",
    },
    {
      title: "5. Your rights",
      body: "You may request access, correction, deletion, or export of your data at any time. Exercise these rights through the settings panel or by contacting our privacy team at privacy@smartacc.io.",
    },
    {
      title: "6. Data retention",
      body: "We retain your data for the duration of your subscription and 90 days afterward, during which you can recover it. After that, it is permanently deleted from our systems.",
    },
    {
      title: "7. Cookies",
      body: "We use necessary cookies to operate the platform and remember your preferences. You can control optional cookies through your browser settings.",
    },
    {
      title: "8. Changes to this policy",
      body: "We will notify you of any material changes to this policy by email or in-app notice at least 30 days before they take effect.",
    },
  ]

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الخصوصيّة" : "Privacy"}
        title={ar ? "سياسة الخصوصيّة" : "Privacy Policy"}
        subtitle={ar
          ? "نؤمن بأنّ بياناتك ملكٌ لك وحدك. هذه السياسة تشرح ما نجمعه، كيف نستخدمه، وكيف نحميه."
          : "We believe your data belongs to you alone. This policy explains what we collect, how we use it, and how we protect it."}
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
