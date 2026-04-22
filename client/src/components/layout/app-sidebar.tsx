import { Link, useLocation } from "wouter";
import {
  Home, ListOrdered, Bot, Wallet, Menu, BarChart3, BookOpen, BookText,
  Sparkles, Users, Building2, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  LogOut, User as UserIcon, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useT, type StringKey } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { BrandMark } from "@/components/brand/mark";

interface NavItem { key: StringKey; url: string; icon: LucideIcon; }
interface NavGroup { label: StringKey; items: NavItem[]; }

const GROUPS: NavGroup[] = [
  {
    label: "group_workspace",
    items: [
      { key: "nav_dashboard",    url: "/app",                icon: Home },
      { key: "nav_transactions", url: "/app/transactions",   icon: ListOrdered },
    ],
  },
  {
    label: "group_books",
    items: [
      { key: "nav_journal",      url: "/app/journal",        icon: BookText },
      { key: "nav_accounts",     url: "/app/accounts",       icon: BookOpen },
      { key: "nav_reports",      url: "/app/reports",        icon: BarChart3 },
    ],
  },
  {
    label: "group_people",
    items: [
      { key: "nav_hr",           url: "/app/hr",             icon: Users },
      { key: "nav_assets",       url: "/app/fixed-assets",   icon: Building2 },
    ],
  },
  {
    label: "group_intelligence",
    items: [
      { key: "nav_insights",     url: "/app/insights",       icon: Sparkles },
      { key: "nav_ai",           url: "/app/ai-assistant",   icon: Bot },
    ],
  },
  {
    label: "group_settings",
    items: [
      { key: "nav_settings",     url: "/app/settings",       icon: SettingsIcon },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const t = useT();
  const { dir } = useLocale();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const side = dir === "rtl" ? "right" : "left";
  const ChevronCollapse = dir === "rtl" ? ChevronRight : ChevronLeft;
  const ChevronExpand = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <Sidebar
      side={side}
      collapsible="icon"
      className={`${dir === "rtl" ? "border-l" : "border-r"} border-border bg-sidebar`}
    >
      <SidebarHeader className="px-3 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 text-foreground">
          <BrandMark size="sm" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate">{t("brand")}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {dir === "rtl" ? "نظام محاسبي ذكي" : "Intelligent ledger"}
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {GROUPS.map((g) => (
          <SidebarGroup key={g.label} className="px-2 py-1">
            {!collapsed && (
              <SidebarGroupLabel className="px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 h-6">
                {t(g.label)}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const isActive = location === item.url;
                  const label = t(item.key);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={label}
                        className={`h-9 px-2.5 rounded-md text-sm transition-colors relative ${
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                        }`}
                      >
                        <Link href={item.url} data-testid={`sidebar-link-${item.key}`}>
                          {isActive && (
                            <span
                              className={`absolute ${dir === "rtl" ? "right-0" : "left-0"} top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary`}
                              aria-hidden
                            />
                          )}
                          <item.icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-2 py-2 space-y-1">
        <UserBadge collapsed={collapsed} />
        <button
          onClick={toggleSidebar}
          className="w-full inline-flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40 transition-colors"
          data-testid="button-toggle-sidebar"
        >
          {!collapsed && <span>{dir === "rtl" ? "طيّ القائمة" : "Collapse"}</span>}
          {collapsed ? (
            <ChevronExpand className="w-4 h-4 mx-auto" />
          ) : (
            <ChevronCollapse className="w-4 h-4" />
          )}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

function UserBadge({ collapsed }: { collapsed: boolean }) {
  const { user, role, signOut, activeMembership } = useAuth();
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "—";
  const initials = ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")) || (user.email?.[0]?.toUpperCase() ?? "?");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-sidebar-accent/40 transition-colors"
          data-testid="button-user-menu"
        >
          <Avatar className="h-7 w-7 shrink-0">
            {user.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={fullName} />}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium" data-testid="text-user-name">{fullName}</div>
              {role && <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="text-user-role">{role}</div>}
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild data-testid="menu-profile">
          <Link href="/app/settings/profile">
            <a className="flex items-center gap-2"><UserIcon className="h-4 w-4" /> Profile</a>
          </Link>
        </DropdownMenuItem>
        {role === "admin" && (
          <DropdownMenuItem asChild data-testid="menu-members">
            <Link href="/app/settings/members">
              <a className="flex items-center gap-2"><Users className="h-4 w-4" /> Members</a>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} data-testid="menu-signout">
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MobileHeader() {
  const { toggleSidebar } = useSidebar();
  const t = useT();
  return (
    <div className="md:hidden flex items-center justify-between px-4 h-12 bg-card border-b border-border sticky top-0 z-50">
      <div className="flex items-center gap-2 text-foreground">
        <BrandMark size="sm" />
        <h2 className="font-semibold text-sm text-foreground">{t("brand")}</h2>
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
        <Menu className="w-5 h-5" />
      </Button>
    </div>
  );
}
