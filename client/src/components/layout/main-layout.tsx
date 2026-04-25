import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileHeader } from "./app-sidebar";
import { CompanyProvider } from "@/contexts/company-context";
import { useLocale, type Locale } from "@/contexts/locale-context";
import { PeriodProvider } from "@/contexts/period-context";
import { TopBar } from "./topbar";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { AiRail } from "./ai-rail";
import { ReadOnlyBanner } from "./readonly-banner";
import { EmailDeliveryAlertBanner } from "./email-delivery-alert-banner";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

const SUPPORTED_LOCALES: Locale[] = ["ar", "en", "de", "fr"];

/**
 * Sync the in-memory locale with the user's saved preference on initial load.
 *
 * Source of truth (in priority order):
 *   1. The signed-in user's `preferredLocale` (per-user, written by the
 *      topbar language picker and the profile page). The `users.preferred_
 *      locale` column is NOT NULL with a `'ar'` default, so a row always
 *      carries a value — meaning the user path effectively wins for every
 *      authenticated request. That is the desired behaviour: the user's
 *      explicit choice must NOT be reverted by the org-level default
 *      (this was the original "topbar reverts to Arabic on reload" bug).
 *   2. The org-wide `settings.locale` (Settings page). Only consulted when
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
