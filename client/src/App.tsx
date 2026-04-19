import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

// Components
import { MainLayout } from "@/components/layout/main-layout";

// Pages
import Dashboard from "@/pages/dashboard";
import Transactions from "@/pages/transactions";
import AiAssistant from "@/pages/ai-assistant";
import Reports from "@/pages/reports";
import ChartOfAccounts from "@/pages/chart-of-accounts";
import JournalEntries from "@/pages/journal-entries";
import Insights from "@/pages/insights";
import HR from "@/pages/hr";
import SettingsPage from "@/pages/settings";

function Router() {
  return (
    <MainLayout>
      <Switch>
        <Route path="/" component={Dashboard}/>
        <Route path="/transactions" component={Transactions}/>
        <Route path="/reports" component={Reports}/>
        <Route path="/accounts" component={ChartOfAccounts}/>
        <Route path="/journal" component={JournalEntries}/>
        <Route path="/insights" component={Insights}/>
        <Route path="/hr" component={HR}/>
        <Route path="/settings" component={SettingsPage}/>
        <Route path="/ai-assistant" component={AiAssistant}/>
        <Route component={NotFound} />
      </Switch>
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
