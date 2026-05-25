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
import SalesInvoices from "@/pages/sales/invoices";
import SalesInvoiceDetail from "@/pages/sales/invoice-detail";
import SalesCustomers from "@/pages/sales/customers";
import PurchaseBills from "@/pages/purchases/bills";
import PurchaseBillDetail from "@/pages/purchases/bill-detail";
import PurchaseVendors from "@/pages/purchases/vendors";
import PurchasePayments from "@/pages/purchases/payments";
import SalesPayments from "@/pages/sales/payments";
import PurchaseApAging from "@/pages/purchases/ap-aging";
import InventoryItems from "@/pages/inventory/items";
import InventoryCategories from "@/pages/inventory/categories";
import InventoryLocations from "@/pages/inventory/locations";
import InventoryTransactions from "@/pages/inventory/transactions";
import InventoryAlerts from "@/pages/inventory/alerts";
import InventoryValuation from "@/pages/inventory/valuation";
import SettingsPage from "@/pages/settings";
import BankingAccountsPage from "@/pages/banking/accounts";
import BankingTransactionsPage from "@/pages/banking/transactions";
import ZatcaSettingsPage from "@/pages/settings/zatca";
import Styleguide from "@/pages/styleguide";

// Marketing pages
import PlatformPage from "@/pages/marketing/platform";
import InvoicesMarketingPage from "@/pages/marketing/invoices";
import AccountingPage from "@/pages/marketing/accounting";
import HrPayrollPage from "@/pages/marketing/hr-payroll";
import FixedAssetsMarketingPage from "@/pages/marketing/fixed-assets";
import ReportsMarketingPage from "@/pages/marketing/reports";
import AiAssistantMarketingPage from "@/pages/marketing/ai-assistant";
import CockpitPage from "@/pages/marketing/cockpit";
import PredictivePage from "@/pages/marketing/predictive";
import CountrySaPage from "@/pages/marketing/country-sa";
import CountryAePage from "@/pages/marketing/country-ae";
import CountryEgPage from "@/pages/marketing/country-eg";
import CountryKwPage from "@/pages/marketing/country-kw";
import CountryQaPage from "@/pages/marketing/country-qa";
import CountryJoPage from "@/pages/marketing/country-jo";
import CountryIntlPage from "@/pages/marketing/country-intl";
import AboutPage from "@/pages/marketing/about";
import CustomersPage from "@/pages/marketing/customers";
import BlogPage from "@/pages/marketing/blog";
import JobsPage from "@/pages/marketing/jobs";
import ContactPage from "@/pages/marketing/contact";
import PrivacyPage from "@/pages/marketing/privacy";
import TermsPage from "@/pages/marketing/terms";
import SecurityPage from "@/pages/marketing/security";

// Auth pages
import SignInPage from "@/pages/auth/sign-in";
import SignUpPage from "@/pages/auth/sign-up";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ResetPasswordPage from "@/pages/auth/reset-password";
import AcceptInvitationPage from "@/pages/auth/accept-invitation";

// Settings sub-pages
import MembersPage from "@/pages/settings/members";
import ProfilePage from "@/pages/settings/profile";
import EmailDeliveryPage from "@/pages/settings/email-delivery";

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
      <Route path="/app/sales/invoices" component={SalesInvoices} />
      <Route path="/app/sales/invoices/:id" component={SalesInvoiceDetail} />
      <Route path="/app/sales/customers" component={SalesCustomers} />
      <Route path="/app/purchases/bills" component={PurchaseBills} />
      <Route path="/app/purchases/bills/:id" component={PurchaseBillDetail} />
      <Route path="/app/purchases/vendors" component={PurchaseVendors} />
      <Route path="/app/purchases/payments" component={PurchasePayments} />
      <Route path="/app/sales/payments" component={SalesPayments} />
      <Route path="/app/purchases/ap-aging" component={PurchaseApAging} />
      <Route path="/app/inventory/items" component={InventoryItems} />
      <Route path="/app/inventory/categories" component={InventoryCategories} />
      <Route path="/app/inventory/locations" component={InventoryLocations} />
      <Route path="/app/inventory/transactions" component={InventoryTransactions} />
      <Route path="/app/inventory/alerts" component={InventoryAlerts} />
      <Route path="/app/inventory/valuation" component={InventoryValuation} />
      <Route path="/app/settings" component={SettingsPage} />
      <Route path="/app/settings/members" component={MembersPage} />
      <Route path="/app/settings/profile" component={ProfilePage} />
      <Route path="/app/settings/email-delivery" component={EmailDeliveryPage} />
      <Route path="/app/settings/zatca" component={ZatcaSettingsPage} />
      <Route path="/app/banking/accounts" component={BankingAccountsPage} />
      <Route path="/app/banking/transactions" component={BankingTransactionsPage} />
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
  // Legacy invite URL — redirect to the real auth flow. Old invitation
  // emails or shared links pasted in chat keep working without dragging
  // the retired /api/team/invites/accept endpoint along with them.
  if (location.startsWith("/invite/")) {
    const token = location.slice("/invite/".length);
    return <Redirect to={`/accept-invitation/${token}`} />;
  }
  if (location === "/signin") return <SignInPage />;
  if (location === "/signup") return <SignUpPage />;
  if (location === "/forgot-password") return <ForgotPasswordPage />;
  if (location.startsWith("/reset-password/")) return <ResetPasswordPage />;
  if (location.startsWith("/accept-invitation/")) return <AcceptInvitationPage />;

  if (LEGACY_REDIRECTS[location]) {
    return <LegacyRedirect to={LEGACY_REDIRECTS[location]} />;
  }

  // Marketing pages — product
  if (location === "/platform")              return <PlatformPage />;
  if (location === "/product/invoices")      return <InvoicesMarketingPage />;
  if (location === "/product/accounting")    return <AccountingPage />;
  if (location === "/product/hr")            return <HrPayrollPage />;
  if (location === "/product/fixed-assets")  return <FixedAssetsMarketingPage />;
  if (location === "/product/reports")       return <ReportsMarketingPage />;
  // Marketing pages — AI
  if (location === "/ai/assistant")          return <AiAssistantMarketingPage />;
  if (location === "/ai/cockpit")            return <CockpitPage />;
  if (location === "/ai/predictive")         return <PredictivePage />;
  // Marketing pages — countries
  if (location === "/countries/sa")              return <CountrySaPage />;
  if (location === "/countries/ae")              return <CountryAePage />;
  if (location === "/countries/eg")              return <CountryEgPage />;
  if (location === "/countries/kw")              return <CountryKwPage />;
  if (location === "/countries/qa")              return <CountryQaPage />;
  if (location === "/countries/jo")              return <CountryJoPage />;
  if (location === "/countries/international")   return <CountryIntlPage />;
  // Marketing pages — company
  if (location === "/about")     return <AboutPage />;
  if (location === "/customers") return <CustomersPage />;
  if (location === "/blog")      return <BlogPage />;
  if (location === "/jobs")      return <JobsPage />;
  if (location === "/contact")   return <ContactPage />;
  // Legal & trust pages
  if (location === "/privacy")   return <PrivacyPage />;
  if (location === "/terms")     return <TermsPage />;
  if (location === "/security")  return <SecurityPage />;

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
