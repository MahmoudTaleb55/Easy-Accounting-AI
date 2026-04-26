import { Link, useLocation } from "wouter";
import {
  Home, ListOrdered, Bot, Wallet, Menu, BarChart3, BookOpen, BookText,
  Activity, Users, Building2, Inbox, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  LogOut, User as UserIcon, FileText, UserCog, type LucideIcon,
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
      { key: "nav_inbox",        url: "/app/inbox",          icon: Inbox },
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
    label: "group_sales",
    items: [
      { key: "nav_sales_invoices",  url: "/app/sales/invoices",  icon: FileText },
      { key: "nav_sales_customers", url: "/app/sales/customers", icon: UserCog },
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
      { key: "nav_insights",     url: "/app/insights",       icon: Activity },
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
      className={`${dir === "rtl" ? "border-l" : "border-r"} border-border bg-sidebar shadow-xs`}
    >
      <SidebarHeader className="px-3 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 text-foreground">
          <BrandMark size="sm" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-h4 font-semibold tracking-tight truncate" dir="rtl">محاسب ذكي</div>
              <div className="eyebrow text-muted-foreground/80" dir="rtl">نظام محاسبي ذكي</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {GROUPS.map((g) => (
          <SidebarGroup key={g.label} className="px-2 py-1">
            {!collapsed && (
              <SidebarGroupLabel className="px-2 h-6 eyebrow text-muted-foreground/80">
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
                        className={`h-9 px-2.5 rounded-md text-small relative hover-elevate ${
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
                          <item.icon className={`size-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
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
          className="w-full inline-flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-caption text-muted-foreground hover:text-foreground hover-elevate"
          data-testid="button-toggle-sidebar"
        >
          {!collapsed && <span>{dir === "rtl" ? "طيّ القائمة" : "Collapse"}</span>}
          {collapsed ? (
            <ChevronExpand className="size-4 mx-auto" />
          ) : (
            <ChevronCollapse className="size-4" />
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
          className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover-elevate"
          data-testid="button-user-menu"
        >
          <Avatar className="h-7 w-7 shrink-0">
            {user.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={fullName} />}
            <AvatarFallback className="text-caption">{initials}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-small font-medium" data-testid="text-sidebar-user-name">{fullName}</div>
              {role && <div className="truncate eyebrow text-muted-foreground" data-testid="text-sidebar-user-role">{role}</div>}
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 shadow-md">
        <DropdownMenuLabel className="truncate text-small">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild data-testid="menu-profile">
          <Link href="/app/settings/profile">
            <a className="flex items-center gap-2"><UserIcon className="size-3.5" /> Profile</a>
          </Link>
        </DropdownMenuItem>
        {role === "owner" && (
          <DropdownMenuItem asChild data-testid="menu-members">
            <Link href="/app/settings/members">
              <a className="flex items-center gap-2"><Users className="size-3.5" /> Members</a>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} data-testid="menu-sidebar-signout">
          <LogOut className="size-3.5 mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MobileHeader() {
  const { toggleSidebar } = useSidebar();
  return (
    <div className="md:hidden flex items-center justify-between px-4 h-12 bg-card border-b border-border sticky top-0 z-50 shadow-xs">
      <div className="flex items-center gap-2 text-foreground">
        <BrandMark size="sm" />
        <h2 className="text-h4 font-semibold text-foreground" dir="rtl">محاسب ذكي</h2>
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
        <Menu className="size-4" />
      </Button>
    </div>
  );
}
