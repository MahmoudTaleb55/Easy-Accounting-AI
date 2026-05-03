import { useLocation } from "wouter";
import {
  Plus, Bell, Sun, Moon, Globe, ChevronDown, Bot, Building2, Check,
  Calendar, LogOut, Locate,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS, de, fr } from "date-fns/locale";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { useTheme } from "@/contexts/theme-context";
import { useCompany } from "@/contexts/company-context";
import { usePeriod, type PeriodKey } from "@/contexts/period-context";
import { usePeriodEmptinessHint } from "@/hooks/use-period-emptiness";
import { useFormatMoney } from "@/lib/format";
import { CommandPaletteTrigger } from "./command-palette";
import { TrustCluster } from "@/components/trust/trust-cluster";
import { useMutation } from "@tanstack/react-query";
import { useDashboardAlerts } from "@/hooks/use-dashboard-data";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Locale } from "@/contexts/locale-context";

interface Props {
  onOpenPalette: () => void;
  onToggleAiRail: () => void;
  aiRailOpen: boolean;
}

const LANG_NATIVE: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  fr: "Français",
};

export function TopBar({ onOpenPalette, onToggleAiRail, aiRailOpen }: Props) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const { companies, activeCompanyId, activeCompany, setActiveCompanyId } = useCompany();
  const { period, setPeriodKey, setPeriodToInclude, compareToPrevious, setCompareToPrevious } = usePeriod();
  // Workspace-wide "this period is empty — jump to the nearest
  // posting?" hint (Task #320). Reuses `setPeriodToInclude`, the same
  // jump primitive the per-account ledger empty state already calls.
  // The hint also resolves a one-line preview of the destination JE
  // (account name · reference · amount) so owners can see *what*
  // they're about to land on before clicking the banner (Task #367).
  const periodHint = usePeriodEmptinessHint(period, locale === "ar");
  const dfLocale = locale === "ar" ? ar : locale === "de" ? de : locale === "fr" ? fr : enUS;
  const formatMoney = useFormatMoney();
  const periodHintJumpLabel = periodHint.nearest
    ? `${
        periodHint.nearest.side === "past"
          ? t("period_jump_past")
          : t("period_jump_future")
      } (${format(periodHint.nearest.date, "d MMM yyyy", { locale: dfLocale })})`
    : "";
  // Each segment is added independently so an unresolved account or a
  // missing amount never produces a stray "·" separator on screen.
  const periodHintPreviewSegments = periodHint.nearest
    ? [
        periodHint.nearest.accountName,
        periodHint.nearest.reference,
        periodHint.nearest.amount != null && periodHint.nearest.amount > 0
          ? formatMoney(periodHint.nearest.amount)
          : "",
      ].filter(Boolean)
    : [];
  const periodHintPreviewLine = periodHintPreviewSegments.join(" · ");
  const { role, user, signOut, isSigningOut } = useAuth();
  const [, setLocation] = useLocation();

  // Build a friendly display name and 1–2 letter monogram for the avatar.
  // Falls back through full name → first name → email local part → "U" so the
  // menu always shows *something* identifying the signed-in account.
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.firstName ||
    user?.email ||
    "";
  const initialsSource = displayName || user?.email || "U";
  const initials = initialsSource
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "U";

  // Persist the chosen UI language to the user's profile so it survives across
  // devices and so the assistant always sees the latest preference. We never
  // block the UI on the network call — local state and storage update first.
  const updateLocaleMut = useMutation({
    mutationFn: async (preferredLocale: Locale) => {
      const res = await apiRequest("PATCH", "/api/auth/profile", { preferredLocale });
      return res.json();
    },
    onSuccess: () => {
      // Match the queryKey used by `useAuth` (`/api/auth/user`) so the
      // signed-in user record refetches and any UI bound to it (e.g. the
      // assistant locale, settings page) immediately reflects the new
      // `preferredLocale` without waiting for a full reload.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  function changeLanguage(code: Locale) {
    setLocale(code);
    if (role) updateLocaleMut.mutate(code);
  }

  // Surface a "Viewer" chip in the topbar when the active membership is
  // read-only, so the user always knows why write actions are disabled.
  const roleChipKey = role === "viewer" ? "role_chip_viewer" : null;
  const roleChipLabel = roleChipKey ? t(roleChipKey) : null;

  const PERIODS: { key: PeriodKey; label: string }[] = [
    { key: "today", label: t("period_today") },
    { key: "week", label: t("period_week") },
    { key: "month", label: t("period_month") },
    { key: "quarter", label: t("period_quarter") },
    { key: "ytd", label: t("period_ytd") },
    { key: "30d", label: t("period_30d") },
  ];

  // For preset keys, show the localised label. For "custom" (set via
  // `setPeriodToInclude` jumps), render the actual start–end range.
  const intl = locale === "ar" ? "ar-SA" : "en-US";
  const presetLabel = PERIODS.find((p) => p.key === period.key)?.label;
  const periodLabel = presetLabel
    ?? `${period.start.toLocaleDateString(intl, { month: "short", day: "numeric" })} – ${period.end.toLocaleDateString(intl, { month: "short", day: "numeric", year: "numeric" })}`;

  // Notifications: pull alert count from insights
  const { data: alertsData } = useDashboardAlerts<{
    alerts: { severity: string }[];
  }>();
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
          <Button variant="outline" size="sm" className="h-9 gap-2 relative" data-testid="button-period-selector">
            <Calendar className="size-4 opacity-70" />
            <span className="text-small font-medium">{periodLabel}</span>
            <ChevronDown className="size-3.5 opacity-60" />
            {/* Empty-period warning dot (Task #320). */}
            {periodHint.isEmpty && periodHint.nearest && (
              <span
                className="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background"
                aria-hidden
                data-testid="indicator-period-empty"
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 shadow-md motion-enter" align="end">
          {/* Jump-to-nearest banner (Task #320). The optional third
              line previews the destination JE (account · ref · amount)
              so owners can confirm the jump is going somewhere
              meaningful before committing (Task #367). */}
          {periodHint.isEmpty && periodHint.nearest && (
            <button
              type="button"
              onClick={() => setPeriodToInclude(periodHint.nearest!.date)}
              className="w-full mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-2 text-start hover-elevate"
              data-testid="button-period-popover-jump-nearest"
            >
              <Locate className="size-4 mt-0.5 text-warning shrink-0" aria-hidden />
              <span className="flex flex-col min-w-0">
                <span className="text-caption font-medium text-foreground">
                  {t("period_empty_hint_short")}
                </span>
                <span className="text-caption text-muted-foreground truncate">
                  {periodHintJumpLabel}
                </span>
                {periodHintPreviewLine && (
                  <span
                    className="text-caption text-foreground/90 truncate mt-0.5"
                    data-testid="text-period-popover-jump-preview"
                  >
                    {periodHintPreviewLine}
                  </span>
                )}
              </span>
            </button>
          )}
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
            aria-label={displayName || t("profile")}
          >
            <Avatar className="h-7 w-7">
              {user?.profileImageUrl && (
                <AvatarImage src={user.profileImageUrl} alt={displayName || ""} />
              )}
              <AvatarFallback
                className="text-caption bg-primary/10 text-primary font-medium"
                data-testid="avatar-fallback-user"
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            {roleChipLabel && (
              <span
                data-testid={`badge-role-${role}`}
                className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-caption font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
              >
                {roleChipLabel}
              </span>
            )}
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 shadow-md motion-enter">
          {user ? (
            <DropdownMenuLabel className="flex items-start gap-2 py-2 font-normal">
              <Avatar className="h-9 w-9 mt-0.5">
                {user.profileImageUrl && (
                  <AvatarImage src={user.profileImageUrl} alt={displayName || ""} />
                )}
                <AvatarFallback className="text-caption bg-primary/10 text-primary font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="eyebrow text-muted-foreground/80">{t("signed_in_as")}</span>
                {displayName && (
                  <span
                    className="text-small font-medium text-foreground truncate"
                    data-testid="text-user-name"
                  >
                    {displayName}
                  </span>
                )}
                {user.email && (
                  <span
                    className="text-caption text-muted-foreground truncate"
                    data-testid="text-user-email"
                  >
                    {user.email}
                  </span>
                )}
                {roleChipLabel && (
                  <span
                    data-testid={`badge-role-menu-${role}`}
                    className="mt-1 self-start inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-caption font-medium normal-case tracking-normal text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
                  >
                    {roleChipLabel}
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
          ) : (
            <DropdownMenuLabel className="flex items-center justify-between gap-2 eyebrow text-muted-foreground/80">
              <span>{t("profile")}</span>
            </DropdownMenuLabel>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation("/app/ai-assistant")} data-testid="menu-ai">
            <Bot className="size-3.5 me-2 opacity-70" /> <span className="text-small">{t("nav_ai")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/app/settings")} data-testid="menu-settings">
            <span className="text-small">{t("nav_settings")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Language sub-menu — Arabic, English, German, French */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-small">
              <Globe className="size-3.5 me-2 opacity-70" />
              <span className="flex-1">{t("language_label")}</span>
              <span className="text-caption text-muted-foreground">{LANG_NATIVE[locale]}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="shadow-md motion-enter">
                {(["ar", "en", "de", "fr"] as const).map((code) => (
                  <DropdownMenuItem
                    key={code}
                    onClick={() => changeLanguage(code)}
                    data-testid={`menu-lang-${code}`}
                  >
                    <Check className={`size-3.5 me-2 ${locale === code ? "opacity-100" : "opacity-0"}`} />
                    <span className="text-small">{LANG_NATIVE[code]}</span>
                  </DropdownMenuItem>
                ))}
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

          {user && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  // Keep the menu mounted long enough for the mutation to fire;
                  // the signOut hook will hard-redirect to /signin on success.
                  e.preventDefault();
                  if (!isSigningOut) signOut();
                }}
                disabled={isSigningOut}
                data-testid="menu-signout"
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="size-3.5 me-2 opacity-70" />
                <span className="text-small">
                  {isSigningOut ? t("signing_out") : t("sign_out")}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
