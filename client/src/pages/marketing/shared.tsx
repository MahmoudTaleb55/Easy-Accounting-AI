import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppFooter } from "@/components/layout/AppFooter"
import { cn } from "@/lib/utils"
import { useLocale } from "@/contexts/locale-context"

interface MarketingLayoutProps {
  children: React.ReactNode
  className?: string
}

export function MarketingLayout({ children, className }: MarketingLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNavbar availableLocales={["ar", "en"]} />
      <main className={cn("mx-auto max-w-5xl px-4 sm:px-6 lg:px-8", className)}>
        {children}
      </main>
      <AppFooter />
    </div>
  )
}

interface HeroProps {
  eyebrow?: string
  title: string
  subtitle: string
  badge?: string
}

export function MarketingHero({ eyebrow, title, subtitle, badge }: HeroProps) {
  return (
    <section className="pt-16 pb-12 text-center">
      {eyebrow && (
        <div className="eyebrow mb-4 text-primary">{eyebrow}</div>
      )}
      {badge && (
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-primary/10 text-primary text-small font-medium">
          {badge}
        </div>
      )}
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-5 leading-tight">
        {title}
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
        {subtitle}
      </p>
    </section>
  )
}

interface FeatureCard {
  icon?: string
  title: string
  description: string
}

interface FeaturesGridProps {
  features: FeatureCard[]
}

export function FeaturesGrid({ features }: FeaturesGridProps) {
  return (
    <section className="py-12">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f, i) => (
          <div
            key={i}
            className="rounded-xl border border-card-border bg-card p-6 shadow-sm hover:shadow-md transition-shadow duration-200"
          >
            {f.icon && (
              <div className="text-2xl mb-3">{f.icon}</div>
            )}
            <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
            <p className="text-small text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

interface CTASectionProps {
  title: string
  subtitle?: string
  primaryLabel: string
  primaryHref: string
  secondaryLabel?: string
  secondaryHref?: string
}

export function CTASection({ title, subtitle, primaryLabel, primaryHref, secondaryLabel, secondaryHref }: CTASectionProps) {
  const { locale } = useLocale()
  const ar = locale === "ar"
  return (
    <section className="py-16 text-center">
      <div className="rounded-2xl bg-primary/5 border border-primary/10 p-10">
        <h2 className="text-2xl font-bold text-foreground mb-3">{title}</h2>
        {subtitle && <p className="text-muted-foreground mb-8 max-w-lg mx-auto">{subtitle}</p>}
        <div className={cn("flex items-center justify-center gap-3 flex-wrap", ar && "flex-row-reverse")}>
          <a
            href={primaryHref}
            className="inline-flex items-center gap-1.5 h-10 px-6 rounded-full bg-primary text-primary-foreground text-small font-semibold border border-primary-border shadow-xs hover:opacity-90 transition-opacity"
          >
            {primaryLabel}
          </a>
          {secondaryLabel && secondaryHref && (
            <a
              href={secondaryHref}
              className="inline-flex items-center h-10 px-6 rounded-full bg-card border border-card-border text-small font-medium text-foreground/75 hover:text-foreground transition-colors"
            >
              {secondaryLabel}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}

interface ComplianceBadgeProps {
  items: string[]
}

export function ComplianceBadges({ items }: ComplianceBadgeProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 py-6">
      {items.map((item) => (
        <span key={item} className="px-3 py-1 rounded-full bg-muted text-small text-foreground/70 font-mono">
          {item}
        </span>
      ))}
    </div>
  )
}
