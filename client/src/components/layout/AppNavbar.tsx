import { useEffect, useState } from "react"
import { Moon, Sun, Languages, ArrowUpRight, Check } from "lucide-react"
import { Brand } from "./Brand"
import { cn } from "@/lib/utils"
import { useLocale, type Locale } from "@/contexts/locale-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const LANG_NATIVE: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  fr: "Français",
}

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
  /**
   * Locales to expose in the language picker. Defaults to all four.
   * Public marketing pages should pass only the locales whose copy is
   * actually translated (currently `["ar", "en"]`) — otherwise picking
   * de/fr silently falls back to English content and looks broken.
   */
  availableLocales?: readonly Locale[]
}

const ALL_LOCALES: readonly Locale[] = ["ar", "en", "de", "fr"] as const

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
  availableLocales = ALL_LOCALES,
}: AppNavbarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const { locale, setLocale } = useLocale()
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
            className="hidden lg:flex items-center gap-0.5 rounded-full bg-muted/55 p-1 text-small"
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={ar ? "تغيير اللغة" : "Change language"}
                  data-testid="button-locale-toggle"
                  title={LANG_NATIVE[locale]}
                  className="size-9 grid place-items-center rounded-full text-foreground/65 hover:text-foreground hover-elevate transition-colors duration-150"
                >
                  <Languages className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="shadow-md min-w-[10rem]">
                {availableLocales.map((code) => (
                  <DropdownMenuItem
                    key={code}
                    onClick={() => setLocale(code)}
                    data-testid={`menu-lang-${code}`}
                    className="text-small"
                  >
                    <Check className={`size-3.5 me-2 ${locale === code ? "opacity-100" : "opacity-0"}`} />
                    {LANG_NATIVE[code]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="button-theme-toggle"
              className="size-9 grid place-items-center rounded-full text-foreground/65 hover:text-foreground hover-elevate transition-colors duration-150"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            <a
              href={tertiaryHref}
              data-testid="link-sign-in"
              className="hidden md:inline-flex h-9 items-center px-3 rounded-full text-small font-medium text-foreground/75 hover:text-foreground hover-elevate transition-colors duration-150"
            >
              {resolvedTertiary}
            </a>

            <a
              href={ctaHref}
              data-testid="button-cta-primary"
              className={cn(
                "inline-flex items-center gap-1.5 h-9 lg:h-10 px-4 lg:px-5",
                "rounded-full bg-primary text-primary-foreground",
                "text-small font-semibold tracking-tight",
                "border border-primary-border shadow-xs",
                "hover:opacity-90 transition-opacity duration-150"
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
