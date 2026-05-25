import { useState } from "react"
import { MarketingLayout } from "./shared"
import { useLocale } from "@/contexts/locale-context"
import { useLocation } from "wouter"
import { OPENINGS } from "./jobs"

const JOB_DETAILS: Record<string, {
  responsibilitiesAr: string[]
  responsibilitiesEn: string[]
  requirementsAr: string[]
  requirementsEn: string[]
  niceToHaveAr: string[]
  niceToHaveEn: string[]
  benefitsAr: string[]
  benefitsEn: string[]
  salaryAr: string
  salaryEn: string
}> = {
  "backend-engineer": {
    responsibilitiesAr: [
      "تصميم وبناء خدمات الباكند الأساسيّة بـ Node.js / TypeScript وPostgreSQL",
      "تطوير طبقة التخزين وضمان عزل البيانات متعدّدة المستأجرين",
      "كتابة اختبارات تلقائيّة شاملة وصيانة جودة الكود",
      "التعاون مع فريق المنتج لتحويل المتطلّبات المحاسبيّة إلى منطق برمجيّ صحيح",
      "المساهمة في مراجعات الكود وتحسين الأداء",
    ],
    responsibilitiesEn: [
      "Design and build core backend services in Node.js / TypeScript with PostgreSQL",
      "Develop the storage layer and ensure multi-tenant data isolation",
      "Write comprehensive automated tests and maintain code quality",
      "Collaborate with the product team to translate accounting requirements into correct business logic",
      "Contribute to code reviews and performance optimization",
    ],
    requirementsAr: [
      "خبرة ٣+ سنوات في تطوير الباكند بـ Node.js أو TypeScript",
      "إتقان PostgreSQL والاستعلامات المعقَّدة والمعاملات (Transactions)",
      "خبرة في معمارية REST API وتصميم الـ schemas",
      "فهم جيّد لمبادئ الأمن والـ authentication",
      "مهارات تواصل قويّة وقدرة على العمل بصورة مستقلّة",
    ],
    requirementsEn: [
      "3+ years of backend development experience in Node.js or TypeScript",
      "Strong PostgreSQL skills including complex queries and transactions",
      "Experience with REST API architecture and schema design",
      "Good understanding of security principles and authentication",
      "Strong communication skills and ability to work independently",
    ],
    niceToHaveAr: [
      "معرفة بـ Drizzle ORM أو Prisma",
      "خبرة في الأنظمة الماليّة أو المحاسبيّة",
      "إلمام بمبادئ IFRS أو المحاسبة بالقيد المزدوج",
      "خبرة في بيئات السحابة (AWS / GCP / Azure)",
    ],
    niceToHaveEn: [
      "Familiarity with Drizzle ORM or Prisma",
      "Experience with financial or accounting systems",
      "Understanding of IFRS principles or double-entry accounting",
      "Experience with cloud environments (AWS / GCP / Azure)",
    ],
    benefitsAr: [
      "راتب تنافسيّ وفق مستوى الخبرة",
      "عمل عن بُعد بالكامل مع اجتماعات متزامنة محدودة",
      "ميزانيّة تطوير سنويّة للتعلّم والمؤتمرات",
      "أسهم في الشركة لجميع الموظّفين",
      "إجازة سنويّة سخيّة + أيّام صحّة نفسيّة",
    ],
    benefitsEn: [
      "Competitive salary based on experience level",
      "Fully remote work with limited synchronous meetings",
      "Annual learning & conference budget",
      "Equity for all employees",
      "Generous PTO + mental health days",
    ],
    salaryAr: "$٨٠,٠٠٠ – $١٣٠,٠٠٠ سنويّاً (حسب الخبرة)",
    salaryEn: "$80,000 – $130,000/year (experience-based)",
  },
  "frontend-engineer": {
    responsibilitiesAr: [
      "بناء مكوّنات واجهة المستخدم باستخدام React و TypeScript وTailwind CSS",
      "تطوير تجارب RTL/LTR متميّزة لجمهور متعدّد اللغات",
      "تحسين الأداء وضمان إمكانيّة الوصول (WCAG AA)",
      "التعاون مع المصمّمين والباكند لتسليم ميزات كاملة",
      "كتابة اختبارات Playwright للميزات الرئيسيّة",
    ],
    responsibilitiesEn: [
      "Build UI components using React, TypeScript, and Tailwind CSS",
      "Develop excellent RTL/LTR experiences for multilingual audiences",
      "Optimize performance and ensure accessibility (WCAG AA)",
      "Collaborate with designers and backend to ship complete features",
      "Write Playwright tests for key features",
    ],
    requirementsAr: [
      "خبرة ٣+ سنوات في React وTypeScript",
      "إتقان Tailwind CSS والتصميم التجاوبيّ",
      "خبرة في TanStack Query أو مكتبات إدارة الحالة",
      "فهم جيّد لمعايير الويب وإمكانيّة الوصول",
      "تجربة مع RTL وتعريب الواجهات (ميزة إضافيّة)",
    ],
    requirementsEn: [
      "3+ years of React and TypeScript experience",
      "Proficiency in Tailwind CSS and responsive design",
      "Experience with TanStack Query or state management libraries",
      "Good understanding of web standards and accessibility",
      "Experience with RTL layouts and UI localization (a plus)",
    ],
    niceToHaveAr: [
      "إلمام بـ Radix UI أو shadcn/ui",
      "خبرة في تطوير منتجات SaaS",
      "اهتمام بالتفاصيل البصريّة الدقيقة والأنيميشن",
      "خبرة مع Recharts أو مكتبات رسم البيانات المالية",
    ],
    niceToHaveEn: [
      "Familiarity with Radix UI or shadcn/ui",
      "Experience building SaaS products",
      "Interest in micro-visual details and animation",
      "Experience with Recharts or financial charting libraries",
    ],
    benefitsAr: [
      "راتب تنافسيّ وفق مستوى الخبرة",
      "عمل عن بُعد بالكامل",
      "ميزانيّة تطوير سنويّة",
      "أسهم في الشركة",
      "إجازة مرنة",
    ],
    benefitsEn: [
      "Competitive salary based on experience",
      "Fully remote work",
      "Annual development budget",
      "Company equity",
      "Flexible PTO",
    ],
    salaryAr: "$٧٠,٠٠٠ – $١٢٠,٠٠٠ سنويّاً",
    salaryEn: "$70,000 – $120,000/year",
  },
  "accounting-expert": {
    responsibilitiesAr: [
      "مراجعة جميع ميزات المنتج للتأكّد من توافقها مع IFRS والأنظمة المحليّة",
      "توثيق السياسات المحاسبيّة المعتمَدة في المنتج",
      "دعم فريق المبيعات في الردّ على الأسئلة الضريبيّة والمحاسبيّة",
      "إعداد محتوى تعليميّ (مقالات، أمثلة، توثيق) للعملاء",
      "المشاركة في اختبار ميزات الضرائب ومخصّصات الرواتب",
    ],
    responsibilitiesEn: [
      "Review all product features to ensure compliance with IFRS and local regulations",
      "Document the accounting policies implemented in the product",
      "Support the sales team in answering tax and accounting questions",
      "Prepare educational content (articles, examples, documentation) for customers",
      "Participate in testing tax and payroll features",
    ],
    requirementsAr: [
      "مؤهَّل محاسبيّ معتمَد (CPA / ACCA / CA أو ما يعادله)",
      "خبرة ٥+ سنوات في المحاسبة أو التدقيق",
      "معرفة عميقة بـ IFRS ومعايير IAS",
      "خبرة في محاسبة الرواتب وضريبة القيمة المضافة في دولة واحدة على الأقلّ",
      "قدرة على التعبير عن المفاهيم المحاسبيّة بلغة واضحة للمطوّرين",
    ],
    requirementsEn: [
      "Certified accounting qualification (CPA / ACCA / CA or equivalent)",
      "5+ years of accounting or auditing experience",
      "Deep knowledge of IFRS and IAS standards",
      "Experience with payroll accounting and VAT in at least one country",
      "Ability to explain accounting concepts clearly to developers",
    ],
    niceToHaveAr: [
      "خبرة في أكثر من دولة (خاصّةً منطقة الشرق الأوسط أو أوروبا)",
      "معرفة أساسيّة بالبرمجة أو العمل مع فرق تقنيّة",
      "خبرة في تطوير سياسات المحاسبة للبرمجيّات المالية",
    ],
    niceToHaveEn: [
      "Experience across multiple countries (especially MENA or Europe)",
      "Basic coding knowledge or experience working with technical teams",
      "Experience developing accounting policies for financial software",
    ],
    benefitsAr: [
      "راتب تنافسيّ يعكس خبرتك المهنيّة العميقة",
      "مرونة في ترتيبات العمل (عن بُعد أو مختلط)",
      "فرصة نادرة للمشاركة في بناء منتج محاسبيّ دوليّ من الداخل",
      "ميزانيّة للمؤتمرات والاشتراكات المهنيّة",
    ],
    benefitsEn: [
      "Competitive salary reflecting your deep professional expertise",
      "Flexible work arrangements (remote or hybrid)",
      "Rare opportunity to shape an international accounting product from the inside",
      "Conference and professional membership budget",
    ],
    salaryAr: "$٩٠,٠٠٠ – $١٤٠,٠٠٠ سنويّاً",
    salaryEn: "$90,000 – $140,000/year",
  },
  "customer-success": {
    responsibilitiesAr: [
      "إدارة علاقات العملاء وضمان حصولهم على أقصى قيمة من المنتج",
      "إجراء جلسات onboarding فرديّة وجماعيّة للعملاء الجدد",
      "تتبّع مؤشّرات الاحتفاظ بالعملاء والتدخّل المبكر عند الانخفاض",
      "جمع ملاحظات العملاء ونقلها إلى فريق المنتج",
      "إعداد تقارير دوريّة عن صحّة قاعدة العملاء",
    ],
    responsibilitiesEn: [
      "Manage customer relationships and ensure they get maximum product value",
      "Conduct individual and group onboarding sessions for new customers",
      "Track retention metrics and intervene early on declining accounts",
      "Gather customer feedback and relay it to the product team",
      "Prepare periodic reports on customer base health",
    ],
    requirementsAr: [
      "خبرة ٢+ سنوات في نجاح العملاء أو الدعم الفنيّ لمنتجات SaaS",
      "فهم جيّد للأعمال والمفاهيم الماليّة الأساسيّة",
      "مهارات تواصل استثنائيّة بالعربيّة والإنجليزيّة",
      "صبر وتعاطف في حلّ مشكلات العملاء",
      "قدرة على الشرح التقنيّ لجمهور غير تقنيّ",
    ],
    requirementsEn: [
      "2+ years in customer success or technical support for SaaS products",
      "Good understanding of business and basic financial concepts",
      "Exceptional communication skills in Arabic and English",
      "Patience and empathy in resolving customer issues",
      "Ability to explain technical concepts to non-technical audiences",
    ],
    niceToHaveAr: [
      "خلفيّة في المحاسبة أو المال",
      "تجربة مع أدوات CRM (HubSpot / Salesforce)",
      "خبرة في أسواق الشرق الأوسط",
    ],
    niceToHaveEn: [
      "Background in accounting or finance",
      "Experience with CRM tools (HubSpot / Salesforce)",
      "Experience in Middle Eastern markets",
    ],
    benefitsAr: [
      "راتب تنافسيّ + مكافآت مرتبطة بالأداء",
      "عمل مختلط (دبي أو الرياض)",
      "فرص تطوير مهنيّ واضحة",
      "فريق متعدّد الجنسيّات وبيئة عمل داعمة",
    ],
    benefitsEn: [
      "Competitive salary + performance-linked bonuses",
      "Hybrid work (Dubai or Riyadh)",
      "Clear professional development opportunities",
      "Multinational team and supportive work environment",
    ],
    salaryAr: "$٥٠,٠٠٠ – $٨٠,٠٠٠ سنويّاً + مكافآت",
    salaryEn: "$50,000 – $80,000/year + bonus",
  },
}

export default function JobDetailPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"
  const [location] = useLocation()
  const slug = location.replace(/^\/jobs\//, "").split("/")[0]

  const jobBase = OPENINGS.find((o) => o.slug === slug)
  const jobDetail = JOB_DETAILS[slug]

  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", linkedin: "", coverLetter: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (!jobBase || !jobDetail) {
    return (
      <MarketingLayout>
        <div className="py-24 text-center">
          <p className="text-muted-foreground">{ar ? "الوظيفة غير موجودة." : "Job not found."}</p>
          <a href="/jobs" className="mt-4 inline-block text-primary hover:underline text-small">
            {ar ? "← العودة للوظائف" : "← Back to Jobs"}
          </a>
        </div>
      </MarketingLayout>
    )
  }

  const responsibilities = ar ? jobDetail.responsibilitiesAr : jobDetail.responsibilitiesEn
  const requirements = ar ? jobDetail.requirementsAr : jobDetail.requirementsEn
  const niceToHave = ar ? jobDetail.niceToHaveAr : jobDetail.niceToHaveEn
  const benefits = ar ? jobDetail.benefitsAr : jobDetail.benefitsEn
  const salary = ar ? jobDetail.salaryAr : jobDetail.salaryEn

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = ar ? "الاسم مطلوب" : "Name is required"
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = ar ? "البريد الإلكترونيّ غير صحيح" : "Invalid email"
    if (!form.coverLetter.trim()) e.coverLetter = ar ? "رسالة التقديم مطلوبة" : "Cover letter is required"
    return e
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setSubmitted(true)
  }

  return (
    <MarketingLayout>
      <div className="max-w-4xl mx-auto py-10 lg:py-16 px-4">
        <a
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground mb-8 transition-colors"
          data-testid="link-back-jobs"
        >
          {ar ? "→ الوظائف" : "← Jobs"}
        </a>

        <div className="flex flex-col lg:flex-row lg:items-start gap-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium">
                {ar ? jobBase.deptAr : jobBase.deptEn}
              </span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground mb-3">
              {ar ? jobBase.titleAr : jobBase.titleEn}
            </h1>
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="px-2.5 py-1 rounded-full bg-muted text-caption text-foreground/70">
                {ar ? jobBase.typeAr : jobBase.typeEn}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-muted text-caption text-foreground/70">
                📍 {ar ? jobBase.locationAr : jobBase.locationEn}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-caption font-medium">
                💰 {salary}
              </span>
            </div>

            <Section title={ar ? "المهام والمسؤوليّات" : "Responsibilities"}>
              <ul className="space-y-2">
                {responsibilities.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-small text-foreground/80">
                    <span className="mt-1.5 size-1.5 rounded-full bg-primary flex-shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={ar ? "المتطلّبات الأساسيّة" : "Requirements"}>
              <ul className="space-y-2">
                {requirements.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-small text-foreground/80">
                    <span className="mt-1.5 size-1.5 rounded-full bg-primary flex-shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={ar ? "يُفضَّل وجوده (ليس إلزاميّاً)" : "Nice to have (not required)"}>
              <ul className="space-y-2">
                {niceToHave.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-small text-foreground/80">
                    <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={ar ? "المزايا والمكافآت" : "Benefits & perks"}>
              <ul className="space-y-2">
                {benefits.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-small text-foreground/80">
                    <span className="text-primary text-base leading-none">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <div className="lg:w-[380px] shrink-0">
            <div className="sticky top-24 rounded-2xl border border-card-border bg-card p-6 lg:p-7 shadow-sm">
              {submitted ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-4">✅</div>
                  <h3 className="font-semibold text-foreground mb-2">
                    {ar ? "وصل طلبك!" : "Application received!"}
                  </h3>
                  <p className="text-small text-muted-foreground leading-relaxed">
                    {ar
                      ? "سيتواصل معك فريقنا خلال ٣–٥ أيّام عمل."
                      : "Our team will get back to you within 3–5 business days."}
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="font-semibold text-foreground text-lg mb-5">
                    {ar ? "تقدَّم لهذه الوظيفة" : "Apply for this role"}
                  </h2>
                  <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                    <FormField
                      label={ar ? "الاسم الكامل *" : "Full name *"}
                      error={errors.name}
                      testId="input-name"
                    >
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        data-testid="input-name"
                        placeholder={ar ? "مثال: أحمد محمّد" : "e.g. John Smith"}
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-small text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </FormField>

                    <FormField
                      label={ar ? "البريد الإلكترونيّ *" : "Email address *"}
                      error={errors.email}
                      testId="input-email"
                    >
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        data-testid="input-email"
                        placeholder="name@company.com"
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-small text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </FormField>

                    <FormField
                      label={ar ? "رابط LinkedIn أو المحفظة (اختياريّ)" : "LinkedIn or portfolio URL (optional)"}
                      testId="input-linkedin"
                    >
                      <input
                        type="url"
                        value={form.linkedin}
                        onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
                        data-testid="input-linkedin"
                        placeholder="https://linkedin.com/in/..."
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-small text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </FormField>

                    <FormField
                      label={ar ? "رسالة التقديم *" : "Cover letter *"}
                      error={errors.coverLetter}
                      testId="textarea-cover"
                    >
                      <textarea
                        rows={5}
                        value={form.coverLetter}
                        onChange={(e) => setForm({ ...form, coverLetter: e.target.value })}
                        data-testid="textarea-cover"
                        placeholder={ar
                          ? "أخبرنا لماذا أنت المناسب لهذا الدور..."
                          : "Tell us why you're the right fit for this role..."}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-small text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none leading-relaxed"
                      />
                    </FormField>

                    <button
                      type="submit"
                      data-testid="button-submit-application"
                      className="w-full h-10 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border hover:opacity-90 transition-opacity"
                    >
                      {ar ? "إرسال الطلب" : "Submit application"}
                    </button>

                    <p className="text-caption text-muted-foreground text-center">
                      {ar
                        ? "نردّ على جميع الطلبات خلال ٣–٥ أيّام عمل."
                        : "We respond to all applications within 3–5 business days."}
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-foreground mb-3 pb-2 border-b border-border">
        {title}
      </h2>
      {children}
    </div>
  )
}

function FormField({
  label, error, testId, children
}: { label: string; error?: string; testId: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={testId} className="block text-caption font-medium text-foreground/80 mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-caption text-red-500">{error}</p>}
    </div>
  )
}
