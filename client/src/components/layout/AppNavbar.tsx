import { useEffect, useRef, useState } from "react"
import { Moon, Sun, Languages, ArrowUpRight, Check, ChevronDown } from "lucide-react"
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

interface NavSubLink { label: string; href: string }
interface NavGroup   { type: "group"; label: string; items: NavSubLink[] }
interface NavLink    { type?: "link";  label: string; href: string }
type NavItem = NavGroup | NavLink

interface AppNavbarProps {
  ctaLabel?: string
  ctaHref?: string
  secondaryLabel?: string
  secondaryHref?: string
  tertiaryLabel?: string
  tertiaryHref?: string
  className?: string
  availableLocales?: readonly Locale[]
}

const ALL_LOCALES: readonly Locale[] = ["ar", "en", "de", "fr"] as const

function buildNav(ar: boolean): NavItem[] {
  return [
    {
      type: "group",
      label: ar ? "المنتج" : "Product",
      items: [
        { label: ar ? "المنصة"               : "Platform",          href: "/platform" },
        { label: ar ? "الفواتير"              : "Invoicing",         href: "/product/invoices" },
        { label: ar ? "المحاسبة"              : "Accounting",        href: "/product/accounting" },
        { label: ar ? "الرواتب والموارد البشرية" : "Payroll & HR",   href: "/product/hr" },
        { label: ar ? "الأصول الثابتة"        : "Fixed Assets",     href: "/product/fixed-assets" },
        { label: ar ? "التقارير المالية"       : "Financial Reports", href: "/product/reports" },
      ],
    },
    {
      type: "group",
      label: ar ? "الذكاء الاصطناعي" : "AI",
      items: [
        { label: ar ? "المساعد المحاسبي" : "AI Assistant",        href: "/ai/assistant" },
        { label: ar ? "كوكبت القرار"      : "Decision Cockpit",   href: "/ai/cockpit" },
        { label: ar ? "تحليلات تنبؤية"    : "Predictive Analytics", href: "/ai/predictive" },
      ],
    },
    {
      type: "group",
      label: ar ? "الدول" : "Countries",
      items: [
        { label: ar ? "🇸🇦 السعودية"         : "🇸🇦 Saudi Arabia",    href: "/countries/sa" },
        { label: ar ? "🇦🇪 الإمارات"         : "🇦🇪 UAE",             href: "/countries/ae" },
        { label: ar ? "🇪🇬 مصر"              : "🇪🇬 Egypt",           href: "/countries/eg" },
        { label: ar ? "🇰🇼 الكويت"           : "🇰🇼 Kuwait",          href: "/countries/kw" },
        { label: ar ? "🇶🇦 قطر"              : "🇶🇦 Qatar",           href: "/countries/qa" },
        { label: ar ? "🇯🇴 الأردن"           : "🇯🇴 Jordan",          href: "/countries/jo" },
        { label: ar ? "🇧🇭 البحرين"          : "🇧🇭 Bahrain",         href: "/countries/international" },
        { label: ar ? "🇴🇲 عُمان"            : "🇴🇲 Oman",            href: "/countries/international" },
        { label: ar ? "🇲🇦 المغرب"           : "🇲🇦 Morocco",         href: "/countries/international" },
        { label: ar ? "🇮🇶 العراق"           : "🇮🇶 Iraq",            href: "/countries/international" },
        { label: ar ? "🇬🇧 المملكة المتّحدة" : "🇬🇧 United Kingdom",  href: "/countries/international" },
        { label: ar ? "🇩🇪 ألمانيا"          : "🇩🇪 Germany",         href: "/countries/international" },
        { label: ar ? "🇫🇷 فرنسا"            : "🇫🇷 France",          href: "/countries/international" },
        { label: ar ? "🇳🇱 هولندا"           : "🇳🇱 Netherlands",     href: "/countries/international" },
        { label: ar ? "🇺🇸 الولايات المتّحدة" : "🇺🇸 United States",  href: "/countries/international" },
        { label: ar ? "🇳🇬 نيجيريا"          : "🇳🇬 Nigeria",         href: "/countries/international" },
        { label: ar ? "🇰🇪 كينيا"            : "🇰🇪 Kenya",           href: "/countries/international" },
        { label: ar ? "🇮🇳 الهند"            : "🇮🇳 India",           href: "/countries/international" },
        { label: ar ? "🇸🇬 سنغافورة"         : "🇸🇬 Singapore",       href: "/countries/international" },
        { label: ar ? "🇹🇷 تركيا"            : "🇹🇷 Turkey",          href: "/countries/international" },
        { label: ar ? "🇧🇷 البرازيل"          : "🇧🇷 Brazil",          href: "/countries/international" },
        { label: "🌐 International",                                     href: "/countries/international" },
      ],
    },
    {
      type: "group",
      label: ar ? "الشركة" : "Company",
      items: [
        { label: ar ? "من نحن"     : "About",     href: "/about" },
        { label: ar ? "العملاء"    : "Customers", href: "/customers" },
        { label: ar ? "المدوّنة"   : "Blog",      href: "/blog" },
        { label: ar ? "الوظائف"   : "Jobs",      href: "/jobs" },
        { label: ar ? "تواصل معنا" : "Contact",  href: "/contact" },
      ],
    },
    {
      type: "link",
      label: ar ? "الأسعار" : "Pricing",
      href: "/#pricing",
    },
  ]
}

export function AppNavbar({
  ctaLabel,
  ctaHref = "/app",
  tertiaryLabel,
  tertiaryHref = "/app",
  className,
  availableLocales = ALL_LOCALES,
}: AppNavbarProps) {
  const [scrolled,  setScrolled]  = useState(false)
  const [isDark,    setIsDark]    = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { locale, setLocale } = useLocale()
  const ar = locale === "ar"
  const resolvedCta      = ctaLabel      ?? (ar ? "افتح التطبيق" : "Open app")
  const resolvedTertiary = tertiaryLabel ?? (ar ? "تسجيل الدخول" : "Sign in")
  const navItems = buildNav(ar)

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

  const handleMouseEnterGroup = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenGroup(label)
  }
  const handleMouseLeaveGroup = () => {
    closeTimer.current = setTimeout(() => setOpenGroup(null), 120)
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
          <div className="ps-2">
            <Brand size="md" />
          </div>

          <nav
            className="hidden lg:flex items-center gap-0.5 rounded-full bg-muted/55 p-1 text-small"
            aria-label="Primary"
          >
            {navItems.map((item) => {
              if (item.type === "link") {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    data-testid={`link-nav-${item.label}`}
                    className={cn(
                      "px-3.5 py-1.5 rounded-full text-foreground/75 font-medium",
                      "hover:text-foreground hover:bg-card",
                      "transition-colors duration-150"
                    )}
                  >
                    {item.label}
                  </a>
                )
              }

              const isOpen = openGroup === item.label
              return (
                <div
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => handleMouseEnterGroup(item.label)}
                  onMouseLeave={handleMouseLeaveGroup}
                >
                  <button
                    type="button"
                    data-testid={`nav-group-${item.label}`}
                    aria-expanded={isOpen}
                    onClick={() => setOpenGroup(isOpen ? null : item.label)}
                    className={cn(
                      "flex items-center gap-1 px-3.5 py-1.5 rounded-full font-medium",
                      "text-foreground/75 hover:text-foreground hover:bg-card",
                      "transition-colors duration-150",
                      isOpen && "text-foreground bg-card"
                    )}
                  >
                    {item.label}
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform duration-150",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>

                  {isOpen && (
                    <div
                      className={cn(
                        "absolute top-full mt-2 min-w-[180px]",
                        "rounded-xl border border-card-border bg-card shadow-lg",
                        "py-1.5",
                        ar ? "right-0" : "left-0"
                      )}
                    >
                      {item.items.map((sub) => (
                        <a
                          key={sub.href}
                          href={sub.href}
                          data-testid={`link-nav-sub-${sub.label}`}
                          className={cn(
                            "block px-4 py-2 text-small text-foreground/75",
                            "hover:text-foreground hover:bg-muted/50",
                            "transition-colors duration-100"
                          )}
                        >
                          {sub.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

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
