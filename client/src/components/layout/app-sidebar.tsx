import { Link, useLocation } from "wouter"
import {
  LayoutDashboard,
  ArrowLeftRight,
  BookOpen,
  BookText,
  BarChart3,
  Sparkles,
  Users,
  Building2,
  Bot,
  Settings as SettingsIcon,
  Menu,
  type LucideIcon,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Brand } from "./Brand"
import { useLocale } from "@/contexts/locale-context"
import { cn } from "@/lib/utils"

type NavItem = {
  url: string
  icon: LucideIcon
  ar: string
  en: string
}

type NavSection = {
  ar: string
  en: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    ar: "نظرة عامة",
    en: "Overview",
    items: [
      { url: "/app", icon: LayoutDashboard, ar: "الكوكبت", en: "Cockpit" },
      { url: "/app/insights", icon: Sparkles, ar: "مركز القرارات", en: "Decisions" },
    ],
  },
  {
    ar: "الدفاتر",
    en: "Books",
    items: [
      { url: "/app/transactions", icon: ArrowLeftRight, ar: "المعاملات", en: "Transactions" },
      { url: "/app/journal", icon: BookText, ar: "قيود اليومية", en: "Journal" },
      { url: "/app/accounts", icon: BookOpen, ar: "دليل الحسابات", en: "Chart of accounts" },
      { url: "/app/reports", icon: BarChart3, ar: "التقارير المالية", en: "Reports" },
    ],
  },
  {
    ar: "الموارد والأصول",
    en: "People & assets",
    items: [
      { url: "/app/hr", icon: Users, ar: "الموارد البشرية", en: "HR & payroll" },
      { url: "/app/fixed-assets", icon: Building2, ar: "الأصول الثابتة", en: "Fixed assets" },
    ],
  },
  {
    ar: "النظام",
    en: "System",
    items: [
      { url: "/app/ai-assistant", icon: Bot, ar: "المساعد الذكي", en: "AI assistant" },
      { url: "/app/settings", icon: SettingsIcon, ar: "الإعدادات", en: "Settings" },
    ],
  },
]

export function AppSidebar() {
  const [location] = useLocation()
  const { locale, dir } = useLocale()
  // RTL: sidebar on right, with a left border. LTR: on left, with a right border.
  const side = dir === "rtl" ? "right" : "left"
  const borderClass = dir === "rtl" ? "border-l border-sidebar-border" : "border-r border-sidebar-border"

  return (
    <Sidebar className={borderClass} side={side}>
      <SidebarHeader className="px-4 pt-5 pb-4 border-b border-sidebar-border">
        <Brand size="md" href="/app" />
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        {sections.map((section) => (
          <SidebarGroup key={section.en} className="mb-1">
            <SidebarGroupLabel className="eyebrow px-3 pt-3 pb-1.5 text-[10px] text-muted-foreground/70">
              {locale === "ar" ? section.ar : section.en}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    location === item.url ||
                    (item.url !== "/app" && location.startsWith(item.url + "/"))
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={locale === "ar" ? item.ar : item.en}
                        className={cn(
                          "h-9 rounded-md text-sm font-medium transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                        data-testid={`link-nav-${item.url.replace(/\//g, "-")}`}
                      >
                        <Link href={item.url} className="flex items-center gap-2.5">
                          <Icon
                            className={cn(
                              "w-4 h-4 shrink-0",
                              isActive ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                          <span className="truncate">{locale === "ar" ? item.ar : item.en}</span>
                          {isActive && (
                            <span
                              aria-hidden
                              className={cn(
                                "ms-auto h-4 w-[2px] rounded-full bg-primary"
                              )}
                            />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span className="text-xs text-muted-foreground font-medium">
            {locale === "ar" ? "متصل · مزامنة لحظية" : "Connected · live sync"}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

export function MobileHeader() {
  const { toggleSidebar } = useSidebar()
  return (
    <div className="md:hidden flex items-center justify-between px-4 h-14 bg-background/95 backdrop-blur border-b border-border sticky top-0 z-50">
      <Brand size="sm" href="/app" />
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        data-testid="button-mobile-menu"
        aria-label="Toggle navigation"
      >
        <Menu className="w-5 h-5" />
      </Button>
    </div>
  )
}
