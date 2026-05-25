import { MarketingLayout, MarketingHero, FeaturesGrid, CTASection, ComplianceBadges } from "./shared"
import { useLocale } from "@/contexts/locale-context"

export default function InvoicesPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "الفواتير" : "Invoicing"}
        title={ar ? "فاتورة دوليّة معتمدة — دفعة واحدة" : "Global invoicing — one shot"}
        subtitle={ar
          ? "أنشئ فواتير بيع وشراء متوافقة مع المعايير الدوليّة. ذكاء اصطناعيّ يقرأ المستندات، يستخرج البيانات، ويُسجّل القيد المحاسبيّ تلقائيّاً."
          : "Create compliant sales and purchase invoices to global standards. AI reads documents, extracts data, and posts the accounting entry automatically."}
      />

      <ComplianceBadges items={["PEPPOL", "EN 16931", "UBL 2.1", "IFRS 15", "e-Invoice"]} />

      <FeaturesGrid features={ar ? [
        { icon: "📄", title: "فواتير بيع وشراء", description: "دورة حياة كاملة: مسوّدة → مُرسَلة → مدفوعة → ملغاة. مع قيد محاسبيّ مزدوج آليّ وفق IFRS 15." },
        { icon: "📸", title: "قراءة من الصور", description: "ارفع صورة الفاتورة أو الإيصال — الذكاء الاصطناعيّ يستخرج البيانات ويُنشئ القيد بدون كتابة يدويّة." },
        { icon: "🌐", title: "متعدّد اللغات والعملات", description: "أصدر فواتير بأيّ لغة وعملة. تحويل تلقائيّ وأرصدة موحَّدة لحظيّاً." },
        { icon: "📱", title: "إرسال عبر أيّ قناة", description: "بريد إلكترونيّ، WhatsApp، أو رابط دفع. العميل يدفع مباشرةً من الفاتورة." },
        { icon: "🔄", title: "مزامنة فوريّة مع الدفتر", description: "كلّ فاتورة تنعكس فوراً على الأستاذ العامّ والتقارير الماليّة." },
        { icon: "⏰", title: "متابعة التأخير تلقائيّاً", description: "تنبيهات ذكيّة للفواتير المتأخّرة وتقارير AR Aging جاهزة." },
      ] : [
        { icon: "📄", title: "Sales & purchase invoices", description: "Full lifecycle: draft → sent → paid → cancelled. Auto double-entry per IFRS 15." },
        { icon: "📸", title: "Read from images", description: "Upload an invoice photo or receipt — AI extracts the data and creates the entry without manual input." },
        { icon: "🌐", title: "Multi-language & currency", description: "Issue invoices in any language and currency. Auto conversion and real-time consolidated balances." },
        { icon: "📱", title: "Send via any channel", description: "Email, WhatsApp, or a payment link. Customers pay directly from the invoice." },
        { icon: "🔄", title: "Real-time ledger sync", description: "Every invoice instantly reflects on the general ledger and financial reports." },
        { icon: "⏰", title: "Auto overdue tracking", description: "Smart alerts for overdue invoices and ready-to-go AR aging reports." },
      ]} />

      <CTASection
        title={ar ? "ابدأ بإصدار فواتير احترافيّة" : "Start issuing professional invoices"}
        primaryLabel={ar ? "ابدأ مجّاناً" : "Start free"}
        primaryHref="/app"
        secondaryLabel={ar ? "اطّلع على المنصة" : "See the platform"}
        secondaryHref="/platform"
      />
    </MarketingLayout>
  )
}
