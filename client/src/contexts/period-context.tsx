import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, subDays, differenceInCalendarDays,
} from "date-fns";

export type PeriodKey = "today" | "week" | "month" | "quarter" | "ytd" | "30d" | "custom";

export interface PeriodRange {
  key: PeriodKey;
  start: Date;
  end: Date;
}

interface PeriodContextValue {
  period: PeriodRange;
  setPeriodKey: (k: PeriodKey) => void;
  /**
   * Switch the global period to the smallest preset that contains the
   * given date. When no preset (today/week/30d/month/quarter/ytd) covers
   * it — typically because the date is in a different calendar year —
   * fall back to a custom calendar-month window around the date so the
   * period still aligns to an accounting boundary instead of a sliding
   * arbitrary window.
   */
  setPeriodToInclude: (date: Date) => void;
  compareToPrevious: boolean;
  setCompareToPrevious: (v: boolean) => void;
  previousRange: PeriodRange;
}

// Preset keys, ordered smallest-window-first. `pickPeriodKeyForDate`
// walks this list and returns the first key whose [start, end] (as
// computed against `now`) contains the target date. Keeping today
// before week before 30d/month/quarter/ytd surfaces the *tightest*
// window — so jumping to the nearest posting lands in the most
// focused range that still includes it.
const PRESET_KEY_ORDER: Exclude<PeriodKey, "custom">[] = [
  "today",
  "week",
  "30d",
  "month",
  "quarter",
  "ytd",
];

function presetRangeFor(key: Exclude<PeriodKey, "custom">, now: Date): PeriodRange {
  switch (key) {
    case "today":   return { key, start: startOfDay(now), end: endOfDay(now) };
    case "week":    return { key, start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
    case "month":   return { key, start: startOfMonth(now), end: endOfMonth(now) };
    case "quarter": return { key, start: startOfQuarter(now), end: endOfQuarter(now) };
    case "ytd":     return { key, start: startOfYear(now), end: endOfDay(now) };
    case "30d":     return { key, start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
  }
}

/**
 * Return the smallest preset PeriodKey whose range (anchored on `now`)
 * contains the given target date, or `null` if no preset covers it.
 *
 * Pure / deterministic so it can be unit-tested without a React tree —
 * the period-context test file imports it directly.
 */
export function pickPeriodKeyForDate(
  target: Date,
  now: Date = new Date(),
): Exclude<PeriodKey, "custom"> | null {
  const ms = target.getTime();
  for (const k of PRESET_KEY_ORDER) {
    const r = presetRangeFor(k, now);
    if (ms >= r.start.getTime() && ms <= r.end.getTime()) return k;
  }
  return null;
}

/**
 * Build the custom-range fallback for `setPeriodToInclude` — the
 * calendar month containing the target date. We snap to month
 * boundaries instead of, say, ±15 days around the date because
 * accounting users think in calendar months and the resulting window
 * matches every other surface that shows monthly figures.
 */
function customMonthRangeFor(date: Date): PeriodRange {
  return { key: "custom", start: startOfMonth(date), end: endOfMonth(date) };
}

function previousFor(r: PeriodRange): PeriodRange {
  const days = Math.max(1, differenceInCalendarDays(r.end, r.start) + 1);
  return { key: r.key, start: subDays(r.start, days), end: subDays(r.end, days) };
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  // The active selection is one of:
  //   • a preset key (today/week/…) — `customRange` is null and `period`
  //     is derived from `now` every render via `presetRangeFor`.
  //   • a custom calendar-month window — `customRange` holds the exact
  //     start/end pair and `periodKey` is "custom" for selectors to
  //     reflect.
  // Switching back to a preset via `setPeriodKey` clears `customRange`
  // so the next render re-derives a live "now"-anchored range.
  const [periodKey, setPeriodKeyState] = useState<PeriodKey>("month");
  const [customRange, setCustomRange] = useState<PeriodRange | null>(null);
  const [compareToPrevious, setCompareToPrevious] = useState(true);

  const period = useMemo<PeriodRange>(() => {
    if (periodKey === "custom" && customRange) return customRange;
    // Defensive: if periodKey is "custom" but no range is set (shouldn't
    // happen via the public API), fall back to "month" so we never hand
    // out an undefined range.
    const fallback = periodKey === "custom" ? "month" : periodKey;
    return presetRangeFor(fallback, new Date());
  }, [periodKey, customRange]);

  const setPeriodKey = useCallback((k: PeriodKey) => {
    // Clear any custom range when the user re-picks a preset so the
    // next render re-derives a live "now"-anchored window. If the
    // caller asks for "custom" without going through
    // `setPeriodToInclude`, leave the existing customRange alone (or
    // null) — the `period` memo handles the missing-range fallback.
    if (k !== "custom") setCustomRange(null);
    setPeriodKeyState(k);
  }, []);

  const setPeriodToInclude = useCallback((target: Date) => {
    const presetKey = pickPeriodKeyForDate(target);
    if (presetKey) {
      setCustomRange(null);
      setPeriodKeyState(presetKey);
      return;
    }
    setCustomRange(customMonthRangeFor(target));
    setPeriodKeyState("custom");
  }, []);

  const previousRange = useMemo(() => previousFor(period), [period]);
  const value = useMemo(
    () => ({
      period,
      setPeriodKey,
      setPeriodToInclude,
      compareToPrevious,
      setCompareToPrevious,
      previousRange,
    }),
    [period, setPeriodKey, setPeriodToInclude, compareToPrevious, previousRange]
  );
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod must be used within <PeriodProvider>");
  return ctx;
}
