import { Switch, Route, useLocation } from "wouter";
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

// Pages
import Landing from "@/pages/landing";
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

const isDev = import.meta.env.DEV;

/** Public routes render OUTSIDE the authenticated MainLayout shell. */
const PUBLIC_ROUTES = new Set<string>(["/"]);

function AppRoutes() {
  return (
    <Switch>
      {/* Public — no app shell */}
      <Route path="/" component={Landing} />

      {/* App — wrapped in MainLayout via wrapper below */}
      <Route path="/dashboard"   component={Dashboard} />
      <Route path="/transactions" component={Transactions} />
      <Route path="/reports"     component={Reports} />
      <Route path="/accounts"    component={ChartOfAccounts} />
      <Route path="/journal"     component={JournalEntries} />
      <Route path="/insights"    component={Insights} />
      <Route path="/hr"          component={HR} />
      <Route path="/fixed-assets" component={FixedAssets} />
      <Route path="/settings"    component={SettingsPage} />
      <Route path="/ai-assistant" component={AiAssistant} />

      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const [location] = useLocation();

  // Styleguide is a standalone, dev-only route — rendered without the app shell.
  if (location === "/styleguide") {
    if (!isDev) return <NotFound />;
    return <Styleguide />;
  }

  // Public routes (e.g. landing) render OUTSIDE the authenticated MainLayout shell.
  if (PUBLIC_ROUTES.has(location)) {
    return <AppRoutes />;
  }

  return (
    <MainLayout>
      <AppRoutes />
    </MainLayout>
  );
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
