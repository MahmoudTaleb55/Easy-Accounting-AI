import { Brand } from "./Brand"
import { cn } from "@/lib/utils"

/**
 * AppFooter — restrained, multi-column, hairline-separated footer.
 *
 * Premium fintech footers (Stripe, Mercury, Brex) share three traits:
 *   1. The footer is *quiet* — it doesn't try to be a second homepage.
 *   2. Columns are aligned on a strict grid with eyebrow-style labels.
 *   3. The legal/meta bar at the bottom is set apart by a hairline rule.
 *
 * Exported standalone so Phase 2 (landing) can consume it without a rewrite.
 */

interface FooterLink { label: string; href: string }
interface FooterColumn { title: string; links: FooterLink[] }

interface AppFooterProps {
  columns?: FooterColumn[]
  className?: string
}

const DEFAULT_COLUMNS: FooterColumn[] = [
  {
    title: "المنتج",
    links: [
      { label: "المنصة",          href: "#platform" },
      { label: "الفواتير",         href: "#invoicing" },
      { label: "المحاسبة",         href: "#accounting" },
      { label: "الرواتب والموارد البشرية", href: "#payroll" },
      { label: "الأصول الثابتة",   href: "#assets" },
      { label: "التقارير المالية", href: "#reports" },
    ],
  },
  {
    title: "الذكاء الاصطناعي",
    links: [
      { label: "المساعد المحاسبي", href: "#assistant" },
      { label: "كوكبت القرار",      href: "#cockpit" },
      { label: "تحليلات تنبؤية",    href: "#forecast" },
    ],
  },
  {
    title: "الدول",
    links: [
      { label: "السعودية",   href: "#sa" },
      { label: "الإمارات",    href: "#ae" },
      { label: "مصر",         href: "#eg" },
      { label: "الكويت",      href: "#kw" },
      { label: "قطر",          href: "#qa" },
      { label: "الأردن",       href: "#jo" },
      { label: "International", href: "#intl" },
    ],
  },
  {
    title: "الشركة",
    links: [
      { label: "من نحن",    href: "#about" },
      { label: "العملاء",    href: "#customers" },
      { label: "المدوّنة",   href: "#blog" },
      { label: "الوظائف",    href: "#careers" },
      { label: "تواصل معنا", href: "#contact" },
    ],
  },
]

export function AppFooter({ columns = DEFAULT_COLUMNS, className }: AppFooterProps) {
  const year = new Date().getFullYear()
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
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              نظام محاسبة ذكي مبني وفق معايير IFRS، عربي أولاً، يمنح الشركة الحديثة
              مركز قيادة مالي واحد — من الفواتير إلى البصيرة.
            </p>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title} className="md:col-span-2">
              <div className="eyebrow mb-4">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      data-testid={`link-footer-${l.label}`}
                      className="text-sm text-foreground/75 hover:text-foreground transition-colors"
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
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>© {year} محاسب ذكي</span>
            <span className="opacity-40">·</span>
            <span className="font-mono text-2xs tracking-wider uppercase">IFRS-Compliant</span>
            <span className="opacity-40">·</span>
            <span className="font-mono text-2xs tracking-wider uppercase">SOC 2 · Type II</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <a href="#privacy"  className="hover:text-foreground transition-colors" data-testid="link-footer-privacy">سياسة الخصوصية</a>
            <a href="#terms"    className="hover:text-foreground transition-colors" data-testid="link-footer-terms">الشروط</a>
            <a href="#security" className="hover:text-foreground transition-colors" data-testid="link-footer-security">الأمان</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
