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
  const [, setLocation] = useLocation();

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
      className="sticky top-0 z-40 hidden md:flex h-14 items-center gap-2 border-b border-border bg-background px-4 lg:px-6"
      data-testid="app-topbar"
    >
      {companies.length > 0 && (
        <Select
          value={activeCompanyId ? String(activeCompanyId) : ""}
          onValueChange={(v) => setActiveCompanyId(Number(v))}
        >
          <SelectTrigger
            className="h-9 w-auto min-w-[10rem] max-w-[14rem] gap-2 border-transparent bg-transparent hover:bg-muted/60 hover:border-border data-[state=open]:bg-muted/60 data-[state=open]:border-border transition-colors"
            data-testid="select-active-company"
          >
            <Building2 className="w-4 h-4 opacity-60" />
            <SelectValue>
              {activeCompany ? (
                <span className="truncate text-sm font-medium">{activeCompany.name}</span>
              ) : (
                <span className="text-muted-foreground text-sm">…</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {companies.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                <span className="font-medium">{c.name}</span>
                <span className="ms-2 text-xs text-muted-foreground">{c.functionalCurrency}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Period selector */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2" data-testid="button-period-selector">
            <Calendar className="w-4 h-4 opacity-70" />
            <span className="font-medium">{periodLabel}</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="end">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            {t("period_month")} / {t("period_quarter")}
          </div>
          <div className="grid grid-cols-2 gap-1 mb-2">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriodKey(p.key)}
                data-testid={`period-${p.key}`}
                className={`text-xs rounded-md px-2 py-1.5 text-start transition-colors ${
                  period.key === p.key
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover:bg-accent text-foreground/80"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border pt-2 px-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
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
      <div className="flex-1 max-w-2xl mx-auto">
        <CommandPaletteTrigger onClick={onOpenPalette} />
      </div>

      {/* Quick create */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="h-9 gap-1.5 font-medium" data-testid="button-quick-create">
            <Plus className="w-4 h-4" />
            <span className="hidden lg:inline">{t("quick_create")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs">{t("quick_create")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation("/app/transactions?new=1")} data-testid="quick-new-tx">
            <Plus className="w-4 h-4 me-2" /> {t("quick_create_tx")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/journal?new=1")} data-testid="quick-new-je">
            <Plus className="w-4 h-4 me-2" /> {t("quick_create_je")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/accounts?new=1")} data-testid="quick-new-acc">
            <Plus className="w-4 h-4 me-2" /> {t("quick_create_account")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Notifications */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 relative" data-testid="button-notifications">
            <Bell className="w-4 h-4" />
            {alertCount > 0 && (
              <span className="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="px-1 pb-2 text-sm font-medium">{t("notifications")}</div>
          <div className="divide-y divide-border max-h-80 overflow-auto -mx-1">
            {(alertsData?.alerts || []).slice(0, 8).map((a: any) => (
              <div key={a.id} className="px-3 py-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                    a.severity === "critical" ? "bg-loss" :
                    a.severity === "warning"  ? "bg-warning" :
                    a.severity === "success"  ? "bg-gain" : "bg-info"
                  }`} />
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{a.title}</div>
                    <div className="text-muted-foreground mt-0.5">{a.description}</div>
                  </div>
                </div>
              </div>
            ))}
            {(!alertsData?.alerts || alertsData.alerts.length === 0) && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">—</div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Profile — also hosts language, theme, AI assistant */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-9 inline-flex items-center gap-1.5 rounded-md px-1.5 hover:bg-muted/60 transition-colors"
            data-testid="button-profile"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                {(activeCompany?.name || "U").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs">{t("profile")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation("/app/ai-assistant")} data-testid="menu-ai">
            <Bot className="w-4 h-4 me-2 opacity-70" /> {t("nav_ai")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/settings")} data-testid="menu-settings">
            {t("nav_settings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Language sub-menu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-sm">
              <Globe className="w-4 h-4 me-2 opacity-70" />
              <span className="flex-1">{t("language_label")}</span>
              <span className="text-xs text-muted-foreground">{locale === "ar" ? "العربية" : "English"}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setLocale("ar")} data-testid="menu-lang-ar">
                  <Check className={`w-3.5 h-3.5 me-2 ${locale === "ar" ? "opacity-100" : "opacity-0"}`} />
                  العربية
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocale("en")} data-testid="menu-lang-en">
                  <Check className={`w-3.5 h-3.5 me-2 ${locale === "en" ? "opacity-100" : "opacity-0"}`} />
                  English
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          {/* Theme sub-menu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-sm">
              {theme === "dark" ? <Moon className="w-4 h-4 me-2 opacity-70" /> : <Sun className="w-4 h-4 me-2 opacity-70" />}
              <span className="flex-1">{t("appearance_label")}</span>
              <span className="text-xs text-muted-foreground">
                {theme === "dark" ? t("dark_mode") : t("light_mode")}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setTheme("light")} data-testid="menu-theme-light">
                  <Check className={`w-3.5 h-3.5 me-2 ${theme === "light" ? "opacity-100" : "opacity-0"}`} />
                  <Sun className="w-4 h-4 me-2 opacity-70" /> {t("light_mode")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")} data-testid="menu-theme-dark">
                  <Check className={`w-3.5 h-3.5 me-2 ${theme === "dark" ? "opacity-100" : "opacity-0"}`} />
                  <Moon className="w-4 h-4 me-2 opacity-70" /> {t("dark_mode")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onToggleAiRail} data-testid="menu-toggle-ai-rail">
            <span className="text-xs text-muted-foreground">
              {aiRailOpen ? t("close_ai_rail") : t("open_ai_rail")}
            </span>
            <span className="ms-auto text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 font-mono">
              ⌘.
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
