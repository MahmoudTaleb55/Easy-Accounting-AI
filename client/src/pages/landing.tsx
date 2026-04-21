import { useState } from "react"
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, FileText, Receipt, Bot,
  Sparkles, ShieldCheck, Globe2, Workflow, BarChart3, Briefcase,
  Users, Wallet, TrendingUp, AlertTriangle, Lock, Database, ScrollText,
  MapPin,
} from "lucide-react"
import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppFooter } from "@/components/layout/AppFooter"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

/* ============================================================================
   Landing page — محاسب ذكي
   Premium fintech positioning. RTL Arabic-first. Built on Phase 1 design system.
   ========================================================================== */

export default function Landing() {
  return (
    <div className="bg-background text-foreground" dir="rtl">
      <AppNavbar
        links={[
          { label: "المنصة",     href: "#platform" },
          { label: "الذكاء",      href: "#ai" },
          { label: "الأتمتة",     href: "#automation" },
          { label: "الأمان",      href: "#security" },
          { label: "الاستخدامات", href: "#use-cases" },
          { label: "الأسئلة",     href: "#faq" },
        ]}
      />
      <main className="overflow-x-clip">
        <Hero />
        <TrustStrip />
        <WhyDifferent />
        <CoreCapabilities />
        <AIAssistant />
        <DashboardShowcase />
        <Automation />
        <Security />
        <UseCases />
        <FAQ />
        <FinalCTA />
      </main>
      <AppFooter />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  1 · Hero                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative pt-16 pb-24 lg:pt-24 lg:pb-32">
      {/* Soft accent glow behind product mockup */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [mask-image:radial-gradient(60%_50%_at_50%_30%,black,transparent)]"
      >
        <div className="absolute top-32 left-1/4 w-[42rem] h-[42rem] rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute top-48 right-1/4 w-[32rem] h-[32rem] rounded-full bg-info/[0.05] blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Copy column */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-xs">
              <span className="status-dot bg-success animate-pulse" />
              <span className="text-xs text-muted-foreground">
                الإصدار الجديد · مدعوم بـ GPT-5.2
              </span>
            </div>

            <h1 className="mt-6 text-display-lg text-foreground">
              نظام محاسبة ذكي،
              <br />
              <span className="text-primary">مبني للأعمال الحديثة.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              من الفواتير إلى البصيرة — منصّة محاسبية واحدة وفق معايير IFRS،
              مدعومة بالذكاء الاصطناعي، تعمل عبر سبع دول وبعملات متعددة.
              <span className="text-foreground/80"> عربية أولاً، عالمية بطبعها.</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" data-testid="button-hero-cta-primary" asChild>
                <a href="#cta" className="gap-2">
                  ابدأ مجاناً
                  <ArrowLeft className="size-4" />
                </a>
              </Button>
              <Button size="lg" variant="outline" data-testid="button-hero-cta-secondary" asChild>
                <a href="#showcase">احجز عرضاً مباشراً</a>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" />بدون بطاقة ائتمان</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" />تجربة كاملة ١٤ يوم</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" />تركيب خلال ٥ دقائق</span>
            </div>
          </div>

          {/* Product mockup column */}
          <div className="lg:col-span-6">
            <HeroProductMockup />
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroProductMockup() {
  return (
    <div className="relative">
      {/* Floating chip — bottom-left */}
      <div className="absolute -bottom-6 -left-4 z-10 hidden md:block">
        <FloatingChip
          icon={<Sparkles className="size-3.5" />}
          title="قيد آلي مُسجَّل"
          subtitle="فاتورة كهرباء · ١٥٠ ر.س"
        />
      </div>
      {/* Floating chip — top-right */}
      <div className="absolute -top-4 -right-4 z-10 hidden md:block">
        <FloatingChip
          icon={<TrendingUp className="size-3.5" />}
          title="نسبة الربح ↑ ١٢٪"
          subtitle="الربع الحالي"
          accent="success"
        />
      </div>

      <BrowserFrame title="cockpit · محاسب ذكي">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3 p-4">
          <MiniKPI label="الإيرادات" value="٢٤٢,٣٠٠" delta="+8.4%" positive />
          <MiniKPI label="المصروفات" value="١٣٨,٧١٠" delta="-2.1%" />
          <MiniKPI label="صافي التدفق" value="١٠٣,٥٩٠" delta="+14.6%" positive highlight />
        </div>
        {/* Chart band */}
        <div className="px-4 pb-3">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="eyebrow mb-1">آخر ٣٠ يوم</div>
                <div className="text-sm font-medium text-foreground">التدفق النقدي</div>
              </div>
              <div className="flex gap-1.5">
                <span className="text-2xs text-muted-foreground">د</span>
                <span className="text-2xs text-muted-foreground">أ</span>
                <span className="text-2xs text-foreground font-medium border-b border-primary pb-0.5">ش</span>
                <span className="text-2xs text-muted-foreground">س</span>
              </div>
            </div>
            <SparkChart />
          </div>
        </div>
        {/* Journal entry preview */}
        <div className="px-4 pb-4">
          <div className="rounded-md border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
              <div className="text-xs font-medium text-foreground">آخر قيد · #٢٤٧٨</div>
              <Badge variant="success" size="sm">متوازن</Badge>
            </div>
            <table className="w-full text-2xs">
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="px-3 py-2 text-muted-foreground font-mono">5110</td>
                  <td className="px-3 py-2 text-foreground">مصروفات تسويق</td>
                  <td className="px-3 py-2 text-foreground font-mono text-end tabular-nums">١٢٠٠.٠٠</td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-end">—</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-muted-foreground font-mono">1010</td>
                  <td className="px-3 py-2 text-foreground">النقدية</td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-end">—</td>
                  <td className="px-3 py-2 text-foreground font-mono text-end tabular-nums">١٢٠٠.٠٠</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </BrowserFrame>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  2 · Trust strip                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function TrustStrip() {
  const wordmarks = ["ARAMEX", "Almosafer", "TALABAT", "Anghami", "Mubadala", "STC pay", "Careem"]
  return (
    <section className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 lg:py-12">
        <div className="grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-3">
            <div className="eyebrow mb-2">يثق بنا</div>
            <div className="text-sm text-foreground/85 leading-relaxed">
              <span className="font-semibold text-foreground">٢٠٠٠+</span> شركة وفريق مالي
              <br />عبر <span className="font-semibold text-foreground">٧ دول</span>
            </div>
          </div>
          <div className="lg:col-span-9">
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 opacity-70">
              {wordmarks.map((w) => (
                <span key={w} className="font-display text-sm md:text-base font-semibold tracking-wide text-foreground/70 whitespace-nowrap">
                  {w}
                </span>
              ))}
            </div>
          </div>
        </div>
        {/* Metrics row */}
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border">
          <Metric value="٢.٤ مليار+" label="ر.س قيود مُسجَّلة" />
          <Metric value="٩٩.٩٩٪" label="جاهزية المنصة" />
          <Metric value="< ١٢٠ms" label="زمن استجابة API" />
          <Metric value="SOC 2" label="Type II معتمد" mono />
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  3 · Why different                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function WhyDifferent() {
  const principles = [
    {
      n: "01",
      t: "ذكاء حقيقي، لا واجهة عليه ملصق",
      b: "الـ AI ليس ميزة جانبية. هو يقرأ فاتورتك، يصنّفها، يقترح القيد المحاسبي الصحيح وفق IFRS، ويتعلّم من تصحيحاتك. تكتب «دفعت ١٢٠ للمورد» ويسجّل القيد كاملاً.",
    },
    {
      n: "02",
      t: "محلّي حيث يجب، عالمي حيث ينبغي",
      b: "ضريبة القيمة المضافة، الزكاة، التأمينات، نهاية الخدمة، عُطل العمل، تقويم رمضان — مدمجة لسبع دول. والقاعدة دائماً IFRS، فحساباتك تُقرأ من المُدقّق في الرياض ومن المستثمر في لندن بنفس اللغة.",
    },
    {
      n: "03",
      t: "أرقام يمكن الاعتماد عليها",
      b: "كل قيد مزدوج، متوازن، له سند رقمي وأثر تدقيق غير قابل للتعديل. المعادلات تتحقق آنياً. لا حقول حرة، لا أرقام «تقريبية»، لا مفاجآت في نهاية السنة.",
    },
    {
      n: "04",
      t: "مبني للقرار، لا للتسجيل فقط",
      b: "كوكبت قرار حيّ يقيس صحة عملك، يتنبّأ بالتدفق النقدي، يحاكي «ماذا لو؟»، ويصلك بصياغة عربية واضحة من مساعد ذكي يفهم سياقك المالي.",
    },
  ]

  return (
    <section id="platform" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 mb-16">
          <div className="lg:col-span-5">
            <div className="eyebrow mb-4">لماذا محاسب ذكي</div>
            <h2 className="text-display text-foreground">
              المحاسبة لم تتغيّر منذ خمسين عاماً.
              <br />
              <span className="text-muted-foreground/70">حتى الآن.</span>
            </h2>
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <p className="text-lg leading-relaxed text-foreground/80">
              معظم برامج المحاسبة ورقة إلكترونية: تكتب فيها ما كنت ستكتبه على ورق.
              نحن نبدأ من السؤال الآخر — ماذا لو فهم النظام معاملاتك،
              وكتب القيود نيابةً عنك، وأخبرك بما يجب فعله غداً؟
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              الإجابة هي محاسب ذكي: نظام محاسبة كامل، مُتوافق مع IFRS، مع طبقة ذكاء
              اصطناعي تعمل من الجذور — لا فوقها.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border">
          {principles.map((p) => (
            <div key={p.n} className="bg-card p-8 lg:p-10">
              <div className="flex items-start gap-6">
                <div className="font-mono text-xs text-primary tracking-widest pt-1">{p.n}</div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-3 leading-snug">{p.t}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{p.b}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  4 · Core capabilities — Bento grid                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function CoreCapabilities() {
  return (
    <section id="capabilities" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-14">
          <div className="eyebrow mb-3">القدرات الأساسية</div>
          <h2 className="text-display text-foreground">
            كل ما تحتاجه لإدارة المالية. لا شيء غير ذلك.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            من الفاتورة الأولى حتى القائمة المالية المُدقَّقة. سبع دول. أربع عملات.
            معايير IFRS من الجذر.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 lg:gap-5">
          {/* Big card — Cockpit */}
          <BentoCard className="md:col-span-4 md:row-span-2">
            <div className="flex items-start justify-between">
              <div>
                <Badge variant="brand" size="sm" className="mb-3">المركز</Badge>
                <h3 className="text-2xl font-semibold text-foreground mb-2">كوكبت القرار</h3>
                <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                  مؤشرات الصحة المالية، التنبؤ النقدي، محاكي «ماذا لو»،
                  والتنبيهات الذكية — في مكان واحد.
                </p>
              </div>
              <BarChart3 className="size-5 text-primary/60" />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <MiniKPI label="نقاط الصحة" value="٨٤" delta="+6" positive compact />
              <MiniKPI label="السيولة" value="٢.٣x" delta="+0.2" positive compact />
              <MiniKPI label="التنبيهات" value="٣" delta="جديدة" compact warning />
            </div>
            <div className="mt-4 rounded-md border border-border bg-card p-3">
              <SparkChart compact />
            </div>
          </BentoCard>

          {/* Tall — AI assistant */}
          <BentoCard className="md:col-span-2 md:row-span-2">
            <Badge variant="brand" size="sm" className="mb-3">الذكاء</Badge>
            <h3 className="text-xl font-semibold text-foreground mb-2">المساعد المحاسبي</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              تحدّث بالعربية. صوّر فاتورتك. اطلب تقريراً.
            </p>
            <div className="mt-5 space-y-3">
              <ChatBubble role="user">سجّل ١٢٠٠ ر.س مصروفات تسويق نقداً</ChatBubble>
              <ChatBubble role="ai">تم. القيد #٢٤٧٨ متوازن، رصيد التسويق هذا الشهر ٤,١٠٠ ر.س.</ChatBubble>
            </div>
          </BentoCard>

          {/* Wide — Localization */}
          <BentoCard className="md:col-span-3">
            <div className="flex items-start gap-4">
              <Globe2 className="size-5 text-primary/60 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">سبع دول، حزمة محلية لكل واحدة</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  ضريبة القيمة المضافة، الزكاة، التأمينات الاجتماعية، صيغ نهاية الخدمة،
                  عُطل العمل والتقويم الهجري — مُهيّأة لكل دولة.
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {["السعودية", "الإمارات", "مصر", "الكويت", "قطر", "الأردن", "International"].map((c) => (
                    <span key={c} className="text-2xs px-2 py-1 rounded border border-border text-muted-foreground bg-background">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </BentoCard>

          {/* Wide — Fixed assets */}
          <BentoCard className="md:col-span-3">
            <div className="flex items-start gap-4">
              <Briefcase className="size-5 text-primary/60 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">الأصول الثابتة بمعايير IFRS</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  دورة حياة كاملة: اقتناء، إهلاك، إعادة تقييم، اضمحلال، تخلّص.
                  جدولة آلية وأثر تدقيق غير قابل للتعديل.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3 text-2xs">
                  <div><div className="text-muted-foreground">طريقة الإهلاك</div><div className="font-mono text-foreground">قسط ثابت</div></div>
                  <div><div className="text-muted-foreground">العمر النافع</div><div className="font-mono text-foreground">٦٠ شهر</div></div>
                  <div><div className="text-muted-foreground">القيمة المتبقية</div><div className="font-mono text-foreground">٥,٠٠٠</div></div>
                </div>
              </div>
            </div>
          </BentoCard>

          {/* Small — Payroll */}
          <BentoCard className="md:col-span-2">
            <Users className="size-5 text-primary/60 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">الرواتب والموارد البشرية</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              IAS 19. تأمينات. مخصص نهاية الخدمة. قيد آلي شهري.
            </p>
          </BentoCard>

          {/* Small — Reports */}
          <BentoCard className="md:col-span-2">
            <ScrollText className="size-5 text-primary/60 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">القوائم المالية</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              الميزانية، الدخل، التدفقات النقدية — وفق IFRS فوراً.
            </p>
          </BentoCard>

          {/* Small — Multi-company */}
          <BentoCard className="md:col-span-2">
            <Wallet className="size-5 text-primary/60 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">شركات وعملات متعددة</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              توحيد، تحويل، عرض موحّد للمجموعة.
            </p>
          </BentoCard>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  5 · AI Assistant — split layout                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function AIAssistant() {
  return (
    <section id="ai" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Copy first in source so on RTL desktop it sits on the RIGHT (natural reading start),
              while the chat mockup falls to the LEFT — varying rhythm vs. the hero. */}
          <div className="lg:col-span-5 lg:col-start-8">
            <Badge variant="brand" size="md" className="mb-4">
              <Bot className="size-3.5" />
              المساعد المحاسبي
            </Badge>
            <h2 className="text-display text-foreground mb-5">
              تحدّث بالعربية،
              <br />
              يفهم محاسبتك.
            </h2>
            <p className="text-lg leading-relaxed text-muted-foreground mb-6">
              مساعد ذكي مدرّب على معايير IFRS وعلى محاسبة عملك بالذات. يُسجّل القيود من نص أو صورة،
              يجيبك عن أسئلتك المالية، ويتنبّأ بما يجب فعله.
            </p>
            <ul className="space-y-3.5">
              {[
                ["قيود من اللغة الطبيعية", "اكتب «دفعت ٣٠٠ مقابل قهوة» — يصنّف ويسجّل."],
                ["تحليل من الصور", "ارفع فاتورة، يستخرج البيانات ويُنشئ القيد."],
                ["محاكاة آنية", "اسأل «ماذا لو زادت الرواتب ١٠٪؟» — تحصل على الجواب فوراً."],
                ["شفافية كاملة", "كل اقتراح له سند: حساب، معيار IFRS، أو سياسة الشركة."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <Check className="size-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-foreground">{t}</div>
                    <div className="text-sm text-muted-foreground">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button variant="outline" asChild>
                <a href="#cta">جرّب المساعد الآن<ArrowLeft className="size-4" /></a>
              </Button>
            </div>
          </div>

          {/* Chat mockup — visual LEFT side on RTL desktop */}
          <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1">
            <BrowserFrame title="assistant · محاسب ذكي" subtle>
              <div className="p-5 space-y-4">
                <ChatBubble role="user">
                  ارفقت صورة فاتورة كهرباء بمبلغ ٤٥٠ ر.س. سجّلها وقل لي أين نقف من ميزانية المرافق.
                </ChatBubble>
                <ChatBubble role="ai">
                  تم. أنشأت القيد <span className="font-mono text-primary">#٢٤٨١</span>:
                  <div className="mt-3 rounded border border-border overflow-hidden">
                    <table className="w-full text-2xs">
                      <tbody>
                        <tr className="border-b border-border/60 bg-muted/30">
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">5210</td>
                          <td className="px-3 py-1.5">مصروفات مرافق</td>
                          <td className="px-3 py-1.5 font-mono text-end">٤٥٠.٠٠</td>
                          <td className="px-3 py-1.5 font-mono text-end text-muted-foreground">—</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">2110</td>
                          <td className="px-3 py-1.5">دائنون</td>
                          <td className="px-3 py-1.5 font-mono text-end text-muted-foreground">—</td>
                          <td className="px-3 py-1.5 font-mono text-end">٤٥٠.٠٠</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 text-xs text-foreground/80">
                    ميزانية المرافق هذا الشهر: <span className="font-mono">١,٨٢٠ / ٢,٥٠٠</span> · متبقّي ٢٧٪.
                  </div>
                </ChatBubble>
                <ChatBubble role="user">احسب لي تأثير زيادة الرواتب ١٠٪ على التدفق النقدي.</ChatBubble>
                <ChatBubble role="ai" typing />
              </div>
            </BrowserFrame>
          </div>

          {/* Copy */}
          <div className="lg:col-span-5 order-1 lg:order-2">
            <Badge variant="brand" size="md" className="mb-4">
              <Bot className="size-3.5" />
              المساعد المحاسبي
            </Badge>
            <h2 className="text-display text-foreground mb-5">
              تحدّث بالعربية،
              <br />
              يفهم محاسبتك.
            </h2>
            <p className="text-lg leading-relaxed text-muted-foreground mb-6">
              مساعد ذكي مدرّب على معايير IFRS وعلى محاسبة عملك بالذات. يُسجّل القيود من نص أو صورة،
              يجيبك عن أسئلتك المالية، ويتنبّأ بما يجب فعله.
            </p>
            <ul className="space-y-3.5">
              {[
                ["قيود من اللغة الطبيعية", "اكتب «دفعت ٣٠٠ مقابل قهوة» — يصنّف ويسجّل."],
                ["تحليل من الصور", "ارفع فاتورة، يستخرج البيانات ويُنشئ القيد."],
                ["محاكاة آنية", "اسأل «ماذا لو زادت الرواتب ١٠٪؟» — تحصل على الجواب فوراً."],
                ["شفافية كاملة", "كل اقتراح له سند: حساب، معيار IFRS، أو سياسة الشركة."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <Check className="size-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-foreground">{t}</div>
                    <div className="text-sm text-muted-foreground">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button variant="outline" asChild>
                <a href="#cta">جرّب المساعد الآن<ArrowLeft className="size-4" /></a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  6 · Dashboard showcase — full-bleed product preview                       */
/* ────────────────────────────────────────────────────────────────────────── */

function DashboardShowcase() {
  return (
    <section id="showcase" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="eyebrow mb-3">منتج حقيقي. ليس عرضاً.</div>
          <h2 className="text-display text-foreground">
            مركز قيادة مالي واحد
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            كل ما يحدث في عملك المالي — مرئي، مفهوم، قابل للقرار في ثوانٍ.
          </p>
        </div>

        <BrowserFrame title="cockpit · محاسب ذكي · Default Company" large>
          <div className="grid grid-cols-12 gap-4 p-5">
            {/* Sidebar mini */}
            <div className="col-span-2 space-y-1">
              {["الرئيسية", "المعاملات", "القيود", "التقارير", "الكوكبت", "الموارد البشرية", "الأصول", "الإعدادات"].map((l, i) => (
                <div
                  key={l}
                  className={cn(
                    "px-2.5 py-1.5 rounded text-2xs",
                    i === 4 ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                  )}
                >
                  {l}
                </div>
              ))}
            </div>
            {/* Main */}
            <div className="col-span-10 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <MiniKPI label="الإيرادات" value="٢٤٢,٣٠٠" delta="+8.4%" positive />
                <MiniKPI label="المصروفات" value="١٣٨,٧١٠" delta="-2.1%" />
                <MiniKPI label="صافي التدفق" value="١٠٣,٥٩٠" delta="+14.6%" positive highlight />
                <MiniKPI label="نقاط الصحة" value="٨٤/١٠٠" delta="ممتاز" positive />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 rounded-md border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="eyebrow mb-1">تدفق نقدي · توقّع ٩٠ يوم</div>
                      <div className="text-sm font-medium text-foreground">المسار الأرجح</div>
                    </div>
                    <Badge variant="success" size="sm">+١٤.٦٪</Badge>
                  </div>
                  <SparkChart />
                </div>
                <div className="rounded-md border border-border bg-card p-4">
                  <div className="eyebrow mb-2">تنبيهات</div>
                  <div className="space-y-2.5">
                    <AlertRow type="warning" label="فاتورة متأخرة" detail="مورد ٣ · ٤,٥٠٠ ر.س" />
                    <AlertRow type="info" label="موعد تأمينات" detail="بعد ٧ أيام" />
                    <AlertRow type="success" label="تحقّق ميزانية" detail="تسويق · ضمن الحد" />
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-primary/20 bg-accent/40 p-3 flex items-start gap-3">
                <Sparkles className="size-4 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-2xs leading-relaxed text-foreground/85">
                  <span className="font-medium text-foreground">رؤية المساعد: </span>
                  مصروفات السفر تجاوزت الميزانية الشهرية بنسبة ١٨٪. اقترح مراجعة سياسة الموافقات
                  للقيم فوق ٢,٠٠٠ ر.س.
                </div>
              </div>
            </div>
          </div>
        </BrowserFrame>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="status-dot bg-primary" />Cash Forecast</span>
          <span className="flex items-center gap-1.5"><span className="status-dot bg-primary" />Health Score</span>
          <span className="flex items-center gap-1.5"><span className="status-dot bg-primary" />What-If Simulator</span>
          <span className="flex items-center gap-1.5"><span className="status-dot bg-primary" />Smart Alerts</span>
          <span className="flex items-center gap-1.5"><span className="status-dot bg-primary" />AI Coach</span>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  7 · Automation — flow + cases                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function Automation() {
  const flow = [
    { icon: <Receipt className="size-4" />, label: "ارفع الفاتورة" },
    { icon: <Bot className="size-4" />,     label: "AI يقرأ ويُصنّف" },
    { icon: <FileText className="size-4" />,label: "يُنشئ القيد" },
    { icon: <Workflow className="size-4" />,label: "يُحدّث الميزانية" },
    { icon: <BarChart3 className="size-4" />,label: "التقرير حيّ" },
  ]

  const cases = [
    {
      t: "فاتورة مورّد",
      d: "صورة → استخراج → قيد دائن/مدين متوازن في حسابك الصحيح، بدون نقرة واحدة.",
      m: "5210 / 2110 · ٤٥٠.٠٠",
    },
    {
      t: "موظف جديد",
      d: "ادخل البيانات مرة. الراتب الشهري، التأمينات (موظف/شركة)، ومخصص نهاية الخدمة كلها تُحتسب آلياً وفق IAS 19.",
      m: "6010 / 6011 / 6012",
    },
    {
      t: "أصل ثابت",
      d: "اقتنِ الأصل، حدد العمر النافع، يُجدول الإهلاك حتى آخر شهر تلقائياً وفق IFRS.",
      m: "1500 → 5500 / 1510",
    },
  ]

  return (
    <section id="automation" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-8 mb-14">
          <div className="lg:col-span-6">
            <div className="eyebrow mb-3">الأتمتة</div>
            <h2 className="text-display text-foreground">
              مهام تستهلك يومك. تختفي.
            </h2>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 self-end">
            <p className="text-base leading-relaxed text-muted-foreground">
              من اللحظة التي تصل فيها فاتورة إلى صندوقك، حتى ظهور الأثر في تقريرك المالي —
              لا خطوة يدوية واحدة في الوسط.
            </p>
          </div>
        </div>

        {/* Flow diagram */}
        <div className="rounded-xl border border-border bg-card p-6 lg:p-10 overflow-x-auto">
          <div className="flex items-center justify-between gap-3 min-w-[640px]">
            {flow.map((step, i) => (
              <div key={step.label} className="flex items-center gap-3 flex-1">
                <div className="flex flex-col items-center text-center flex-1">
                  <div className="size-10 rounded-full bg-accent text-accent-foreground border border-accent-border flex items-center justify-center mb-2.5">
                    {step.icon}
                  </div>
                  <div className="text-xs font-medium text-foreground">{step.label}</div>
                  <div className="font-mono text-2xs text-muted-foreground mt-1">0{i + 1}</div>
                </div>
                {i < flow.length - 1 && (
                  <div className="flex-shrink-0 w-8 h-px bg-border relative">
                    <ArrowLeft className="size-3 text-muted-foreground absolute -top-1.5 left-0" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Cases */}
        <div className="mt-10 grid md:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {cases.map((c) => (
            <div key={c.t} className="bg-card p-7">
              <h3 className="text-base font-semibold text-foreground mb-2">{c.t}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{c.d}</p>
              <div className="font-mono text-2xs text-primary border-t border-border/60 pt-3">{c.m}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  8 · Security                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

function Security() {
  const items = [
    {
      icon: <ShieldCheck className="size-5" />,
      t: "SOC 2 Type II",
      d: "تدقيق مستقلّ سنوي على ضوابط الأمان والتوفّر والسرية.",
      m: "Audited · Q1 2026",
    },
    {
      icon: <Lock className="size-5" />,
      t: "تشفير من طرف لطرف",
      d: "AES-256 للبيانات الساكنة، TLS 1.3 للبيانات أثناء النقل.",
      m: "AES-256 · TLS 1.3",
    },
    {
      icon: <ScrollText className="size-5" />,
      t: "أثر تدقيق وفق IFRS",
      d: "كل قيد له ختم زمني، مُستخدم، وسبب — غير قابل للتعديل.",
      m: "Immutable ledger",
    },
    {
      icon: <MapPin className="size-5" />,
      t: "بيانات مُقيمة في المنطقة",
      d: "خوادم في الرياض ودبي. ملكية البيانات لك، تصدير في أيّ وقت.",
      m: "RUH · DXB · Bahrain",
    },
  ]
  return (
    <section id="security" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 mb-14 items-end">
          <div className="lg:col-span-7">
            <div className="eyebrow mb-3">الأمان والثقة</div>
            <h2 className="text-display text-foreground">
              بياناتك المالية — مُؤمَّنة بمعايير المؤسسات.
            </h2>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="text-base leading-relaxed text-muted-foreground">
              لا اختصارات في الأمان. كل ما يلمسه الذكاء الاصطناعي يبقى ضمن بيئتك،
              غير مُتاح لتدريب نماذج خارجية.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border border-border">
          {items.map((it) => (
            <div key={it.t} className="bg-card p-7 lg:p-8">
              <div className="text-primary/70 mb-5">{it.icon}</div>
              <h3 className="text-base font-semibold text-foreground mb-2">{it.t}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-5">{it.d}</p>
              <div className="font-mono text-2xs uppercase tracking-widest text-muted-foreground pt-4 border-t border-border/60">
                {it.m}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  9 · Use cases — tabbed editorial                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function UseCases() {
  const personas = [
    {
      key: "founder",
      tab: "للمؤسّسين",
      headline: "تعرف رقم شركتك بدقّة، في أي لحظة.",
      quote: "«قبل محاسب ذكي، كنت أنتظر نهاية الشهر لأعرف هل ربحت أم خسرت. الآن أعرفها قبل أن أوافق على المصروف.»",
      author: "هاني الشمري · مؤسس، شركة لوجستيات",
      outcomes: [
        "نقاط صحة مالية محدّثة يومياً",
        "تنبؤ تدفق نقدي لـ ٩٠ يوماً قادمة",
        "محاكاة قرار قبل اتخاذه: «ماذا لو وظّفت ٣ مهندسين؟»",
        "ملخّص تنفيذي بالعربية يصلك كل أسبوع",
      ],
    },
    {
      key: "accountant",
      tab: "للمحاسبين",
      headline: "وقتك للقرار، لا للترحيل.",
      quote: "«الـ AI يكتب القيود، أنا أراجع. وفّرت ١٢ ساعة في الأسبوع. والقوائم تخرج مُتوازنة من المرة الأولى.»",
      author: "د. سارة العتيبي · CPA، مكتب محاسبة",
      outcomes: [
        "قيود مزدوجة آلية قابلة للمراجعة",
        "تطابق فوري بين الأستاذ العام والقوائم",
        "أثر تدقيق كامل لكل قيد ولكل تعديل",
        "تصدير مباشر للهيئة، ZATCA-ready",
      ],
    },
    {
      key: "team",
      tab: "للفرق المالية",
      headline: "فريق واحد. نظام واحد. مصدر حقيقة واحد.",
      quote: "«كنا نعمل في خمسة ملفات Excel. الآن CFO يفتح نفس الكوكبت الذي يفتحه المحلل المالي ومسؤول الرواتب.»",
      author: "نورة العلي · CFO، شركة تقنية",
      outcomes: [
        "صلاحيات بحسب الدور (RBAC) مع سجل أنشطة",
        "موافقات متعدّدة المستويات على المدفوعات",
        "توحيد متعدد الشركات والعملات",
        "تقارير IFRS جاهزة للتدقيق فوراً",
      ],
    },
  ]
  const [active, setActive] = useState(personas[0].key)
  const current = personas.find((p) => p.key === active)!

  return (
    <section id="use-cases" className="py-24 lg:py-32 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-12">
          <div className="eyebrow mb-3">من يستخدم محاسب ذكي</div>
          <h2 className="text-display text-foreground">منتج واحد. ثلاثة فِرق. نتيجة واحدة: وضوح.</h2>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="فئات المستخدمين" className="flex flex-wrap gap-1 border-b border-border mb-10">
          {personas.map((p, i) => {
            const selected = active === p.key
            return (
              <button
                key={p.key}
                id={`persona-tab-${p.key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`persona-panel-${p.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(p.key)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
                  e.preventDefault()
                  // RTL: ArrowLeft = next, ArrowRight = previous
                  const dir = e.key === "ArrowLeft" ? 1 : -1
                  const next = (i + dir + personas.length) % personas.length
                  setActive(personas[next].key)
                  document.getElementById(`persona-tab-${personas[next].key}`)?.focus()
                }}
                data-testid={`tab-persona-${p.key}`}
                className={cn(
                  "px-5 py-3 text-sm font-medium -mb-px border-b-2 transition-colors outline-none",
                  selected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {p.tab}
              </button>
            )
          })}
        </div>

        <div
          id={`persona-panel-${current.key}`}
          role="tabpanel"
          aria-labelledby={`persona-tab-${current.key}`}
          className="grid lg:grid-cols-12 gap-12 animate-fade-in"
          key={current.key}
        >
          <div className="lg:col-span-7">
            <h3 className="text-2xl lg:text-3xl font-semibold text-foreground tracking-tight leading-snug mb-6">
              {current.headline}
            </h3>
            <blockquote className="border-r-2 border-primary pr-5 mb-6">
              <p className="text-lg leading-relaxed text-foreground/80 italic">{current.quote}</p>
              <footer className="mt-3 text-sm text-muted-foreground">{current.author}</footer>
            </blockquote>
          </div>
          <div className="lg:col-span-5">
            <div className="eyebrow mb-4">النتائج</div>
            <ul className="space-y-3.5">
              {current.outcomes.map((o) => (
                <li key={o} className="flex gap-3 text-sm text-foreground/85 leading-relaxed">
                  <Check className="size-4 text-primary flex-shrink-0 mt-1" />
                  {o}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 10 · FAQ                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function FAQ() {
  const qs = [
    {
      q: "هل النظام مُتوافق فعلاً مع IFRS؟",
      a: "نعم. النظام مبني على الأساس وفق IFRS: قيد مزدوج إجباري، شجرة حسابات قياسية، اعتراف بالإيراد، إهلاك الأصول، مخصص نهاية الخدمة (IAS 19)، وقوائم مالية تُولَّد آلياً. كل دولة لها حزمة محلية فوق هذا الأساس.",
    },
    {
      q: "هل بياناتي تُستخدم لتدريب نماذج الذكاء الاصطناعي؟",
      a: "لا. بياناتك ملكك. الذكاء الاصطناعي يعمل ضمن بيئتك ولا يُشارك أيّ معلومة مع نماذج خارجية لأغراض تدريب. هذا مكتوب في عقد الخدمة وقابل للتدقيق.",
    },
    {
      q: "ما الدول المدعومة؟",
      a: "حالياً: السعودية، الإمارات، مصر، الكويت، قطر، الأردن، وحزمة International. كل حزمة تشمل: العملة، ضريبة القيمة المضافة، الزكاة (حيث تنطبق)، التأمينات، صيغة نهاية الخدمة، عُطل العمل، والتقويم.",
    },
    {
      q: "كم يستغرق التركيب؟",
      a: "أقل من خمس دقائق للحساب الأول. اختر الدولة، أنشئ الشركة، وستجد شجرة الحسابات IFRS جاهزة. الفِرق الكبيرة عادةً تستكمل الإعداد الكامل (ربط البنوك، استيراد البيانات، الصلاحيات) خلال يومين.",
    },
    {
      q: "هل يُمكن استيراد بياناتي من نظام آخر؟",
      a: "نعم. نستورد من Excel، QuickBooks، Xero، Zoho Books، وSAP. خلال الاستيراد، الـ AI يفحص الترميز ويقترح المطابقات لشجرة الحسابات IFRS لديك.",
    },
    {
      q: "هل النظام يدعم التدقيق الخارجي؟",
      a: "نعم. الأثر التدقيقي كامل وغير قابل للتعديل، مع إمكانية إنشاء حساب «مدقّق خارجي» بصلاحيات قراءة فقط لكامل القيود والمستندات الداعمة.",
    },
  ]
  return (
    <section id="faq" className="py-24 lg:py-32 bg-card/30 border-b border-border">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="eyebrow mb-3">الأسئلة الشائعة</div>
          <h2 className="text-display text-foreground">سؤال صريح، إجابة صريحة.</h2>
        </div>
        <Accordion type="single" collapsible className="border-t border-border">
          {qs.map((item, i) => (
            <AccordionItem key={i} value={`q-${i}`} className="border-b border-border">
              <AccordionTrigger className="text-start py-5 text-base font-medium text-foreground hover:no-underline">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="pb-6 text-sm text-muted-foreground leading-relaxed">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 11 · Final CTA                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section id="cta" className="py-24 lg:py-32 scroll-mt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-bl from-primary/[0.08] via-background to-background p-10 lg:p-16">
          {/* Decorative grid */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <h2 className="text-display-lg text-foreground">
                ابدأ بإدارة ماليتك
                <br />
                <span className="text-primary">بطريقة تستحقّها.</span>
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground max-w-xl">
                ١٤ يوماً مجاناً. كل المميزات. بدون بطاقة. ألغِ في أي لحظة.
              </p>
            </div>
            <div className="lg:col-span-5 lg:text-end">
              <div className="flex flex-wrap lg:justify-end gap-3">
                <Button size="xl" data-testid="button-final-cta" asChild>
                  <a href="mailto:hello@accounting.app?subject=ابدأ تجربتي المجانية" className="gap-2">
                    ابدأ مجاناً
                    <ArrowLeft className="size-4" />
                  </a>
                </Button>
                <Button size="xl" variant="outline" asChild>
                  <a href="mailto:sales@accounting.app?subject=طلب عرض">تحدّث مع المبيعات</a>
                </Button>
              </div>
              <div className="mt-5 text-xs text-muted-foreground lg:text-end">
                أو شاهد <a href="#showcase" className="text-primary underline-offset-4 hover:underline">عرضاً مدّته ٣ دقائق</a>.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helper components                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function BrowserFrame({
  children, title, subtle = false, large = false,
}: { children: React.ReactNode; title: string; subtle?: boolean; large?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        subtle ? "shadow-md" : large ? "shadow-xl" : "shadow-lg",
      )}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex-1 text-center font-mono text-2xs text-muted-foreground tracking-wide">
          {title}
        </div>
        <div className="size-2.5" />
      </div>
      {children}
    </div>
  )
}

function MiniKPI({
  label, value, delta, positive, highlight, compact, warning,
}: {
  label: string; value: string; delta?: string;
  positive?: boolean; highlight?: boolean; compact?: boolean; warning?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        highlight
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border",
      )}
    >
      <div className={cn("text-2xs", highlight ? "text-background/70" : "text-muted-foreground")}>{label}</div>
      <div className={cn(
        "font-semibold tabular-nums tracking-tight mt-0.5",
        compact ? "text-base" : "text-xl",
      )}>
        {value}
      </div>
      {delta && (
        <div className={cn(
          "text-2xs mt-1 font-mono",
          warning && !highlight ? "text-warning"
            : positive && !highlight ? "text-success"
            : highlight ? "text-background/70"
            : "text-muted-foreground"
        )}>
          {delta}
        </div>
      )}
    </div>
  )
}

function SparkChart({ compact = false }: { compact?: boolean }) {
  // Hand-drawn SVG sparkline — no chart library noise
  const h = compact ? 40 : 80
  return (
    <svg viewBox={`0 0 320 ${h}`} className="w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={compact
          ? "M0 30 L40 28 L80 22 L120 24 L160 16 L200 18 L240 12 L280 8 L320 4 L320 40 L0 40 Z"
          : "M0 60 L40 55 L80 48 L120 52 L160 36 L200 42 L240 28 L280 18 L320 10 L320 80 L0 80 Z"}
        fill="url(#sparkFill)"
      />
      <path
        d={compact
          ? "M0 30 L40 28 L80 22 L120 24 L160 16 L200 18 L240 12 L280 8 L320 4"
          : "M0 60 L40 55 L80 48 L120 52 L160 36 L200 42 L240 28 L280 18 L320 10"}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ChatBubble({
  role, children, typing,
}: { role: "user" | "ai"; children?: React.ReactNode; typing?: boolean }) {
  const isAI = role === "ai"
  return (
    <div className={cn("flex", isAI ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
          isAI
            ? "bg-card border border-border text-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {typing ? (
          <span className="inline-flex gap-1 py-1">
            <span className="size-1.5 rounded-full bg-current opacity-40 animate-pulse" />
            <span className="size-1.5 rounded-full bg-current opacity-60 animate-pulse [animation-delay:120ms]" />
            <span className="size-1.5 rounded-full bg-current opacity-80 animate-pulse [animation-delay:240ms]" />
          </span>
        ) : children}
      </div>
    </div>
  )
}

function FloatingChip({
  icon, title, subtitle, accent,
}: { icon: React.ReactNode; title: string; subtitle: string; accent?: "success" }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-md px-3 py-2.5 flex items-center gap-2.5 backdrop-blur">
      <div className={cn(
        "size-7 rounded-md flex items-center justify-center",
        accent === "success"
          ? "bg-success/10 text-success border border-success/20"
          : "bg-accent text-accent-foreground border border-accent-border"
      )}>
        {icon}
      </div>
      <div>
        <div className="text-xs font-medium text-foreground leading-tight">{title}</div>
        <div className="text-2xs text-muted-foreground leading-tight mt-0.5">{subtitle}</div>
      </div>
    </div>
  )
}

function Metric({ value, label, mono }: { value: string; label: string; mono?: boolean }) {
  return (
    <div className="bg-card p-5 lg:p-6">
      <div className={cn(
        "text-2xl lg:text-3xl font-semibold text-foreground tabular-nums tracking-tight",
        mono && "font-mono"
      )}>
        {value}
      </div>
      <div className="text-2xs text-muted-foreground mt-1.5 uppercase tracking-widest">{label}</div>
    </div>
  )
}

function BentoCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "rounded-xl border border-card-border bg-card p-6 lg:p-7 shadow-xs hover:shadow-sm transition-shadow",
      className
    )}>
      {children}
    </div>
  )
}

function AlertRow({ type, label, detail }: {
  type: "warning" | "info" | "success"; label: string; detail: string
}) {
  const dotColor =
    type === "warning" ? "bg-warning" :
    type === "info" ? "bg-info" :
    "bg-success"
  const Icon =
    type === "warning" ? AlertTriangle :
    type === "info" ? Database :
    Check
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn("status-dot mt-1.5 flex-shrink-0", dotColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-2xs text-foreground font-medium truncate">{label}</div>
        <div className="text-2xs text-muted-foreground truncate mt-0.5">{detail}</div>
      </div>
      <Icon className="size-3 text-muted-foreground flex-shrink-0 mt-1" />
    </div>
  )
}
