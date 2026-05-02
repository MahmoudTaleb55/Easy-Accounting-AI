import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import type { PeriodRange } from "@/contexts/period-context";

/**
 * Find the posting timestamp closest to — but outside — `[start, end]`.
 * Distance is measured against the nearer boundary on each side, and
 * `<` (strict) keeps the choice stable across renders for ties.
 *
 * Pure so the unit suite can pin behaviour without React.
 */
export function findNearestPostingOutsidePeriod(
  postingMs: readonly number[],
  start: Date,
  end: Date,
): { date: Date; side: "past" | "future" } | null {
  const startMs = start.getTime();
  const endMs = end.getTime();
  let best: { ms: number; side: "past" | "future"; distance: number } | null =
    null;
  for (const ms of postingMs) {
    if (ms >= startMs && ms <= endMs) continue;
    const side: "past" | "future" = ms < startMs ? "past" : "future";
    const distance = side === "past" ? startMs - ms : ms - endMs;
    if (!best || distance < best.distance) {
      best = { ms, side, distance };
    }
  }
  return best ? { date: new Date(best.ms), side: best.side } : null;
}

/** Inclusive on both ends — matches every other in-period filter. */
export function periodHasAnyPosting(
  postingMs: readonly number[],
  start: Date,
  end: Date,
): boolean {
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const ms of postingMs) {
    if (ms >= startMs && ms <= endMs) return true;
  }
  return false;
}

export interface PeriodEmptinessHint {
  ready: boolean;
  hasAnyHistory: boolean;
  isEmpty: boolean;
  nearest: { date: Date; side: "past" | "future" } | null;
}

interface JournalEntryListItem {
  id: number;
  entryDate: string;
}

/**
 * "This period is empty across the whole workspace — jump to the
 * nearest posting?" hint for the period-chip / topbar period popover.
 *
 * Workspace scoping: the queryKey embeds `activeCompanyId`, so
 * switching companies in the topbar selector evicts the previous
 * workspace's data instead of leaking it into the hint. The default
 * queryClient has `staleTime: Infinity`, so a plain `["/api/journal-
 * entries"]` key would otherwise serve the prior workspace's entries
 * after a switch.
 */
export function usePeriodEmptinessHint(
  period: PeriodRange,
): PeriodEmptinessHint {
  const { activeCompanyId } = useAuth();
  const { data: entries } = useQuery<JournalEntryListItem[]>({
    queryKey: ["/api/journal-entries", "period-hint", activeCompanyId],
    enabled: activeCompanyId != null,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/journal-entries");
      return res.json();
    },
  });

  const postingMs = useMemo(() => {
    if (!entries || entries.length === 0) return [] as number[];
    const out: number[] = [];
    for (const e of entries) {
      const ms = new Date(e.entryDate).getTime();
      if (Number.isFinite(ms)) out.push(ms);
    }
    return out;
  }, [entries]);

  return useMemo<PeriodEmptinessHint>(() => {
    if (!entries) {
      return { ready: false, hasAnyHistory: false, isEmpty: false, nearest: null };
    }
    if (postingMs.length === 0) {
      return { ready: true, hasAnyHistory: false, isEmpty: false, nearest: null };
    }
    if (periodHasAnyPosting(postingMs, period.start, period.end)) {
      return { ready: true, hasAnyHistory: true, isEmpty: false, nearest: null };
    }
    const nearest = findNearestPostingOutsidePeriod(
      postingMs,
      period.start,
      period.end,
    );
    return { ready: true, hasAnyHistory: true, isEmpty: true, nearest };
  }, [entries, postingMs, period.start, period.end]);
}
