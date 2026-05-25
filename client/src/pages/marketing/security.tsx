import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function SecurityPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الأمان" : "Security"}
        title={ar ? "أمانك خطٌّ أحمر لا نتجاوزه" : "Your security is a red line we never cross"}
        subtitle={ar
          ? "نبني الأمان في كلّ طبقة — من البنية التحتيّة إلى التطبيق إلى البيانات. SOC 2 Type II، تشفير عسكريّ المستوى، وأثر تدقيق لا يُمكن تعديله."
          : "We build security into every layer — from infrastructure to application to data. SOC 2 Type II, military-grade encryption, and an immutable audit trail."}
      />

      <ComplianceBadges items={["SOC 2 Type II", "AES-256", "TLS 1.3", "GDPR", "PDPL", "CCPA", "ISO 27001"]} />

      <FeaturesGrid features={ar ? [
        { icon: "🔐", title: "تشفير AES-256", description: "جميع بياناتك مشفَّرة بـ AES-256 في مرحلة التخزين. أيّ نقل بيانات بينك وبيننا محمي بـ TLS 1.3." },
        { icon: "🛡️", title: "SOC 2 Type II", description: "خضعنا لتدقيق مستقلّ شامل وحصلنا على شهادة SOC 2 Type II، التي تُثبت التزامنا بالأمان والتوفّر والسرّيّة." },
        { icon: "📋", title: "أثر تدقيق لا يُعدَّل", description: "كلّ قيد محاسبيّ، كلّ تسجيل دخول، كلّ تعديل — يُسجَّل بختم زمنيّ وهويّة المستخدم ولا يمكن حذفه أو تعديله." },
        { icon: "🔑", title: "مصادقة ثنائيّة", description: "ادعم حسابك بمصادقة ثنائيّة (2FA) عبر تطبيق المصادقة أو الرسائل النصيّة. إلزاميّة للمسؤولين في خطّة المؤسّسات." },
        { icon: "🏗️", title: "عزل البيانات", description: "بيانات كلّ شركة معزولة تماماً بسياسات أمان على مستوى قاعدة البيانات (RLS). لا يصل أيّ مستخدم إلى بيانات مؤسّسة أخرى." },
        { icon: "🔍", title: "اختبارات اختراق دوريّة", description: "نُجري اختبارات اختراق مع فريق ثالث مستقلّ مرّتين سنويّاً على الأقلّ. النتائج الحرجة تُعالَج في غضون ٢٤ ساعة." },
        { icon: "💾", title: "نسخ احتياطيّة آليّة", description: "نسخ احتياطيّة تلقائيّة كلّ ساعة، مُخزَّنة في مناطق جغرافيّة متعدّدة. يمكنك استعادة بياناتك في أيّ وقت." },
        { icon: "🌐", title: "حماية DDoS والحواجز", description: "حواجز معدَّل الطلبات، وحماية DDoS، وجدار حماية تطبيقي (WAF) — لحماية المنصّة من الهجمات الخارجيّة." },
        { icon: "🔔", title: "مراقبة ٢٤/٧", description: "فريق مراقبة أمنيّة يعمل على مدار الساعة مع تنبيهات فوريّة عند أيّ نشاط مشبوه." },
      ] : [
        { icon: "🔐", title: "AES-256 encryption", description: "All your data is encrypted with AES-256 at rest. All data in transit is protected with TLS 1.3." },
        { icon: "🛡️", title: "SOC 2 Type II", description: "We underwent a comprehensive independent audit and received SOC 2 Type II certification, proving our commitment to security, availability, and confidentiality." },
        { icon: "📋", title: "Immutable audit trail", description: "Every accounting entry, every login, every change — timestamped with user identity and cannot be deleted or modified." },
        { icon: "🔑", title: "Two-factor authentication", description: "Secure your account with 2FA via authenticator app or SMS. Mandatory for admins on the Enterprise plan." },
        { icon: "🏗️", title: "Data isolation", description: "Each company's data is completely isolated with database-level security policies (RLS). No user can access another organization's data." },
        { icon: "🔍", title: "Periodic penetration tests", description: "We conduct penetration tests with an independent third party at least twice a year. Critical findings are addressed within 24 hours." },
        { icon: "💾", title: "Automated backups", description: "Automatic hourly backups stored across multiple geographic regions. You can restore your data at any time." },
        { icon: "🌐", title: "DDoS protection & rate limits", description: "Rate-limiting barriers, DDoS protection, and a Web Application Firewall (WAF) — protecting the platform from external attacks." },
        { icon: "🔔", title: "24/7 monitoring", description: "A security monitoring team working around the clock with instant alerts on any suspicious activity." },
      ]} />

      <div className="py-8 rounded-xl border border-card-border bg-card text-center my-12">
        <h2 className="text-xl font-bold text-foreground mb-2">
          {ar ? "اكتشفت ثغرةً أمنيّة؟" : "Found a security vulnerability?"}
        </h2>
        <p className="text-muted-foreground mb-4 max-w-lg mx-auto">
          {ar
            ? "نحثّ الباحثين الأمنيّين على الإبلاغ المسؤول. راسلنا على security@smartacc.io وسنستجيب خلال ٢٤ ساعة."
            : "We encourage responsible disclosure from security researchers. Email us at security@smartacc.io and we'll respond within 24 hours."}
        </p>
        <a
          href="mailto:security@smartacc.io"
          className="inline-flex items-center h-10 px-6 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border hover:opacity-90 transition-opacity"
        >
          {ar ? "أبلغ عن ثغرة" : "Report a vulnerability"}
        </a>
      </div>

      <CTASection
        title={ar ? "بياناتك في أيد أمينة" : "Your data is in safe hands"}
        subtitle={ar ? "اطّلع على مركز الثقة الكامل للاطّلاع على أوراق اعتماد الأمان التفصيليّة." : "Visit our full trust center for detailed security credentials."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "تواصل مع فريق الأمان" : "Contact security team"}
        secondaryHref="/contact"
      />
    </MarketingLayout>
  )
}
