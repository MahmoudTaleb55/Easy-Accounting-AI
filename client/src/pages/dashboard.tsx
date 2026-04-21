import { PeriodBar } from "@/components/dashboard/period-bar";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { AttentionQueue } from "@/components/dashboard/attention-queue";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { CategoryList } from "@/components/dashboard/category-list";
import { RecentActivity } from "@/components/dashboard/recent-activity";

export default function Dashboard() {
  return (
    <div className="space-y-8" data-testid="page-dashboard">
      <PeriodBar />
      <KpiStrip />
      <AttentionQueue />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><ActivityChart /></div>
        <CategoryList />
      </div>
      <RecentActivity />
    </div>
  );
}
