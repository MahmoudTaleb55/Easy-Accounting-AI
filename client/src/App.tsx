import { Switch, Route, useLocation, Redirect } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { MainLayout } from "@/components/layout/main-layout";

import { LocaleProvider } from "@/contexts/locale-context";
import { ThemeProvider } from "@/contexts/theme-context";

import Landing from "@/pages/landing";
import Demo from "@/pages/demo";

import Dashboard from "@/pages/dashboard";
import Transactions from "@/pages/transactions";
import Inbox from "@/pages/inbox";
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

// Auth pages
import SignInPage from "@/pages/auth/sign-in";
import SignUpPage from "@/pages/auth/sign-up";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ResetPasswordPage from "@/pages/auth/reset-password";
import AcceptInvitationPage from "@/pages/auth/accept-invitation";

// Settings sub-pages
import MembersPage from "@/pages/settings/members";
import ProfilePage from "@/pages/settings/profile";

import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

const isDev = import.meta.env.DEV;

const LEGACY_REDIRECTS: Record<string, string> = {
  "/dashboard": "/app",
  "/inbox": "/app/inbox",
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
      <Route path="/app/inbox" component={Inbox} />
      <Route path="/app/transactions" component={Transactions} />
      <Route path="/app/reports" component={Reports} />
      <Route path="/app/accounts" component={ChartOfAccounts} />
      <Route path="/app/journal" component={JournalEntries} />
      <Route path="/app/insights" component={Insights} />
      <Route path="/app/hr" component={HR} />
      <Route path="/app/fixed-assets" component={FixedAssets} />
      <Route path="/app/settings" component={SettingsPage} />
      <Route path="/app/settings/members" component={MembersPage} />
      <Route path="/app/settings/profile" component={ProfilePage} />
      <Route path="/app/ai-assistant" component={AiAssistant} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** Gate that redirects unauthenticated users to /signin. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Redirect to={`/signin?next=${encodeURIComponent(location)}`} />;
  }
  return <>{children}</>;
}

function Router() {
  const [location] = useLocation();

  if (location === "/styleguide") {
    if (!isDev) return <NotFound />;
    return <Styleguide />;
  }

  // Public routes
  if (location === "/") return <Landing />;
  if (location === "/demo") return <Demo />;
  if (location.startsWith("/invite/")) return <InviteAccept />;
  if (location === "/signin") return <SignInPage />;
  if (location === "/signup") return <SignUpPage />;
  if (location === "/forgot-password") return <ForgotPasswordPage />;
  if (location.startsWith("/reset-password/")) return <ResetPasswordPage />;
  if (location.startsWith("/accept-invitation/")) return <AcceptInvitationPage />;

  if (LEGACY_REDIRECTS[location]) {
    return <LegacyRedirect to={LEGACY_REDIRECTS[location]} />;
  }

  if (location === "/app" || location.startsWith("/app/")) {
    return (
      <RequireAuth>
        <MainLayout>
          <AppShellRoutes />
        </MainLayout>
      </RequireAuth>
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
