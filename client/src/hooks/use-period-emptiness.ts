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

/**
 * One-line preview of the nearest out-of-window posting so owners can see
 * *what* they're about to land on before they take the jump (Task #367).
 * `accountName` is the representative leg's name (the line with the largest
 * absolute amount on that JE), and `amount` is the entry's total debit
 * (== total credit for a balanced JE). All fields are optional because a
 * legacy/imported JE may be missing a description or have lines without a
 * resolved account record.
 */
export interface NearestPostingPreview {
  reference: string;
  description: string;
  accountName: string;
  amount: number;
}

export interface PeriodEmptinessHint {
  ready: boolean;
  hasAnyHistory: boolean;
  isEmpty: boolean;
  nearest:
    | ({ date: Date; side: "past" | "future" } & Partial<NearestPostingPreview>)
    | null;
}

interface JournalLineLite {
  accountId: number;
  debit: string | number | null;
  credit: string | number | null;
  account?: {
    nameAr?: string | null;
    nameEn?: string | null;
  } | null;
}

interface JournalEntryListItem {
  id: number;
  entryDate: string;
  reference: string;
  description: string;
  lines?: JournalLineLite[];
}

/**
 * Pick a representative account name for a JE: the line with the largest
 * |debit| + |credit|. For a typical 2-line JE this picks whichever side
 * has the populated leg (since the other line carries the same magnitude
 * on the opposite side, both qualify and the first one wins). Returns ""
 * when no line has a resolved account, so the caller can decide to omit
 * the field rather than render a placeholder.
 */
export function pickRepresentativeAccountName(
  lines: readonly JournalLineLite[] | undefined,
  preferAr: boolean,
): string {
  if (!lines || lines.length === 0) return "";
  let best: { line: JournalLineLite; magnitude: number } | null = null;
  for (const l of lines) {
    const debit = Math.abs(Number(l.debit ?? 0));
    const credit = Math.abs(Number(l.credit ?? 0));
    const magnitude = debit + credit;
    if (!best || magnitude > best.magnitude) {
      best = { line: l, magnitude };
    }
  }
  const account = best?.line.account;
  if (!account) return "";
  if (preferAr) return account.nameAr || account.nameEn || "";
  return account.nameEn || account.nameAr || "";
}

/** Sum of debits on a balanced JE (== sum of credits). */
export function totalEntryAmount(
  lines: readonly JournalLineLite[] | undefined,
): number {
  if (!lines || lines.length === 0) return 0;
  let total = 0;
  for (const l of lines) {
    total += Math.abs(Number(l.debit ?? 0));
  }
  return total;
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
 *
 * `preferAr` controls which language wins when picking the
 * representative account name on the nearest-posting preview, so the
 * one-liner reads naturally for the active UI locale (Task #367).
 */
export function usePeriodEmptinessHint(
  period: PeriodRange,
  preferAr: boolean = true,
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
    if (!nearest) {
      return { ready: true, hasAnyHistory: true, isEmpty: true, nearest: null };
    }
    // Resolve the JE that produced this timestamp so we can surface a
    // "what am I jumping to?" preview. Multiple entries can share a
    // millisecond — pick the most recently created (highest id) so the
    // preview matches the row a user would land on first.
    const targetMs = nearest.date.getTime();
    let candidate: JournalEntryListItem | null = null;
    for (const e of entries) {
      const ms = new Date(e.entryDate).getTime();
      if (ms !== targetMs) continue;
      if (!candidate || e.id > candidate.id) candidate = e;
    }
    if (!candidate) {
      return {
        ready: true,
        hasAnyHistory: true,
        isEmpty: true,
        nearest,
      };
    }
    return {
      ready: true,
      hasAnyHistory: true,
      isEmpty: true,
      nearest: {
        ...nearest,
        reference: candidate.reference,
        description: candidate.description,
        accountName: pickRepresentativeAccountName(candidate.lines, preferAr),
        amount: totalEntryAmount(candidate.lines),
      },
    };
  }, [entries, postingMs, period.start, period.end, preferAr]);
}
