import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar, MobileHeader } from "./app-sidebar"
import { CompanyProvider, useCompany } from "@/contexts/company-context"
import { useLocale } from "@/contexts/locale-context"
import { useTheme } from "@/contexts/theme-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Building2, Languages, Moon, Sun, Search, Bell } from "lucide-react"

function CompanySwitcher() {
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany()
  if (companies.length === 0) return null
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="header-company-switcher">
      <Building2 className="w-4 h-4 text-muted-foreground" />
      <Select
        value={activeCompanyId ? String(activeCompanyId) : ""}
        onValueChange={(v) => setActiveCompanyId(Number(v))}
      >
        <SelectTrigger
          className="h-9 w-52 border-border/70 bg-background"
          data-testid="select-active-company"
        >
          <SelectValue placeholder="Company" />
        </SelectTrigger>
        <SelectContent>
          {companies.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name} ({c.functionalCurrency})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function TopBar() {
  const { locale, toggleLocale } = useLocale()
  const { theme, toggleTheme } = useTheme()
  return (
    <div
      className="hidden md:flex items-center justify-between gap-3 px-6 h-14 border-b border-border bg-background/85 backdrop-blur sticky top-0 z-40"
      data-testid="topbar"
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          data-testid="button-sidebar-toggle"
        />
        <button
          type="button"
          aria-label={locale === "ar" ? "ابحث في كل شيء" : "Search anything"}
          data-testid="button-global-search"
          className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2.5 py-1.5 rounded-md border border-transparent hover:border-border transition-colors w-72 select-none text-start"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-start">
            {locale === "ar" ? "ابحث في كل شيء…" : "Search anything…"}
          </span>
          <kbd className="text-[10px] font-mono text-muted-foreground/70 bg-background px-1.5 py-0.5 rounded border border-border">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <CompanySwitcher />
        <div className="hairline-v h-5 mx-2" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleLocale}
          aria-label="Toggle language"
          data-testid="button-toggle-locale"
          className="text-muted-foreground hover:text-foreground"
        >
          <Languages className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          data-testid="button-toggle-theme"
          className="text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Notifications"
          data-testid="button-notifications"
          className="text-muted-foreground hover:text-foreground relative"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
        </Button>
      </div>
    </div>
  )
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { dir } = useLocale()
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  } as React.CSSProperties

  return (
    <CompanyProvider>
      <SidebarProvider style={style}>
        <div
          className="flex min-h-screen w-full bg-background font-sans text-foreground"
          dir={dir}
        >
          <AppSidebar />
          <div className="flex flex-col flex-1 w-full min-w-0 relative">
            <MobileHeader />
            <TopBar />
            <main
              className="flex-1 w-full max-w-[1400px] mx-auto px-4 md:px-8 lg:px-10 py-6 md:py-8 lg:py-10"
              data-testid="main-content"
            >
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </CompanyProvider>
  )
}
