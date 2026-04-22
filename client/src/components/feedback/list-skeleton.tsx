import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ListSkeletonProps {
  rows?: number;
  className?: string;
  testId?: string;
}

export function ListSkeleton({ rows = 5, className, testId }: ListSkeletonProps) {
  return (
    <Card
      variant="default"
      className={cn("p-0 overflow-hidden", className)}
      data-testid={testId || "list-skeleton"}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Skeleton className="h-7 w-7 rounded-md shrink-0" />
              <div className="space-y-2 flex-1 min-w-0">
                <Skeleton className="h-3.5 w-2/5 max-w-[16rem]" />
                <Skeleton className="h-2.5 w-1/4 max-w-[10rem]" />
              </div>
            </div>
            <Skeleton className="h-3.5 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}

interface CardGridSkeletonProps {
  count?: number;
  height?: string;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}

export function CardGridSkeleton({
  count = 4,
  height = "h-32",
  cols = 4,
  className,
}: CardGridSkeletonProps) {
  const colClass =
    cols === 1
      ? "grid-cols-1"
      : cols === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : cols === 3
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-2 lg:grid-cols-4";
  return (
    <div className={cn("grid gap-3", colClass, className)} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn(height, "rounded-lg")} />
      ))}
    </div>
  );
}
