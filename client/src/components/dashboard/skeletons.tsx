import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeletons that match the final geometry of each dashboard widget.
 * Goal: zero layout shift when the real data arrives.
 */

export function KpiStripSkeleton() {
  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-3 gap-3"
      data-testid="kpi-strip-loading"
    >
      {/* Hero card — matches HeroCash height & padding */}
      <div className="border border-border bg-card rounded-xl p-6 lg:row-span-2 flex flex-col gap-6 min-h-[18rem]">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="space-y-1.5 text-end">
            <Skeleton className="h-5 w-12 ms-auto" />
            <Skeleton className="h-2.5 w-16 ms-auto" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="mt-auto pt-6">
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      </div>

      {/* Four small tiles in a 1→2 col grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:col-span-2 gap-3 auto-rows-fr">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border border-border bg-card rounded-xl p-4 flex flex-col gap-3 min-h-[8rem]"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-10 rounded-full" />
            </div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-auto h-6 w-full rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AttentionQueueSkeleton() {
  return (
    <section data-testid="attention-loading">
      <div className="flex items-baseline justify-between mb-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-6" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-md border border-border bg-card p-3 min-h-[4.25rem]"
          >
            <Skeleton className="h-4 w-4 rounded-sm shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full max-w-[18rem]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ActivityChartSkeleton() {
  return (
    <section
      className="border border-border bg-card rounded-md"
      data-testid="activity-chart-loading"
    >
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-border">
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-44" />
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
      <div className="px-4 py-4 h-72 flex items-end gap-1.5">
        {Array.from({ length: 18 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-sm"
            style={{ height: `${30 + ((i * 37) % 60)}%` }}
          />
        ))}
      </div>
    </section>
  );
}

export function CategoryListSkeleton() {
  return (
    <section
      className="border border-border bg-card rounded-md flex flex-col"
      data-testid="category-list-loading"
    >
      <div className="px-4 py-3 border-b border-border space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="flex-1 px-4 py-3 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton
              className="h-1.5 rounded-full"
              style={{ width: `${90 - i * 12}%` }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function RecentActivitySkeleton() {
  return (
    <section
      className="border border-border bg-card rounded-md"
      data-testid="recent-activity-loading"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[6rem_1fr_6rem_5rem] sm:grid-cols-[8rem_1fr_8rem_8rem] items-center gap-3 px-4 py-2.5"
          >
            <Skeleton className="h-3 w-16" />
            <div className="flex items-center gap-2 min-w-0">
              <Skeleton className="h-5 w-5 rounded-sm shrink-0" />
              <Skeleton className="h-3.5 w-full max-w-[16rem]" />
            </div>
            <Skeleton className="h-3 w-20 hidden sm:block" />
            <Skeleton className="h-3.5 w-16 ms-auto" />
          </div>
        ))}
      </div>
    </section>
  );
}
