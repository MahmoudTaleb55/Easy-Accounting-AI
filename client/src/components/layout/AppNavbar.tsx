import { useEffect, useState } from "react"
import { Moon, Sun, ChevronDown, Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Brand } from "./Brand"
import { cn } from "@/lib/utils"
import { useLocale } from "@/contexts/locale-context"

/**
 * AppNavbar — premium top bar.
 *
 * - Sticky, translucent on scroll (glass surface + hairline bottom)
 * - Typographic brand mark (no icon-in-circle)
 * - Restrained nav: text links with subtle hover, no chips/pills
 * - Right side: theme toggle + a single primary CTA
 *
 * This component is part of the Phase 1 design system. It is exported
 * standalone so the landing redesign (Phase 2) and the in-app shell
 * (Phase 3) can both consume it.
 */

interface NavLink { label: string; href: string }

interface AppNavbarProps {
  links?: NavLink[]
  ctaLabel?: string
  ctaHref?: string
  secondaryLabel?: string
  secondaryHref?: string
  tertiaryLabel?: string
  tertiaryHref?: string
  className?: string
}

const DEFAULT_LINKS: NavLink[] = [
  { label: "المنصة",   href: "#platform" },
  { label: "المميزات", href: "#features" },
  { label: "الأسعار",   href: "#pricing" },
  { label: "العملاء",   href: "#customers" },
  { label: "الموارد",   href: "#resources" },
]

export function AppNavbar({
  links = DEFAULT_LINKS,
  ctaLabel,
  ctaHref = "/app",
  secondaryLabel,
  secondaryHref = "/demo",
  tertiaryLabel,
  tertiaryHref = "/app",
  className,
}: AppNavbarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const { locale, toggleLocale } = useLocale()
  const resolvedCta = ctaLabel ?? (locale === "ar" ? "افتح التطبيق" : "Open app")
  const resolvedSecondary = secondaryLabel ?? (locale === "ar" ? "طلب عرض" : "Request demo")
  const resolvedTertiary = tertiaryLabel ?? (locale === "ar" ? "تسجيل الدخول" : "Sign in")

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    setIsDark(root.classList.contains("dark"))
  }, [])

  const toggleTheme = () => {
    const root = document.documentElement
    const nextDark = !root.classList.contains("dark")
    root.classList.toggle("dark", nextDark)
    try { localStorage.setItem("theme", nextDark ? "dark" : "light") } catch {}
    setIsDark(nextDark)
  }

  return (
    <header
      data-testid="app-navbar"
      className={cn(
        "sticky top-0 z-40 w-full",
        "transition-[background-color,border-color,box-shadow] duration-200",
        scrolled
          ? "glass-surface border-b border-border/80 shadow-xs"
          : "bg-background border-b border-transparent",
        className
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-8">
          {/* Brand */}
          <Brand size="md" />

          {/* Center: nav links — restrained, text-only with subtle hover */}
          <nav
            className="hidden md:flex items-center gap-1 text-sm"
            aria-label="Primary"
          >
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                data-testid={`link-nav-${l.label}`}
                className={cn(
                  "px-3 py-2 rounded-md text-foreground/75",
                  "hover:text-foreground hover:bg-accent/60",
                  "transition-colors duration-150"
                )}
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Right: actions */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleLocale}
              aria-label={locale === "ar" ? "Switch to English" : "التحويل إلى العربية"}
              data-testid="button-locale-toggle"
              title={locale === "ar" ? "EN" : "AR"}
            >
              <Languages />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="button-theme-toggle"
            >
              {isDark ? <Sun /> : <Moon />}
            </Button>

            <a
              href={tertiaryHref}
              data-testid="link-sign-in"
              className="hidden md:inline-flex h-9 items-center px-3 text-sm text-foreground/75 hover:text-foreground transition-colors"
            >
              {resolvedTertiary}
            </a>
            <a
              href={secondaryHref}
              data-testid="link-secondary-cta"
              className="hidden sm:inline-flex h-9 items-center px-3 text-sm text-foreground/75 hover:text-foreground transition-colors"
            >
              {resolvedSecondary}
            </a>

            <Button asChild size="default" data-testid="button-cta-primary">
              <a href={ctaHref}>{resolvedCta}</a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

/* Re-export for convenience */
export { ChevronDown }
