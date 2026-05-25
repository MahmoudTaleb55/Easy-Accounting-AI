import { MarketingLayout, MarketingHero } from "./shared"
import { useLocale } from "@/contexts/locale-context"
import { useState } from "react"

export default function ContactPage() {
  const { locale } = useLocale()
  const ar = locale === "ar"
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSent(true)
  }

  return (
    <MarketingLayout>
      <MarketingHero
        eyebrow={ar ? "تواصل معنا" : "Contact"}
        title={ar ? "نحن هنا لمساعدتك" : "We're here to help"}
        subtitle={ar
          ? "سواء كنت تريد تجربة المنتج، أو لديك سؤال تقنيّ، أو تبحث عن عرض للمؤسّسات — فريقنا يردّ في غضون يوم عمل."
          : "Whether you want to try the product, have a technical question, or are looking for an enterprise quote — our team responds within one business day."}
      />

      <section className="py-10 max-w-2xl mx-auto">
        {sent ? (
          <div className="rounded-xl border border-card-border bg-card p-10 text-center">
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              {ar ? "شكراً! استلمنا رسالتك." : "Thanks! We received your message."}
            </h2>
            <p className="text-muted-foreground">
              {ar ? "سيتواصل معك فريقنا خلال يوم عمل واحد." : "Our team will reach out within one business day."}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-xl border border-card-border bg-card p-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-small font-medium text-foreground mb-1.5">
                  {ar ? "الاسم الكامل *" : "Full name *"}
                </label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-card-border bg-background text-foreground text-small focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder={ar ? "محمد الأحمد" : "Jane Smith"}
                  data-testid="input-contact-name"
                />
              </div>
              <div>
                <label className="block text-small font-medium text-foreground mb-1.5">
                  {ar ? "البريد الإلكترونيّ *" : "Email *"}
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-card-border bg-background text-foreground text-small focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="you@company.com"
                  data-testid="input-contact-email"
                />
              </div>
            </div>
            <div>
              <label className="block text-small font-medium text-foreground mb-1.5">
                {ar ? "الشركة" : "Company"}
              </label>
              <input
                value={form.company}
                onChange={e => setForm({ ...form, company: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-card-border bg-background text-foreground text-small focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={ar ? "شركة النجمة للتقنية" : "Acme Corp"}
                data-testid="input-contact-company"
              />
            </div>
            <div>
              <label className="block text-small font-medium text-foreground mb-1.5">
                {ar ? "رسالتك *" : "Your message *"}
              </label>
              <textarea
                required
                rows={5}
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-card-border bg-background text-foreground text-small focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                placeholder={ar ? "كيف يمكننا مساعدتك؟" : "How can we help you?"}
                data-testid="input-contact-message"
              />
            </div>
            <button
              type="submit"
              data-testid="button-contact-submit"
              className="w-full h-10 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border hover:opacity-90 transition-opacity"
            >
              {ar ? "أرسل الرسالة" : "Send message"}
            </button>
          </form>
        )}

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          {[
            { icon: "💬", labelAr: "دردشة مباشرة",   labelEn: "Live chat",   descAr: "من داخل التطبيق", descEn: "Inside the app" },
            { icon: "📧", labelAr: "بريد إلكترونيّ", labelEn: "Email",       descAr: "hello@smartacc.io", descEn: "hello@smartacc.io" },
            { icon: "📅", labelAr: "اجتماع مُجدوَل", labelEn: "Book a call", descAr: "للمنشآت الكبرى",  descEn: "For enterprises" },
          ].map((c) => (
            <div key={c.labelEn} className="rounded-xl border border-card-border bg-card p-4">
              <div className="text-2xl mb-2">{c.icon}</div>
              <div className="font-medium text-foreground">{ar ? c.labelAr : c.labelEn}</div>
              <div className="text-small text-muted-foreground">{ar ? c.descAr : c.descEn}</div>
            </div>
          ))}
        </div>
      </section>
    </MarketingLayout>
  )
}
