import { useEffect, useState } from "react";
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

function LocaleSync() {
  const { locale, setLocale } = useLocale();
  const { data } = useQuery<{ locale?: string }>({ queryKey: ["/api/settings"] });
  useEffect(() => {
    const remote = data?.locale;
    if (remote && SUPPORTED_LOCALES.includes(remote as Locale) && remote !== locale) {
      setLocale(remote as Locale);
    }
  }, [data?.locale, locale, setLocale]);
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
