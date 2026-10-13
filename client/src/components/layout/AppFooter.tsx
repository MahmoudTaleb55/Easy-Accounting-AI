import { Brand } from "./Brand"
import { cn } from "@/lib/utils"
import { useLocale, type Locale } from "@/contexts/locale-context"
import { t, type StringKey } from "@/i18n/dict"

interface FooterLink   { label: string; href: string }
interface FooterColumn { title: string; links: FooterLink[] }
interface AppFooterProps {
  columns?: FooterColumn[]
  tagline?: string
  className?: string
}

function defaultColumns(locale: Locale): FooterColumn[] {
  const tr = (k: StringKey) => t(k, locale)
  return [
    {
      title: tr("mktnav_product"),
      links: [
        { label: tr("mktnav_platform"),          href: "/platform" },
        { label: tr("mktnav_invoicing"),          href: "/product/invoices" },
        { label: tr("mktnav_accounting"),         href: "/product/accounting" },
        { label: tr("mktnav_payroll_hr"),         href: "/product/hr" },
        { label: tr("mktnav_fixed_assets"),       href: "/product/fixed-assets" },
        { label: tr("mktnav_financial_reports"),  href: "/product/reports" },
      ],
    },
    {
      title: tr("mktnav_intelligence"),
      links: [
        { label: tr("mktnav_ai_assistant"),       href: "/ai/assistant" },
        { label: tr("mktnav_decision_cockpit"),   href: "/ai/cockpit" },
        { label: tr("mktnav_predictive"),         href: "/ai/predictive" },
      ],
    },
    {
      title: tr("mktnav_countries"),
      links: [
        { label: tr("country_sa"),   href: "/countries/sa" },
        { label: tr("country_ae"),   href: "/countries/ae" },
        { label: tr("country_eg"),   href: "/countries/eg" },
        { label: tr("country_kw"),   href: "/countries/kw" },
        { label: tr("country_qa"),   href: "/countries/qa" },
        { label: tr("country_jo"),   href: "/countries/jo" },
        { label: tr("country_intl"), href: "/countries/international" },
      ],
    },
    {
      title: tr("mktnav_company"),
      links: [
        { label: tr("mktnav_about"),     href: "/about" },
        { label: tr("mktnav_customers"), href: "/customers" },
        { label: tr("mktnav_blog"),      href: "/blog" },
        { label: tr("mktnav_jobs"),      href: "/jobs" },
        { label: tr("mktnav_contact"),   href: "/contact" },
      ],
    },
  ]
}

export function AppFooter({ columns, tagline, className }: AppFooterProps) {
  const { locale } = useLocale()
  const cols = columns ?? defaultColumns(locale)
  const year = new Date().getFullYear()
  const brandName = t("brand", locale)
  const resolvedTagline = tagline ?? t("mktnav_tagline", locale)
  const privacy  = t("mktnav_privacy", locale)
  const terms    = t("mktnav_terms", locale)
  const security = t("mktnav_security", locale)

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
