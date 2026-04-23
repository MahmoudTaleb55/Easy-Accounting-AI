import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Mail } from "lucide-react";
import { AppNavbar } from "@/components/layout/AppNavbar";
import { AppFooter } from "@/components/layout/AppFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/contexts/locale-context";

const COPY = {
  ar: {
    eyebrow: "احجز عرضاً مباشراً",
    title: "اعرض محاسب ذكي على فريقك المالي.",
    sub: "خصصنا 30 دقيقة لنريك كيف تُسجَّل القيود تلقائياً، كيف يقفل الشهر بنفسه، وكيف يبدو ملف ZATCA الجاهز.",
    name: "الاسم الكامل",
    email: "البريد المهني",
    company: "اسم الشركة",
    employees: "عدد الموظفين",
    notes: "ما الذي تريد معالجته في الجلسة؟",
    submit: "اطلب موعد العرض",
    fallback: "نفضّل البريد؟",
    fallbackEmail: "اكتب لنا على sales@accounting.app",
    success: "تم استلام طلبك",
    successBody: "سيتواصل معك أحد متخصصينا خلال يوم عمل واحد لتأكيد موعد الجلسة.",
    back: "العودة للرئيسية",
  },
  en: {
    eyebrow: "Book a live walkthrough",
    title: "See the platform in action with your finance team.",
    sub: "30 minutes. We'll show how journal entries post themselves, how the month closes itself, and what a ZATCA-ready file looks like.",
    name: "Full name",
    email: "Work email",
    company: "Company",
    employees: "Team size",
    notes: "What would you like to cover?",
    submit: "Request a session",
    fallback: "Prefer email?",
    fallbackEmail: "Write to sales@accounting.app",
    success: "Your request was received",
    successBody: "A specialist will reach out within one business day to confirm the session.",
    back: "Back to home",
  },
};

export default function DemoPage() {
  const { locale, dir } = useLocale();
  const t = COPY[locale];
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    employees: "",
    notes: "",
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Stub: open mailto with prefilled body. No backend dependency.
    const subject = encodeURIComponent(
      locale === "ar" ? "طلب عرض — محاسب ذكي" : "Demo request — Accounting Platform"
    );
    const body = encodeURIComponent(
      `${t.name}: ${form.name}\n${t.email}: ${form.email}\n${t.company}: ${form.company}\n${t.employees}: ${form.employees}\n\n${t.notes}:\n${form.notes}`
    );
    window.location.href = `mailto:sales@accounting.app?subject=${subject}&body=${body}`;
    setSubmitted(true);
  }

  return (
    <div className="bg-background text-foreground min-h-screen flex flex-col" dir={dir}>
      <AppNavbar />
      <main className="flex-1">
        <section className="relative overflow-hidden brand-grain">
          <div
            aria-hidden
            className="absolute inset-0 -z-0 brand-mesh pointer-events-none"
            style={{
              WebkitMaskImage:
                "radial-gradient(75% 65% at 25% 20%, black, transparent)",
              maskImage:
                "radial-gradient(75% 65% at 25% 20%, black, transparent)",
            }}
          />
          <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
            <div className="lg:col-span-5">
              <div className="eyebrow mb-3">{t.eyebrow}</div>
              <h1 className="text-display text-foreground">{t.title}</h1>
              <p className="mt-5 text-base leading-relaxed text-muted-foreground">{t.sub}</p>

              <div className="mt-10 rounded-lg border border-border bg-card/50 p-5">
                <div className="text-xs text-muted-foreground mb-1">{t.fallback}</div>
                <a
                  href="mailto:sales@accounting.app"
                  data-testid="link-demo-mailto"
                  className="inline-flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors"
                >
                  <Mail className="size-4" />
                  {t.fallbackEmail}
                </a>
              </div>
            </div>

            <div className="lg:col-span-7">
              {submitted ? (
                <div
                  data-testid="demo-success"
                  className="rounded-xl border border-border bg-card p-8 lg:p-10 shadow-sm"
                >
                  <div className="size-10 rounded-full bg-success/10 text-success flex items-center justify-center mb-4">
                    <Check className="size-5" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground">{t.success}</h2>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t.successBody}</p>
                  <div className="mt-6">
                    <Button variant="outline" asChild>
                      <Link href="/" data-testid="link-back-home" className="gap-2">
                        <ArrowLeft className="size-4" />
                        {t.back}
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  data-testid="form-demo"
                  className="rounded-xl border border-border bg-card p-6 lg:p-8 shadow-sm space-y-4"
                >
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="demo-name">{t.name}</Label>
                      <Input
                        id="demo-name"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="mt-1.5"
                        data-testid="input-demo-name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="demo-email">{t.email}</Label>
                      <Input
                        id="demo-email"
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="mt-1.5"
                        data-testid="input-demo-email"
                      />
                    </div>
                    <div>
                      <Label htmlFor="demo-company">{t.company}</Label>
                      <Input
                        id="demo-company"
                        required
                        value={form.company}
                        onChange={(e) => setForm({ ...form, company: e.target.value })}
                        className="mt-1.5"
                        data-testid="input-demo-company"
                      />
                    </div>
                    <div>
                      <Label htmlFor="demo-employees">{t.employees}</Label>
                      <Input
                        id="demo-employees"
                        value={form.employees}
                        onChange={(e) => setForm({ ...form, employees: e.target.value })}
                        className="mt-1.5"
                        data-testid="input-demo-employees"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="demo-notes">{t.notes}</Label>
                    <Textarea
                      id="demo-notes"
                      rows={4}
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="mt-1.5"
                      data-testid="input-demo-notes"
                    />
                  </div>
                  <div className="pt-2">
                    <Button type="submit" size="lg" data-testid="button-demo-submit" className="gap-2">
                      {t.submit}
                      <ArrowLeft className="size-4" />
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
          </div>
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
