import { useEffect, useState } from "react"
import { Moon, Sun, Languages, ArrowUpRight } from "lucide-react"
import { Brand } from "./Brand"
import { cn } from "@/lib/utils"
import { useLocale } from "@/contexts/locale-context"

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

/**
 * AppNavbar — Bento × Clean fusion.
 *
 * A floating pill-shaped nav card on the cream page surface.
 * White card chrome (bg-card), rounded-full silhouette, generous
 * breathing room, peach CTA accent.
 */
export function AppNavbar({
  links = DEFAULT_LINKS,
  ctaLabel,
  ctaHref = "/app",
  secondaryHref = "/demo",
  tertiaryLabel,
  tertiaryHref = "/app",
  className,
}: AppNavbarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const { locale, toggleLocale } = useLocale()
  const ar = locale === "ar"
  const resolvedCta = ctaLabel ?? (ar ? "افتح التطبيق" : "Open app")
  const resolvedTertiary = tertiaryLabel ?? (ar ? "تسجيل الدخول" : "Sign in")

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
        "sticky top-0 z-40 w-full pt-3 lg:pt-4 pb-2",
        "transition-[padding] duration-200",
        className
      )}
    >
      <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-6">
        <div
          className={cn(
            "flex h-14 lg:h-16 items-center justify-between gap-3 px-3 lg:px-4",
            "rounded-full border border-card-border bg-card",
            "transition-shadow duration-200",
            scrolled ? "shadow-md" : "shadow-sm"
          )}
        >
          {/* Brand — peach dot kept; "ذكي" uses ink, not peach (peach has no contrast on white) */}
          <div className="ps-2">
            <Brand size="md" />
          </div>

          {/* Center nav — inner muted pill rail */}
          <nav
            className="hidden lg:flex items-center gap-0.5 rounded-full bg-muted/55 p-1 text-sm"
            aria-label="Primary"
          >
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                data-testid={`link-nav-${l.label}`}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-foreground/75 font-medium",
                  "hover:text-foreground hover:bg-card",
                  "transition-colors duration-150"
                )}
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-1.5 pe-1">
            <button
              type="button"
              onClick={toggleLocale}
              aria-label={ar ? "Switch to English" : "التحويل إلى العربية"}
              data-testid="button-locale-toggle"
              title={ar ? "EN" : "AR"}
              className="size-9 grid place-items-center rounded-full text-foreground/65 hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Languages className="size-4" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="button-theme-toggle"
              className="size-9 grid place-items-center rounded-full text-foreground/65 hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            <a
              href={tertiaryHref}
              data-testid="link-sign-in"
              className="hidden md:inline-flex h-9 items-center px-3 rounded-full text-sm font-medium text-foreground/75 hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {resolvedTertiary}
            </a>

            <a
              href={ctaHref}
              data-testid="button-cta-primary"
              className={cn(
                "inline-flex items-center gap-1.5 h-9 lg:h-10 px-4 lg:px-5",
                "rounded-full bg-primary text-primary-foreground",
                "text-sm font-semibold tracking-tight",
                "border border-primary-border",
                "hover:opacity-90 transition-opacity"
              )}
            >
              {resolvedCta}
              <ArrowUpRight className={cn("size-4", ar && "-scale-x-100")} />
            </a>
          </div>
        </div>
      </div>
    </header>
  )
}

export { ChevronDown } from "lucide-react"
