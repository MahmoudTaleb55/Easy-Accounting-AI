import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PeriodBar } from "@/components/dashboard/period-bar";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { AttentionQueue } from "@/components/dashboard/attention-queue";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { CategoryList } from "@/components/dashboard/category-list";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { WidgetBoundary } from "@/components/dashboard/widget-boundary";
import {
  KpiStripSkeleton,
  AttentionQueueSkeleton,
  ActivityChartSkeleton,
  CategoryListSkeleton,
  RecentActivitySkeleton,
} from "@/components/dashboard/skeletons";

export default function Dashboard() {
  const qc = useQueryClient();

  // Kick off the heavier endpoints in parallel as soon as the dashboard mounts
  // so individual widgets don't have to wait for each other to start fetching.
  useEffect(() => {
    qc.prefetchQuery({
      queryKey: ["/api/insights/cash-forecast", 30],
      queryFn: () =>
        fetch("/api/insights/cash-forecast?days=30").then((r) => r.json()),
    });
    qc.prefetchQuery({ queryKey: ["/api/insights/alerts"] });
    qc.prefetchQuery({ queryKey: ["/api/transactions"] });
    qc.prefetchQuery({ queryKey: ["/api/journal-entries"] });
  }, [qc]);

  return (
    <div className="space-y-6 md:space-y-8" data-testid="page-dashboard">
      <PeriodBar />

      <WidgetBoundary fallback={<KpiStripSkeleton />} label="KPI strip">
        <KpiStrip />
      </WidgetBoundary>

      <WidgetBoundary fallback={<AttentionQueueSkeleton />} label="Attention queue">
        <AttentionQueue />
      </WidgetBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0">
          <WidgetBoundary fallback={<ActivityChartSkeleton />} label="Activity chart">
            <ActivityChart />
          </WidgetBoundary>
        </div>
        <div className="min-w-0">
          <WidgetBoundary fallback={<CategoryListSkeleton />} label="Categories">
            <CategoryList />
          </WidgetBoundary>
        </div>
      </div>

      <WidgetBoundary fallback={<RecentActivitySkeleton />} label="Recent activity">
        <RecentActivity />
      </WidgetBoundary>
    </div>
  );
}
