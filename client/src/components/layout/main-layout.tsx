import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileHeader } from "./app-sidebar";
import { CompanyProvider } from "@/contexts/company-context";
import { getUrlLocaleOverride, useLocale, type Locale } from "@/contexts/locale-context";
import { PeriodProvider } from "@/contexts/period-context";
import { TopBar } from "./topbar";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { AiRail } from "./ai-rail";
import { ReadOnlyBanner } from "./readonly-banner";
import { EmailDeliveryAlertBanner } from "./email-delivery-alert-banner";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

const SUPPORTED_LOCALES: Locale[] = ["ar", "en", "de", "fr"];

const LOCALE_STORAGE_KEY = "app.locale";

// Snapshot whether this device already had an explicit locale picked in
// localStorage *before* any React code ran. The LocaleProvider's mount
// effect rewrites localStorage on first paint, so we have to capture the
// pre-mount state at module load time — once React has booted, the
// distinction between "user explicitly picked en here" and "provider just
// wrote its default to storage" is gone.
const HAD_PRELOADED_LOCALE: boolean = (() => {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return v === "ar" || v === "en" || v === "de" || v === "fr";
  } catch {
    return false;
  }
})();

/**
 * Sync the in-memory locale with the user's saved preference on initial load.
 *
 * Source of truth (in priority order):
 *   1. An explicit per-device choice already saved in `localStorage` before
 *      this session started. Once a user has picked a locale on this
 *      device — via the topbar, profile page, or any other channel that
 *      writes `app.locale` — that pick is treated as authoritative for
 *      this device. Otherwise an English-preferring user whose server
 *      profile still carries the schema default (`'ar'`) would silently
 *      flip back to Arabic on every reload, which is the bug the
 *      email-delivery alert banner was hitting end-to-end.
 *   2. The signed-in user's `preferredLocale` (per-user, written by the
 *      topbar language picker and the profile page). Applied on the
 *      first load on a brand-new device (no localStorage value yet) so
 *      the cross-device preference still propagates. The topbar also
 *      mutates the in-memory locale optimistically and PATCHes the
 *      profile, so the two stay in sync after that.
 *   3. The org-wide `settings.locale` (Settings page). Only consulted when
 *      no user is signed in (e.g. shared / unauthenticated views inside
 *      the shell). When the user query is still loading we wait — applying
 *      the org locale prematurely would briefly flip the UI before the
 *      user's preference arrives a few ms later.
 *
 * The effect only fires when the *server-reported* preferred locale changes —
 * never when the in-memory `locale` changes. The ref tracks the last value we
 * adopted from the API so the same value isn't re-applied (which would fight
 * the topbar/Settings flow that mutate the in-memory locale optimistically).
 */
function LocaleSync() {
  const { setLocale } = useLocale();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { data: settings } = useQuery<{ locale?: string }>({ queryKey: ["/api/settings"] });
  const lastAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    // A `?lang=<locale>` URL override is the explicit, deep-link signal that
    // the caller wants this locale for the lifetime of the page. Honour it by
    // skipping server-side reconciliation entirely — otherwise the user's
    // stored `preferredLocale` (default `'ar'`) would clobber the override
    // moments after `/api/auth/user` resolves. Used by e2e tests that need
    // a known language for headline/text assertions.
    if (getUrlLocaleOverride()) return;
    // Wait for the auth query to settle before deciding which source to honour,
    // otherwise we can briefly apply the org locale and then flip to the user's
    // personal locale a render later.
    if (isAuthLoading) return;
    const userPref = user?.preferredLocale;
    const orgPref = settings?.locale;
    const remote = user
      ? userPref && SUPPORTED_LOCALES.includes(userPref as Locale)
        ? userPref
        : null
      : orgPref && SUPPORTED_LOCALES.includes(orgPref as Locale)
        ? orgPref
        : null;
    if (!remote) return;
    if (lastAppliedRef.current === remote) return;
    // First time we're seeing a remote preference this session: if this
    // device already had an explicit local pick, trust it and just
    // remember what the server reported so a future *change* (e.g. the
    // user picks a different locale via the topbar, which refetches
    // /api/auth/user) can still flow through normally.
    if (lastAppliedRef.current === null && HAD_PRELOADED_LOCALE) {
      lastAppliedRef.current = remote;
      return;
    }
    lastAppliedRef.current = remote;
    setLocale(remote as Locale);
  }, [user, user?.preferredLocale, settings?.locale, isAuthLoading, setLocale]);
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { dir } = useLocale();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [location] = useLocation();
  useCommandPaletteShortcut(setPaletteOpen);

  // Dashboard breathes; transactional/dense pages widen.
  const isDashboard = location === "/app";

  return (
    <div className="flex min-h-screen w-full bg-background font-sans text-foreground" dir={dir}>
      <LocaleSync />
      <AppSidebar />
      <div className="flex flex-col flex-1 w-full min-w-0 relative">
        <MobileHeader />
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onToggleAiRail={() => setAiOpen((v) => !v)}
          aiRailOpen={aiOpen}
        />
        <ReadOnlyBanner />
        <EmailDeliveryAlertBanner />
        <main
          className={`flex-1 w-full mx-auto px-4 md:px-8 lg:px-10 py-6 md:py-8 ${
            isDashboard ? "max-w-[1400px]" : "max-w-[1600px]"
          }`}
        >
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <AiRail open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.25rem",
  } as React.CSSProperties;

  return (
    <CompanyProvider>
      <PeriodProvider>
        <SidebarProvider style={style}>
          <Shell>{children}</Shell>
        </SidebarProvider>
      </PeriodProvider>
    </CompanyProvider>
  );
}
