import { Brand } from "./Brand"
import { cn } from "@/lib/utils"
import { useLocale } from "@/contexts/locale-context"

/**
 * AppFooter — restrained, multi-column, hairline-separated footer.
 *
 * Premium fintech footers (Stripe, Mercury, Brex) share three traits:
 *   1. The footer is *quiet* — it doesn't try to be a second homepage.
 *   2. Columns are aligned on a strict grid with eyebrow-style labels.
 *   3. The legal/meta bar at the bottom is set apart by a hairline rule.
 *
 * Localized via `useLocale()`: copy and link labels switch between AR
 * and EN based on the current locale; callers may override by passing
 * `columns` explicitly.
 */

interface FooterLink { label: string; href: string }
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
        { label: "المنصة",                  href: "#platform" },
        { label: "الفواتير",                 href: "#invoicing" },
        { label: "المحاسبة",                 href: "#accounting" },
        { label: "الرواتب والموارد البشرية", href: "#payroll" },
        { label: "الأصول الثابتة",           href: "#assets" },
        { label: "التقارير المالية",         href: "#reports" },
      ] : [
        { label: "Platform",            href: "#platform" },
        { label: "Invoicing",           href: "#invoicing" },
        { label: "Accounting",          href: "#accounting" },
        { label: "Payroll & HR",        href: "#payroll" },
        { label: "Fixed assets",        href: "#assets" },
        { label: "Financial reports",   href: "#reports" },
      ],
    },
    {
      title: ar ? "الذكاء الاصطناعي" : "Intelligence",
      links: ar ? [
        { label: "المساعد المحاسبي", href: "#assistant" },
        { label: "كوكبت القرار",      href: "#cockpit" },
        { label: "تحليلات تنبؤية",    href: "#forecast" },
      ] : [
        { label: "Accounting assistant", href: "#assistant" },
        { label: "Decision cockpit",     href: "#cockpit" },
        { label: "Predictive analytics", href: "#forecast" },
      ],
    },
    {
      title: ar ? "الدول" : "Countries",
      links: ar ? [
        { label: "السعودية",    href: "#sa" },
        { label: "الإمارات",     href: "#ae" },
        { label: "مصر",          href: "#eg" },
        { label: "الكويت",       href: "#kw" },
        { label: "قطر",           href: "#qa" },
        { label: "الأردن",        href: "#jo" },
        { label: "International", href: "#intl" },
      ] : [
        { label: "Saudi Arabia",  href: "#sa" },
        { label: "UAE",           href: "#ae" },
        { label: "Egypt",         href: "#eg" },
        { label: "Kuwait",        href: "#kw" },
        { label: "Qatar",         href: "#qa" },
        { label: "Jordan",        href: "#jo" },
        { label: "International", href: "#intl" },
      ],
    },
    {
      title: ar ? "الشركة" : "Company",
      links: ar ? [
        { label: "من نحن",    href: "#about" },
        { label: "العملاء",    href: "#customers" },
        { label: "المدوّنة",   href: "#blog" },
        { label: "الوظائف",    href: "#careers" },
        { label: "تواصل معنا", href: "#contact" },
      ] : [
        { label: "About",     href: "#about" },
        { label: "Customers", href: "#customers" },
        { label: "Blog",      href: "#blog" },
        { label: "Careers",   href: "#careers" },
        { label: "Contact",   href: "#contact" },
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
    ? "نظام محاسبيّ ذكيّ، مبنيّ وفق IFRS، عربيّ في الجوهر، يمنح الشركة الحديثة مركز قيادة ماليّ واحداً — من أوّل فاتورة إلى آخر تقرير."
    : "An IFRS-grade, AI-native accounting system that gives the modern business one financial command center — from invoices to insight.")
  const privacy  = ar ? "الخصوصيّة" : "Privacy"
  const terms    = ar ? "الشروط" : "Terms"
  const security = ar ? "الأمان" : "Security"

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
          {/* Brand column */}
          <div className="col-span-2 md:col-span-4">
            <Brand size="lg" withTagline />
            <p className="mt-5 max-w-sm text-small leading-relaxed text-muted-foreground">
              {resolvedTagline}
            </p>
          </div>

          {/* Link columns */}
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

        {/* Hairline + meta bar */}
        <div className="mt-14 pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-caption text-muted-foreground">
            <span>© {year} {brandName}</span>
            <span className="opacity-40">·</span>
            <span className="font-mono tracking-wider uppercase">IFRS-Compliant</span>
            <span className="opacity-40">·</span>
            <span className="font-mono tracking-wider uppercase">SOC 2 · Type II</span>
          </div>
          <div className="flex items-center gap-5 text-small text-muted-foreground">
            <a href="#privacy"  className="hover:text-foreground transition-colors duration-150" data-testid="link-footer-privacy">{privacy}</a>
            <a href="#terms"    className="hover:text-foreground transition-colors duration-150" data-testid="link-footer-terms">{terms}</a>
            <a href="#security" className="hover:text-foreground transition-colors duration-150" data-testid="link-footer-security">{security}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
