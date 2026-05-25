import { Brand } from "./Brand"
import { cn } from "@/lib/utils"
import { useLocale } from "@/contexts/locale-context"

interface FooterLink   { label: string; href: string }
interface FooterColumn { title: string; links: FooterLink[] }
interface AppFooterProps {
  columns?: FooterColumn[]
  tagline?: string
  className?: string
}

function defaultColumns(ar: boolean): FooterColumn[] {
  return [
    {
      title: ar ? "المنتج" : "Product",
      links: ar ? [
        { label: "المنصة",                   href: "/platform" },
        { label: "الفواتير",                  href: "/product/invoices" },
        { label: "المحاسبة",                  href: "/product/accounting" },
        { label: "الرواتب والموارد البشرية",  href: "/product/hr" },
        { label: "الأصول الثابتة",            href: "/product/fixed-assets" },
        { label: "التقارير المالية",          href: "/product/reports" },
      ] : [
        { label: "Platform",            href: "/platform" },
        { label: "Invoicing",           href: "/product/invoices" },
        { label: "Accounting",          href: "/product/accounting" },
        { label: "Payroll & HR",        href: "/product/hr" },
        { label: "Fixed Assets",        href: "/product/fixed-assets" },
        { label: "Financial Reports",   href: "/product/reports" },
      ],
    },
    {
      title: ar ? "الذكاء الاصطناعي" : "Intelligence",
      links: ar ? [
        { label: "المساعد المحاسبي", href: "/ai/assistant" },
        { label: "كوكبت القرار",      href: "/ai/cockpit" },
        { label: "تحليلات تنبؤية",    href: "/ai/predictive" },
      ] : [
        { label: "AI Assistant",         href: "/ai/assistant" },
        { label: "Decision Cockpit",     href: "/ai/cockpit" },
        { label: "Predictive Analytics", href: "/ai/predictive" },
      ],
    },
    {
      title: ar ? "الدول" : "Countries",
      links: ar ? [
        { label: "السعودية",    href: "/countries/sa" },
        { label: "الإمارات",    href: "/countries/ae" },
        { label: "مصر",         href: "/countries/eg" },
        { label: "الكويت",      href: "/countries/kw" },
        { label: "قطر",         href: "/countries/qa" },
        { label: "الأردن",      href: "/countries/jo" },
        { label: "International", href: "/countries/international" },
      ] : [
        { label: "Saudi Arabia",  href: "/countries/sa" },
        { label: "UAE",           href: "/countries/ae" },
        { label: "Egypt",         href: "/countries/eg" },
        { label: "Kuwait",        href: "/countries/kw" },
        { label: "Qatar",         href: "/countries/qa" },
        { label: "Jordan",        href: "/countries/jo" },
        { label: "International", href: "/countries/international" },
      ],
    },
    {
      title: ar ? "الشركة" : "Company",
      links: ar ? [
        { label: "من نحن",     href: "/about" },
        { label: "العملاء",    href: "/customers" },
        { label: "المدوّنة",   href: "/blog" },
        { label: "الوظائف",    href: "/jobs" },
        { label: "تواصل معنا", href: "/contact" },
      ] : [
        { label: "About",     href: "/about" },
        { label: "Customers", href: "/customers" },
        { label: "Blog",      href: "/blog" },
        { label: "Jobs",      href: "/jobs" },
        { label: "Contact",   href: "/contact" },
      ],
    },
  ]
}

export function AppFooter({ columns, tagline, className }: AppFooterProps) {
  const { locale } = useLocale()
  const ar = locale === "ar"
  const cols = columns ?? defaultColumns(ar)
  const year = new Date().getFullYear()
  const brandName = ar ? "محاسب ذكي" : "Smart Accountant"
  const resolvedTagline = tagline ?? (ar
    ? "نظام محاسبيّ ذكيّ، مبنيّ وفق IFRS، عالميّ في الجوهر، يمنح الشركة الحديثة مركز قيادة ماليّ واحداً — من أوّل فاتورة إلى آخر تقرير."
    : "An IFRS-grade, AI-native accounting system that gives the modern business one financial command center — from invoices to insight.")
  const privacy  = ar ? "الخصوصيّة" : "Privacy"
  const terms    = ar ? "الشروط"     : "Terms"
  const security = ar ? "الأمان"     : "Security"

  return (
    <footer
      data-testid="app-footer"
      className={cn(
        "mt-24 border-t border-border bg-background",
        className
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-12">
          <div className="col-span-2 md:col-span-4">
            <Brand size="lg" withTagline />
            <p className="mt-5 max-w-sm text-small leading-relaxed text-muted-foreground">
              {resolvedTagline}
            </p>
          </div>

          {cols.map((col) => (
            <div key={col.title} className="md:col-span-2">
              <div className="eyebrow mb-4">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      data-testid={`link-footer-${l.label}`}
                      className="text-small text-foreground/75 hover:text-foreground transition-colors duration-150"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-caption text-muted-foreground">
            <span>© {year} {brandName}</span>
            <span className="opacity-40">·</span>
            <span className="font-mono tracking-wider uppercase">IFRS-Compliant</span>
            <span className="opacity-40">·</span>
            <span className="font-mono tracking-wider uppercase">SOC 2 · Type II</span>
          </div>
          <div className="flex items-center gap-5 text-small text-muted-foreground">
            <a href="/privacy"  className="hover:text-foreground transition-colors duration-150" data-testid="link-footer-privacy">{privacy}</a>
            <a href="/terms"    className="hover:text-foreground transition-colors duration-150" data-testid="link-footer-terms">{terms}</a>
            <a href="/security" className="hover:text-foreground transition-colors duration-150" data-testid="link-footer-security">{security}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
