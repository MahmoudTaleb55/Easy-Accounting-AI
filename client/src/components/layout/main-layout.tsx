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
import { useLocation } from "wouter";

const SUPPORTED_LOCALES: Locale[] = ["ar", "en", "de", "fr"];

/**
 * Adopt the org's saved locale on initial load, then stay out of the way.
 *
 * The effect only fires when the *server-reported* locale changes — never when
 * the in-memory `locale` changes. That's important: the topbar/settings let the
 * user pick a language, and we must not fight back when they do. The ref tracks
 * the last value we adopted from the API so the same value isn't re-applied.
 */
function LocaleSync() {
  const { setLocale } = useLocale();
  const { data } = useQuery<{ locale?: string }>({ queryKey: ["/api/settings"] });
  const lastAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const remote = data?.locale;
    if (!remote || !SUPPORTED_LOCALES.includes(remote as Locale)) return;
    if (lastAppliedRef.current === remote) return;
    lastAppliedRef.current = remote;
    setLocale(remote as Locale);
  }, [data?.locale, setLocale]);
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
