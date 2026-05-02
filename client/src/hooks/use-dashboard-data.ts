import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";

export { useTransactions } from "@/hooks/use-transactions";

export const dashboardKeys = {
  // Mirror the path that `useTransactions` uses so prefetching shares the
  // same cache entry and a future rename in `@shared/routes` keeps both in
  // sync automatically.
  transactions: [api.transactions.list.path] as const,
  alerts: ["/api/insights/alerts"] as const,
  journalEntries: ["/api/journal-entries"] as const,
  cashForecast: (days: number) =>
    ["/api/insights/cash-forecast", days] as const,
  inventoryValuation: ["/api/inventory/valuation"] as const,
  inventoryAlerts: ["/api/inventory/alerts"] as const,
  inventoryTransactions: ["/api/inventory/transactions"] as const,
};

async function fetchCashForecast(days: number) {
  const res = await fetch(`/api/insights/cash-forecast?days=${days}`);
  if (!res.ok) throw new Error("Failed to fetch cash forecast");
  return res.json();
}

export function useDashboardAlerts<
  T = { alerts: any[] },
>() {
  return useQuery<T>({ queryKey: dashboardKeys.alerts });
}

export function useDashboardJournalEntries() {
  return useQuery<any[]>({ queryKey: dashboardKeys.journalEntries });
}

export function useDashboardCashForecast(days = 30) {
  return useQuery<any>({
    queryKey: dashboardKeys.cashForecast(days),
    queryFn: () => fetchCashForecast(days),
  });
}

/** Kick off every dashboard query in parallel so individual widgets don't
 *  introduce fetch waterfalls. Always reuse this from new dashboard widgets
 *  rather than calling `prefetchQuery` ad-hoc. */
export function prefetchDashboardData(qc: QueryClient, cashForecastDays = 30) {
  qc.prefetchQuery({
    queryKey: dashboardKeys.cashForecast(cashForecastDays),
    queryFn: () => fetchCashForecast(cashForecastDays),
  });
  qc.prefetchQuery({ queryKey: dashboardKeys.alerts });
  qc.prefetchQuery({ queryKey: dashboardKeys.transactions });
  qc.prefetchQuery({ queryKey: dashboardKeys.journalEntries });
  qc.prefetchQuery({ queryKey: dashboardKeys.inventoryValuation });
  qc.prefetchQuery({ queryKey: dashboardKeys.inventoryAlerts });
  qc.prefetchQuery({ queryKey: dashboardKeys.inventoryTransactions });
}
