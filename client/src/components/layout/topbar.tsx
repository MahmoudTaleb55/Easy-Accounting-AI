import { useLocation } from "wouter";
import {
  Plus, Bell, Sun, Moon, Globe, ChevronDown, Bot, Building2, Check,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { useTheme } from "@/contexts/theme-context";
import { useCompany } from "@/contexts/company-context";
import { usePeriod, type PeriodKey } from "@/contexts/period-context";
import { CommandPaletteTrigger } from "./command-palette";
import { TrustCluster } from "@/components/trust/trust-cluster";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

interface Props {
  onOpenPalette: () => void;
  onToggleAiRail: () => void;
  aiRailOpen: boolean;
}

export function TopBar({ onOpenPalette, onToggleAiRail, aiRailOpen }: Props) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const { companies, activeCompanyId, activeCompany, setActiveCompanyId } = useCompany();
  const { period, setPeriodKey, compareToPrevious, setCompareToPrevious } = usePeriod();
  const { role } = useAuth();
  const [, setLocation] = useLocation();

  const roleChipKey =
    role === "reviewer" ? "role_chip_reviewer" :
    role === "readonly" ? "role_chip_readonly" :
    null;
  const roleChipLabel = roleChipKey ? t(roleChipKey) : null;

  const PERIODS: { key: PeriodKey; label: string }[] = [
    { key: "today", label: t("period_today") },
    { key: "week", label: t("period_week") },
    { key: "month", label: t("period_month") },
    { key: "quarter", label: t("period_quarter") },
    { key: "ytd", label: t("period_ytd") },
    { key: "30d", label: t("period_30d") },
  ];

  const periodLabel = PERIODS.find((p) => p.key === period.key)?.label || period.key;

  // Notifications: pull alert count from insights
  const { data: alertsData } = useQuery<{ alerts: { severity: string }[] }>({
    queryKey: ["/api/insights/alerts"],
  });
  const alertCount = alertsData?.alerts?.filter(
    (a) => a.severity === "critical" || a.severity === "warning"
  ).length || 0;

  return (
    <header
      className="sticky top-0 z-40 hidden md:flex h-14 items-center gap-2 border-b border-border bg-background px-4 lg:px-6 shadow-xs"
      data-testid="app-topbar"
    >
      {companies.length > 0 && (
        <Select
          value={activeCompanyId ? String(activeCompanyId) : ""}
          onValueChange={(v) => setActiveCompanyId(Number(v))}
        >
          <SelectTrigger
            className="h-9 w-auto min-w-0 max-w-[8rem] lg:min-w-[10rem] lg:max-w-[14rem] gap-2 border-transparent bg-transparent hover-elevate hover:border-border data-[state=open]:bg-accent/60 data-[state=open]:border-border"
            data-testid="select-active-company"
          >
            <Building2 className="size-4 opacity-60" />
            <SelectValue>
              {activeCompany ? (
                <span className="truncate text-small font-medium">{activeCompany.name}</span>
              ) : (
                <span className="text-muted-foreground text-small">…</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" className="shadow-md">
            {companies.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                <span className="font-medium text-small">{c.name}</span>
                <span className="ms-2 text-caption text-muted-foreground">{c.functionalCurrency}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Period selector */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2" data-testid="button-period-selector">
            <Calendar className="size-4 opacity-70" />
            <span className="text-small font-medium">{periodLabel}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 shadow-md motion-enter" align="end">
          <div className="eyebrow text-muted-foreground/80 px-2 py-1">
            {t("period_month")} / {t("period_quarter")}
          </div>
          <div className="grid grid-cols-2 gap-1 mb-2">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriodKey(p.key)}
                data-testid={`period-${p.key}`}
                className={`text-small rounded-md px-2 py-1.5 text-start transition-colors duration-150 ${
                  period.key === p.key
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover-elevate text-foreground/80"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border pt-2 px-2">
            <label className="flex items-center gap-2 text-small cursor-pointer">
              <input
                type="checkbox"
                checked={compareToPrevious}
                onChange={(e) => setCompareToPrevious(e.target.checked)}
                className="accent-primary"
                data-testid="checkbox-compare-prev"
              />
              <span>{t("compare_prev")}</span>
            </label>
          </div>
        </PopoverContent>
      </Popover>

      {/* Trust cluster: data freshness + integration health */}
      <TrustCluster />

      {/* Search / command — primary */}
      <div className="flex-1 min-w-0 max-w-2xl mx-auto">
        <CommandPaletteTrigger onClick={onOpenPalette} />
      </div>

      {/* Quick create */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="h-9 gap-1.5 font-medium text-small" data-testid="button-quick-create">
            <Plus className="size-4" />
            <span className="hidden lg:inline">{t("quick_create")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 shadow-md motion-enter">
          <DropdownMenuLabel className="eyebrow text-muted-foreground/80">{t("quick_create")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation("/app/transactions?new=1")} data-testid="quick-new-tx">
            <Plus className="size-3.5 me-2" /> <span className="text-small">{t("quick_create_tx")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/journal?new=1")} data-testid="quick-new-je">
            <Plus className="size-3.5 me-2" /> <span className="text-small">{t("quick_create_je")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/accounts?new=1")} data-testid="quick-new-acc">
            <Plus className="size-3.5 me-2" /> <span className="text-small">{t("quick_create_account")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Notifications */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 relative hover-elevate" data-testid="button-notifications">
            <Bell className="size-4" />
            {alertCount > 0 && (
              <span className="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 shadow-md motion-enter" align="end">
          <div className="px-1 pb-2 text-h4 font-semibold">{t("notifications")}</div>
          <div className="divide-y divide-border max-h-80 overflow-auto -mx-1">
            {(alertsData?.alerts || []).slice(0, 8).map((a: any) => (
              <div key={a.id} className="px-3 py-2 text-small hover-elevate rounded-md">
                <div className="flex items-start gap-2">
                  <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                    a.severity === "critical" ? "bg-loss" :
                    a.severity === "warning"  ? "bg-warning" :
                    a.severity === "success"  ? "bg-gain" : "bg-info"
                  }`} />
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{a.title}</div>
                    <div className="text-muted-foreground mt-0.5 text-caption">{a.description}</div>
                  </div>
                </div>
              </div>
            ))}
            {(!alertsData?.alerts || alertsData.alerts.length === 0) && (
              <div className="px-3 py-6 text-center text-small text-muted-foreground">—</div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Profile — also hosts language, theme, AI assistant */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-9 inline-flex items-center gap-1.5 rounded-md px-1.5 hover-elevate"
            data-testid="button-profile"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-caption bg-primary/10 text-primary font-medium">
                {(activeCompany?.name || "U").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {roleChipLabel && (
              <span
                data-testid={`badge-role-${role}`}
                className="hidden lg:inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-caption font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
              >
                {roleChipLabel}
              </span>
            )}
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 shadow-md motion-enter">
          <DropdownMenuLabel className="flex items-center justify-between gap-2 eyebrow text-muted-foreground/80">
            <span>{t("profile")}</span>
            {roleChipLabel && (
              <span
                data-testid={`badge-role-menu-${role}`}
                className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-caption font-medium normal-case tracking-normal text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
              >
                {roleChipLabel}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation("/app/ai-assistant")} data-testid="menu-ai">
            <Bot className="size-3.5 me-2 opacity-70" /> <span className="text-small">{t("nav_ai")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/settings")} data-testid="menu-settings">
            <span className="text-small">{t("nav_settings")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Language sub-menu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-small">
              <Globe className="size-3.5 me-2 opacity-70" />
              <span className="flex-1">{t("language_label")}</span>
              <span className="text-caption text-muted-foreground">{locale === "ar" ? "العربية" : "English"}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="shadow-md motion-enter">
                <DropdownMenuItem onClick={() => setLocale("ar")} data-testid="menu-lang-ar">
                  <Check className={`size-3.5 me-2 ${locale === "ar" ? "opacity-100" : "opacity-0"}`} />
                  <span className="text-small">العربية</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocale("en")} data-testid="menu-lang-en">
                  <Check className={`size-3.5 me-2 ${locale === "en" ? "opacity-100" : "opacity-0"}`} />
                  <span className="text-small">English</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          {/* Theme sub-menu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-small">
              {theme === "dark" ? <Moon className="size-3.5 me-2 opacity-70" /> : <Sun className="size-3.5 me-2 opacity-70" />}
              <span className="flex-1">{t("appearance_label")}</span>
              <span className="text-caption text-muted-foreground">
                {theme === "dark" ? t("dark_mode") : t("light_mode")}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="shadow-md motion-enter">
                <DropdownMenuItem onClick={() => setTheme("light")} data-testid="menu-theme-light">
                  <Check className={`size-3.5 me-2 ${theme === "light" ? "opacity-100" : "opacity-0"}`} />
                  <Sun className="size-3.5 me-2 opacity-70" /> <span className="text-small">{t("light_mode")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")} data-testid="menu-theme-dark">
                  <Check className={`size-3.5 me-2 ${theme === "dark" ? "opacity-100" : "opacity-0"}`} />
                  <Moon className="size-3.5 me-2 opacity-70" /> <span className="text-small">{t("dark_mode")}</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onToggleAiRail} data-testid="menu-toggle-ai-rail">
            <span className="text-small text-muted-foreground">
              {aiRailOpen ? t("close_ai_rail") : t("open_ai_rail")}
            </span>
            <span className="ms-auto text-caption text-muted-foreground border border-border rounded px-1 py-0.5 font-mono">
              ⌘.
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
