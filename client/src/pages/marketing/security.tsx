import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function SecurityPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الأمان" : "Security"}
        title={ar ? "الأمان مبنيّ في كلّ طبقة" : "Security built into every layer"}
        subtitle={ar
          ? "نصف هنا ما هو مطبَّق فعليّاً في المنصّة اليوم — عزل بيانات على مستوى قاعدة البيانات، أثر تدقيق، وحماية المصادقة. ما زلنا في مرحلة تطوير، ولا ندّعي شهادات لم نحصل عليها بعد."
          : "This page describes what is actually implemented in the platform today — database-level data isolation, an audit trail, and authentication protections. We are still in active development and do not claim certifications we have not yet earned."}
      />

      {/* Honest posture: these describe the current engineering state, not
          third-party certifications. Do not add a badge here unless the
          control is implemented AND independently verifiable. */}
      <ComplianceBadges
        items={
          ar
            ? ["عزل RLS مطبَّق", "أثر تدقيق", "قيد التطوير — بدون شهادات بعد"]
            : ["RLS isolation (implemented)", "Audit trail", "In development — not yet certified"]
        }
      />

      <FeaturesGrid features={ar ? [
        { icon: "🏗️", title: "عزل البيانات على مستوى قاعدة البيانات", description: "بيانات كلّ شركة معزولة بسياسات أمان على مستوى الصفوف (Row-Level Security) في PostgreSQL، ويُعاد تطبيقها والتحقّق منها عند كلّ إقلاع للخادم." },
        { icon: "📋", title: "أثر تدقيق", description: "التعديلات على الدفاتر تُسجَّل مع هويّة المستخدم وختم زمنيّ في سجلّ التدقيق، ضمن نطاق مساحة العمل." },
        { icon: "🔑", title: "أسرار من جهة الخادم فقط", description: "مفاتيح الواجهات البرمجيّة وبيانات الاعتماد (OpenAI، التخزين، قاعدة البيانات) تبقى على الخادم ولا تُرسَل أبداً إلى المتصفّح." },
        { icon: "⏳", title: "حدود معدَّل على المصادقة", description: "نقاط تسجيل الدخول وإنشاء الحساب واستعادة كلمة المرور والدعوات محميّة بحدود معدَّل الطلبات للحدّ من هجمات التخمين." },
        { icon: "🖼️", title: "التحقّق من الملفات المرفوعة", description: "الملفات المرفوعة تُفحَص ببصمة البايتات الفعليّة (magic bytes) لا بنوع المحتوى المُعلَن، مع حدود حجم صارمة على الصور." },
        { icon: "🔒", title: "التخزين الخاصّ", description: "دلو التخزين مُصمَّم ليبقى خاصّاً، والتنزيلات المحميّة تمرّ عبر الخادم بعد التحقّق من الصلاحيّات." },
      ] : [
        { icon: "🏗️", title: "Database-level data isolation", description: "Each company's data is isolated with PostgreSQL Row-Level Security policies, which are re-applied and verified on every server boot." },
        { icon: "📋", title: "Audit trail", description: "Changes to the books are recorded with user identity and a timestamp in the audit log, scoped to the workspace." },
        { icon: "🔑", title: "Server-side secrets only", description: "API keys and credentials (OpenAI, storage, database) stay on the server and are never shipped to the browser." },
        { icon: "⏳", title: "Rate-limited authentication", description: "Sign-in, sign-up, password-reset, and invitation endpoints are rate-limited to slow down brute-force attempts." },
        { icon: "🖼️", title: "Upload validation", description: "Uploaded files are checked by their actual byte signature (magic bytes), not the declared content type, with strict size limits on images." },
        { icon: "🔒", title: "Private storage", description: "The object storage bucket is designed to stay private; protected downloads are proxied through the authenticated backend." },
      ]} />

      <div className="py-8 rounded-xl border border-card-border bg-card text-center my-12">
        <h2 className="text-xl font-bold text-foreground mb-2">
          {ar ? "على خارطة الطريق" : "On the roadmap"}
        </h2>
        <p className="text-muted-foreground mb-4 max-w-lg mx-auto">
          {ar
            ? "التشفير المُدار للبيانات المخزّنة، والمصادقة الثنائيّة (2FA)، والنسخ الاحتياطيّة المُجدوَلة، والمراجعات الأمنيّة المستقلّة أهدافٌ نعمل نحوها — ولا نعتبرها متوفّرة حتّى نتمكّن من إثباتها."
            : "Managed encryption at rest, two-factor authentication (2FA), scheduled backups, and independent security reviews are goals we are working toward — we do not consider them available until we can demonstrate them."}
        </p>
      </div>

      <div className="py-8 rounded-xl border border-card-border bg-card text-center my-12">
        <h2 className="text-xl font-bold text-foreground mb-2">
          {ar ? "اكتشفت ثغرةً أمنيّة؟" : "Found a security vulnerability?"}
        </h2>
        <p className="text-muted-foreground mb-4 max-w-lg mx-auto">
          {ar
            ? "نرحّب بالإبلاغ المسؤول من الباحثين الأمنيّين. راسلنا وسنردّ في أقرب وقت ممكن."
            : "We welcome responsible disclosure from security researchers. Email us and we'll respond as soon as we can."}
        </p>
        <a
          href="mailto:security@smartacc.io"
          className="inline-flex items-center h-10 px-6 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border hover:opacity-90 transition-opacity"
        >
          {ar ? "أبلغ عن ثغرة" : "Report a vulnerability"}
        </a>
      </div>

      <CTASection
        title={ar ? "أسئلة حول الأمان؟" : "Questions about security?"}
        subtitle={ar ? "تواصل معنا وسنشرح بوضوح ما هو مطبَّق وما هو قيد العمل." : "Get in touch and we'll be clear about what is implemented and what is in progress."}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "تواصل معنا" : "Contact us"}
        secondaryHref="/contact"
      />
    </MarketingLayout>
  )
}
