import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

// Layout
import { MainLayout } from "@/components/layout/main-layout";

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
  const isPublic = PUBLIC_ROUTES.has(location);

  if (isPublic) {
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
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
