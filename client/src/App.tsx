import { Switch, Route, useLocation, Redirect } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

// Layout
import { MainLayout } from "@/components/layout/main-layout";

// Providers
import { LocaleProvider } from "@/contexts/locale-context";
import { ThemeProvider } from "@/contexts/theme-context";

// Pages — public
import Landing from "@/pages/landing";
import Demo from "@/pages/demo";

// Pages — authenticated app
import Dashboard from "@/pages/dashboard";
import Transactions from "@/pages/transactions";
import AiAssistant from "@/pages/ai-assistant";
import Reports from "@/pages/reports";
import ChartOfAccounts from "@/pages/chart-of-accounts";
import JournalEntries from "@/pages/journal-entries";
import Insights from "@/pages/insights";
import HR from "@/pages/hr";
import FixedAssets from "@/pages/fixed-assets";
import SettingsPage from "@/pages/settings";
import Styleguide from "@/pages/styleguide";
import InviteAccept from "@/pages/invite";

const isDev = import.meta.env.DEV;

/** Map of legacy in-app routes → new /app/* equivalents (kept stable for redirects). */
const LEGACY_REDIRECTS: Record<string, string> = {
  "/dashboard": "/app",
  "/transactions": "/app/transactions",
  "/reports": "/app/reports",
  "/accounts": "/app/accounts",
  "/journal": "/app/journal",
  "/insights": "/app/insights",
  "/hr": "/app/hr",
  "/fixed-assets": "/app/fixed-assets",
  "/settings": "/app/settings",
  "/ai-assistant": "/app/ai-assistant",
};

function LegacyRedirect({ to }: { to: string }) {
  return <Redirect to={to} />;
}

function AppShellRoutes() {
  return (
    <Switch>
      <Route path="/app" component={Dashboard} />
      <Route path="/app/transactions" component={Transactions} />
      <Route path="/app/reports" component={Reports} />
      <Route path="/app/accounts" component={ChartOfAccounts} />
      <Route path="/app/journal" component={JournalEntries} />
      <Route path="/app/insights" component={Insights} />
      <Route path="/app/hr" component={HR} />
      <Route path="/app/fixed-assets" component={FixedAssets} />
      <Route path="/app/settings" component={SettingsPage} />
      <Route path="/app/ai-assistant" component={AiAssistant} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const [location] = useLocation();

  // Standalone, dev-only styleguide — no shell.
  if (location === "/styleguide") {
    if (!isDev) return <NotFound />;
    return <Styleguide />;
  }

  // Public routes — render OUTSIDE the authenticated MainLayout shell.
  if (location === "/") return <Landing />;
  if (location === "/demo") return <Demo />;
  if (location.startsWith("/invite/")) return <InviteAccept />;

  // Legacy top-level in-app paths — permanently redirect to /app/* equivalents.
  if (LEGACY_REDIRECTS[location]) {
    return <LegacyRedirect to={LEGACY_REDIRECTS[location]} />;
  }

  // Authenticated app shell.
  if (location === "/app" || location.startsWith("/app/")) {
    return (
      <MainLayout>
        <AppShellRoutes />
      </MainLayout>
    );
  }

  return <NotFound />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <LocaleProvider defaultLocale="ar">
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
